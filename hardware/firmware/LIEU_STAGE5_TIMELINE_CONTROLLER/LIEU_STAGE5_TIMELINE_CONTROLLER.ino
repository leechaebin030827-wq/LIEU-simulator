/*
 * LIEU Stage 5: narrow-window, four-axis timeline controller.
 * Outputs always start locked. ARM ALL is required before FRAME commands.
 */

#include <Dynamixel2Arduino.h>
#include <Wire.h>
#include <WDT.h>
#include <Adafruit_NeoPixel.h>

// If anything stalls the loop (an I2C lock-up from the eye matrices froze the
// board with the app unable to reach it), the hardware watchdog restarts the
// chip; setup() then releases every motor. INFO reports whether that happened.
static const uint32_t HW_WATCHDOG_MS = 2000;
static const unsigned int I2C_TIMEOUT_US = 5000;
bool resetByWatchdog = false;
using namespace ControlTableItem;

// Eyes (two HT16K33 8x8 on I2C A4/A5) and the 24px SK6812 RGBW ring on D6.
// They follow the timeline whenever the host streams EYES/RING lines, armed or
// not; they never touch the motors and have their own 2 s watchdog.
static const uint8_t PIN_RING = 6;
static const uint8_t RING_COUNT = 24;
static const uint8_t EYE_ADDR[2] = {0x70, 0x71};
static const unsigned long LIGHT_WATCHDOG_MS = 5000;
static const uint8_t IDLE_EYE_L[8] = {0, 16, 56, 56, 56, 56, 16, 0};
static const uint8_t IDLE_EYE_R[8] = {0, 8, 28, 28, 28, 28, 8, 0};
Adafruit_NeoPixel ring(RING_COUNT, PIN_RING, NEO_GRBW + NEO_KHZ800);
uint8_t eyeDim[2] = {255, 255};
bool lightsActive = false;
unsigned long lastLightMs = 0;
uint32_t i2cErrors = 0;
// ring.show() blocks interrupts for ~1 ms and the UART drops bytes meanwhile,
// so the ring is only refreshed once the host's burst for this tick is over.
static const unsigned long RING_QUIET_MS = 3;
bool ringPending = false;
unsigned long lastByteMs = 0;
uint32_t badLines = 0;

struct Axis {
  const char* name;
  uint8_t id;
  int32_t minRaw;
  int32_t maxRaw;
  int32_t maxStepRaw;
  int32_t trackingToleranceRaw;
  uint32_t profileVelocity;
  uint32_t profileAcceleration;
  int32_t goalRaw;
};

enum ActiveMode : uint8_t { MODE_OFF, MODE_SINGLE, MODE_ALL };

static const uint8_t DXL_DIR_PIN = 2;
static const unsigned long WATCHDOG_MS = 750;
// Timeline playback: a browser tab can stall for a second (first 3D render,
// video decode). The jitter buffer then simply holds the newest pose with
// torque on; torque is released only after this much host silence.
static const unsigned long TIMELINE_WATCHDOG_MS = 5000;
static const unsigned long MONITOR_INTERVAL_MS = 100;
// Timeline frames arrive at ~30 Hz. The firmware interpolates between them and
// writes goals at 100 Hz with the motors' internal profile disabled, so every
// goal no longer restarts an accelerate-then-stop profile (the Tilt stutter).
static const unsigned long STREAM_INTERVAL_MS = 10;
static const unsigned long FRAME_MIN_MS = 15;
static const unsigned long FRAME_MAX_MS = 150;
static const uint8_t TORQUE_CHECK_EVERY = 10; // monitor ticks between torque reads
static const uint8_t DXL_ALERT_BIT = 0x80;
#if defined(LIEU_STAGE7_CALIBRATED)
static const unsigned long TRACKING_TIMEOUT_MS = 8000;
#else
static const unsigned long TRACKING_TIMEOUT_MS = 1500;
#endif

#if defined(LIEU_STAGE7_CALIBRATED)
// Streaming speed caps (Profile Velocity units) cover 08 Final Exhibition's
// peak axis speeds with ~25% headroom: yaw ~4300, tilt ~810 (spin wobble),
// body ~3800 (spin unwind), rail ~910 raw/s.
Axis axes[] = {
  {"YAW", 1, -3362, 8543, 11905, 1200, 360, 20, 1692},
  {"TILT", 2, 1829, 2248, 419, 100, 70, 10, 2055},
  {"BODY", 3, -5073, 9312, 14385, 1200, 310, 15, 2184},
  {"RAIL", 4, -2522, 4113, 6635, 800, 130, 10, 242},
};
#elif defined(LIEU_STAGE6_MODERATE)
Axis axes[] = {
  {"YAW", 1, 1502, 1902, 15, 60, 40, 10, 1702},
  {"TILT", 2, 1975, 2135, 20, 80, 50, 8, 2055},
  {"BODY", 3, 1784, 2584, 40, 160, 40, 10, 2184},
  {"RAIL", 4, 64, 464, 20, 80, 20, 4, 264},
};
#else
Axis axes[] = {
  {"YAW", 1, 1682, 1722, 5, 20, 20, 5, 1702},
  {"TILT", 2, 2025, 2085, 10, 40, 31, 4, 2055},
  {"BODY", 3, 2084, 2284, 20, 80, 20, 5, 2184},
  {"RAIL", 4, 214, 314, 10, 40, 10, 2, 264},
};
#endif

Dynamixel2Arduino dxl(Serial1, DXL_DIR_PIN);
struct SyncGoalData { int32_t goalPosition; } __attribute__((packed));
SyncGoalData syncGoalData[4];
DYNAMIXEL::InfoSyncWriteInst_t syncWriteInfo;
DYNAMIXEL::XELInfoSyncWrite_t syncWriteAxes[4];
struct SyncPresentData { int32_t presentPosition; } __attribute__((packed));
SyncPresentData syncPresentData[4];
DYNAMIXEL::InfoSyncReadInst_t syncPresentInfo;
DYNAMIXEL::XELInfoSyncRead_t syncPresentAxes[4];

// Per-axis stream state: a linear segment from the commanded position at the
// moment a host frame arrived to that frame's target, plus a velocity cap that
// replaces the disabled Profile Velocity as the speed safety limit.
struct AxisStream {
  float out;
  float segStart;
  int32_t segTarget;
  float maxRawPerSec;
  int32_t lastWritten;
};
AxisStream streams[4];
unsigned long segBeganMs = 0;
unsigned long segDurationMs = 33;
unsigned long lastFrameAtMs = 0;
unsigned long lastStreamMs = 0;

// Timestamped playback (FRAMET). Host frames arrive with USB/OS jitter of
// +/-15 ms, and a segment that simply ends at the next expected arrival makes
// the motor stop whenever a frame is late (the stutter). Instead frames are
// buffered with the host's own timestamp and played PLAYOUT_DELAY_MS behind
// on a C1 Catmull-Rom curve, so arrival jitter never reaches the motor.
static const uint8_t TIMED_BUF_LEN = 8;
static const unsigned long PLAYOUT_DELAY_MS = 100;
struct TimedFrame { uint32_t hostMs; int32_t target[4]; };
TimedFrame timedBuf[TIMED_BUF_LEN];
uint8_t timedCount = 0;
bool timedMode = false;
bool clockSynced = false;
long clockOffsetMs = 0;          // local millis - host ms, smallest seen (least delayed arrival)
unsigned long lastOffsetCreepMs = 0;
uint8_t monitorTicks = 0;

ActiveMode activeMode = MODE_OFF;
Axis* activeAxis = nullptr;
char commandBuffer[240]; // RING carries 96 bytes as 192 hex characters
uint16_t commandLength = 0;
unsigned long lastHostMs = 0;
unsigned long lastMonitorMs = 0;
unsigned long trackingLagSince[4] = {0, 0, 0, 0};

static void htCommand(uint8_t addr, uint8_t command) {
  Wire.beginTransmission(addr);
  Wire.write(command);
  if (Wire.endTransmission() != 0) ++i2cErrors;
}

static void eyeInit(uint8_t side) {
  htCommand(EYE_ADDR[side], 0x21); // oscillator on
  htCommand(EYE_ADDR[side], 0x81); // display on, no blink
  eyeDim[side] = 255;
}

static void eyeShow(uint8_t side, const uint8_t* rows, uint8_t dim) {
  dim &= 15;
  if (dim != eyeDim[side]) { htCommand(EYE_ADDR[side], 0xE0 | dim); eyeDim[side] = dim; }
  Wire.beginTransmission(EYE_ADDR[side]);
  Wire.write((uint8_t)0);
  for (uint8_t row = 0; row < 8; ++row) { Wire.write(rows[row]); Wire.write((uint8_t)0); }
  if (Wire.endTransmission() != 0) ++i2cErrors;
}

static bool eyePresent(uint8_t side) {
  Wire.beginTransmission(EYE_ADDR[side]);
  return Wire.endTransmission() == 0;
}

static void lightsIdle() {
  eyeShow(0, IDLE_EYE_L, 13);
  eyeShow(1, IDLE_EYE_R, 13);
  ring.clear();
  ring.show();
  ringPending = false;
  lightsActive = false;
}

static int8_t hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

static bool parseHex(const char* text, uint8_t* out, uint8_t count) {
  if (!text || strlen(text) != (size_t)count * 2) return false;
  for (uint8_t i = 0; i < count; ++i) {
    const int8_t hi = hexValue(text[2 * i]), lo = hexValue(text[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (uint8_t)(hi << 4 | lo);
  }
  return true;
}

// EYES <16 hex left rows><16 hex right rows> <dimL 0-15> <dimR 0-15>
static void handleEyes() {
  uint8_t rows[16];
  char* rowText = strtok(nullptr, " ");
  char* dimL = strtok(nullptr, " ");
  char* dimR = strtok(nullptr, " ");
  if (!parseHex(rowText, rows, 16) || !dimL || !dimR) { Serial.println(F("REFUSE reason=bad-eyes")); return; }
  eyeShow(0, rows, (uint8_t)strtol(dimL, nullptr, 10));
  eyeShow(1, rows + 8, (uint8_t)strtol(dimR, nullptr, 10));
  lightsActive = true;
  lastLightMs = millis();
  if (activeMode == MODE_ALL) lastHostMs = lastLightMs; // the host is alive even if a motion line was lost
}

// RING <192 hex: 24 x R,G,B,W> already scaled to the power budget by the host
static void handleRing() {
  uint8_t px[RING_COUNT * 4];
  if (!parseHex(strtok(nullptr, " "), px, sizeof(px))) { Serial.println(F("REFUSE reason=bad-ring")); return; }
  for (uint8_t i = 0; i < RING_COUNT; ++i) {
    const uint8_t* p = px + 4 * i;
    ring.setPixelColor(i, ring.Color(p[0], p[1], p[2], p[3]));
  }
  ringPending = true;
  lightsActive = true;
  lastLightMs = millis();
  if (activeMode == MODE_ALL) lastHostMs = lastLightMs;
}

// X-series: Profile Velocity unit 0.229 rpm, 4096 raw per revolution.
static float profileToRawPerSec(uint32_t profileVelocity) {
  return profileVelocity * 0.229f * 4096.0f / 60.0f;
}

static int32_t readRaw(uint8_t id) {
  const float raw = dxl.getPresentPosition(id, UNIT_RAW);
  return isfinite(raw) ? lroundf(raw) : INT32_MIN;
}

static Axis* findAxis(const char* name) {
  for (Axis& axis : axes) if (strcmp(axis.name, name) == 0) return &axis;
  return nullptr;
}

// Last release that ended an active session, reported by INFO for diagnosis
// after the browser has disconnected.
const __FlashStringHelper* lastReleaseReason = nullptr;
unsigned long lastReleaseAtMs = 0;

static void releaseAll(const __FlashStringHelper* reason) {
  dxl.torqueOff(DXL_BROADCAST_ID);
  if (activeMode != MODE_OFF) { lastReleaseReason = reason; lastReleaseAtMs = millis(); }
  activeMode = MODE_OFF;
  activeAxis = nullptr;
  for (uint8_t i = 0; i < 4; ++i) trackingLagSince[i] = 0;
  Serial.print(F("RELEASE reason=")); Serial.println(reason);
}

static bool writeAndVerify(Axis& axis, uint8_t item, int32_t value) {
  if (!dxl.writeControlTableItem(item, axis.id, value)) return false;
  return (int32_t)dxl.readControlTableItem(item, axis.id) == value;
}

// A released axis can come to rest a little outside its window (the head sags
// past -15 deg under gravity). The timeline may arm within this margin; the
// stream then eases it back inside at the axis' speed cap.
static const int32_t ARM_MARGIN_RAW = 150;

// Says why an axis cannot arm, so the app shows which axis and where it is.
static bool axisReady(Axis& axis, int32_t& present, int32_t margin = 0) {
  int32_t hwError = -1;
  present = INT32_MIN;
  if (dxl.ping(axis.id)) {
    present = readRaw(axis.id);
    hwError = (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, axis.id);
  }
  if (present != INT32_MIN && hwError == 0 && present >= axis.minRaw - margin && present <= axis.maxRaw + margin) return true;
  Serial.print(F("REFUSE reason=axis-not-ready axis=")); Serial.print(axis.name);
  Serial.print(F(" raw=")); Serial.print(present);
  Serial.print(F(" min=")); Serial.print(axis.minRaw - margin);
  Serial.print(F(" max=")); Serial.print(axis.maxRaw + margin);
  Serial.print(F(" hw_error=")); Serial.println(hwError);
  return false;
}

// streaming=true disables the internal profile (0 = unlimited); the firmware
// interpolator then owns the trajectory and its velocity cap.
static bool configureAtCurrent(Axis& axis, int32_t present, bool streaming) {
  dxl.torqueOff(axis.id);
  if (!dxl.setOperatingMode(axis.id, OP_EXTENDED_POSITION) ||
      !writeAndVerify(axis, PROFILE_ACCELERATION, streaming ? 0 : axis.profileAcceleration) ||
      !writeAndVerify(axis, PROFILE_VELOCITY, streaming ? 0 : axis.profileVelocity)) return false;
#if defined(LIEU_STAGE7_CALIBRATED)
  if (axis.id == 2 &&
      (!writeAndVerify(axis, POSITION_P_GAIN, 650) ||
       !writeAndVerify(axis, POSITION_I_GAIN, 0) ||
       !writeAndVerify(axis, POSITION_D_GAIN, 0))) return false;
#endif
  return dxl.setGoalPosition(axis.id, present, UNIT_RAW);
}

static void prepareSyncWrite() {
  syncWriteInfo.packet.p_buf = nullptr;
  syncWriteInfo.packet.is_completed = false;
  syncWriteInfo.addr = 116; // X-series Goal Position
  syncWriteInfo.addr_length = 4;
  syncWriteInfo.p_xels = syncWriteAxes;
  syncWriteInfo.xel_count = 4;
  for (uint8_t i = 0; i < 4; ++i) {
    syncWriteAxes[i].id = axes[i].id;
    syncWriteAxes[i].p_data = (uint8_t*)&syncGoalData[i].goalPosition;
  }
  syncWriteInfo.is_info_changed = true;
}

static void prepareSyncRead() {
  syncPresentInfo.packet.p_buf = nullptr;
  syncPresentInfo.packet.is_completed = false;
  syncPresentInfo.addr = 132; // X-series Present Position
  syncPresentInfo.addr_length = 4;
  syncPresentInfo.p_xels = syncPresentAxes;
  syncPresentInfo.xel_count = 4;
  for (uint8_t i = 0; i < 4; ++i) {
    syncPresentAxes[i].id = axes[i].id;
    syncPresentAxes[i].p_recv_buf = (uint8_t*)&syncPresentData[i].presentPosition;
  }
  syncPresentInfo.is_info_changed = true;
}

static void resetStream(uint8_t i, int32_t present) {
  streams[i].out = present;
  streams[i].segStart = present;
  streams[i].segTarget = present;
  streams[i].lastWritten = present;
  streams[i].maxRawPerSec = profileToRawPerSec(axes[i].profileVelocity);
}

// Advances every axis along its current segment and Sync Writes the result.
// Called from loop() and from the blocking tilt diagnostics.
// Position of one axis at host time playMs, Catmull-Rom through the buffered frames.
static float timedTarget(uint8_t axis, uint32_t playMs) {
  const TimedFrame* f = timedBuf;
  if (timedCount == 0) return streams[axis].out;
  const float p = (float)(int32_t)(playMs - f[0].hostMs);
  if (p <= 0) return f[0].target[axis];
  for (uint8_t i = 0; i + 1 < timedCount; ++i) {
    const float t0 = (float)(int32_t)(f[i].hostMs - f[0].hostMs);
    const float t1 = (float)(int32_t)(f[i + 1].hostMs - f[0].hostMs);
    if (p >= t1) continue;
    const float h = t1 - t0, u = (p - t0) / h;
    const float p0 = f[i].target[axis], p1 = f[i + 1].target[axis];
    const float m0 = i > 0
      ? (p1 - f[i - 1].target[axis]) / (t1 - (float)(int32_t)(f[i - 1].hostMs - f[0].hostMs)) * h
      : p1 - p0;
    const float m1 = i + 2 < timedCount
      ? (f[i + 2].target[axis] - p0) / ((float)(int32_t)(f[i + 2].hostMs - f[0].hostMs) - t0) * h
      : p1 - p0;
    const float u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
  }
  return f[timedCount - 1].target[axis]; // buffer ran dry: hold the newest target
}

static void serviceStream() {
  WDT.refresh(); // also reached from the blocking tilt diagnostics
  if (activeMode != MODE_ALL) return;
  const unsigned long now = millis();
  const unsigned long elapsedMs = now - lastStreamMs;
  if (elapsedMs < STREAM_INTERVAL_MS) return;
  lastStreamMs = now;
  const float dt = min(0.05f, elapsedMs / 1000.0f);
  const float u = min(1.0f, (float)(now - segBeganMs) / (float)segDurationMs);
  if (timedMode && now - lastOffsetCreepMs >= 1000) { ++clockOffsetMs; lastOffsetCreepMs = now; } // follow slow clock drift
  const uint32_t playMs = (uint32_t)(now - clockOffsetMs - PLAYOUT_DELAY_MS);
  bool changed = false;
  for (uint8_t i = 0; i < 4; ++i) {
    AxisStream& s = streams[i];
    const float desired = timedMode ? timedTarget(i, playMs) : s.segStart + (s.segTarget - s.segStart) * u;
    const float maxDelta = s.maxRawPerSec * dt;
    s.out += constrain(desired - s.out, -maxDelta, maxDelta);
    // Targets are always inside the window; only an axis armed just outside it may still
    // be easing back in, so the goal may sit within the arming margin.
    const int32_t goal = constrain(lroundf(s.out), axes[i].minRaw - ARM_MARGIN_RAW, axes[i].maxRaw + ARM_MARGIN_RAW);
    syncGoalData[i].goalPosition = goal;
    if (goal != s.lastWritten) changed = true;
  }
  if (!changed) return;
  syncWriteInfo.is_info_changed = true; // the cached packet holds the old goals
  if (!dxl.syncWrite(&syncWriteInfo)) { releaseAll(F("stream-sync-write-failed")); return; }
  for (uint8_t i = 0; i < 4; ++i) streams[i].lastWritten = syncGoalData[i].goalPosition;
}

static void printStatus() {
  Serial.print(F("STATUS active="));
  if (activeMode == MODE_ALL) Serial.print(F("ALL"));
  else Serial.print(activeMode == MODE_SINGLE && activeAxis ? activeAxis->name : "NONE");
  for (uint8_t id = 1; id <= 4; ++id) {
    Serial.print(F(" id")); Serial.print(id); Serial.print(F("=")); Serial.print(readRaw(id));
  }
  Serial.print(F(" torque="));
  for (uint8_t id = 1; id <= 4; ++id) {
    Serial.print((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, id) == 1 ? '1' : '0');
  }
  if (activeMode == MODE_SINGLE && activeAxis) {
    Serial.print(F(" goal=")); Serial.print(activeAxis->goalRaw);
  } else if (activeMode == MODE_ALL) {
    for (uint8_t i = 0; i < 4; ++i) {
      Serial.print(F(" goal")); Serial.print(i + 1); Serial.print(F("=")); Serial.print(axes[i].goalRaw);
    }
  }
  Serial.println();
}

static void printInfo() {
#if defined(LIEU_STAGE7_CALIBRATED)
  Serial.println(F("INFO controller=LIEU-STAGE7 mode=timeline-calibrated-sync watchdog_ms=750"));
#elif defined(LIEU_STAGE6_MODERATE)
  Serial.println(F("INFO controller=LIEU-STAGE6 mode=timeline-moderate-window watchdog_ms=750"));
#else
  Serial.println(F("INFO controller=LIEU-STAGE5 mode=timeline-narrow-window watchdog_ms=750"));
#endif
  for (Axis& axis : axes) {
    Serial.print(F("LIMIT axis=")); Serial.print(axis.name);
    Serial.print(F(" id=")); Serial.print(axis.id);
    Serial.print(F(" min=")); Serial.print(axis.minRaw);
    Serial.print(F(" max=")); Serial.print(axis.maxRaw);
    Serial.print(F(" max_step=")); Serial.println(axis.maxStepRaw);
  }
  Serial.print(F("LIGHTS eyeL=0x70:")); Serial.print(eyePresent(0) ? F("ok") : F("MISSING"));
  Serial.print(F(" eyeR=0x71:")); Serial.print(eyePresent(1) ? F("ok") : F("MISSING"));
  Serial.print(F(" ring=D6x")); Serial.print(RING_COUNT);
  Serial.print(F(" i2c_errors=")); Serial.print(i2cErrors);
  Serial.print(F(" bad_lines=")); Serial.println(badLines);
  Serial.print(F("LAST_RELEASE reason="));
  if (lastReleaseReason) { Serial.print(lastReleaseReason); Serial.print(F(" ago_ms=")); Serial.println(millis() - lastReleaseAtMs); }
  else Serial.println(F("none"));
  Serial.print(F("LAST_RESET watchdog=")); Serial.println(resetByWatchdog ? F("yes") : F("no"));
}

static void armAxis(Axis& axis) {
  releaseAll(F("pre-arm"));
  int32_t present;
  if (!axisReady(axis, present)) return;
  if (!configureAtCurrent(axis, present, false)) { releaseAll(F("setup-failed")); return; }
  delay(30);
  if (labs(readRaw(axis.id) - present) > 4 || !dxl.torqueOn(axis.id)) {
    releaseAll(F("arm-failed")); return;
  }
  axis.goalRaw = present;
  activeAxis = &axis;
  activeMode = MODE_SINGLE;
  lastHostMs = millis();
  Serial.print(F("ARMED axis=")); Serial.print(axis.name);
  Serial.print(F(" raw=")); Serial.println(present);
}

static void armAll() {
  releaseAll(F("pre-arm-all"));
  int32_t present[4];
  for (uint8_t i = 0; i < 4; ++i) {
    if (!axisReady(axes[i], present[i], ARM_MARGIN_RAW)) return; // already released by pre-arm; keep the REFUSE detail visible
  }
  for (uint8_t i = 0; i < 4; ++i) {
    if (!configureAtCurrent(axes[i], present[i], true)) { releaseAll(F("setup-all-failed")); return; }
  }
  delay(30);
  for (uint8_t i = 0; i < 4; ++i) {
    if (labs(readRaw(axes[i].id) - present[i]) > 4 || !dxl.torqueOn(axes[i].id)) {
      releaseAll(F("arm-all-failed")); return;
    }
    axes[i].goalRaw = present[i];
    trackingLagSince[i] = 0;
    resetStream(i, present[i]);
  }
  activeMode = MODE_ALL;
  activeAxis = nullptr;
  lastHostMs = millis();
  segBeganMs = lastStreamMs = lastHostMs;
  segDurationMs = 33;
  lastFrameAtMs = 0;
  monitorTicks = 0;
  timedMode = false;
  timedCount = 0;
  clockSynced = false;
  Serial.print(F("ARMED axis=ALL"));
  for (uint8_t i = 0; i < 4; ++i) {
    Serial.print(F(" raw")); Serial.print(i + 1); Serial.print(F("=")); Serial.print(present[i]);
  }
  Serial.println();
}

static void moveAxis(Axis& axis, int32_t targetRaw) {
  if (activeMode != MODE_SINGLE || activeAxis != &axis) { Serial.println(F("REFUSE reason=axis-not-active")); return; }
  if (targetRaw < axis.minRaw || targetRaw > axis.maxRaw) { releaseAll(F("target-outside-window")); return; }
  if (labs(targetRaw - axis.goalRaw) > axis.maxStepRaw) { releaseAll(F("step-too-large")); return; }
  if (!dxl.setGoalPosition(axis.id, targetRaw, UNIT_RAW)) { releaseAll(F("goal-write-failed")); return; }
  axis.goalRaw = targetRaw;
  lastHostMs = millis();
  Serial.print(F("GOAL axis=")); Serial.print(axis.name);
  Serial.print(F(" raw=")); Serial.println(targetRaw);
}

// Starts a new interpolation segment toward the host frame. durationMs is the
// host's own frame spacing when sent; otherwise the arrival interval is used.
// FRAMET <hostMs> y t b r: queue a timestamped frame for buffered playback.
static void moveTimedFrame(uint32_t hostMs, int32_t target[4]) {
  if (activeMode != MODE_ALL) { Serial.println(F("REFUSE reason=timeline-not-active")); return; }
  for (uint8_t i = 0; i < 4; ++i) {
    if (target[i] < axes[i].minRaw || target[i] > axes[i].maxRaw) { releaseAll(F("frame-outside-window")); return; }
    if (labs(target[i] - axes[i].goalRaw) > axes[i].maxStepRaw) { releaseAll(F("frame-step-too-large")); return; }
  }
  if (timedCount > 0 && (int32_t)(hostMs - timedBuf[timedCount - 1].hostMs) <= 0) return; // stale or duplicate
  if (timedCount > 0 && (int32_t)(hostMs - timedBuf[timedCount - 1].hostMs) > 500) { timedMode = false; clockSynced = false; } // gap: re-anchor
  if (!timedMode) {
    // First timed frame: start the curve from where the motors are commanded now.
    timedMode = true;
    timedCount = 1;
    timedBuf[0].hostMs = hostMs - PLAYOUT_DELAY_MS;
    for (uint8_t i = 0; i < 4; ++i) timedBuf[0].target[i] = lroundf(streams[i].out);
  }
  if (timedCount == TIMED_BUF_LEN) { memmove(timedBuf, timedBuf + 1, sizeof(TimedFrame) * (TIMED_BUF_LEN - 1)); --timedCount; }
  timedBuf[timedCount].hostMs = hostMs;
  for (uint8_t i = 0; i < 4; ++i) { timedBuf[timedCount].target[i] = target[i]; axes[i].goalRaw = target[i]; }
  ++timedCount;
  const unsigned long now = millis();
  const long offset = (long)(now - hostMs);
  if (!clockSynced || offset < clockOffsetMs) { clockOffsetMs = offset; clockSynced = true; lastOffsetCreepMs = now; }
  lastHostMs = now;
}

static void moveFrame(int32_t target[4], long durationMs = 0) {
  if (activeMode != MODE_ALL) { Serial.println(F("REFUSE reason=timeline-not-active")); return; }
  for (uint8_t i = 0; i < 4; ++i) {
    if (target[i] < axes[i].minRaw || target[i] > axes[i].maxRaw) { releaseAll(F("frame-outside-window")); return; }
    if (labs(target[i] - axes[i].goalRaw) > axes[i].maxStepRaw) { releaseAll(F("frame-step-too-large")); return; }
  }
  const unsigned long now = millis();
  if (durationMs <= 0 && lastFrameAtMs != 0) durationMs = now - lastFrameAtMs;
  if (durationMs > 0) segDurationMs = constrain((unsigned long)durationMs, FRAME_MIN_MS, FRAME_MAX_MS);
  lastFrameAtMs = now;
  segBeganMs = now;
  for (uint8_t i = 0; i < 4; ++i) {
    streams[i].segStart = streams[i].out;
    streams[i].segTarget = target[i];
    axes[i].goalRaw = target[i];
  }
  lastHostMs = now;
  serviceStream();
}

static void printTiltGains() {
  Serial.print(F("TILT_GAINS p=")); Serial.print((int32_t)dxl.readControlTableItem(POSITION_P_GAIN, 2));
  Serial.print(F(" i=")); Serial.print((int32_t)dxl.readControlTableItem(POSITION_I_GAIN, 2));
  Serial.print(F(" d=")); Serial.println((int32_t)dxl.readControlTableItem(POSITION_D_GAIN, 2));
}

static void setTiltGains(int32_t p, int32_t i, int32_t d) {
  if (activeMode != MODE_OFF) { Serial.println(F("REFUSE reason=outputs-active")); return; }
  if (p < 0 || p > 16383 || i < 0 || i > 16383 || d < 0 || d > 16383) {
    Serial.println(F("REFUSE reason=bad-gain")); return;
  }
  Axis& tilt = axes[1];
  dxl.torqueOff(tilt.id);
  if (!writeAndVerify(tilt, POSITION_P_GAIN, p) ||
      !writeAndVerify(tilt, POSITION_I_GAIN, i) ||
      !writeAndVerify(tilt, POSITION_D_GAIN, d)) {
    releaseAll(F("gain-write-failed")); return;
  }
  printTiltGains();
}

static bool traceTiltLeg(const char* testName, uint8_t leg, int32_t target, unsigned long durationMs) {
  int32_t targetFrame[4];
  for (uint8_t i = 0; i < 4; ++i) targetFrame[i] = axes[i].goalRaw;
  targetFrame[1] = target;
  moveFrame(targetFrame);
  if (activeMode != MODE_ALL) return false;
  const unsigned long began = millis();
  unsigned long nextSample = began;
  while (millis() - began < durationMs) {
    lastHostMs = millis();
    serviceStream();
    if (activeMode != MODE_ALL) return false;
    if ((long)(millis() - nextSample) < 0) continue;
    nextSample += 50;
    const int32_t pos = readRaw(2);
    const int32_t vel = (int32_t)dxl.readControlTableItem(PRESENT_VELOCITY, 2);
    const int32_t current = (int32_t)(int16_t)dxl.readControlTableItem(PRESENT_CURRENT, 2);
    const int32_t error = target - pos;
    Serial.print(F("TTRACE test=")); Serial.print(testName);
    Serial.print(F(" leg=")); Serial.print(leg);
    Serial.print(F(" ms=")); Serial.print(millis() - began);
    Serial.print(F(" goal=")); Serial.print(target);
    Serial.print(F(" pos=")); Serial.print(pos);
    Serial.print(F(" error=")); Serial.print(error);
    Serial.print(F(" vel=")); Serial.print(vel);
    Serial.print(F(" current=")); Serial.println(current);
    if (pos == INT32_MIN ||
        (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, 2) != 0 ||
        (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, 2) != 1) {
      releaseAll(F("tilt-trace-fault")); return false;
    }
  }
  return true;
}

static bool traceTiltRamp(const char* phase, int32_t start, int32_t target, unsigned long durationMs) {
  const unsigned long began = millis();
  unsigned long nextSample = began;
  int32_t commanded = start;
  while (millis() - began <= durationMs) {
    lastHostMs = millis();
    serviceStream();
    if (activeMode != MODE_ALL) return false;
    if ((long)(millis() - nextSample) < 0) continue;
    nextSample += 33;
    const float u = min(1.0f, (float)(millis() - began) / (float)durationMs);
    const float smooth = u * u * (3.0f - 2.0f * u);
    const int32_t requested = lroundf(start + (target - start) * smooth);
    commanded = requested;
    int32_t targetFrame[4];
    for (uint8_t i = 0; i < 4; ++i) targetFrame[i] = axes[i].goalRaw;
    targetFrame[1] = commanded;
    moveFrame(targetFrame, 33);
    if (activeMode != MODE_ALL) return false;
    const int32_t pos = readRaw(2);
    const int32_t vel = (int32_t)dxl.readControlTableItem(PRESENT_VELOCITY, 2);
    const int32_t current = (int32_t)(int16_t)dxl.readControlTableItem(PRESENT_CURRENT, 2);
    Serial.print(F("TLOAD phase=")); Serial.print(phase);
    Serial.print(F(" ms=")); Serial.print(millis() - began);
    Serial.print(F(" requested=")); Serial.print(requested);
    Serial.print(F(" goal=")); Serial.print(commanded);
    Serial.print(F(" pos=")); Serial.print(pos);
    Serial.print(F(" error=")); Serial.print(commanded - pos);
    Serial.print(F(" vel=")); Serial.print(vel);
    Serial.print(F(" current=")); Serial.println(current);
  }
  return true;
}

static void runTiltLoadTest() {
  if (activeMode != MODE_OFF) { Serial.println(F("REFUSE reason=outputs-active")); return; }
  armAll();
  if (activeMode != MODE_ALL) return;
  const int32_t start = axes[1].goalRaw;
  const int32_t forward = min(axes[1].maxRaw - 8, start + 150);
  bool ok = traceTiltRamp("DOWN", start, forward, 1200);
  if (ok) ok = traceTiltLeg("LOAD_HOLD", 1, forward, 1500);
  if (ok) traceTiltRamp("RETURN", forward, start, 1200);
  releaseAll(F("tilt-load-test-complete"));
}

static void runTiltTest(bool fast) {
  if (activeMode != MODE_OFF) { Serial.println(F("REFUSE reason=outputs-active")); return; }
  const uint32_t savedVelocity = axes[1].profileVelocity;
  const uint32_t savedAcceleration = axes[1].profileAcceleration;
  axes[1].profileVelocity = fast ? 90 : 25;
  axes[1].profileAcceleration = fast ? 25 : 5;
  armAll();
  if (activeMode != MODE_ALL) {
    axes[1].profileVelocity = savedVelocity;
    axes[1].profileAcceleration = savedAcceleration;
    return;
  }
  const int32_t center = max(axes[1].minRaw + 70, min(axes[1].maxRaw - 70, axes[1].goalRaw));
  const unsigned long legMs = fast ? 1200 : 2200;
  const char* name = fast ? "FAST" : "SLOW";
  bool ok = traceTiltLeg(name, 1, center + 60, legMs);
  if (ok) ok = traceTiltLeg(name, 2, center - 60, legMs);
  if (ok) traceTiltLeg(name, 3, center, legMs);
  releaseAll(F("tilt-test-complete"));
  axes[1].profileVelocity = savedVelocity;
  axes[1].profileAcceleration = savedAcceleration;
}

// Lines may end in " ~HH": the low byte of the sum of every character before
// the space, in hex. A line whose checksum does not match is dropped, so a byte
// lost on the UART can never become a wrong goal. Plain lines (manual tests)
// are still accepted.
static bool checksumOk() {
  char* tilde = strrchr(commandBuffer, '~');
  if (!tilde || tilde == commandBuffer || tilde[-1] != ' ') return true;
  uint8_t expected[1];
  if (!parseHex(tilde + 1, expected, 1)) return false;
  uint8_t sum = 0;
  for (char* c = commandBuffer; c < tilde - 1; ++c) sum += (uint8_t)*c;
  tilde[-1] = '\0';
  return sum == expected[0];
}

static void handleCommand() {
  commandBuffer[commandLength] = '\0';
  if (!checksumOk()) { ++badLines; commandLength = 0; return; }
  char* command = strtok(commandBuffer, " ");
  if (!command) { commandLength = 0; return; }

  if (strcmp(command, "STATUS") == 0) printStatus();
  else if (strcmp(command, "INFO") == 0) printInfo();
  else if (strcmp(command, "OFF") == 0) releaseAll(F("host-off"));
  else if (strcmp(command, "HEARTBEAT") == 0) {
    if (activeMode != MODE_OFF) lastHostMs = millis();
    Serial.println(F("HEARTBEAT_OK"));
  } else if (strcmp(command, "VEL") == 0) {
    // VEL <AXIS> <profileVelocity>: session-only streaming speed cap (RAM, reset on reboot).
    char* axisName = strtok(nullptr, " ");
    char* valueText = strtok(nullptr, " ");
    Axis* axis = axisName ? findAxis(axisName) : nullptr;
    const long value = valueText ? strtol(valueText, nullptr, 10) : 0;
    if (activeMode != MODE_OFF) Serial.println(F("REFUSE reason=outputs-active"));
    else if (!axis || value < 1 || value > 1023) Serial.println(F("REFUSE reason=bad-vel"));
    else {
      axis->profileVelocity = (uint32_t)value;
      Serial.print(F("VEL axis=")); Serial.print(axis->name); Serial.print(F(" profile=")); Serial.println(value);
    }
  } else if (strcmp(command, "EYES") == 0) handleEyes();
  else if (strcmp(command, "RING") == 0) handleRing();
  else if (strcmp(command, "LIGHTS_OFF") == 0) lightsIdle();
  else if (strcmp(command, "TILT_GAINS") == 0) printTiltGains();
  else if (strcmp(command, "TILT_GAIN") == 0) {
    char* pText = strtok(nullptr, " ");
    char* iText = strtok(nullptr, " ");
    char* dText = strtok(nullptr, " ");
    if (!pText || !iText || !dText) Serial.println(F("REFUSE reason=bad-gain-command"));
    else setTiltGains(strtol(pText, nullptr, 10), strtol(iText, nullptr, 10), strtol(dText, nullptr, 10));
  } else if (strcmp(command, "TILT_TEST") == 0) {
    char* speed = strtok(nullptr, " ");
    if (speed && strcmp(speed, "SLOW") == 0) runTiltTest(false);
    else if (speed && strcmp(speed, "FAST") == 0) runTiltTest(true);
    else if (speed && strcmp(speed, "LOAD") == 0) runTiltLoadTest();
    else Serial.println(F("REFUSE reason=bad-tilt-test"));
  } else if (strcmp(command, "ARM") == 0) {
    char* axisName = strtok(nullptr, " ");
    if (axisName && strcmp(axisName, "ALL") == 0) armAll();
    else {
      Axis* axis = axisName ? findAxis(axisName) : nullptr;
      if (axis) armAxis(*axis); else Serial.println(F("REFUSE reason=unknown-axis"));
    }
  } else if (strcmp(command, "MOVE") == 0) {
    char* axisName = strtok(nullptr, " ");
    char* valueText = strtok(nullptr, " ");
    Axis* axis = axisName ? findAxis(axisName) : nullptr;
    if (!axis || !valueText) Serial.println(F("REFUSE reason=bad-move"));
    else moveAxis(*axis, strtol(valueText, nullptr, 10));
  } else if (strcmp(command, "FRAMET") == 0) {
    char* timeText = strtok(nullptr, " ");
    int32_t target[4];
    bool valid = timeText != nullptr;
    for (uint8_t i = 0; valid && i < 4; ++i) {
      char* valueText = strtok(nullptr, " ");
      if (!valueText) valid = false; else target[i] = strtol(valueText, nullptr, 10);
    }
    if (valid) moveTimedFrame((uint32_t)strtoul(timeText, nullptr, 10), target);
    else Serial.println(F("REFUSE reason=bad-frame"));
  } else if (strcmp(command, "FRAME") == 0) {
    int32_t target[4];
    bool valid = true;
    for (uint8_t i = 0; i < 4; ++i) {
      char* valueText = strtok(nullptr, " ");
      if (!valueText) { valid = false; break; }
      target[i] = strtol(valueText, nullptr, 10);
    }
    char* durationText = strtok(nullptr, " "); // optional host frame spacing in ms
    if (valid) moveFrame(target, durationText ? strtol(durationText, nullptr, 10) : 0);
    else Serial.println(F("REFUSE reason=bad-frame"));
  } else Serial.println(F("REFUSE reason=unknown-command"));
  commandLength = 0;
}

// One Sync Read for all four positions instead of twelve single reads, so the
// bus is busy for a few ms rather than ~35 ms and the 100 Hz stream keeps going.
// A hardware error sets the Alert bit in every status packet; Torque Enable is
// polled less often because a fault drops torque and raises Alert anyway.
// Status line for the app's 활성상태 tab, every TELEMETRY_MS:
//   TEL mode=ALL rx=4 p=..x4 g=..x4 alert=..x4 torque=1111 eyes=1,1 lights=1 i2c=0 bad=0
// While the timeline plays it reuses the positions monitorAll() already read (no extra
// bus traffic); otherwise it does one Sync Read. A motor that did not answer is "x".
static const unsigned long TELEMETRY_MS = 500;
unsigned long lastTelemetryMs = 0;
uint8_t telemetryTorque[4] = {0, 0, 0, 0};
uint8_t telemetryRx = 0;

static void printTelemetry() {
  if (millis() - lastTelemetryMs < TELEMETRY_MS) return;
  lastTelemetryMs = millis();
  if (activeMode != MODE_ALL) {
    syncPresentInfo.is_info_changed = true;
    telemetryRx = dxl.syncRead(&syncPresentInfo);
    for (uint8_t i = 0; i < 4; ++i) telemetryTorque[i] = i < telemetryRx && (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, axes[i].id) == 1;
  }
  Serial.print(F("TEL mode=")); Serial.print(activeMode == MODE_ALL ? F("ALL") : activeMode == MODE_SINGLE ? F("SINGLE") : F("OFF"));
  Serial.print(F(" rx=")); Serial.print(telemetryRx);
  Serial.print(F(" p="));
  for (uint8_t i = 0; i < 4; ++i) { if (i) Serial.print(','); if (i < telemetryRx) Serial.print(syncPresentData[i].presentPosition); else Serial.print('x'); }
  Serial.print(F(" g="));
  for (uint8_t i = 0; i < 4; ++i) { if (i) Serial.print(','); Serial.print(activeMode == MODE_ALL ? streams[i].lastWritten : axes[i].goalRaw); }
  Serial.print(F(" alert="));
  for (uint8_t i = 0; i < 4; ++i) { if (i) Serial.print(','); Serial.print(i < telemetryRx && (syncPresentAxes[i].error & DXL_ALERT_BIT) ? 1 : 0); }
  Serial.print(F(" torque="));
  for (uint8_t i = 0; i < 4; ++i) Serial.print(activeMode == MODE_ALL ? '1' : telemetryTorque[i] ? '1' : '0');
  Serial.print(F(" eyes=")); Serial.print(eyePresent(0) ? 1 : 0); Serial.print(','); Serial.print(eyePresent(1) ? 1 : 0);
  Serial.print(F(" lights=")); Serial.print(lightsActive ? 1 : 0);
  Serial.print(F(" i2c=")); Serial.print(i2cErrors);
  Serial.print(F(" bad=")); Serial.println(badLines);
}

static void monitorAll() {
  syncPresentInfo.is_info_changed = true; // the library shares one packet buffer between instructions
  telemetryRx = dxl.syncRead(&syncPresentInfo);
  if (telemetryRx != 4) { releaseAll(F("monitor-position-read-failed")); return; }
  for (uint8_t i = 0; i < 4; ++i) {
    if (syncPresentAxes[i].error & DXL_ALERT_BIT) { releaseAll(F("monitor-fault")); return; }
  }
  if (++monitorTicks >= TORQUE_CHECK_EVERY) {
    monitorTicks = 0;
    for (uint8_t i = 0; i < 4; ++i) {
      if ((int32_t)dxl.readControlTableItem(TORQUE_ENABLE, axes[i].id) != 1) { releaseAll(F("monitor-torque-off")); return; }
    }
  }
  const unsigned long now = millis();
  for (uint8_t i = 0; i < 4; ++i) {
    // Compare with what was actually commanded, not the host frame still being interpolated toward.
    if (labs(syncPresentData[i].presentPosition - streams[i].lastWritten) > axes[i].trackingToleranceRaw) {
      if (trackingLagSince[i] == 0) trackingLagSince[i] = now;
      else if (now - trackingLagSince[i] > TRACKING_TIMEOUT_MS) { releaseAll(F("tracking-timeout")); return; }
    } else trackingLagSince[i] = 0;
  }
}

void setup() {
  // RSTSR1 bit 1 (WDTRF): this start was caused by the watchdog. Clear it for next time.
  resetByWatchdog = (R_SYSTEM->RSTSR1 & 0x02) != 0;
  R_SYSTEM->RSTSR1 = 0;
  Serial.begin(115200);
  const unsigned long began = millis();
  while (!Serial && millis() - began < 1500) {}
  dxl.begin(115200);
  dxl.setPortProtocolVersion(2.0);
  prepareSyncWrite();
  prepareSyncRead();
  dxl.torqueOff(DXL_BROADCAST_ID);
  Wire.begin();
  Wire.setClock(400000);
  Wire.setWireTimeout(I2C_TIMEOUT_US, true);
  ring.begin();
  eyeInit(0);
  eyeInit(1);
  lightsIdle();
  WDT.begin(HW_WATCHDOG_MS);
#if defined(LIEU_STAGE7_CALIBRATED)
  Serial.println(F("READY LIEU-STAGE7 outputs=locked"));
#elif defined(LIEU_STAGE6_MODERATE)
  Serial.println(F("READY LIEU-STAGE6 outputs=locked"));
#else
  Serial.println(F("READY LIEU-STAGE5 outputs=locked"));
#endif
}

void loop() {
  WDT.refresh();
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();
    lastByteMs = millis();
    if (c == '\n' || c == '\r') { if (commandLength > 0) handleCommand(); }
    else if (commandLength < sizeof(commandBuffer) - 1) commandBuffer[commandLength++] = c;
    else { commandLength = 0; releaseAll(F("command-too-long")); }
  }

  serviceStream();
  if (ringPending && commandLength == 0 && Serial.available() == 0 && millis() - lastByteMs >= RING_QUIET_MS) {
    ring.show();
    ringPending = false;
  }
  if (lightsActive && millis() - lastLightMs > LIGHT_WATCHDOG_MS) lightsIdle();
  printTelemetry();
  if (activeMode == MODE_OFF || millis() - lastMonitorMs < MONITOR_INTERVAL_MS) return;
  lastMonitorMs = millis();
  if (millis() - lastHostMs > (activeMode == MODE_ALL ? TIMELINE_WATCHDOG_MS : WATCHDOG_MS)) { releaseAll(F("watchdog")); return; }
  if (activeMode == MODE_ALL) { monitorAll(); return; }
  for (uint8_t i = 0; i < 4; ++i) {
    if (activeAxis != &axes[i]) continue;
    const int32_t present = readRaw(axes[i].id);
    if (present == INT32_MIN ||
        (int32_t)dxl.readControlTableItem(HARDWARE_ERROR_STATUS, axes[i].id) != 0 ||
        (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, axes[i].id) != 1) {
      releaseAll(F("monitor-fault")); return;
    }
    if (labs(present - axes[i].goalRaw) > axes[i].trackingToleranceRaw) {
      if (trackingLagSince[i] == 0) trackingLagSince[i] = millis();
      else if (millis() - trackingLagSince[i] > TRACKING_TIMEOUT_MS) { releaseAll(F("tracking-timeout")); return; }
    } else trackingLagSince[i] = 0;
  }
}
