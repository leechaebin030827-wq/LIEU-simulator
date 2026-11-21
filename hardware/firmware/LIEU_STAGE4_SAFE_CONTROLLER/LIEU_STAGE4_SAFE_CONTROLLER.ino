/*
 * LIEU Stage 4: narrow-window, single-axis commissioning controller.
 * No axis arms on startup or reconnect.
 */

#include <Dynamixel2Arduino.h>
using namespace ControlTableItem;

struct Axis {
  const char* name;
  uint8_t id;
  int32_t minRaw;
  int32_t maxRaw;
  int32_t maxStepRaw;
  uint32_t profileVelocity;
  uint32_t profileAcceleration;
  int32_t goalRaw;
};

static const uint8_t DXL_DIR_PIN = 2;
static const unsigned long WATCHDOG_MS = 750;
static const unsigned long MONITOR_INTERVAL_MS = 50;
static const int32_t MAX_TRACKING_ERROR_RAW = 80;

Axis axes[] = {
  {"YAW", 1, 1682, 1722, 5, 20, 5, 1702},
  {"TILT", 2, 2025, 2085, 10, 31, 4, 2055},
  {"BODY", 3, 2084, 2284, 20, 20, 5, 2184},
  {"RAIL", 4, 214, 314, 10, 10, 2, 264},
};

Dynamixel2Arduino dxl(Serial1, DXL_DIR_PIN);
Axis* activeAxis = nullptr;
char commandBuffer[48];
uint8_t commandLength = 0;
unsigned long lastHostMs = 0;
unsigned long lastMonitorMs = 0;

static int32_t readRaw(uint8_t id) {
  const float raw = dxl.getPresentPosition(id, UNIT_RAW);
  return isfinite(raw) ? lroundf(raw) : INT32_MIN;
}

static Axis* findAxis(const char* name) {
  for (Axis& axis : axes) if (strcmp(axis.name, name) == 0) return &axis;
  return nullptr;
}

static void releaseAll(const __FlashStringHelper* reason) {
  dxl.torqueOff(DXL_BROADCAST_ID);
  activeAxis = nullptr;
  Serial.print(F("RELEASE reason=")); Serial.println(reason);
}

static bool writeAndVerify(Axis& axis, uint8_t item, int32_t value) {
  if (!dxl.writeControlTableItem(item, axis.id, value)) return false;
  return (int32_t)dxl.readControlTableItem(item, axis.id) == value;
}

static void printStatus() {
  Serial.print(F("STATUS active="));
  Serial.print(activeAxis ? activeAxis->name : "NONE");
  for (uint8_t id = 1; id <= 4; ++id) {
    Serial.print(F(" id")); Serial.print(id); Serial.print(F("=")); Serial.print(readRaw(id));
  }
  Serial.print(F(" torque="));
  for (uint8_t id = 1; id <= 4; ++id) {
    Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, id) == 1 ? '1' : '0');
  }
  if (activeAxis) { Serial.print(F(" goal=")); Serial.print(activeAxis->goalRaw); }
  Serial.println();
}

static void printInfo() {
  Serial.println(F("INFO controller=LIEU-STAGE4 mode=single-axis yaw=narrow-window watchdog_ms=750"));
  for (Axis& axis : axes) {
    Serial.print(F("LIMIT axis=")); Serial.print(axis.name);
    Serial.print(F(" id=")); Serial.print(axis.id);
    Serial.print(F(" min=")); Serial.print(axis.minRaw);
    Serial.print(F(" max=")); Serial.print(axis.maxRaw);
    Serial.print(F(" max_step=")); Serial.println(axis.maxStepRaw);
  }
}

static void armAxis(Axis& axis) {
  releaseAll(F("pre-arm"));
  if (!dxl.ping(axis.id)) { Serial.println(F("REFUSE reason=axis-not-found")); return; }
  int32_t present = readRaw(axis.id);
  if (present == INT32_MIN || present < axis.minRaw || present > axis.maxRaw) {
    Serial.print(F("REFUSE reason=outside-window raw=")); Serial.println(present); return;
  }
  if ((int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, axis.id) != 0) {
    Serial.println(F("REFUSE reason=hardware-error")); return;
  }
  dxl.torqueOff(axis.id);
  if (!dxl.setOperatingMode(axis.id, OP_EXTENDED_POSITION) ||
      !writeAndVerify(axis, PROFILE_ACCELERATION, axis.profileAcceleration) ||
      !writeAndVerify(axis, PROFILE_VELOCITY, axis.profileVelocity)) {
    releaseAll(F("setup-failed")); return;
  }
  present = readRaw(axis.id);
  if (present == INT32_MIN || !dxl.setGoalPosition(axis.id, present, UNIT_RAW)) {
    releaseAll(F("goal-current-failed")); return;
  }
  delay(30);
  if (labs(readRaw(axis.id) - present) > 4 || !dxl.torqueOn(axis.id) ||
      (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, axis.id) != 1) {
    releaseAll(F("arm-failed")); return;
  }
  axis.goalRaw = present;
  activeAxis = &axis;
  lastHostMs = millis();
  Serial.print(F("ARMED axis=")); Serial.print(axis.name);
  Serial.print(F(" raw=")); Serial.println(present);
}

static void moveAxis(Axis& axis, int32_t targetRaw) {
  if (activeAxis != &axis) { Serial.println(F("REFUSE reason=axis-not-active")); return; }
  if (targetRaw < axis.minRaw || targetRaw > axis.maxRaw) {
    releaseAll(F("target-outside-window")); return;
  }
  if (labs(targetRaw - axis.goalRaw) > axis.maxStepRaw) {
    releaseAll(F("step-too-large")); return;
  }
  if (!dxl.setGoalPosition(axis.id, targetRaw, UNIT_RAW)) {
    releaseAll(F("goal-write-failed")); return;
  }
  axis.goalRaw = targetRaw;
  lastHostMs = millis();
  Serial.print(F("GOAL axis=")); Serial.print(axis.name);
  Serial.print(F(" raw=")); Serial.println(targetRaw);
}

static void handleCommand() {
  commandBuffer[commandLength] = '\0';
  char* command = strtok(commandBuffer, " ");
  char* axisName = strtok(nullptr, " ");
  char* valueText = strtok(nullptr, " ");
  if (!command) { commandLength = 0; return; }

  if (strcmp(command, "STATUS") == 0) printStatus();
  else if (strcmp(command, "INFO") == 0) printInfo();
  else if (strcmp(command, "OFF") == 0) releaseAll(F("host-off"));
  else if (strcmp(command, "HEARTBEAT") == 0) {
    if (activeAxis) lastHostMs = millis();
    Serial.println(F("HEARTBEAT_OK"));
  } else if (strcmp(command, "ARM") == 0) {
    if (!axisName) Serial.println(F("REFUSE reason=unknown-axis"));
    else { Axis* axis = findAxis(axisName); if (axis) armAxis(*axis); else Serial.println(F("REFUSE reason=unknown-axis")); }
  } else if (strcmp(command, "MOVE") == 0) {
    Axis* axis = axisName ? findAxis(axisName) : nullptr;
    if (!axis || !valueText) Serial.println(F("REFUSE reason=bad-move"));
    else moveAxis(*axis, strtol(valueText, nullptr, 10));
  } else Serial.println(F("REFUSE reason=unknown-command"));
  commandLength = 0;
}

void setup() {
  Serial.begin(115200);
  const unsigned long began = millis();
  while (!Serial && millis() - began < 1500) {}
  dxl.begin(115200);
  dxl.setPortProtocolVersion(2.0);
  dxl.torqueOff(DXL_BROADCAST_ID);
  Serial.println(F("READY LIEU-STAGE4 outputs=locked"));
}

void loop() {
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') { if (commandLength > 0) handleCommand(); }
    else if (commandLength < sizeof(commandBuffer) - 1) commandBuffer[commandLength++] = c;
    else { commandLength = 0; releaseAll(F("command-too-long")); }
  }

  if (!activeAxis || millis() - lastMonitorMs < MONITOR_INTERVAL_MS) return;
  lastMonitorMs = millis();
  if (millis() - lastHostMs > WATCHDOG_MS) { releaseAll(F("watchdog")); return; }
  const int32_t present = readRaw(activeAxis->id);
  if (present == INT32_MIN || (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, activeAxis->id) != 0 ||
      (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, activeAxis->id) != 1 ||
      labs(present - activeAxis->goalRaw) > MAX_TRACKING_ERROR_RAW) {
    releaseAll(F("monitor-fault"));
  }
}
