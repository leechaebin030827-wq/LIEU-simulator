/*
 * LIEU Stage 3/4: Yaw hold and bounded micro-movement validation.
 *
 * HOLD YAW performs the stationary three-second validation.
 * NUDGE YAW moves exactly +50 raw from the measured default, returns to the
 * start, and releases. Both paths are bounded and monitor hardware errors.
 */

#include <Dynamixel2Arduino.h>

using namespace ControlTableItem;

static const unsigned long HOST_BAUD = 115200;
static const uint32_t DXL_BAUD = 115200;
static const float DXL_PROTOCOL = 2.0;
static const uint8_t DXL_DIR_PIN = 2;
static const uint8_t YAW_ID = 1;
static const int32_t EXPECTED_DEFAULT_RAW = 1692;
static const int32_t DEFAULT_TOLERANCE_RAW = 200;
static const int32_t MAX_TRACKING_ERROR_RAW = 100;
static const uint32_t PROFILE_VELOCITY_RAW = 20;
static const uint32_t PROFILE_ACCELERATION_RAW = 5;
static const int32_t DEFAULT_POSITION_P_GAIN = 900;
static const int32_t TEST_POSITION_P_GAIN = 1000;
static const unsigned long HOLD_MS = 3000;
static const int32_t NUDGE_RAW = 50;
static const int32_t NUDGE_TOLERANCE_RAW = 4;
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

static void releaseAll(const __FlashStringHelper* reason) {
  dxl.torqueOff(DXL_BROADCAST_ID);
  holding = false;
  Serial.print(F("RELEASE reason="));
  Serial.println(reason);
}

static bool writeAndVerify(uint8_t item, int32_t value) {
  if (!dxl.writeControlTableItem(item, YAW_ID, value)) return false;
  return (int32_t)dxl.readControlTableItem(item, YAW_ID) == value;
}

static bool restoreYawGain() {
  dxl.torqueOff(YAW_ID);
  return writeAndVerify(POSITION_P_GAIN, DEFAULT_POSITION_P_GAIN);
}

static void printStatus() {
  Serial.print(F("STATUS yaw_raw="));
  Serial.print(readRaw(YAW_ID));
  Serial.print(F(" yaw_torque="));
  Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, YAW_ID) == 1 ? 1 : 0);
  Serial.print(F(" other_torque="));
  for (uint8_t id = 2; id <= 4; ++id) {
    Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, id) == 1 ? '1' : '0');
  }
  Serial.println();
}

static void printDiagnostics() {
  Serial.print(F("DIAG yaw_raw=")); Serial.print(readRaw(YAW_ID));
  Serial.print(F(" goal=")); Serial.print((int32_t)dxl.readControlTableItem(GOAL_POSITION, YAW_ID));
  Serial.print(F(" mode=")); Serial.print((int32_t)dxl.readControlTableItem(OPERATING_MODE, YAW_ID));
  Serial.print(F(" torque=")); Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, YAW_ID));
  Serial.print(F(" hw=")); Serial.print((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, YAW_ID));
  Serial.print(F(" velocity=")); Serial.print((int32_t)dxl.readControlTableItem(PRESENT_VELOCITY, YAW_ID));
  Serial.print(F(" current=")); Serial.print((int32_t)dxl.readControlTableItem(PRESENT_CURRENT, YAW_ID));
  Serial.print(F(" current_limit=")); Serial.print((int32_t)dxl.readControlTableItem(CURRENT_LIMIT, YAW_ID));
  Serial.print(F(" pwm_limit=")); Serial.print((int32_t)dxl.readControlTableItem(PWM_LIMIT, YAW_ID));
  Serial.print(F(" voltage=")); Serial.print((int32_t)dxl.readControlTableItem(PRESENT_INPUT_VOLTAGE, YAW_ID));
  Serial.print(F(" temperature=")); Serial.print((int32_t)dxl.readControlTableItem(PRESENT_TEMPERATURE, YAW_ID));
  Serial.print(F(" profile_vel=")); Serial.print((int32_t)dxl.readControlTableItem(PROFILE_VELOCITY, YAW_ID));
  Serial.print(F(" profile_acc=")); Serial.print((int32_t)dxl.readControlTableItem(PROFILE_ACCELERATION, YAW_ID));
  Serial.print(F(" p_gain=")); Serial.println((int32_t)dxl.readControlTableItem(POSITION_P_GAIN, YAW_ID));
}

static void startYawHold() {
  releaseAll(F("pre-arm"));

  if (!dxl.ping(YAW_ID)) {
    Serial.println(F("REFUSE reason=yaw-not-found"));
    return;
  }

  int32_t present = readRaw(YAW_ID);
  if (present == INT32_MIN) {
    Serial.println(F("REFUSE reason=position-read"));
    return;
  }
  if (labs(present - EXPECTED_DEFAULT_RAW) > DEFAULT_TOLERANCE_RAW) {
    Serial.print(F("REFUSE reason=not-at-default raw="));
    Serial.println(present);
    return;
  }
  if ((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, YAW_ID) != 0) {
    Serial.println(F("REFUSE reason=hardware-error"));
    return;
  }

  dxl.torqueOff(YAW_ID);
  if (!dxl.setOperatingMode(YAW_ID, OP_EXTENDED_POSITION) ||
      !writeAndVerify(PROFILE_ACCELERATION, PROFILE_ACCELERATION_RAW) ||
      !writeAndVerify(PROFILE_VELOCITY, PROFILE_VELOCITY_RAW)) {
    releaseAll(F("setup-failed"));
    return;
  }

  present = readRaw(YAW_ID);
  if (present == INT32_MIN || !dxl.setGoalPosition(YAW_ID, present, UNIT_RAW)) {
    releaseAll(F("goal-current-failed"));
    return;
  }
  delay(30);
  if (labs(readRaw(YAW_ID) - present) > 4 ||
      (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, YAW_ID) != 0 ||
      !dxl.torqueOn(YAW_ID) ||
      (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, YAW_ID) != 1) {
    releaseAll(F("arm-verification-failed"));
    return;
  }

  holdGoalRaw = present;
  holdStartedMs = millis();
  holding = true;
  Serial.print(F("HOLD_STARTED id=1 goal="));
  Serial.println(holdGoalRaw);
}

static bool waitForYawTarget(int32_t startRaw, int32_t targetRaw, const char* phase) {
  const unsigned long startedMs = millis();
  while (millis() - startedMs < MOVE_TIMEOUT_MS) {
    const int32_t present = readRaw(YAW_ID);
    const int32_t hwError = (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, YAW_ID);
    const int32_t torque = (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, YAW_ID);
    if (present == INT32_MIN || hwError != 0 || torque != 1 ||
        present < min(startRaw, targetRaw) - 20 || present > max(startRaw, targetRaw) + 20) {
      releaseAll(F("nudge-monitor-fault"));
      return false;
    }
    Serial.print(F("NUDGE_STATUS phase="));
    Serial.print(phase);
    Serial.print(F(" raw="));
    Serial.print(present);
    Serial.print(F(" goal="));
    Serial.print(targetRaw);
    Serial.print(F(" velocity="));
    Serial.print((int32_t)dxl.readControlTableItem(PRESENT_VELOCITY, YAW_ID));
    Serial.print(F(" current="));
    Serial.println((int32_t)dxl.readControlTableItem(PRESENT_CURRENT, YAW_ID));
    if (labs(present - targetRaw) <= NUDGE_TOLERANCE_RAW) return true;
    delay(50);
  }
  releaseAll(F("nudge-timeout"));
  return false;
}

static void runYawNudge(bool gainTest) {
  releaseAll(F("pre-nudge"));
  if (!dxl.ping(YAW_ID)) {
    Serial.println(F("REFUSE reason=yaw-not-found"));
    return;
  }

  int32_t startRaw = readRaw(YAW_ID);
  if (startRaw == INT32_MIN || labs(startRaw - EXPECTED_DEFAULT_RAW) > DEFAULT_TOLERANCE_RAW) {
    Serial.print(F("REFUSE reason=not-at-default raw="));
    Serial.println(startRaw);
    return;
  }
  if ((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, YAW_ID) != 0) {
    Serial.println(F("REFUSE reason=hardware-error"));
    return;
  }

  dxl.torqueOff(YAW_ID);
  if (!dxl.setOperatingMode(YAW_ID, OP_EXTENDED_POSITION) ||
      !writeAndVerify(PROFILE_ACCELERATION, PROFILE_ACCELERATION_RAW) ||
      !writeAndVerify(PROFILE_VELOCITY, PROFILE_VELOCITY_RAW)) {
    releaseAll(F("nudge-setup-failed"));
    return;
  }
  if (gainTest && !writeAndVerify(POSITION_P_GAIN, TEST_POSITION_P_GAIN)) {
    releaseAll(F("gain-write-failed"));
    restoreYawGain();
    return;
  }

  startRaw = readRaw(YAW_ID);
  if (startRaw == INT32_MIN || !dxl.setGoalPosition(YAW_ID, startRaw, UNIT_RAW)) {
    releaseAll(F("nudge-goal-current-failed"));
    if (gainTest) restoreYawGain();
    return;
  }
  delay(30);
  if (labs(readRaw(YAW_ID) - startRaw) > 4 ||
      !dxl.torqueOn(YAW_ID) ||
      (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, YAW_ID) != 1) {
    releaseAll(F("nudge-arm-failed"));
    if (gainTest) restoreYawGain();
    return;
  }

  const int32_t outRaw = startRaw + NUDGE_RAW;
  Serial.print(F("NUDGE_STARTED start="));
  Serial.print(startRaw);
  Serial.print(F(" out="));
  Serial.print(outRaw);
  Serial.print(F(" p_gain="));
  Serial.println((int32_t)dxl.readControlTableItem(POSITION_P_GAIN, YAW_ID));
  if (!dxl.setGoalPosition(YAW_ID, outRaw, UNIT_RAW) || !waitForYawTarget(startRaw, outRaw, "out")) {
    if (gainTest) restoreYawGain();
    return;
  }
  delay(250);
  if (!dxl.setGoalPosition(YAW_ID, startRaw, UNIT_RAW) || !waitForYawTarget(outRaw, startRaw, "back")) {
    if (gainTest) restoreYawGain();
    return;
  }

  const int32_t finalRaw = readRaw(YAW_ID);
  releaseAll(F("nudge-complete"));
  const bool gainRestored = !gainTest || restoreYawGain();
  Serial.print(F("NUDGE_COMPLETE start="));
  Serial.print(startRaw);
  Serial.print(F(" out="));
  Serial.print(outRaw);
  Serial.print(F(" final="));
  Serial.print(finalRaw);
  Serial.print(F(" gain_restored="));
  Serial.println(gainRestored ? 1 : 0);
}

static void handleCommand() {
  commandBuffer[commandLength] = '\0';
  if (strcmp(commandBuffer, "HOLD YAW") == 0) startYawHold();
  else if (strcmp(commandBuffer, "NUDGE YAW") == 0) runYawNudge(false);
  else if (strcmp(commandBuffer, "GAINTEST YAW") == 0) runYawNudge(true);
  else if (strcmp(commandBuffer, "STATUS") == 0) printStatus();
  else if (strcmp(commandBuffer, "DIAG YAW") == 0) printDiagnostics();
  else Serial.println(F("REFUSE reason=unknown-command"));
  commandLength = 0;
}

void setup() {
  Serial.begin(HOST_BAUD);
  const unsigned long startedMs = millis();
  while (!Serial && millis() - startedMs < 1500) {}
  dxl.begin(DXL_BAUD);
  dxl.setPortProtocolVersion(DXL_PROTOCOL);
  dxl.torqueOff(DXL_BROADCAST_ID);
  Serial.println(F("READY LIEU-STAGE3 axis=yaw actions=hold,nudge50 timeout_ms=3000"));
}

void loop() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (commandLength > 0) handleCommand();
    } else if (commandLength < sizeof(commandBuffer) - 1) {
      commandBuffer[commandLength++] = c;
    } else {
      commandLength = 0;
      Serial.println(F("REFUSE reason=command-too-long"));
    }
  }

  // Non-tested axes are periodically forced off without saturating the bus.
  if (millis() - lastOtherOffMs >= 250) {
    dxl.torqueOff(2);
    dxl.torqueOff(3);
    dxl.torqueOff(4);
    lastOtherOffMs = millis();
  }

  if (!holding) return;

  const int32_t present = readRaw(YAW_ID);
  const int32_t hwError = (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, YAW_ID);
  if (present == INT32_MIN || hwError != 0 || labs(present - holdGoalRaw) > MAX_TRACKING_ERROR_RAW) {
    releaseAll(F("monitor-fault"));
    return;
  }
  if (millis() - holdStartedMs >= HOLD_MS) {
    releaseAll(F("hold-complete"));
    return;
  }

  if (millis() - lastStatusMs >= 250) {
    Serial.print(F("HOLD_STATUS raw="));
    Serial.print(present);
    Serial.print(F(" goal="));
    Serial.print(holdGoalRaw);
    Serial.print(F(" torque="));
    Serial.println((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, YAW_ID) == 1 ? 1 : 0);
    lastStatusMs = millis();
  }
}
