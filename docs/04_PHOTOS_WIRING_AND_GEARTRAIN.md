# 실물 제작 사진과 GLB를 교차 검증한 회로·구동부 해석 (2026-10-19)

> 사진 증거는 시각적이며 전기적 연속성 테스트, 부품 데이터시트, CAD 조인트 설정을 대신하지 않습니다. '사진상 확인', '기구적 추론', '확인 필요'를 분리합니다.

## 1. 참고 실물 사진

- `references/eye_backpack_wiring.png`: 두 HT16K33 모듈 뒷면의 체인 배선 및 외장 고정 상태.
- `references/internal_ring_gear_and_pinion.png`: 외장 내부의 큰 링 기어, 작은 피니언, 모터 케이블 및 중앙 링 지지부.
- 아래 해석은 사진에서 보이는 범위에만 근거합니다. 카메라 방향상 좌·우는 **사진 좌/우**이고 탑승자 기준의 왼쪽 눈/오른쪽 눈과 동일하지 않을 수 있습니다.

## 2. 눈 모듈 — 버스 배선 확인

**사진상 확실**

- 별도의 `HT16K33 LED Backpack` 라벨이 붙은 **Monochrome 8×8 Matrix 보드 2개**가 외장 내부에 나란히 나사로 고정되어 있음.
- 사진상 왼쪽 보드의 접점 이름은 **위부터 SCL / SDA / GND / VCC**.
- 접점에 물린 점퍼선은 육안상 **SCL=주황 / SDA=노랑 / GND=검정 / VCC=빨강**.
- 동일 4개 신호선이 양쪽 백팩 보드로 배선되어, 독립된 2개의 직렬 버스가 아니라 **같은 I²C 버스를 공유하는 병렬 접속**으로 보임.
- 보드마다 주소 선택용 `A2 / A1 / A0` 패드가 있으나, 사진만으로 **납땜으로 연결한 패드 상태를 확정할 수 없음**.
- 보드 실크스크린에 `HT16K33 LED Backpack`, `Monochrome 8x8 Matrix`, `MRA210A` 문구가 보임. GLB의 제조사명/제품명(`KeyStudio-HT16K33-8x8...`)과 다를 수 있음. 핵심 기능 모델은 **HT16K33 기반 8×8 단색 매트릭스 2개**로 설정할 것.

**웹 시스템 반영**

```text
Simulated Eyes / 128 logical pixels
    ├─ screenLeft  : 8×8 bitmap, global intensity, blink
    └─ screenRight : 8×8 bitmap, global intensity, blink
                  ↓ physical mapping (MUST calibrate)
One shared I²C bus (SCL/SDA/GND/VCC)
    ├─ physicalBoardA @ ADDRESS_UNKNOWN
    └─ physicalBoardB @ ADDRESS_UNKNOWN
```

- **서로 다른 I²C 주소가 필요**합니다. HT16K33의 일반적인 주소 선택 영역은 `0x70–0x77`이지만 정확한 주소는 보드 회로·A0/A1/A2 점퍼 상태와 I²C 스캔으로 확인해야 합니다.
- **두 보드의 주소가 같으면** 양쪽 독립 표정 표현이 불가능하거나 동일 명령에 같이 반응하는 등 문제가 생깁니다. HardwareAdapter는 주소가 중복되거나 미설정이면 개별 눈 제어 송신을 비활성화합니다.
- 실물에 실제로 어떤 픽셀이 (row=0, col=0)인지 확인하려면 **각 보드의 단일 점등 테스트**를 실시하고 웹의 사진 좌/우 ↔ 화면 좌/우 ↔ GLB node 8/13 매핑을 교정해야 합니다.
- 웹에서 눈의 표현은 RGB 컬러를 기본으로 하지 않습니다. 각각 단색 8×8(`0/1` 또는 밝기)과 공통 밝기 조절을 구현합니다. 실제 드라이버 사용 시 brightness 0–15 등 지원값을 별도 어댑터에서 양자화할 수 있습니다.
- 사진 속 빨강/검정이 전기적으로 5V/GND에 올바르게 연결되었는지는 **전원 인가 전 테스터로 확인**해야 합니다. 색상만으로 안전한 배선임을 보장하지 않습니다.

## 3. 사진 속 링 기어 + 피니언

**사진상 확실**

- 도넛 내부에 **원형 대형 링 기어**가 있으며 바깥 둘레에 톱니가 보임.
- 링 기어의 바깥 톱니와 **작은 피니언 기어**가 접촉해 맞물려 있음.
- 피니언 가까이에 검은 모터 형상 및 케이블 묶음이 보임.
- 링 중앙에 백색 원통형 지지 구조가 있고, 외부 백색 쉘 안쪽에 기어가 조립됨.

**기구적으로 유력한 해석**

- 이 모듈은 **작은 모터의 회전을 큰 링의 상대 회전으로 감속 전달**하기 위한 스퍼 기어 구동으로 보입니다.
- 큰 링이 수평으로 놓여 있으므로 주된 상대 회전은 **GLB 월드 +Y축(Yaw) 중심**일 가능성이 큽니다.
- `XL,XC-330 (4) v2:4`가 GLB에서 링 외곽 쪽에 배치돼 있어 피니언 구동 모터의 후보이나, 사진의 피니언과 CAD의 특정 모터 노드가 **동일 부품인지 확정하지 않았습니다**.
- 링의 고정측과 이동측(내부 기둥/외장), 실제 피니언 구동 모터 식별, 상대 회전방향은 현 단계에서 확정 불가입니다.

**실측 후에만 적용할 기어 관계**

```text
피니언 잇수 = Np (현재 UNKNOWN)
링기어 잇수 = Nr (현재 UNKNOWN)
기어비(모터각/상대 링각) = Nr / Np (예: 6.0, 이 숫자는 사용 금지)
고정 지지대 기준 외접 기어 쌍: ringAngle = -pinionAngle * Np / Nr
* 실제 캐리어가 움직이거나 링이 고정된 구조일 경우 출력관계/부호가 달라집니다.
```

- 웹에는 `gearRatio`, `driveJoint`, `fixedLink`, `movingLink`, `pinionMotorRef`, `invertDirection`, `backlashDeg`, `originOffsetDeg`를 **수정 가능한 보정 필드**로 두고 모두 초기 `null`/`unknown`으로 둡니다.
- GLB에서 기어의 톱니 형태를 보여줄 수는 있으나, `:4`, `(1.3mm, 118)` 등 CAD 이름의 수치를 **확정 기어 잇수로 쓰면 안 됩니다**.
- 프리뷰 Yaw가 움직일 때 기어 링·피니언의 회전 애니메이션은 별도 `gear visualization` 모드로 표현하되, **기어비 확인 전에는 수치적 기어 연동을 비활성화하거나 명확히 MOCK 표시**합니다.

## 4. 현재 사진에서 보이지 않는 전장 정보

- 중앙 NeoPixel 24개의 **실물 PCB 뒷면 DIN/DOUT 배선과 외부 전원**은 이 두 사진에서 식별되지 않습니다. 따라서 LED0 방향, RGBW 칩셋, GRBW 순서는 **여전히 UNKNOWN**입니다.
- 오른쪽 사진의 **검정 케이블 4가닥**은 보이지만 어떤 모터의 신호/전원 선인지 식별 불가. 단지 케이블 수로 DYNAMIXEL 모델/TTL/RS-485 결선 등을 추정할 수 없습니다.
- 레일 모터/엔드스톱, 틸트 구동부의 장착 관계, 프로젝터 입출력/광축, 스피커, 카메라의 **실물 결선은 이 사진에 없거나 가려져 있습니다**.

## 5. Codex 구현: 전기 배선과 논리 좌/우를 혼동하지 말기

```ts
type EyeBusCalibration = {
  busType: 'I2C';
  connectionsVisual: { scl: 'orange'; sda: 'yellow'; gnd: 'black'; vcc: 'red' };
  boards: {
    physicalBoardA: { address: number|null; geometryMeshNodeIndex: 8|13|null; pixelMap: number[]|null };
    physicalBoardB: { address: number|null; geometryMeshNodeIndex: 8|13|null; pixelMap: number[]|null };
  };
  photographedWireColorNotElectricallyVerified: true;
};
```

`config/LIEU_Physical_Evidence.json`에는 사람/코드 양쪽에서 사용할 근거·미확정 보정 필드가 담겨 있습니다.

## 6. 실물에서 해 보면 바로 해결되는 짧은 테스트

1. **눈 주소 테스트:** 컨트롤러로 I²C 스캔 → 2개 주소가 각각 잡히는지 확인 → 한 보드씩 `pixel(0,0)` 테스트 → 좌/우 및 회전·미러 방향 매핑.
2. **회전 시험(전원/부하 안전 확인 후):** 출력축을 아주 조금만 동작 → 무엇이 고정되는지(기둥/외장/링) 확인 → 모터/링 회전 방향과 실제 각도 비율 측정 → 원점과 하드스톱 기록.
3. **NeoPixel:** LED 0만 켜서 물리 시작점과 순서/CW 여부 확인 → R/G/B/W 개별 테스트 → LED 칩셋·전원 용량 확인.
4. **Tilt:** 서보를 수동으로 비틀어 시험하지 말고 실제 구동 가능한 상태에서 안전하게 관절 링크를 확인 → 눈/외장/프로젝터/중앙 LED의 동행 여부를 기록.

> 이 검증은 현장에서 시뮬레이터 보정을 위한 절차 안내일 뿐, 하드웨어를 웹에 연결해 자동으로 작동시키라는 지시가 아닙니다. 미검증 모터에는 웹에서 어떤 명령도 전송하지 않습니다.
