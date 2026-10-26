# LIEU hardware (UNO R4 test rig → Raspberry Pi)

시뮬레이터의 시퀀스를 **실제 눈 매트릭스 2개 + 링 LED 24개**로 재생합니다. 모터(Dynamixel)는 아직 구동하지 않습니다(프레임에 동작 값만 담겨 있고 `motion.py`가 비어 있음).

```
시뮬레이터 시퀀스 (examples/*.lieu.json)
   │  npx vite-node tools/export_hw_frames.ts      ← 뷰어와 같은 evaluateSequenceAt로 30fps 구움
   ▼
hardware/frames/<id>.hw.json   (눈 8행×2, 눈 밝기, 링 RGBW×24, 동작)
   │  python -m lieu_hw play <id>
   ▼
player ─ mapping(배선 보정) ─ driver ┬ mock    : 터미널 미리보기 (장비 없이)
                                     ├ serial  : UNO R4 (firmware/lieu_uno_r4)   ← 지금
                                     └ pi      : 라즈베리파이 직결 (I2C + GPIO18) ← 나중
```
UNO → 라즈베리파이 이전은 `config/hardware.json`의 `"backend"`만 `serial` → `pi`로 바꾸면 됩니다. 프레임·플레이어·배선 보정은 그대로입니다.

## 배선
| 부품 | UNO R4 | 라즈베리파이 |
|---|---|---|
| 눈 ×2 SDA / SCL | A4 / A5 (같은 선에 병렬) | GPIO2(핀3) / GPIO3(핀5) |
| 눈 VCC / GND | 5V / GND | 5V(핀2·4) / GND(핀6) |
| 링 DIN | D6 (330Ω 직렬) | GPIO18(핀12) |
| 링 5V / GND | 5V(밝기 낮게) / GND | 외부 5V 2A, GND는 Pi와 공통 |

주의: 두 눈 보드는 **I²C 주소가 달라야** 합니다(보드의 A0/A1/A2 패드). 기본 가정은 `0x70`(왼쪽)/`0x71`(오른쪽)이며 `python -m lieu_hw info`가 실제 감지된 주소를 출력합니다. 링은 UNO USB 전원에서는 `max_scale 0.25`, `budget_ma 400`으로 제한됩니다(링 전류는 코드에서 추정해 초과 시 자동으로 낮춤). 외부 5V 2A로 옮기면 `hardware.json`에서 올리세요.

## UNO R4 테스트 순서
1. Arduino IDE → 라이브러리 관리자에서 **Adafruit NeoPixel** 설치 → `firmware/lieu_uno_r4/lieu_uno_r4.ino` 업로드. 부팅 직후 링 LED0과 눈 중앙 점이 0.4초 켜지면 배선 OK.
2. `cd hardware/pi && pip install -r requirements.txt` (Arduino IDE 시리얼 모니터는 닫기)
3. 장비 확인과 보정:
   ```
   python -m lieu_hw info          # 감지된 I²C 주소 / 눈 보드 유무
   python -m lieu_hw test eyes     # 점 하나가 8×8을 훑음 → 실제 보드에서 위치/방향 확인
   python -m lieu_hw test ring     # LED0 빨강 + 흰 점 이동, 이어 R/G/B/W 색 순서 확인
   ```
   `test eyes`에서 방향이 틀리면 `eyes.*.layout`(`adafruit`/`msb_left`/`lsb_left`), `flip_x`, `flip_y`, `swap`을 고칩니다. 링은 `ring.offset`, `ring.reverse`(LED0 위치/방향), 색 순서는 `.ino`의 `LED_TYPE`을 맞추세요.
4. 재생: `python -m lieu_hw play 05_web_cover` (`--loop`, `--speed 0.5`). 장비 없이는 `--backend mock`.

시퀀스를 고친 뒤에는 프레임을 다시 굽습니다: `npx vite-node tools/export_hw_frames.ts [id...]`

## 라즈베리파이로 옮길 때
1. `sudo raspi-config` → Interfaces → I2C 켜기, `i2cdetect -y 1`로 두 주소 확인.
2. `pip install smbus2 rpi_ws281x`, `hardware.json`의 `"backend": "pi"`, 같은 `test`로 재확인(rpi_ws281x는 `sudo` 필요, GPIO18 PWM은 3.5mm 오디오 출력과 충돌 → USB/HDMI 오디오 사용).
3. Pi 5는 rpi_ws281x가 동작하지 않으므로 `drivers/pi_direct.py`의 `_open_ring/_write_ring`만 PIO/SPI 방식으로 교체하면 됩니다.
4. 부팅 자동 실행은 systemd로 `python -m lieu_hw play <id> --loop`.

## 검증 상태
- 하드웨어 없이 검증됨: 프레임 굽기, 매핑/전류 제한/패킷 직렬화(`python -m lieu_hw.tests`), mock 재생.
- **미검증(실기 필요)**: `.ino` 컴파일·업로드, HT16K33/NeoPixel 실제 출력, `pi` 백엔드. 눈 행/열 방향, I²C 주소, 링 LED0·색 순서는 위 `test`로 직접 보정해야 하는 값입니다.
- 모터: `motion.py`의 `DynamixelMotion`이 자리만 잡아 둔 상태(U2D2, 모터 ID·기어비·가동범위·E-stop 확정 후 구현).
