# LIEU — GLB 해석 & 웹 시퀀스 에디터 구현 자료

**2026-11-01 | 하드웨어 제어부 초기화 | 시뮬레이터·시퀀스 미리보기 전용**

> 현재 실제 하드웨어 출력은 완전히 비활성화되어 있습니다. 기존 USB/Wi-Fi/U2D2 제어, 펌웨어, 교정값은 `backups/hardware-control-before-reset-2026-11-01.zip`에 보존했으며, 활성 코드로 사용하지 않습니다. 재연결 절차는 `hardware/README.md`를 참고하세요.

원본 파일 `LIEU_Senario.glb`와 제작 사진 2장을 검토하여 **3D 시각화 + Motion + NeoPixel RGBW 24개 + 단색 8×8 눈 2개 + 프로젝터 + 오디오 + 키프레임 편집 + 통합 Play/Seek** 도구를 만들기 위한 명세·기하 좌표·예제 시퀀스를 묶은 패키지입니다.

## 시작하기

개발은 `npm run dev`, 전시 실행은 `npm run build && npm run preview`로 시작합니다(전시 주소: `http://127.0.0.1:4173`). 전시에서는 코드 변경에 따른 개발 서버의 자동 새로고침과 연결 해제를 피할 수 있습니다. 전체 자동 검사는 `npm run check`로 실행합니다.

1. **[`CODEX_START_HERE.md`](CODEX_START_HERE.md)의 프롬프트를 Codex에 전달하세요.** 이 폴더 전체를 Codex 작업 루트에 놓으세요.
2. `python tools/validate_handoff.py`를 실행해 GLB/JSON/예제 매핑을 검사하세요.
3. 상단 `하드웨어` 메뉴는 현재 초기화 상태만 표시하며 실제 장치 연결이나 출력 기능을 제공하지 않습니다.

> 안전: 브라우저는 보조 컨트롤러입니다. 독립된 물리 비상정지, 전원 차단, 기구적 한계를 대체하지 않습니다.

## 파일 구성

```text
LIEU_Codex_Handoff/
├── README.md                              # 이 문서
├── CODEX_START_HERE.md                   # Codex 복붙 지시문/우선순위/완성조건
├── assets/
│   └── LIEU_Senario.glb                  # 사용자가 제공한 원본 그대로
├── references/
│   ├── eye_backpack_wiring.png           # 실제 눈 매트릭스·I2C 배선 사진
│   └── internal_ring_gear_and_pinion.png # 내부 대형 링기어·피니언 사진
├── docs/
│   ├── 01_GLB_ANALYSIS.md                # 노드/부품/치수/의미
│   ├── 02_EDITOR_ARCHITECTURE.md         # 화면 IA·스택·렌더·리그
│   ├── 03_INPUTS_AND_LIMITS.md           # 사용자에게 필요한 미확정 데이터
│   ├── 04_PHOTOS_WIRING_AND_GEARTRAIN.md # 배선/기어/실제사진 해석
│   └── 05_SEQUENCE_ENGINE_AND_DATA.md    # 타임라인/키프레임/평가기 계약
├── config/
│   ├── LIEU_GLB_Node_Manifest.json       # 144개 노드/61개 메시 인스턴스/월드 좌표
│   ├── LIEU_LED_Calibration.json         # CAD에서 추출한 발광점 24+64+64
│   ├── LIEU_Simulator_Config.json        # 임시 3축 리그·preview 범위/physical=null
│   └── LIEU_Physical_Evidence.json       # 사진에서 확인한 배선·기어 증거
├── spec/
│   ├── sequence-types.ts                 # JSON 시퀀스 TypeScript 타입
│   └── HARDWARE_CALIBRATION_TEMPLATE.json# 물리 제약/장치 ID 채우기용 양식
├── examples/
│   ├── 01_boarding.lieu.json             # 탑승: 환영·안전벨트 확인·출발
│   ├── 02_driving_a.lieu.json            # 주행A: 교통 상황 탐색·우회 안내
│   ├── 03_arrival.lieu.json              # 하차: 거의 도착·작별 인사
│   └── media/                            # Welcome/Detour/Seatbelt SVG + 미리보기 음원
├── tables/
│   ├── glb_nodes_144.csv                 # 144개 노드/상위노드/부품 카테고리
│   ├── glb_mesh_instances_61.csv         # 61개 메시 인스턴스/바운드/재질
│   └── emitter_positions_152.csv         # LED 24 + 눈 128 좌표
├── tools/
│   ├── build_rig_config.py
│   ├── extract_led_calibration.py
│   ├── generate_example_sequences.py
│   └── validate_handoff.py
└── VALIDATION_REPORT.md                  # 자동 검증 결과
```

## GLB로 '실제로' 확인한 것

아래 수치는 초기 로봇 본체 분석 기준입니다. 현재 전시 GLB는 고정 전시 구조물을 포함해 1,093개 노드 / 371개 메시 인스턴스 / 72개 고유 메시이며, 검증기는 기존 본체의 노드 식별자·메시 매핑과 추가 구조물을 함께 검사합니다.

| 항목 | 확인/결론 |
|---|---|
| **144 nodes / 61 mesh instances / 38 unique meshes** | Fusion 계층 GLB 정적 모델; 애니메이션·스킨 **없음** |
| 레일 | 독립 루트 `Rail` 143번, 약 612.4 mm 형상. **가동 스트로크는 미확인** |
| NeoPixel | 노드 133 안에 **24개 발광 칩 형상**. 링 반지름 약 29.4 mm, 15° 간격. 실제 물리 LED 인덱스/배선 순서는 미확인 |
| 눈 | HT16K33 계열 8×8 보드 **2개**, 실제 도트 좌표 총 **128개** 복원. 단색 보드이며 RGB 컬러 눈 아님 |
| 프로젝터 | `Miniray_Beam` 본체 메시 18번, 홀더 139번 존재. **광학 중심/투사비는 미확인** |
| 기구 | 베어링 상·중·하/틸트축 2개/XL·XC330 계열 어셈블리 1세트/XM·H430 명칭의 아이들러 1세트 |
| 실물 사진 | 눈 보드 2개 공통 I²C 배선 형태, 큰 링 기어+작은 피니언 맞물림. 모터 모델/기어비/모터 개수는 단정 불가 |

## 가장 중요한 설계 원칙

- **Scene 좌표 != 실물 하드웨어 캘리브레이션**: 렌더 원점/회전축은 기하학적 가설입니다. 실제 조인트 원점/링 고정 링크/가동각은 확인받아야 합니다.
- **가상 Preview 한계 != 모터의 허용 한계**: Preview의 rail -0.25~0 m, yaw ±45°, tilt ±15°는 **UI 데모를 위한 임시 숫자**이며 실제 기구·장치 안전성에 전혀 적용하면 안 됩니다.
- **모든 표현을 하나의 시간 함수로 계산**: `evaluate(sequence,t)`는 부작용이 없고 재생/스크러빙/영상 저장 시 동일한 결과를 내야 합니다.
- **배선 논리 분리**: eyes I²C 물리 주소와 row/column, NeoPixel LED0·RGBW byte order는 아직 null. UI 가상 순서와 장치 전송 매핑을 섞지 않습니다.
- **출력 안전**: 현재 물리 출력 경로 자체가 제거되어 있습니다. 새 제어기를 만들 때 읽기 전용 검색부터 단계별로 재검증합니다.

## 이 자료로 바로 할 수 있는 것 / 아직 못 하는 것

- **할 수 있음**: 원본 GLB 정확한 표시, 모터 후보 3축 가상 조작, 24 RGBW LED·두 눈·프로젝터·사운드 조작, 키프레임/타임라인/통합 재생을 Codex로 구현.
- **추가 정보 필요**: 진짜 모터 ID·수량·운전모드·각도/속도/가속도/기어비·레일 travel·LED 물리 배선·I²C 주소·프로젝터 투사비를 반영한 실물 일치 시뮬레이션/실장치 제어.

## 재현/검증

- `pip install trimesh numpy`가 있으면 발광점 추출 및 리그 생성 스크립트를 재실행할 수 있습니다.
- 검증 스크립트는 추가 패키지 없이 JSON/GLB 파일 및 샘플을 점검합니다.
- 시나리오 파일은 영상이나 실제 녹음이 아니라 사용자의 3개 상호작용을 **데모로 구성한 예시 데이터**입니다.
