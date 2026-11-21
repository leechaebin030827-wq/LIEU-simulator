/*
 * LIEU Stage 2: mapped, torque-off batch telemetry.
 *
 * IDs: 1 yaw, 2 tilt, 3 body, 4 rail. Mapping comes from the Stage 1
 * torque-off manual round trips and the user's rail wiring confirmation.
 * No command parser and no motion writes exist in this sketch.
 */

#include <Dynamixel2Arduino.h>

using namespace ControlTableItem;

static const unsigned long HOST_BAUD = 115200;
static const uint32_t DXL_BAUD = 115200;
static const float DXL_PROTOCOL = 2.0;
static const uint8_t DXL_DIR_PIN = 2;
static const uint8_t IDS[] = {1, 2, 3, 4};
static const unsigned long SAMPLE_INTERVAL_MS = 200;
static const unsigned long TORQUE_OFF_INTERVAL_MS = 500;

Dynamixel2Arduino dxl(Serial1, DXL_DIR_PIN);
unsigned long lastSampleMs = 0;
unsigned long lastTorqueOffMs = 0;

static void forceTorqueOff() {
  dxl.torqueOff(DXL_BROADCAST_ID);
  for (uint8_t id : IDS) dxl.torqueOff(id);
  lastTorqueOffMs = millis();
}

static void printSample() {
  Serial.print(F("POS ms="));
  Serial.print(millis());
  for (uint8_t id : IDS) {
    const float raw = dxl.getPresentPosition(id, UNIT_RAW);
    Serial.print(F(" id"));
    Serial.print(id);
    Serial.print(F("="));
    if (isfinite(raw)) Serial.print(lroundf(raw));
    else Serial.print(F("ERR"));
  }
  Serial.print(F(" torque="));
  for (uint8_t id : IDS) {
    const int32_t enabled = (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, id);
    Serial.print(enabled == 1 ? '1' : '0');
  }
  Serial.println();
}

void setup() {
  Serial.begin(HOST_BAUD);
  const unsigned long startedMs = millis();
  while (!Serial && millis() - startedMs < 1500) {}

  dxl.begin(DXL_BAUD);
  dxl.setPortProtocolVersion(DXL_PROTOCOL);
  forceTorqueOff();
  Serial.println(F("READY LIEU-STAGE2 mapped=1:yaw,2:tilt,3:body,4:rail outputs=torque-off-only rate_hz=5"));
}

void loop() {
  const unsigned long now = millis();
  if (now - lastTorqueOffMs >= TORQUE_OFF_INTERVAL_MS) forceTorqueOff();
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    printSample();
    lastSampleMs = now;
  }

  // Stage 2 accepts no commands.
  while (Serial.available() > 0) (void)Serial.read();
}
