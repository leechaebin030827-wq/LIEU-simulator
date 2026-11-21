/* LIEU Stage 3: Tilt stationary hold validation only. */

#include <Dynamixel2Arduino.h>
using namespace ControlTableItem;

static const uint8_t DXL_DIR_PIN = 2;
static const uint8_t TILT_ID = 2;
static const int32_t EXPECTED_DEFAULT_RAW = 2055;
static const int32_t DEFAULT_TOLERANCE_RAW = 100;
static const int32_t MAX_TRACKING_ERROR_RAW = 80;
static const uint32_t PROFILE_VELOCITY_RAW = 31;
static const uint32_t PROFILE_ACCELERATION_RAW = 4;
static const unsigned long HOLD_MS = 3000;
static const int32_t NUDGE_RAW = 10;
static const int32_t NUDGE_TOLERANCE_RAW = 2;
static const unsigned long MOVE_TIMEOUT_MS = 3000;

Dynamixel2Arduino dxl(Serial1, DXL_DIR_PIN);
char commandBuffer[24];
uint8_t commandLength = 0;
bool holding = false;
int32_t holdGoalRaw = 0;
unsigned long holdStartedMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastOtherOffMs = 0;

static int32_t readRaw(uint8_t id) {
  const float raw = dxl.getPresentPosition(id, UNIT_RAW);
  return isfinite(raw) ? lroundf(raw) : INT32_MIN;
}

static bool writeAndVerify(uint8_t item, int32_t value) {
  if (!dxl.writeControlTableItem(item, TILT_ID, value)) return false;
  return (int32_t)dxl.readControlTableItem(item, TILT_ID) == value;
}

static void releaseAll(const __FlashStringHelper* reason) {
  dxl.torqueOff(DXL_BROADCAST_ID);
  holding = false;
  Serial.print(F("RELEASE reason="));
  Serial.println(reason);
}

static void printStatus() {
  Serial.print(F("STATUS tilt_raw=")); Serial.print(readRaw(TILT_ID));
  Serial.print(F(" tilt_torque=")); Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, TILT_ID) == 1 ? 1 : 0);
  Serial.print(F(" other_torque="));
  for (uint8_t id : {1, 3, 4}) Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, id) == 1 ? '1' : '0');
  Serial.println();
}

static void startTiltHold() {
  releaseAll(F("pre-arm"));
  if (!dxl.ping(TILT_ID)) { Serial.println(F("REFUSE reason=tilt-not-found")); return; }
  int32_t present = readRaw(TILT_ID);
  if (present == INT32_MIN || labs(present - EXPECTED_DEFAULT_RAW) > DEFAULT_TOLERANCE_RAW) {
    Serial.print(F("REFUSE reason=not-at-default raw=")); Serial.println(present); return;
  }
  if ((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, TILT_ID) != 0) {
    Serial.println(F("REFUSE reason=hardware-error")); return;
  }
  dxl.torqueOff(TILT_ID);
  if (!dxl.setOperatingMode(TILT_ID, OP_EXTENDED_POSITION) ||
      !writeAndVerify(PROFILE_ACCELERATION, PROFILE_ACCELERATION_RAW) ||
      !writeAndVerify(PROFILE_VELOCITY, PROFILE_VELOCITY_RAW)) {
    releaseAll(F("setup-failed")); return;
  }
  present = readRaw(TILT_ID);
  if (present == INT32_MIN || !dxl.setGoalPosition(TILT_ID, present, UNIT_RAW)) {
    releaseAll(F("goal-current-failed")); return;
  }
  delay(30);
  if (labs(readRaw(TILT_ID) - present) > 4 ||
      (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, TILT_ID) != 0 ||
      !dxl.torqueOn(TILT_ID) ||
      (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, TILT_ID) != 1) {
    releaseAll(F("arm-verification-failed")); return;
  }
  holdGoalRaw = present;
  holdStartedMs = millis();
  holding = true;
  Serial.print(F("HOLD_STARTED id=2 goal=")); Serial.println(holdGoalRaw);
}

static bool waitForTiltTarget(int32_t startRaw, int32_t targetRaw, const char* phase) {
  const unsigned long startedMs = millis();
  while (millis() - startedMs < MOVE_TIMEOUT_MS) {
    const int32_t present = readRaw(TILT_ID);
    const int32_t hwError = (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, TILT_ID);
    const int32_t torque = (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, TILT_ID);
    if (present == INT32_MIN || hwError != 0 || torque != 1 ||
        present < min(startRaw, targetRaw) - 10 || present > max(startRaw, targetRaw) + 10) {
      releaseAll(F("nudge-monitor-fault")); return false;
    }
    Serial.print(F("NUDGE_STATUS phase=")); Serial.print(phase);
    Serial.print(F(" raw=")); Serial.print(present);
    Serial.print(F(" goal=")); Serial.print(targetRaw);
    Serial.print(F(" velocity=")); Serial.print((int32_t)dxl.readControlTableItem(PRESENT_VELOCITY, TILT_ID));
    Serial.print(F(" current=")); Serial.println((int32_t)dxl.readControlTableItem(PRESENT_CURRENT, TILT_ID));
    if (labs(present - targetRaw) <= NUDGE_TOLERANCE_RAW) return true;
    delay(50);
  }
  releaseAll(F("nudge-timeout"));
  return false;
}

static void runTiltNudge() {
  releaseAll(F("pre-nudge"));
  if (!dxl.ping(TILT_ID)) { Serial.println(F("REFUSE reason=tilt-not-found")); return; }
  int32_t startRaw = readRaw(TILT_ID);
  if (startRaw == INT32_MIN || labs(startRaw - EXPECTED_DEFAULT_RAW) > DEFAULT_TOLERANCE_RAW) {
    Serial.print(F("REFUSE reason=not-at-default raw=")); Serial.println(startRaw); return;
  }
  if ((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, TILT_ID) != 0) {
    Serial.println(F("REFUSE reason=hardware-error")); return;
  }
  dxl.torqueOff(TILT_ID);
  if (!dxl.setOperatingMode(TILT_ID, OP_EXTENDED_POSITION) ||
      !writeAndVerify(PROFILE_ACCELERATION, PROFILE_ACCELERATION_RAW) ||
      !writeAndVerify(PROFILE_VELOCITY, PROFILE_VELOCITY_RAW)) {
    releaseAll(F("nudge-setup-failed")); return;
  }
  startRaw = readRaw(TILT_ID);
  if (startRaw == INT32_MIN || !dxl.setGoalPosition(TILT_ID, startRaw, UNIT_RAW)) {
    releaseAll(F("nudge-goal-current-failed")); return;
  }
  delay(30);
  if (labs(readRaw(TILT_ID) - startRaw) > 4 || !dxl.torqueOn(TILT_ID) ||
      (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, TILT_ID) != 1) {
    releaseAll(F("nudge-arm-failed")); return;
  }
  const int32_t outRaw = startRaw + NUDGE_RAW;
  Serial.print(F("NUDGE_STARTED start=")); Serial.print(startRaw);
  Serial.print(F(" out=")); Serial.println(outRaw);
  if (!dxl.setGoalPosition(TILT_ID, outRaw, UNIT_RAW) || !waitForTiltTarget(startRaw, outRaw, "out")) return;
  delay(250);
  if (!dxl.setGoalPosition(TILT_ID, startRaw, UNIT_RAW) || !waitForTiltTarget(outRaw, startRaw, "back")) return;
  const int32_t finalRaw = readRaw(TILT_ID);
  releaseAll(F("nudge-complete"));
  Serial.print(F("NUDGE_COMPLETE start=")); Serial.print(startRaw);
  Serial.print(F(" out=")); Serial.print(outRaw);
  Serial.print(F(" final=")); Serial.println(finalRaw);
}

static void handleCommand() {
  commandBuffer[commandLength] = '\0';
  if (strcmp(commandBuffer, "HOLD TILT") == 0) startTiltHold();
  else if (strcmp(commandBuffer, "NUDGE TILT") == 0) runTiltNudge();
  else if (strcmp(commandBuffer, "STATUS") == 0) printStatus();
  else Serial.println(F("REFUSE reason=unknown-command"));
  commandLength = 0;
}

void setup() {
  Serial.begin(115200);
  const unsigned long startedMs = millis();
  while (!Serial && millis() - startedMs < 1500) {}
  dxl.begin(115200);
  dxl.setPortProtocolVersion(2.0);
  dxl.torqueOff(DXL_BROADCAST_ID);
  Serial.println(F("READY LIEU-STAGE3 axis=tilt action=hold-current-only timeout_ms=3000"));
}

void loop() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') { if (commandLength > 0) handleCommand(); }
    else if (commandLength < sizeof(commandBuffer) - 1) commandBuffer[commandLength++] = c;
    else { commandLength = 0; Serial.println(F("REFUSE reason=command-too-long")); }
  }

  if (millis() - lastOtherOffMs >= 250) {
    dxl.torqueOff(1); dxl.torqueOff(3); dxl.torqueOff(4);
    lastOtherOffMs = millis();
  }
  if (!holding) return;

  const int32_t present = readRaw(TILT_ID);
  const int32_t hwError = (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, TILT_ID);
  if (present == INT32_MIN || hwError != 0 || labs(present - holdGoalRaw) > MAX_TRACKING_ERROR_RAW) {
    releaseAll(F("monitor-fault")); return;
  }
  if (millis() - holdStartedMs >= HOLD_MS) { releaseAll(F("hold-complete")); return; }
  if (millis() - lastStatusMs >= 250) {
    Serial.print(F("HOLD_STATUS raw=")); Serial.print(present);
    Serial.print(F(" goal=")); Serial.print(holdGoalRaw);
    Serial.print(F(" torque=")); Serial.println((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, TILT_ID) == 1 ? 1 : 0);
    lastStatusMs = millis();
  }
}
