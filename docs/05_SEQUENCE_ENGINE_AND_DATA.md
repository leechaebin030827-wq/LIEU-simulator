# LIEU 시퀀스 엔진: 실제처럼 조작하고 한 번에 재생하는 명세

## 0. 설계 의도

**LIEU Sequence Editor**는 단순 모델 뷰어나 'LED 애니메이션 생성기'가 아닙니다. 조명·표정·레일·Yaw·Tilt·프로젝션·사운드·이벤트를 단일 시간축에 저작하는 통합 인터랙션 툴입니다. 하드웨어가 없어도 스크러빙과 재생 결과는 동일해야 하며, 실제 장치에 보낼 값은 캘리브레이션을 거쳐 별도 어댑터로 생성해야 합니다.

**설계 불변식**

1. `state = evaluate(sequence, timeSec)`는 **순수 함수**. 같은 시퀀스와 같은 시간은 언제나 같은 상태를 산출합니다.
2. 단일 재생 시계. 3D/LED/eyes/projector/audio/events의 시간 소스는 하나.
3. keyframe의 값은 **논리 단위**(레일 미터, 각도 degree, RGBW 바이트, 8×8 비트맵)로 보존하고, 장치별 원시 명령(tick/PWM/I2C/LED byte)은 **HardwareAdapter**에서만 변환.
4. `PreviewLimits`와 `PhysicalLimits`는 **엄격 분리**. 물리 한계에 null 하나라도 남은 축은 실제 명령 송신 금지.
5. GLB는 외관 및 대략적 부품 구조만 제공. 실제 기구 관절 관계는 사용자가 바꿀 수 있는 리그 보정데이터에서 정의합니다.

## 1. 화면의 정밀 편집 동작

```text
LIEU [Scenario ▼]  [Import] [Export] [Undo] [Redo]     PREVIEW ONLY   [FPS 30]
┌────── Scene / Rig ──────┬─────────────── 3D Viewport ─────────────┬──────── Inspector ─────┐
│ Rail (static)            │ orbit / front / bottom / cutaway view     │ Motion                 │
│ Moving carriage          │ real GLB + actual emitter coordinates    │  Rail X [mm] ◆         │
│  Yaw drive               │ glowing LEDs / eye dots / projection     │  Yaw [deg] ◆           │
│   Tilt assembly          │ gizmos: pivot, limits, beam, axes        │  Tilt [deg] ◆          │
│  Ring 24px               │                                          │ LEDs / Eye / Projector │
│  Eye left/right          │                                          │ Audio / Trigger        │
└──────────────────────────┴──────────────────────────────────────────┴───────────────────────┘
[|<] [▶/❚❚] [■] [↻ loop] [2.450 / 12.000 s] [◇ Add Key] [AutoKey] [Snap 1/30]
┌────────────────────────────── Timeline with nested lanes ────────────────────────────────┐
│ Motion  ┬ Rail X              ◆------------------◆                                      │
│         ├ Yaw                 ◆-----◆------------◆                                      │
│         └ Tilt                ◆---------◆--------◆                                      │
│ Ring    ┬ All 24 RGBW         ◆--------◆------◆                                          │
│         ├ LED #0 ... #23      expandable per pixel; 4 individual channels              │
│         └ Effects             [Breathe------------][Wave----]                          │
│ Eyes    ┬ Left 8×8            [Neutral--][Blink][Smile-------------]                   │
│         ├ Right 8×8           [Neutral--][Blink][Smile-------------]                   │
│         └ Brightness          ◆----------◆                                              │
│ Project ┬ Media source        [Welcome.svg--------][Reroute.svg]                        │
│         ├ Opacity / Scale     ◆---------◆-----------◆                                  │
│         └ Lens/Transform      ◆--------------------◆                                   │
│ Audio   └ Voice              [Hello.wav--------]                                      │
│ Trigger └ Detect events       ┆arrived┃ belt_on ┃ reroute_requested                   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- 조작 중 **Autokey ON**이면 현재 플레이헤드 시간에 기존 키 업데이트 또는 키 추가, **Autokey OFF**면 미저장 live override(명확한 UI 표시). 키프레임이 없는 상태의 첫 편집 시 기본 키 `t=0`을 만들 수 있어야 합니다.
- 모든 수치 값 옆 `◆`를 눌러 현재 시간에 키 생성; 키를 이동, 다중 선택, 복사/붙여넣기, 삭제, 키 간 보간 변경.
- Ring은 **24픽셀 원형 선택 UI**와 **RGBW 4슬라이더/수치 입력** 제공; 다중 선택, 전체 채우기, 방향 회전, 컬러 복사. 트랙은 펼치면 LED i의 R/G/B/W까지 보여줍니다.
- Eyes는 **좌/우 별도 8×8 도트 에디터**, 펜/지우개/복사/반전/프리셋, 같은 눈의 패턴을 hold 키로 저장.
- Projector는 영상/이미지 선택, OFF/ON, 불투명도, 조도 가상 배수, 위치/크기/회전/왜곡/키스톤/초점 가상 프리뷰 등 **각 속성 키프레임** 가능.
- Audio는 waveform형 클립(첨부 미디어 ID/시작/길이/페이드/게인/미디어 offset). 카메라 센서에 관한 트리거는 실제 연결 전 **Mock Event**.
- 편집기 외 별도 `Present` 버튼으로 컨트롤을 숨기고 풀스크린 뷰어에서 시나리오 재생.

## 2. 문서 계약 및 데이터 단위

`spec/sequence-types.ts`는 로직과 분리된 TypeScript 계약. `examples/01_boarding.lieu.json`은 프리뷰용 예시 시퀀스입니다.

| 데이터 | 형식 | 기본 보간 | 키프레임 범위 |
|---|---|---|---|
| railX | m(float) | smoothstep / linear | preview 범위는 config; real=null |
| yawY / tiltZ | degree(float) | smoothstep / linear | preview 범위; real=null |
| 24 NeoPixel | `[r,g,b,w] ×24`, 각 0..255 | 채널별 linear 또는 hold | 전체프레임 키 + 픽셀별 세부 편집 |
| NeoPixel brightness | 0..1 | linear | 별도 global dimmer |
| LED effect | `EffectClip` with `start/end/seed/params/blend` | time-based analytic | 독립 clip 파라미터도 키 가능 |
| Left/right eyes | `rows[8]` each integer 0..255 | **hold only** | 8행 × 8비트, 전체 점멸은 overlay |
| eye intensity | 0..1 | linear | 실제 HT16K33 밝기 단계와 별도 |
| projector source | assetId / built-in | hold at clip boundaries | 실제 렌즈 좌표 등 미확인 |
| projector pose | local xyz m + rotation(deg) + scale | smoothstep/linear | 광축 이동에 따른 raycast 재계산 |
| audio | clip startSec/endSec + assetId, gain | clip scheduling | 브라우저에서 사용자 play 필요 |
| event | discrete event + payload | none | 지나간 시간 구간에서만 fire |

## 3. Ring 24 RGBW 결과 합성 — 정확한 규칙

- **Base Frame**: 24개의 RGBW 값 전체에 대한 keyframe을 보간 (`hold` 또는 4채널 개별 `linear`).
- **효과 Clip Layer**: 각 효과는 `effect(type, tSec, index, params, seed) → [r,g,b,w]` 순수 함수여야 합니다. 주요 타입: `solid, breathe, chase, wave, sparkle, pulse, gradient, progress`. Chase index direction은 **virtual index** 기준; physical LED0/방향 매핑은 어댑터에만.
- **Layer Order**: 베이스 프레임 → Clip을 priority 오름차순 합성(`replace`, `add`, `max`) → 0..255로 clamp → `brightness` 곱 → 렌더용 gamma/color convert. `RGBW W`를 RGB 흰색과 합쳐 source data를 잃지 않음.
- seed와 모든 시간 변수는 순수하게 계산해서, `seek(5.0)`이 언제나 완벽히 같은 LED 색을 냄. 프레임마다 `Math.random()` 하지 말 것.
- **현실감**: 24개의 발광 칩 좌표에서 emissive overlay를 계산하고, `LED 쉐이드`에는 퍼지는 빛의 sector field를 적용. 독립 `PointLight` 24개를 무조건 넣지 말 것. Diffuser, bloom, gamma는 물리 출력값과 분리된 프리뷰 파라미터.

## 4. Eyes / I²C — 논리 패턴과 실물 프로토콜 분리

- 두 눈은 2×64 = 128개의 논리 픽셀. 각 눈의 frame은 `rows[8]`이며 bit7=UI 왼쪽 column0이라는 **가상 규칙**을 사용.
- 실제 HT16K33은 글래스면의 회전/미러에 따라 row/col 대응이 달라지며, 보드 백면 사진으로는 실제 매핑 확정 불가. Adapter에서 **physicalBoardA/B 주소와 64개 매핑표**를 설정할 것.
- 감정 프리셋은 `neutral`, `blink`, `look_left`, `look_right`, `smile`, `surprise` 등. user-authored bitmap이 항상 1차 source of truth이며 preset은 사용자가 키프레임화할 수 있어야 함.
- **Blink Clip**은 현재 두 8×8 bitmap을 곱하는 마스크로서 timeSec 기준 결정. `eyeIntensity`는 별개.
- 2개의 I²C 주소를 검증하기 전에는 하드웨어 연결을 시도하지 않고 반드시 `PREVIEW ONLY`.

## 5. Motion – 리그 / 속도 / 기어

- 원본 모델 노드에 bone/joint 없음. `RigDefinition`은 Stage `fixedRail`, `carriage`, `yawLink`, `tiltLink`에 각 renderable mesh node index를 **중복 없이 정확히 1번 할당**하고, 부모 스테이지 변환은 상속하도록 구성. 하위 stage의 피벗은 **원본 rest pose 월드 좌표**로 정의.
- 광원, 투사장치, 눈은 스테이지 소속에 따라 같은 변환을 적용. 기본 후보 소속은 `config/LIEU_Simulator_Config.json`에 있으나 **사용자 확인 전 가설**.
- `Rail` node143은 항상 stationary. 레일을 따라 기둥/로봇 어셈블리가 이동. 레일 실제 유효 이동거리는 레일 전체 612.4mm와 다름.
- `Yaw` 회전 대상을 ring gear와 pinion 실물 링크로 캘리브레이션할 것. 기어 이빨 수/방향/수동 고정 측이 미확정인 상태에서는, 큰 링과 작은 피니언의 정량 연동은 **MOCK**로 표시하거나 하지 않을 것.
- Servo `positionLimit`, `maxVelocity`, `maxAcceleration`, `maxJerk`, `home`, `invert`, `servoRawTicks`, `gearRatio`, `backlash`는 물리 설정과 분리된 별도 캘리브레이션 스키마.
- 프리뷰 모션은 `P(t) = T(railX(t)) × P_yaw × R_yaw(t) × P_yaw⁻¹ × P_tilt × R_tilt(t) × P_tilt⁻¹ × M_rest`의 기하 계층 합성. 각 스테이지에 실제로 포함되는 변환만 적용할 것. **매 프레임 원본 rest matrix로부터 새로 계산**, 누적 transform 금지.
- 위치 한계뿐 아니라 키프레임 경로에서 속도/가속도 초과를 감지하고 경고. 속도를 넘긴 구간은 UI에 빨간 표시, 실제 장치에는 전송 금지. 특히 Ease overshoot 클램프/제한.

## 6. Projector / beam – 실제와 가상 한계 명확화

- GLB는 `Miniray_Beam` 본체 메시와 `빔 홀더`만 보유. 정확한 렌즈 중심, throw ratio, brightness, aim, projector source는 미확인.
- **프리뷰 1차**: optical origin/aim을 inspector에서 편집 → floor raycast → 바닥 텍스처 가시화. `visible`, `opacity`, `image/video asset`, `rotation`, `projectedScale`, `floorOffset`, `projectorPose`, `focusBlur` 모두 keyframable.
- **고급 2차**: 프로젝트/바닥/장애물 교차를 활용하는 projective texture mapping, 실제 throw ratio로 frustum size 계산, 투사 거리 기반 keystone 및 광량 감쇠. `ProjectorPosition`이 Tilt stage에 속하면 광선/발광 정보도 함께 갱신.
- 광선을 emissive fog 콘으로 보여 주는 것은 **연출 또는 Debug view**로 따로 표시. 실제 바닥 투사 품질을 결정하는 `projective texturing`과 구분해야 함.

## 7. 재생, 시크, 루프, 오디오 정합

```ts
// deterministic: 이 함수 자체는 장치 출력이나 setTimeout을 호출하지 않는다
function evaluateAt(sequence: LieuSequence, tSec: number): DesiredState;

// 재생 루프: 하나의 transportTime 기반으로 모든 장면 상태 재계산
function transportFrame(nowMs: number) {
  const tSec = resolveTimeFromPlaybackAnchor(nowMs);
  applyToThreeScene(evaluateAt(activeSequence, tSec));
  scheduler.syncAudioAt(tSec); // 상태/클립 기반; 별도 scheduler
  dispatchCueEventsCrossed(previousTimeSec, tSec, playingDirection, loopBoundary);
}
```

- `Play`, `Pause`, `Stop`, `Seek`, `Loop`, `Speed 0.5x/1x/2x`, 단일 프레임 이동, 컷/복제/리네임 지원.
- **Seek는 사이드이펙트를 발생시키지 않음**: projector/text/eye/ring 모두 해당 시점 시각 상태로 점프; 이벤트는 발화하지 않고 타임라인 표시만. Play 상태에서 `(prevT, currentT]`를 지난 이벤트만 처리.
- 오디오는 WebAudio의 고정밀 시계에 transport를 맞추고 play/pause/seek/loop 때 기존 노드를 멈춘 뒤 필요한 클립만 정확한 media offset으로 스케줄. 최초 Play 버튼에서 AudioContext resume.
- 비디오 프레임 탐색/재생은 `VideoTexture` currentTime/offset을 시계에 맞추되 브라우저 디코딩/seek 정확도 제한을 UI에 명시. 스틸 이미지/벡터는 정밀 프레임 복원 가능.
- 브라우저 백그라운드에서 FPS가 떨어져도 RAF 횟수로 시간을 누적하지 않음.

## 8. 저장/불러오기 및 계층화

```text
Project.lieu.json:
 metadata / rigCalibrationId / mediaAssetIds / scenarios[]
Scenario:
 settings {durationSec, fps, loop}
 tracks {motion, ring24, eyes, projector, audio, events}
Asset registry:
 uploads {assetId → contentHash, mime, filename, blob}
```

- Export에는 JSON과 media를 ZIP으로 함께 넣을 수 있어야 하며 브라우저 재시작 뒤에도 사용자가 저장한 자료를 복원할 수 있도록 `IndexedDB` 사용 가능. 파일 불러오기로 다른 PC 재현 가능해야 함.
- scenario 버전 스키마와 마이그레이션 필수. 로봇 리그/하드웨어 캘리브레이션은 시퀀스 데이터와 분리.
- **첫 데모 시나리오**는 `examples/01_boarding.lieu.json` 참조: 3채널 motion, 24 RGWB, 2 eyes, welcome projection, audio marker, event cue를 같은 타임라인에 실어 동작을 보여 주는 장면입니다.

## 9. 하드웨어 준비가 안 되었을 때 UI 행동

- 항상 `Preview only / Limits not calibrated`를 표시; 가상값은 편집 가능.
- `connectHardware()`를 **no-op / throw**로 두고 물리 전송을 비활성화. 실물 모터가 저절로 동작하는 코드는 만들지 말 것.
- 물리 제어 별도 승인/캘리브레이션 완료 후 Adapter를 구현. USB/WebSerial/ESP32/WebSocket 등 전송방식은 지금 미확정.

## 10. 확장 키프레임 프로퍼티(타입 계약의 선택적 필드)

기본 예제는 빠른 재생 테스트를 위한 최소 트랙을 제공한다. 사용자 요구인 **'모든 조작을 키프레임으로'**를 구현할 때 다음 선택적 필드도 인스펙터에서 `◆` 클릭으로 저작되도록 지원한다.

- **Ring LED 픽셀별 세부 커브:** `tracks.ring24.pixelChannelOverrides["0".."23"].r/g/b/w`는 각각 `NumericTrack`이다. 계산 순서: `baseFrames`의 24픽셀 색 보간 → 해당 픽셀/채널의 유효 오버라이드 값으로 덮어씀 → 시간 기반 `effects` 오름차순 합성 → clamp → global brightness. 이 순서는 *임의의 키프레임 시간에 동일 결과*를 보장한다.
- **Ring Effect 클립 세부 파라미터:** `effects[].parameterTracks`는 `speedHz, phase, width, whiteLevel` 같은 수치 파라미터의 커브를 저장한다. 각 시각 t의 파라미터를 구한 다음 순수 함수 effect를 평가한다. 효과 이름/Blend/우선순위/활성 구간은 Clip 홀드/편집 속성으로 관리한다.
- **좌우 눈 밝기 독립:** `eyes.leftIntensity` 또는 `eyes.rightIntensity`가 존재하면 공통 `eyes.intensity` 대신 각 눈의 밝기로 평가하고, 없으면 공통값을 사용한다. 물리 보드는 단색이며 I²C 주소와 orientation 확정 전에는 송신하지 않는다.
- **프로젝터 추가 키:** `opticalOriginXm/Ym/Zm`, `opticalAimYawDeg`, `opticalAimPitchDeg`, `floorHeightYm`, `projectedWidthM`, `focusBlur`, `keystoneTop/Bottom`을 프리뷰 트랙으로 사용할 수 있다. 광학 사양값은 **물리 캘리브레이션과 별도**이며 스테이지 고정/회전 여부에 따라 트랜스폼 합성한다.
- **오디오 볼륨/좌우 팬:** Clip의 `gainTrack`, `panTrack`으로 애니메이션한다. Audio gain 1.0은 dB가 아니라 선형 계수라는 UI 라벨을 붙인다.

`TS spec`은 **데이터 계약이지 실제 앱 구현이 아니다.** Codex는 이를 검증하는 Zod schema 또는 동등한 런타임 검사와 버전 마이그레이션을 추가해야 한다.

## 11. 컨셉의 외곽 White LED Ring과 CAD 중앙 NeoPixel의 구분

기존 LIEU 브랜딩의 **도넛 외곽 White LED Ring**은 이 GLB에서 별도 24 RGBW 하드웨어로 확인되지 않았다. 실제로 추출한 24개 LED는 **본체 하부 중앙의 약 66mm 크기 링**이다. 외곽 발광 연출을 추가하고 싶다면 화면상 `visualOnlyOuterHalo`를 별도 레이어로 만들고, 하드웨어 인덱스나 실물 장치로 표시하지 않는다. 실물 외곽 발광 소자/배선 정보가 확인된 후에만 별도 physical channel을 추가한다.
