# LIEU Sequence Editor — Codex용 웹 시스템 설계

## A. 사용자 목표 / 제품 정의

단순한 3D 뷰어가 아니다. **실제 LIEU 기구에 대응하는 모든 표현 채널을 하나의 시간축에서 편집·미리보기·저장·재생하는 시퀀스 에디터**를 구현한다.

### MVP 필수 동작
1. 원본 `LIEU_Senario.glb` 로드, 노드 구조 표시, 카메라 orbit/pan/zoom, 모델 위치·크기 보존.
2. 레일 위치(m), Yaw(°), Tilt(°) 숫자/슬라이더로 실시간 조작. 일단 preview-only 3DOF; 리그는 반드시 사용자 수정 가능.
3. **RGBW 24픽셀** 각각을 선택해 R/G/B/W(0–255)·밝기·프리셋(숨쉬기, 체이스, 웨이브, 단색, 스파클 등) 편집. pixel0/방향 표시.
4. 양쪽 **8×8 눈을 독립적으로 픽셀 도트 드로잉**하고 깜빡임·시선·표정 프리셋 선택.
5. 바닥 프로젝터의 **PNG/SVG/비디오 소스**, 표시/숨김, 크기·회전·좌표·밝기·불투명도 및 렌즈/바닥 거리를 조정; 프로젝터 콘 프러스텀 디버그 가능.
6. 스피커 오디오 트랙(파일, 시작시간, 게인, Fade in/out), 필요시 트리거/가상 카메라 이벤트 트랙.
7. 모든 속성·이벤트를 하단 타임라인에서 키프레임 추가/이동/삭제/복사, 여러 시나리오로 저장. `Auto-key` 옵션.
8. **Play / Pause / Stop / Seek / Loop**. 플레이헤드를 임의 시점에 놓으면 화면이 해당 시점으로 **즉시·항상 동일하게** 복원됨.
9. `.lieu.json` JSON 프로젝트 Import/Export, 재사용 가능한 media assets 분리, 기본 Welcome 샘플.
10. 하드웨어 연결 전까지 **preview-only**. 모터 실 제어·서보 값 출력은 실측 교정 이후에만 활성화.

## B. 기술 스택 제안

| 층 | 추천 | 이유 |
|---|---|---|
| 프론트엔드 | React + TypeScript + Vite | 빠른 브라우저 기반 편집기 / 타입 안전성 |
| 3D 엔진 | Three.js + @react-three/fiber + @react-three/drei | GLTF 로드, 실시간 좌표·광원·자재 업데이트 |
| 상태 | Zustand + Immer(선택) | EditorState와 RenderState 분리, undo/redo 구현 |
| 타임라인 | 커스텀 React 타임라인 (Canvas/SVG 또는 DOM virtualization) | 숫자 키프레임, LED 배열, 8×8 도트/미디어 클립 등 이질적인 트랙 제어 |
| 시간 평가 | 자체 pure 함수 `evaluateSequenceAt(t)` | seek, loop, deterministic repeat, offline export의 핵심 |
| 렌더 효과 | EffectComposer + Bloom(선택적) | 픽셀 발광과 확산 표현, 하드웨어 실제 밝기와 별도 |
| 프로젝션 | 바닥 texture plane → camera-based projector shader(2차) | MVP 우선 완성, 이후 투사 광학 개선 |
| 오디오 | Web Audio API | 독립 오디오 큐잉과 게인/Fade 제어 |
| 미디어 | URL/Object URL 및 프로젝트 내 assetId | 타임라인에 파일 전체가 중복 저장되지 않도록 |
| 데이터 | JSON schema(Zod 등), local IndexedDB for blobs | 복원·검증·공유. 외부 서버 없이도 동작 |
| 테스트 | Vitest + Playwright | 순수 시간 평가, frame seek, 편집 저장 검증 |

## C. 화면 IA / 기본 레이아웃

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ LIEU  | Scenario ▼  | Save  Import Export | PREVIEW ONLY  | FPS | Settings               │
├──────────────────┬─────────────────────────────────────────┬─────────────────────────────┤
│ SCENE TREE       │ 3D VIEWPORT                             │ INSPECTOR                   │
│  Rail            │ Orbit / Pan / Zoom                        │ [Motion] [LED] [Eyes]      │
│  Carriage        │ Camera: Front / Side / Bottom / Iso       │ [Projector] [Audio]        │
│   Yaw assembly   │ Floor / cabin overlay toggle             │                            │
│   Tilt assembly  │ Selected part highlight; pivot/axis gizmo│ Rail(m) slider + keyframe  │
│   Eye Left/Right │ Realistic / X-ray / exploded mode        │ Yaw/Tilt(deg) + keyframe   │
│   NeoPixel 24    │ Projection + eye + LED live preview       │ LED24 pixel color editor   │
│   Projector      │                                          │ Eye 8×8 bitmaps            │
│                  │                                          │ Projection source params   │
├──────────────────┴─────────────────────────────────────────┴─────────────────────────────┤
│ ◀◀  ▶/❚❚  ■  ↺ Loop | 00:02.400 / 00:10.000 | +Key | Auto-Key | Snap | Zoom timeline       │
├──────────────────────────── TIMELINE ────────────────────────────────────────────────────┤
│ Rail X          ●─────◆────────────◆─────────────────────────────────────────────────────│
│ Yaw             ●──────────◆────────────────◆───────────────────────────────────────────│
│ Tilt            ●────────────◆─────◆────────◆───────────────────────────────────────────│
│ LED 24 / effect ●──[WAVE SEGMENT]──────[BREATH]─────────────────────────────────────────│
│ Eyes L/R        ●──[NEUTRAL]─[BLINK]─[SMILE]─────────────────────────────────────────────│
│ Projector       ●───────────[WELCOME.svg]────────────────────────────────────────────────│
│ Speaker         ───────────────[hello.wav]───────────────────────────────────────────────│
│ Event           ──────────────────┆ passenger_seated ┆──────────────────────────────────│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- Inspector 변경 시 viewport 즉시 변경. **선택한 속성의 다이아몬드(◆)** 클릭하면 현재 playhead에 키프레임 저장.
- `Auto-Key OFF`: 현재 시간의 수동 프리뷰값만 바뀜(기존 키프레임은 불변). `Auto-Key ON`: 현재 시간에 키 생성·업데이트.
- Keyframe 클릭은 **트랙 타입별 편집기**(숫자 커브/24 RGBW pixel grid/두 8×8/미디어 clip) 오픈.
- 아래 트랙 키프레임과 inspector는 동일 source of truth를 사용. FPS 30 기본, 필요시 60. 키 시간은 초(float), 표시만 프레임으로 snap.
- 관객용 전시에서는 `Editor Mode`와 풀스크린 `Presentation Mode`를 분리할 수 있게 구조화.

## D. 장치 제어 추상화

```text
LIEU Project Data
  ├─ RigDefinition (physical limits unknown, preview ranges separate)
  ├─ Calibration (24 ring coords, 128 eye coords, projector intrinsics)
  ├─ Assets (PNG/SVG/WebM/MP4/WAV/MP3 by assetId)
  └─ Sequence[]
       ├─ Motion (railX, yawY, tiltZ + future axes)
       ├─ LedFrames / LedEffects (24 × [R,G,B,W])
       ├─ EyeFrames (L and R: each 64×0/1 or intensity)
       ├─ ProjectorClips
       ├─ AudioClips
       └─ TriggerEvents
          ↓
  evaluateSequenceAt(t) : DesiredState        [pure, deterministic]
          ↓
  safetyAndPreviewLimiter(state, context)     [preview vs real hardware]
          ↓
  ┌──────────────────────┬──────────────────────┬──────────────────────┐
  │ ThreeRenderer        │ WebAudioScheduler    │ HardwareAdapter      │
  │ image/light/motion   │ play/fade/seek       │ (OFF by default)     │
  └──────────────────────┴──────────────────────┴──────────────────────┘
```

**One clock**: 메인 시퀀스 `t`는 공통이다. 장치별로 `setTimeout`을 따로 돌리면 동기화가 어긋난다. 재생 엔진은 다음 프레임의 `t`를 1번 정하고 그 값을 전 시스템에 배포한다.

### 상태 구분

- `EditorState`: 시퀀스 데이터·선택 트랙·선택 키·undo stack·UI 상태(영구).
- `TransportState`: isPlaying, timeSec, durationSec, speed, loop, fps, audioContext 상태(일시).
- `DesiredState`: `evaluateSequenceAt(t)`의 반환값(모터위치, LED 채널/밝기, 눈 비트맵, projection 상태, active audio clips).
- `RenderedState`: 그려진 메시/광원 상태. EditorState와 일대일로 매 프레임 동기화.
- `HardwareFeedbackState`: 향후 실제 모터 현재 위치, 연결 상태, 오류, overcurrent 등(미리보기 상태와 절대 혼동하지 않음).

## E. 시간·보간·키프레임 명세

### 공통 시간 모델

- 내부 시간 단위 **초(sec)**, 정밀도 소수 이하 허용. UI 표시 `MM:SS.mmm`.
- 키프레임에는 `id, tSec, value, interpolation`이 있고, 곡선 트랙별 사전 정렬.
- 수치 채널(`railX/yawY/tiltZ/brightness/opacity`): 기본 smoothstep 또는 cubic (m/s 제한 반영); linear / hold 옵션.
- RGBW 색상: 채널별 선형 또는 hold, color-space 올바른 혼합 필요. 기기 출력은 **각 R,G,B,W 채널 독립 보존**.
- 8×8 패턴: **기본 hold** (도트 비트맵은 중간값 보간 금지), 필요한 fade는 별도 intensity 트랙.
- LED effect segment: `effectType, startSec, endSec, params, seed`를 기반으로 **현재 t에서 직접 계산**. Math.random()을 매 프레임 무작위로 호출하면 seek 재현성이 깨짐.
- 투사·음성 클립: on/off 및 소스 변경은 불연속 이벤트. fade/opacity/transform은 수치 커브.
- Event: 같은 이벤트를 seek할 때 다시 발생시키지 않음. play mode에서는 시간구간 `(prevTime,t]`을 통과할 때 한 번 dispatch; loop/start 시 규칙 정의.

### 엔진 개념 코드

```ts
function evaluateSequenceAt(sequence: Sequence, tSec: number): DesiredState {
  return {
    motion: {
      railX: evaluateNumeric(sequence.motion.railX, tSec),
      yawY: evaluateNumeric(sequence.motion.yawY, tSec),
      tiltZ: evaluateNumeric(sequence.motion.tiltZ, tSec),
    },
    ring: evaluateRingPixelsAndEffects(sequence.ring24, tSec),
    eyes: evaluateEyeFrames(sequence.eyeLeft, sequence.eyeRight, tSec),
    projection: evaluateProjectionClips(sequence.projector, tSec),
    audio: evaluateAudioClips(sequence.audio, tSec),
  };
}
```

- `seek(t)`는 `evaluateSequenceAt(t)`만 호출해 뷰를 **항상 동일하게** 복원하며, 과거 재생 상태에 의존하지 않아야 함.
- `play()`는 `performance.now()`로 경과시간을 계산하고 매 RAF에서 `seek(non-mutating time)`처럼 상태 평가. Web Audio는 정밀한 `AudioContext.currentTime`을 재생 기준 시각에 맞춰 스케줄링.
- 브라우저 숨김/프레임 드롭 이후에도 `deltaTime`을 무한 누적해 움직이지 말고 **시계 기준 절대 시간** 사용.
- 실제 하드웨어 모드는 매 프레임 target 명령을 날리는 방식이 아니라 주기적 setpoint 송신과 장치 자체 보간, ACK/feedback, 통신 끊김 중립 상태를 추가해야 한다.

### Motion 안전 제약

- `config/LIEU_Simulator_Config.json`의 `previewOnlyRange`는 **실물 검증 이전에 인터페이스 시연을 위해 임시로 잡은 범위**다. 실제 장치에 절대 직접 전송하지 않는다.
- 실제 최소/최대각·stroke·vel/accel/jerk는 각 채널 별 **physical** 객체에 입력하며 미입력(`null`)일 때 `HardwareAdapter`는 arm 금지.
- 저장/재생 전 모션 궤적 샘플링으로 `min/max position`, `|velocity|`, `|acceleration|`, 필요 시 `|jerk|` 초과를 표시.
- 단순 위치 클램프만으로 속도 초과가 해결되지 않는다. Keyframe 간 시간/거리에서 안전하게 재타이밍하거나 큐브 스플라인 속도를 제한해야 한다.
- 레일 가용 스트로크는 **메시 레일 길이 612.4mm와 다르다**. Z/Yaw/tilt 움직임에 따라 간섭 공간을 통과하면 피해야 한다.
- 실물 구동 시 홈/원점/기구 충돌·케이블 꼬임·전원 한계를 별도 safety state machine으로 다룬다.

## F. GLB 렌더러/모션 리그 구현

### 주의점

- GLB에는 Joint/Bone이 없으며 실제 움직임 소속도 정해져 있지 않다.
- `previewKinematics.yawCandidateMeshNodeIndices`, `tiltCandidateMeshNodeIndices`는 **메시 형상으로 추정한 임시 소속**이다. 실제로 틸트할 때 중앙 프로젝터와 NeoPixel이 함께 움직이는지 **확인 전까지 미확정**.
- 본체·베어링·모터 케이스·모터 혼·프로젝터 각각 정확히 어떤 관절을 따라가는지 사용자 확인 후 소속 재분류.

### 안정적인 렌더 방법(권장)

1. GLB로부터 61개 mesh object를 얻고 `updateMatrixWorld(true)` 후 각 mesh의 **rest `matrixWorld`** 저장.
2. glTF 노드 인덱스는 `parser.associations`로 가능한 한 얻고 `Manifest.meshInstances[].nodeIndex`에 매칭/검증.
3. 원본을 그대로 표시하는 대신 flat `SimMesh` 프록시 61개 생성. 각 프록시의 `geometry` 참조/clone을 재사용하고 **각 rest 월드행렬**을 적용 (`matrixAutoUpdate=false`). Rail node143은 항상 고정.
4. rest 행렬 `Mrest`에서 매시간 목표행렬을 재계산 (**이전 프레임 행렬에 누적회전 금지**):

```text
Mrail(t) = Translate(railX(t), 0, 0)
Myaw(t)  = Translate(Pyaw) · RotateY(yaw(t)) · Translate(-Pyaw)
Mtilt(t) = Translate(Ptilt) · RotateZ(tilt(t)) · Translate(-Ptilt)
M(t)     = Mrail(t) · [Myaw(t) if yaw-follows] · [Mtilt(t) if tilt-follows] · Mrest
```

5. 아래 축 이름/원점은 **임시 후보**이고 사용자가 편집/저장 가능해야 한다. 모든 LED emissive overlay, 눈 픽셀, 프로젝션 카메라 역시 **자신의 장착 노드와 같은 변환 chain**을 따라야 한다.
6. 비균일/음수 스케일을 가진 모델을 무리하게 `Group.attach()`로 중간에 재부모화하지 말 것; raw matrix 곱셈을 우선.

### 구동체 계층 장착·간섭 확인

- 레일: `Rail` static, `기둥` + 나머지 모든 몸체가 X 이동.
- Yaw: bearing 3개 중 어느 부품이 고정측인지 미확인. preview yaw는 외장을 중심으로 움직이는 **컨셉 애니메이션**으로 한정.
- Tilt: `틸트 회전축`은 Z측 ±위치로 배치. 기구상 회전축이 Z축인 후보. outer shell/eyes만 우선 tilting preview, 중앙 프로젝터는 기본 비동기(설정 필요).
- XL/XC-330 케이스·horn은 별도 링크로 나눌 수 있도록 nodeIndex 유지(35/38/41 케이스, 44 horn 후보). **각도→서보 encoder tick 환산**은 모델/모드 확인 뒤 작성.

## G. RGBW 24 LED 구현

### 데이터 모델

```ts
type RGBW = { r:number; g:number; b:number; w:number }; // each 0..255
ringState: {
  pixels: RGBW[24];
  masterBrightness: number; // 0..1
  mode: 'manual'|'solid'|'breathe'|'chase'|'wave'|'sparkle';
  effectParams: {...};
};
```

**W는 RGB의 흰색 합성이 아니라 별도 채널**이다. 그래야 실제 RGBW NeoPixel과 일치할 수 있다. 실물 칩이 RGBW인지, GRBW byte order인지, W 색온도가 몇 K인지, 감마값이 어떤지 확인 필요.

### 화면 구현 단계

- 1차: 24개의 정확한 발광 위치를 `LIEU_LED_Calibration.json`에서 읽고 `InstancedMesh`/소형 area glow를 배치. 24색을 독립 업데이트. 유저가 0–23번을 선택 가능하도록 LED inspector의 원형 24점 UI 제공.
- 2차: 실제 `LED 쉐이드`(17) 위에 fragment shader로 원형 pixel intensity field를 구성: 각도 θ에 가까운 LED 이웃 2~3개의 값을 섞고 diffuser blur σ, transmittance, 광량 falloff 적용. 원본 중앙 링 메시의 불투명 재질 때문에 overlay가 가려지면 emissive diffuser shader로 해결.
- 조명은 픽셀별 `emissive`와 제한적 Bloom으로 표현하고, 성능 때문에 24개의 PointLight 전체를 사용하는 것은 피함.
- 애니메이션 preset은 `effect(timeSec, 24, params, seed) -> RGBW[24]` 순수 함수. `phase`, `speed`, `direction`, `width`, `dutyCycle`, `gradient`, `whiteIntensity` 등 편집.
- 사용자 직접 그린 프레임은 `manualFrame[24]`로 저장하고, 그 위에 선택 효과를 합성하는 레이어 합성 규칙을 명시. `replace`, `add`, `max`를 별도 정의.
- 물리 mode 출력은 `physicalColorByteOrder`, `physicalIndex0`, `physicalOrder` calibration이 없는 한 차단.

## H. 두 개 8×8 눈

- `left`와 `right` 각각 `8 x 8` boolean/intensity data(권장: `8개 row byte` 0..255, 비트 7이 col0)로 저장.
- 눈 editor는 8×8 그리드 두 개를 나란히 표시. Pencil, Erase, Mirror, Copy L→R, Flip Horizontal, Blink, Neutral, Smile 프리셋.
- 원본 CAD 픽셀 위치 128개에 emissive overlay를 얹고 기존 `눈 LED 가이드`의 가림/개구를 고려. 실제 면 위치보다 LED가 겉으로 튀지 않게 emission depth를 calibration에서 조정.
- `eyeIntensity`는 UI 0–1. 실물 HT16K33 brightness 0–15 구간으로 quantize(드라이버 검증 후 적용).
- 좌·우 orientation과 물리 비트/행렬 매핑은 실물의 한 점(예: 왼쪽 윗칸) ON 테스트로 확인 후 `mappingTable` 작성. GLB 화면좌우 좌표만으로 하드웨어 연결 순서는 알 수 없다.

## I. 프로젝터 / 바닥 안내

### 1단계 MVP

- `Miniray_Beam`(18)과 `빔 홀더`(139)를 optical mount 후보로 바인딩.
- 투사 바닥은 물리적인 floor plane. `opticalOrigin`, `opticalDirection`, `throwRatio`는 실측 전 **임시 값**으로 `Preview only` 표기.
- 렌즈 방향으로 광선 raycast → 바닥 교점 기준 위치 계산. PNG/SVG를 바닥 plane에 표시. `visible, assetId, opacity, intensity, rotation, size, offsetX, offsetZ` 키프레임 가능.
- LED/프로젝터 밝기 모두 수치상 0–1로 조작하되 프로젝터 실물 ANSI/ISO lumen과 1:1 대응하지 않음.

### 2단계 고도화

- 실제 투사비(throw ratio)·종횡비에 기반한 projector frustum 생성; 투사 폭 `width = opticalDistance / throwRatio`, 높이 `width / aspectRatio` (상대식; 입력 투사비 정의 확인).
- 특정 바닥/장애물 메시의 world position을 projector matrix에 투영하는 shader `projective texturing`으로 실물에 가깝게 적용.
- keystone (4-corner homography), focus blur(거리 기반), projected color/alpha mask, falloff, occlusion, 투사면 회전 지원.
- 프로젝터가 Tilt 리그를 따라가는지 여부는 실제 장착 정보 확인 후 결정. **Tilt에 따라 바닥 투사 경로가 변해야 한다면 광선과 projector frustum도 함께 움직여야 함.**
- 동영상은 `assetId`와 `clipStartSec`, 재생 오프셋으로 관리; seek/loop 때 texture time을 맞추고 video seek 완료 이전 프레임 표시 방지.

## J. 오디오·카메라·이벤트

- Audio: wav/mp3 파일 첨부, `atSec`, `offsetSec`, `durationSec`, `gain`, `fadeInSec`, `fadeOutSec`, `loop` 트랙. Play 중 Web Audio scheduler로 dispatch, Pause/Seek 때 위치 동기화. 브라우저 오디오 auto-play 정책 때문에 **사용자 Play 버튼 클릭 이후** 오디오 컨텍스트 resume.
- Virtual events: `passenger_arrives`, `seatbelt_unfastened`, `obstacle_detected`, `reroute_started` 등의 semantic cue를 디버깅용 타임라인에 꽂아 장면/시퀀스 전환 가능.
- Live webcam은 보안 권한·실물 센서 범위·프로토콜이 없으므로 후속 단계. 파일에 웹캠/스피커 정밀 모델이 없으므로 **없는 하드웨어를 있다고 렌더하지 말 것**.
- Real-time sensor mode와 authored timeline mode를 분리. 이벤트를 받아 timeline을 시작할 수 있지만 `PlaybackEngine`의 내부 시계는 단일 유지.

## K. 파일 저장·프리뷰 / 실제 장치 연동 안전 설계

```text
project.lieu.json
  schemaVersion
  assetRefs
  rigPresetId
  settings { fps, durationSec, loop }
  sequences[] { id, name, motion, ring24, eyeLeft, eyeRight, projector, audio, events }
```

- 이미지/영상/오디오 Blob을 JSON에 base64로 직렬화하지 말 것. IndexedDB asset registry 또는 Export ZIP에 media 폴더로 보관.
- `rig calibrated = false`면 UI에 **Preview only** 상태 표시. 물리 제어 `Connect`, `Arm`, `Send` 버튼 숨김/비활성.
- 실제 모터 연동: `HardwareAdapter` 인터페이스만 먼저 정의하고, 구동 구현은 **명시적으로 별도 PR**. 장치 모드에는 E-stop, 통신 끊김 처리, device feedback, velocity shaping, arming, limits, source-of-truth hardware state, safety timeout 필요.
- Export 타임라인은 하드웨어 vendor independent 표현을 쓰며, Adapter가 각 모터 tick/LED byte/I2C bitmap으로 변환.

## L. 구현 순서 / 완료 조건

**Milestone 1 — Geometry**: GLB 61개 메시 world transform 보존, Rail static, 노드 트리/선택/피벗 가시화. LED 좌표 24+128 정위치 검증.

**Milestone 2 — Live controls**: 레일/Yaw/Tilt 임시 프리뷰 범위, RGBW pixel24, 눈 2x 8x8, 바닥 texture projector, 오디오 파일 컨트롤.

**Milestone 3 — Timeline**: 키 생성/수정/삭제/drag, `evaluateAt` pure engine, Play/Pause/Seek/Loop, 3 대표 시나리오 preset.

**Milestone 4 — Workflow**: `.lieu.json` Import/Export, asset folder/registry, undo/redo, preset gallery, 시퀀스 프리뷰.

**Milestone 5 — Realistic**: ring diffuser shader, bloom refinement, projector frustum/keystone, 장치별 실제 calibration 업데이트.

**Milestone 6 — Hardware (별도 승인)**: 실제 모터/LED/eye 컨트롤러 연결, limit re-validation, arming/E-stop/feedback. Preview default 유지.

## M. 기계/시뮬레이터 자동 테스트 (필수)

1. GLB loader가 **144 nodes / 61 renderable meshes / 38 unique meshes**를 확인.
2. static Rail node143 matrix가 모든 t에 변하지 않음.
3. `seek(3.5)`를 아무 play history에서 100번 호출해도 output state 및 mesh pose 동일.
4. `seek(1)` → `seek(4)` → `seek(1)` 결과가 처음 `seek(1)`과 동일.
5. 24 LED 단색 분리: pixel 7만 W=255일 때 7번 diffuser sector만 발광(주변 blur 허용).
6. 눈 2개 각각 64 LED가 유일 위치에 나타나고 `left(0,0)`이 right에는 영향을 주지 않음.
7. RGBW w=255, RGB=0 설정이 RGB=255 환산으로 바뀌지 않음.
8. 프로젝터 OFF일 때 floor texture 없음, asset 교체/seek 일관.
9. 모션 invalid limits / velocity / acceleration의 위치·시점을 warning 표시하고 hardware dispatch 차단.
10. Import→Export round trip 후 키프레임/커브/LED 픽셀/미디어 ID가 의미적으로 동일.
11. Play/Pause/Seek에서 audio clip의 중복 재생과 조기 시작이 없음.
12. 브라우저 창 숨김→복귀 시 프레임이 누적 가속하지 않고 절대시간 기준 현재 상태로 돌아옴.
