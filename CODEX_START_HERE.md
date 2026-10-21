# LIEU Sequence Editor — Codex 시작 지시문

> **이 문서 전체를 Codex에 전달하고, 이 폴더를 작업 프로젝트 루트로 사용하세요.**  
> 목표는 원본 LIEU의 형상을 살린 **웹 기반 통합 시퀀스 저작·시뮬레이션 도구**입니다. 단순 3D 뷰어나 실제 기계의 검증되지 않은 모터 제어기가 아닙니다.

## Codex에 그대로 전달할 프롬프트

```text
당신은 React/TypeScript/Three.js 시니어 엔지니어이자 물리 로봇 HRI 툴 제작자다.

이 작업 폴더를 검사하고 LIEU Sequence Editor 웹 애플리케이션을 구현하라.
먼저 README.md, docs/01~05, spec/sequence-types.ts,
config/LIEU_GLB_Node_Manifest.json, config/LIEU_LED_Calibration.json,
config/LIEU_Simulator_Config.json을 읽어라.

중요: 원본 GLB의 geometry/노드/위치와 물리 사진에서 확인된 구조를 최대한 보존한다.
원본 GLB에는 joint/animation이 없으므로 시뮬레이션 RigDefinition과
실물 확인이 필요한 Calibrations를 명확히 구분한다.
실제 모터, LED, I2C 장치에는 어떠한 명령도 전송하지 않는다(PREVIEW ONLY).

기능 요구사항:
1. Three.js(@react-three/fiber) GLB 로더: 144개 glTF 노드, 렌더 메시 인스턴스 61개,
   고유 메시 38개. 원본의 월드 rest matrix를 정확히 보존한다.
   Rail(node143)은 고정. 나머지 메시의 stage ownership을 시각적으로 수정 가능하게 한다.
   임시 3자유도: Rail X, Yaw Y, Tilt Z. 피벗·축·가동 소속이 교정 전 가설임을 명시.
2. 24개 NeoPixel RGBW: 개별 LED 선택 및 [R,G,B,W] 0..255 편집,
   일괄 선택/그라디언트/브리딩/체이스/웨이브/펄스/프로그레스/스파클.
   config의 실제 CAD 발광점(24)을 기초로 shader emissive 및 diffuser glow.
   W 채널은 RGB 흰색으로 변환하여 원본 데이터를 지우지 않는다.
   0번 픽셀/배선 회전방향과 바이트 순서는 아직 미확인이다.
3. 눈: 각각 독립된 단색 HT16K33 8x8 매트릭스(총 128 점).
   왼쪽/오른쪽 8x8 도트 그리드, 픽셀/프리셋/깜박임/밝기 편집,
   실제 128 좌표에 맞춘 emissive 렌더.
   논리 좌우와 실제 I2C 보드 주소·행열 맵은 분리해야 한다.
4. 프로젝터: 원본 Miniray_Beam(node18) 참조.
   PNG/SVG 이미지/비디오 source 클립, ON/OFF, 위치, 크기, 회전,
   opacity, brightness, floor height, optical origin/direction,
   투사 영역 및 frustum 디버그 뷰. 실제 throw ratio는 UNKNOWN.
   MVP는 바닥 raycast + plane texture, 2차는 projector shader.
5. 오디오: 타임라인에 사운드 클립, 볼륨/페이드, 사용자 Play 이후 재생,
   Pause/Seek/Loop와 오디오 시각 상태 동기화. 가상 센서 트리거 트랙.
6. 타임라인: Motion 3채널, Ring 24 RGBW, Eye L/R, Projector, Audio,
   Event 트랙. 모든 수치 제어 항목은 현재 playhead에서 다이아몬드 키프레임을
   추가/이동/삭제/보간(hold/linear/smoothstep)할 수 있어야 한다.
   LED 효과는 timeSec 기반의 결정적 계산, 눈 패턴은 hold 기본.
   Auto-key, Undo/Redo, clip 편집, Play/Pause/Stop/Seek/Loop를 제공한다.
7. 단일 클록 + 순수 평가기 evaluateSequenceAt(seq, timeSec).
   seek(t)는 이전 프레임 이력과 관계없이 항상 동일한 상태/메시 행렬/LED 픽셀을 낸다.
   상태 계산, Three 렌더, WebAudio 동기화, 하드웨어 어댑터 인터페이스를 분리한다.
8. LieuSequence TypeScript 계약에 따른 JSON Import/Export.
   media asset은 assetId로 참조; Import/Export ZIP을 지원하면 더 좋다.
   examples 3종 Hospitality / Reassurance / Social Care를 프리셋으로 불러온다.
9. UI는 Scene Tree(좌측) / 3D Viewport(중앙) / 속성 Inspector(우측) /
   전체 트랙 Timeline(하단) 4구역. 하나의 화면에서 직접 조작하고 키를 찍는다.
   Preview Only 상태, unknown physical limits 표시, debug gizmo/cutaway 옵션.

프로젝트 지침:
- README.md와 docs의 확인됨/추정/미확정 구분을 보존한다.
- 실제 제어 각도/속도/가속도/jerk, 기어비, I2C 주소, LED byte order를 임의 확정하지 않는다.
- 기본 예시의 Preview Limits는 실제 하드웨어 안전 범위가 절대 아니다.
- 사용자가 stage attachment/pivot/axis를 교정할 수 있게 한다.
- GLB의 24 NeoPixel은 한 개 mesh 안에 있으므로 메시 24개라는 가정은 틀리다.
- GLB의 LED 캡 위치에 raw sphere를 그대로 노출하는 것을 최종 렌더로 삼지 않는다.
- 레일의 GLB 전체 길이를 가용 스트로크로 사용하지 않는다.
- 외부 센서, 스피커, 웹캠의 정확한 형상을 GLB에 있다고 주장하지 않는다.
- 원본의 mesh를 무리하게 재부모화하지 말고 restWorldMatrix × stage matrices 방식으로
  애니메이션을 적용한다. 중복 할당 시 모델이 두 번 렌더되지 않게 주의한다.

개발은 Milestone 순서로 진행하고, 단계마다 실행 가능한 앱과 테스트를 남겨라:
(1) GLB 로드+rest matrices+리그 피벗 시각화
(2) Motion + LED24 RGBW + 두 개 8x8 눈 + 프로젝션 라이브 조작
(3) 편집 가능한 멀티트랙 Timeline+deterministic evaluateAt
(4) 3 시나리오 import/play, 파일 저장/불러오기, Undo/Redo
(5) 라이팅 현실감, projector shader, 재생 품질 개선
물리 장치 제어는 요청하지 않았으므로 구현하지 않는다.

우선 현재 아티팩트가 통과하는지 `python tools/validate_handoff.py`를 실행하라.
다음으로 앱 아키텍처와 구성요소 트리를 출력한 뒤 1단계부터 실제로 구현하라.
모든 기능은 테스트로 검증하고 알려진 한계와 필요한 하드웨어 교정값을 기록하라.
```

## 구현 때 우선 읽을 파일 순서

1. `README.md` → 폴더 구조와 확인 수준
2. `docs/01_GLB_ANALYSIS.md` → 부품별 GLB 노드 ID / 어떤 메시가 있는가
3. `docs/04_PHOTOS_WIRING_AND_GEARTRAIN.md` → 눈 배선, 링 기어, 모터 추정
4. `docs/03_INPUTS_AND_LIMITS.md` → **실물 안전 한계 미확정** + 질문 10개
5. `docs/02_EDITOR_ARCHITECTURE.md` → 편집기 IA·렌더·속성·사용 흐름
6. `docs/05_SEQUENCE_ENGINE_AND_DATA.md` → 타임라인·평가기·RGBW·Seek 규칙
7. `spec/sequence-types.ts` + `config/` + `examples/` → 구현에 사용되는 데이터 계약

## 완성 여부를 판단하는 데모 (필수)

- GLB 원본이 올바른 스케일/자세로 보인다. 레일은 고정이며 본체는 이동한다.
- 타임라인 3초 지점에서 LED #7만 W=255로, 왼쪽 눈은 웃는 표정으로,
  Tilt는 +5°로, projector는 `welcome.svg`로 키프레임을 저장할 수 있다.
- Play 시 모든 효과가 동시에 나타나고 3초로 다시 Seek하면 동일한 결과다.
- 오른쪽 눈만 켜기/끄기 가능하며, 실제 물리 주소를 아직 몰라도 시뮬레이션된다.
- 24번째 LED까지 개별 선택 가능하고 R/G/B/W 모두 유지된다.
- JSON을 내보냈다가 다시 불러와도 키프레임·클립·배선 미확정 상태가 보존된다.
- 실제 하드웨어 송신 버튼은 없거나 비활성이고 물리 안전한 동작이라 주장하지 않는다.
