// LIEU test firmware for Arduino UNO R4 (Minima / WiFi).
// A dumb output stage: the host (hardware/pi, `python -m lieu_hw`) decides what to show and sends 114-byte frames over USB serial.
// Eyes: 2x HT16K33 8x8 on I2C (SDA=A4, SCL=A5). Ring: 24 NeoPixel RGBW on D6 (330 ohm in series, common GND).
// Library: "Adafruit NeoPixel" (Library Manager). Protocol: hardware/pi/lieu_hw/protocol.py
#include <Wire.h>
#include <Adafruit_NeoPixel.h>

#define PIN_RING   6
#define RING_COUNT 24
#define LED_TYPE   (NEO_GRBW + NEO_KHZ800)   // SK6812 RGBW. Plain WS2812 RGB ring: NEO_GRB + NEO_KHZ800 (W byte is then ignored)
#define BAUD       115200
#define WATCHDOG_MS 2000                     // no frame for this long -> everything off

static const uint8_t SYNC0 = 0xAA, SYNC1 = 0x55;
enum : uint8_t { T_FRAME = 1, T_CONFIG = 2, T_INFO = 3, T_BLANK = 4 };
static const uint8_t FRAME_LEN = 8 + 8 + 2 + RING_COUNT * 4;

Adafruit_NeoPixel ring(RING_COUNT, PIN_RING, LED_TYPE);

uint8_t addr[2] = {0x70, 0x71};              // left, right; overwritten by the host CONFIG packet
uint8_t dimNow[2] = {255, 255};
uint8_t maxScale = 64;                       // 0..255 hard cap on ring brightness (backstop; the host already limits)
uint16_t budgetMa = 400;                     // estimated ring current cap (20 mA per channel at 255)
uint32_t lastFrameMs = 0;
bool dark = true;
uint32_t nFrames = 0, nBad = 0, nI2cErr = 0;   // shown by INFO, for bring-up

// ---- HT16K33 -------------------------------------------------------------------------------------------------------------
void htCmd(uint8_t a, uint8_t c) { Wire.beginTransmission(a); Wire.write(c); Wire.endTransmission(); }

void htInit(uint8_t a) { htCmd(a, 0x21); htCmd(a, 0x81); htCmd(a, 0xE0 | 15); }

void htShow(uint8_t side, const uint8_t* rows, uint8_t dim) {
  if (dim != dimNow[side]) { htCmd(addr[side], 0xE0 | (dim & 15)); dimNow[side] = dim; }
  Wire.beginTransmission(addr[side]);
  Wire.write((uint8_t)0x00);
  for (uint8_t r = 0; r < 8; r++) { Wire.write(rows[r]); Wire.write((uint8_t)0); }   // 8x8 backpack: row r at register 2r
  if (Wire.endTransmission() != 0) nI2cErr++;
}

bool htPresent(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }

// ---- Ring ----------------------------------------------------------------------------------------------------------------
void ringShow(const uint8_t* px) {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < RING_COUNT * 4; i++) sum += px[i];
  uint32_t scale = maxScale;                                  // /255
  uint32_t estMa = (sum * 20UL / 255UL) * scale / 255UL;
  if (estMa > budgetMa) scale = scale * budgetMa / estMa;
  for (uint8_t i = 0; i < RING_COUNT; i++) {
    const uint8_t* p = px + i * 4;
    ring.setPixelColor(i, ring.Color(p[0] * scale / 255, p[1] * scale / 255, p[2] * scale / 255, p[3] * scale / 255));
  }
  ring.show();
}

// ---- Output --------------------------------------------------------------------------------------------------------------
void blankAll() {
  uint8_t z[RING_COUNT * 4] = {0};
  htShow(0, z, 0); htShow(1, z, 0);
  ringShow(z);
  dark = true;
}

void onFrame(const uint8_t* p) {
  htShow(0, p, p[16]);
  htShow(1, p + 8, p[17]);
  ringShow(p + 18);
  lastFrameMs = millis();
  nFrames++;
  dark = false;
}

void onConfig(const uint8_t* p, uint8_t n) {
  if (n < 5) return;
  addr[0] = p[0]; addr[1] = p[1];
  maxScale = p[2];
  budgetMa = ((uint16_t)p[3] << 8) | p[4];
  dimNow[0] = dimNow[1] = 255;
  htInit(addr[0]); htInit(addr[1]);
  Serial.print(F("CONFIG eyeL=0x")); Serial.print(addr[0], HEX);
  Serial.print(F(" eyeR=0x")); Serial.print(addr[1], HEX);
  Serial.print(F(" scale=")); Serial.print(maxScale);
  Serial.print(F(" budget_mA=")); Serial.println(budgetMa);
  if (addr[0] == addr[1]) Serial.println(F("WARN both eyes share one I2C address: set A0/A1/A2 pads on one board"));
}

void onInfo() {
  Serial.print(F("INFO LIEU-HW fw=1 ring=")); Serial.print(RING_COUNT);
  Serial.print(F(" eyeL=0x")); Serial.print(addr[0], HEX); Serial.print(htPresent(addr[0]) ? F(":ok") : F(":MISSING"));
  Serial.print(F(" eyeR=0x")); Serial.print(addr[1], HEX); Serial.println(htPresent(addr[1]) ? F(":ok") : F(":MISSING"));
  Serial.print(F("I2C scan:"));
  for (uint8_t a = 0x08; a < 0x78; a++) if (htPresent(a)) { Serial.print(F(" 0x")); Serial.print(a, HEX); }
  Serial.println();
  Serial.print(F("frames=")); Serial.print(nFrames);
  Serial.print(F(" bad=")); Serial.print(nBad);
  Serial.print(F(" i2cErr=")); Serial.println(nI2cErr);
}

// ---- Serial parser (AA 55 | type | len | payload | sum) --------------------------------------------------------------------
void pump() {
  static uint8_t st = 0, type, len, idx, buf[255];
  static uint8_t sum;
  while (Serial.available()) {
    uint8_t b = Serial.read();
    switch (st) {
      case 0: st = (b == SYNC0) ? 1 : 0; break;
      case 1: st = (b == SYNC1) ? 2 : (b == SYNC0 ? 1 : 0); break;
      case 2: type = b; sum = b; st = 3; break;
      case 3: len = b; sum += b; idx = 0; st = len ? 4 : 5; break;
      case 4: buf[idx++] = b; sum += b; if (idx == len) st = 5; break;
      case 5:
        if (b == sum) {
          if (type == T_FRAME && len == FRAME_LEN) onFrame(buf);
          else if (type == T_CONFIG) onConfig(buf, len);
          else if (type == T_INFO) onInfo();
          else if (type == T_BLANK) blankAll();
        } else { nBad++; Serial.println(F("ERR checksum")); }
        st = 0; break;
    }
  }
}

void setup() {
  Serial.begin(BAUD);
  Wire.begin();
  Wire.setClock(400000);
  ring.begin();
  htInit(addr[0]); htInit(addr[1]);
  blankAll();
  // boot blink so the wiring can be checked without the host: ring LED 0 and one dot per eye
  uint8_t dot[8] = {0, 0, 0, 0x18, 0x18, 0, 0, 0}, px[RING_COUNT * 4] = {0};
  px[3] = 255;
  htShow(0, dot, 4); htShow(1, dot, 4); ringShow(px);
  delay(400);
  blankAll();
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1500) {}
  Serial.println(F("READY LIEU-HW fw=1"));
}

void loop() {
  pump();
  if (!dark && millis() - lastFrameMs > WATCHDOG_MS) blankAll();
}
