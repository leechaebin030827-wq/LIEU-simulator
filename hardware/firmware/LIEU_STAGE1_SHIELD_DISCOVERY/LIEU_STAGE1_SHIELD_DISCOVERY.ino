/*
 * LIEU Stage 1: DYNAMIXEL Shield discovery.
 *
 * Allowed bus operations:
 *   - broadcast Torque Enable = 0 (safety action)
 *   - protocol 2.0 broadcast ping
 *   - read present position and Torque Enable for discovered IDs
 *
 * This sketch never enables torque and never writes operating mode, goal
 * position, velocity, acceleration, limits, calibration, LEDs, eyes, or Wi-Fi.
 */

#include <Dynamixel2Arduino.h>

using namespace ControlTableItem;

static const unsigned long HOST_BAUD = 115200;
static const uint32_t DXL_BAUD = 115200;
static const float DXL_PROTOCOL = 2.0;
static const uint8_t DXL_DIR_PIN = 2;
static const unsigned long SCAN_INTERVAL_MS = 2000;
static const uint8_t MAX_FOUND = 16;

Dynamixel2Arduino dxl(Serial1, DXL_DIR_PIN);
DYNAMIXEL::InfoFromPing_t found[MAX_FOUND];
unsigned long lastScanMs = 0;

static void printIdentity() {
  Serial.println(F("READY LIEU-STAGE1 board=UNO-R4 shield=DYNAMIXEL outputs=torque-off-only"));
}

static void scanBus() {
  // The only write allowed in Stage 1: force every responding device to a
  // non-driving state before asking it for identity or telemetry.
  dxl.torqueOff(DXL_BROADCAST_ID);
  delay(20);

  const uint8_t count = dxl.ping(DXL_BROADCAST_ID, found, MAX_FOUND);
  Serial.print(F("DXL_SCAN count="));
  Serial.println(count);

  for (uint8_t i = 0; i < count; ++i) {
    const uint8_t id = found[i].id;
    // Repeat the safety write per discovered ID before any reads.
    dxl.torqueOff(id);

    Serial.print(F("DXL_FOUND id="));
    Serial.print(id);
    Serial.print(F(" model="));
    Serial.print(found[i].model_number);
    Serial.print(F(" firmware="));
    Serial.print(found[i].firmware_version);

    const float raw = dxl.getPresentPosition(id, UNIT_RAW);
    Serial.print(F(" raw="));
    if (isfinite(raw)) Serial.print(lroundf(raw));
    else Serial.print(F("ERR"));

    const int32_t torque = (int32_t)dxl.readControlTableItem(TORQUE_ENABLE, id);
    Serial.print(F(" torque="));
    Serial.println(torque == 1 ? 1 : 0);
  }
}

void setup() {
  Serial.begin(HOST_BAUD);
  const unsigned long startedMs = millis();
  while (!Serial && millis() - startedMs < 1500) {
    // USB CDC only. No actuator operation occurs here.
  }

  dxl.begin(DXL_BAUD);
  dxl.setPortProtocolVersion(DXL_PROTOCOL);
  dxl.torqueOff(DXL_BROADCAST_ID);

  printIdentity();
  scanBus();
  lastScanMs = millis();
}

void loop() {
  if (millis() - lastScanMs >= SCAN_INTERVAL_MS) {
    scanBus();
    lastScanMs = millis();
  }

  // Stage 1 accepts no host commands.
  while (Serial.available() > 0) {
    (void)Serial.read();
  }
}
