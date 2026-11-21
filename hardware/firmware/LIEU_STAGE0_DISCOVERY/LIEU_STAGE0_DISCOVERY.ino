/*
 * LIEU Stage 0: USB identity only.
 *
 * This sketch deliberately does not include Dynamixel, I2C, NeoPixel, Wi-Fi,
 * or actuator code. It does not configure or write any hardware output pin.
 * Keep external motor power disconnected while using this stage.
 */

static const unsigned long BAUD = 115200;
static unsigned long lastBannerMs = 0;

static void printBanner() {
  Serial.println(F("READY LIEU-STAGE0 board=UNO-R4 outputs=disabled shield=uninitialized"));
}

void setup() {
  Serial.begin(BAUD);
  const unsigned long startedMs = millis();
  while (!Serial && millis() - startedMs < 1500) {
    // Wait briefly for USB CDC only. No physical outputs are touched.
  }
  printBanner();
  lastBannerMs = millis();
}

void loop() {
  // Repeat the identity so a read-only host can discover the board without
  // resetting it or sending a probe command.
  if (millis() - lastBannerMs >= 1000) {
    printBanner();
    lastBannerMs = millis();
  }

  // Discard any received bytes. Stage 0 accepts no commands.
  while (Serial.available() > 0) {
    (void)Serial.read();
  }
}
