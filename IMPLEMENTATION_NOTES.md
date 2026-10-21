# LIEU Sequence Editor — 구현 현황 (PREVIEW ONLY)

## 실행
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 엔진/스토어 테스트 (vitest)
npm run validate   # 핸드오프 아티팩트 검증 (python)
```

## GLB
`public/assets/LIEU_Senario.glb` 는 사용자가 따로 첨부한 `LIEU_Senario.glb`(zip 안 파일 아님)입니다. zip 버전과의 차이:
- `Rail`(node 143) Z 스케일 0.0343 → 0.0448 (레일 단면 68.5×68.5 → 68.5×89.6 mm). 매니페스트를 갱신함.
- 재질 `Steel - Satin` 이 알파 0.1 BLEND (48개 메시가 사용). 뷰포트 `Opaque` 버튼으로 불투명 대체 가능(기본값: 불투명, 버튼으로 GLB 원본 투명도 복원).
- 노드 144 / 메시 인스턴스 61 / 고유 메시 38 은 동일. 런타임은 GLB에서 월드 rest matrix를 직접 읽습니다.

## 구조
- `src/engine/*` 순수 로직: `evaluateSequenceAt`, effects(결정적 해시), rig 행렬, 편집(immutable), 검증/마이그레이션/ZIP.
- `src/store.ts` 단일 상태(+Undo/Redo 100단계, Auto-key, live override). `src/runtime/transport.ts` 단일 시계(performance.now 앵커), `audio.ts` WebAudio 스케줄러.
- `src/three/*` 렌더 계층: `restWorld × stage` 로 매 프레임 재계산(누적 없음), LED/눈/프로젝터 emitter.
- `src/ui/*` Scene Tree / Viewport / Inspector / Timeline.

## 구현된 것
Milestone 1–4 전부, 5 일부(요약: 24 RGBW 개별 편집·효과 8종, 독립 8×8 눈 2개, 바닥 raycast 프로젝션(이미지/SVG/비디오), WebAudio, 6종 트랙 키프레임, JSON/ZIP Import·Export, 3개 예제 프리셋).
미구현/제한: projective-texture projector shader, bloom, 키프레임 곡선 에디터, 눈 blink 마스크 클립, 오디오 pan 트랙(첫 키만), 비디오 프레임 정밀 seek(브라우저 한계).

## 반드시 알아둘 한계 (확정하지 않은 값)
- Rail/Yaw/Tilt 소속·피벗·축은 **가설**(좌측 트리·Rig 탭에서 수정). Preview 범위(Rail −0.25~0 m, Yaw ±45°, Tilt ±15°)는 **시연용 임의값**이며 하드웨어 안전 범위가 아님.
- LED0 물리 위치/방향/바이트 순서, 눈 I²C 주소·행열 맵, 프로젝터 throw/광학 중심, 모터 사양은 모두 `null/UNKNOWN`으로 export에 보존됨.
- 프로젝터 투사 폭(30 cm)·바닥 높이(−0.5 m)는 프리뷰 가정값.
- 하드웨어로 어떤 명령도 보내지 않음 (`Connect hardware` 비활성).

## 눈 구멍 표현
- 외벽의 눈 구멍(+구멍 안 CAD LED 돔)은 `src/three/eyeSurface.ts` 가 만든 매끈한 패치로 덮습니다. 외벽의 바깥쪽 삼각형을 -X 방향으로 래스터화한 뒤
  눈 영역마다 다항식(4차)을 맞추고 구멍 셀은 반복 제외해서, 구멍 없는 곡면 높이장을 얻고 외벽과 같은 재질로 그립니다(로딩 시 수십 ms).
- 켜진 도트만 이 표면 위에서 발광(기본 흰색)하고, 꺼진 도트는 아무것도 그리지 않아 외벽과 구분되지 않습니다. 눈 보드/LED 가이드 메시는 어둡게 처리.
- GLB를 교체해도 자동으로 다시 계산됩니다(별도 베이킹 없음).
