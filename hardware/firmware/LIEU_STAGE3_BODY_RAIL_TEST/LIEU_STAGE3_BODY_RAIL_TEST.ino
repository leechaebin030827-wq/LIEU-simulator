/* LIEU staged validation for Body (ID 3) and Rail (ID 4). */

#include <Dynamixel2Arduino.h>
using namespace ControlTableItem;

struct AxisConfig {
  const char* name;
  uint8_t id;
  int32_t expectedRaw;
  int32_t defaultTolerance;
  int32_t nudgeRaw;
  int32_t sweepRaw;
  int32_t reachedToleranceRaw;
  uint32_t profileVelocity;
  uint32_t profileAcceleration;
};

static const uint8_t DXL_DIR_PIN = 2;
static const unsigned long ACTION_TIMEOUT_MS = 3000;
static const int32_t REACHED_TOLERANCE_RAW = 3;
static const AxisConfig TILT = {"tilt", 2, 2055, 100, 10, 30, 3, 31, 4};
static const AxisConfig BODY = {"body", 3, 2184, 250, 20, 100, 3, 20, 5};
static const AxisConfig RAIL = {"rail", 4, 242, 250, 10, 50, 8, 10, 2};

Dynamixel2Arduino dxl(Serial1, DXL_DIR_PIN);
char commandBuffer[24];
uint8_t commandLength = 0;

static int32_t readRaw(uint8_t id) {
  const float raw = dxl.getPresentPosition(id, UNIT_RAW);
  return isfinite(raw) ? lroundf(raw) : INT32_MIN;
}

static bool writeAndVerify(const AxisConfig& axis, uint8_t item, int32_t value) {
  if (!dxl.writeControlTableItem(item, axis.id, value)) return false;
  return (int32_t)dxl.readControlTableItem(item, axis.id) == value;
}

static void releaseAll(const __FlashStringHelper* reason) {
  dxl.torqueOff(DXL_BROADCAST_ID);
  Serial.print(F("RELEASE reason=")); Serial.println(reason);
}

static void printStatus() {
  Serial.print(F("STATUS"));
  for (uint8_t id = 1; id <= 4; ++id) {
    Serial.print(F(" id")); Serial.print(id); Serial.print(F("_raw=")); Serial.print(readRaw(id));
  }
  Serial.print(F(" torque="));
  for (uint8_t id = 1; id <= 4; ++id) {
    Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, id) == 1 ? '1' : '0');
  }
  Serial.println();
}

static bool prepareAxis(const AxisConfig& axis, int32_t& startRaw) {
  releaseAll(F("pre-action"));
  if (!dxl.ping(axis.id)) { Serial.println(F("REFUSE reason=axis-not-found")); return false; }
  startRaw = readRaw(axis.id);
  if (startRaw == INT32_MIN || labs(startRaw - axis.expectedRaw) > axis.defaultTolerance) {
    Serial.print(F("REFUSE reason=not-at-default axis=")); Serial.print(axis.name);
    Serial.print(F(" raw=")); Serial.println(startRaw); return false;
  }
  if ((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, axis.id) != 0) {
    Serial.println(F("REFUSE reason=hardware-error")); return false;
  }
  dxl.torqueOff(axis.id);
  if (!dxl.setOperatingMode(axis.id, OP_EXTENDED_POSITION) ||
      !writeAndVerify(axis, PROFILE_ACCELERATION, axis.profileAcceleration) ||
      !writeAndVerify(axis, PROFILE_VELOCITY, axis.profileVelocity)) {
    releaseAll(F("setup-failed")); return false;
  }
  startRaw = readRaw(axis.id);
  if (startRaw == INT32_MIN || !dxl.setGoalPosition(axis.id, startRaw, UNIT_RAW)) {
    releaseAll(F("goal-current-failed")); return false;
  }
  delay(30);
  if (labs(readRaw(axis.id) - startRaw) > 4 || !dxl.torqueOn(axis.id) ||
      (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, axis.id) != 1) {
    releaseAll(F("arm-failed")); return false;
  }
  return true;
}

static bool healthyAt(const AxisConfig& axis, int32_t startRaw, int32_t targetRaw, int32_t present) {
  if (present == INT32_MIN) return false;
  if ((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, axis.id) != 0) return false;
  if ((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, axis.id) != 1) return false;
  return present >= min(startRaw, targetRaw) - 20 && present <= max(startRaw, targetRaw) + 20;
}

static bool waitForTarget(const AxisConfig& axis, int32_t startRaw, int32_t targetRaw, const char* phase) {
  const unsigned long began = millis();
  while (millis() - began < ACTION_TIMEOUT_MS) {
    const int32_t present = readRaw(axis.id);
    if (!healthyAt(axis, startRaw, targetRaw, present)) {
      releaseAll(F("monitor-fault")); return false;
    }
    Serial.print(F("MOVE_STATUS axis=")); Serial.print(axis.name);
    Serial.print(F(" phase=")); Serial.print(phase);
    Serial.print(F(" raw=")); Serial.print(present);
    Serial.print(F(" goal=")); Serial.print(targetRaw);
    Serial.print(F(" velocity=")); Serial.print((int32_t)dxl.readControlTableItem(PRESENT_VELOCITY, axis.id));
    Serial.print(F(" current=")); Serial.println((int32_t)dxl.readControlTableItem(PRESENT_CURRENT, axis.id));
    if (labs(present - targetRaw) <= axis.reachedToleranceRaw) return true;
    delay(50);
  }
  releaseAll(F("action-timeout"));
  return false;
}

static void runHold(const AxisConfig& axis) {
  int32_t startRaw = 0;
  if (!prepareAxis(axis, startRaw)) return;
  Serial.print(F("HOLD_STARTED axis=")); Serial.print(axis.name);
  Serial.print(F(" goal=")); Serial.println(startRaw);
  const unsigned long began = millis();
  while (millis() - began < ACTION_TIMEOUT_MS) {
    const int32_t present = readRaw(axis.id);
    if (!healthyAt(axis, startRaw, startRaw, present) || labs(present - startRaw) > 80) {
      releaseAll(F("hold-monitor-fault")); return;
    }
    Serial.print(F("HOLD_STATUS axis=")); Serial.print(axis.name);
    Serial.print(F(" raw=")); Serial.print(present);
    Serial.print(F(" goal=")); Serial.println(startRaw);
    delay(250);
  }
  releaseAll(F("hold-complete"));
  Serial.print(F("HOLD_COMPLETE axis=")); Serial.println(axis.name);
}

static void runNudge(const AxisConfig& axis) {
  int32_t startRaw = 0;
  if (!prepareAxis(axis, startRaw)) return;
  const int32_t outRaw = startRaw + axis.nudgeRaw;
  Serial.print(F("NUDGE_STARTED axis=")); Serial.print(axis.name);
  Serial.print(F(" start=")); Serial.print(startRaw);
  Serial.print(F(" out=")); Serial.println(outRaw);
  if (!dxl.setGoalPosition(axis.id, outRaw, UNIT_RAW)) { releaseAll(F("out-goal-failed")); return; }
  if (!waitForTarget(axis, startRaw, outRaw, "out")) return;
  delay(250);
  if (!dxl.setGoalPosition(axis.id, startRaw, UNIT_RAW)) { releaseAll(F("back-goal-failed")); return; }
  if (!waitForTarget(axis, outRaw, startRaw, "back")) return;
  const int32_t finalRaw = readRaw(axis.id);
  releaseAll(F("nudge-complete"));
  Serial.print(F("NUDGE_COMPLETE axis=")); Serial.print(axis.name);
  Serial.print(F(" start=")); Serial.print(startRaw);
  Serial.print(F(" out=")); Serial.print(outRaw);
  Serial.print(F(" final=")); Serial.println(finalRaw);
}

static void runSweep(const AxisConfig& axis) {
  int32_t startRaw = 0;
  if (!prepareAxis(axis, startRaw)) return;
  const int32_t targets[] = {startRaw + axis.sweepRaw, startRaw, startRaw - axis.sweepRaw, startRaw};
  Serial.print(F("SWEEP_STARTED axis=")); Serial.print(axis.name);
  Serial.print(F(" start=")); Serial.print(startRaw);
  Serial.print(F(" delta=")); Serial.println(axis.sweepRaw);
  int32_t previous = startRaw;
  for (uint8_t i = 0; i < 4; ++i) {
    if (!dxl.setGoalPosition(axis.id, targets[i], UNIT_RAW)) { releaseAll(F("sweep-goal-failed")); return; }
    if (!waitForTarget(axis, previous, targets[i], "sweep")) return;
    previous = targets[i];
    delay(200);
  }
  const int32_t finalRaw = readRaw(axis.id);
  releaseAll(F("sweep-complete"));
  Serial.print(F("SWEEP_COMPLETE axis=")); Serial.print(axis.name);
  Serial.print(F(" start=")); Serial.print(startRaw);
  Serial.print(F(" final=")); Serial.println(finalRaw);
}

static void handleCommand() {
  commandBuffer[commandLength] = '\0';
  if (strcmp(commandBuffer, "STATUS") == 0) printStatus();
  else if (strcmp(commandBuffer, "HOLD BODY") == 0) runHold(BODY);
  else if (strcmp(commandBuffer, "NUDGE BODY") == 0) runNudge(BODY);
  else if (strcmp(commandBuffer, "HOLD RAIL") == 0) Serial.println(F("REFUSE reason=rail-locked"));
  else if (strcmp(commandBuffer, "NUDGE RAIL") == 0) Serial.println(F("REFUSE reason=rail-locked"));
  else if (strcmp(commandBuffer, "SWEEP TILT") == 0) runSweep(TILT);
  else if (strcmp(commandBuffer, "SWEEP BODY") == 0) runSweep(BODY);
  else if (strcmp(commandBuffer, "SWEEP RAIL") == 0) Serial.println(F("REFUSE reason=rail-locked"));
  else if (strcmp(commandBuffer, "RETEST RAIL") == 0) Serial.println(F("REFUSE reason=rail-locked"));
  else Serial.println(F("REFUSE reason=unknown-command"));
  commandLength = 0;
}

void setup() {
  Serial.begin(115200);
  const unsigned long began = millis();
  while (!Serial && millis() - began < 1500) {}
  dxl.begin(115200);
  dxl.setPortProtocolVersion(2.0);
  dxl.torqueOff(DXL_BROADCAST_ID);
  Serial.println(F("READY LIEU-STAGE3 axes=tilt,body,rail actions=hold,nudge,sweep"));
}

void loop() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') { if (commandLength > 0) handleCommand(); }
    else if (commandLength < sizeof(commandBuffer) - 1) commandBuffer[commandLength++] = c;
    else { commandLength = 0; Serial.println(F("REFUSE reason=command-too-long")); }
  }
  // No axis remains armed after a command returns.
}
