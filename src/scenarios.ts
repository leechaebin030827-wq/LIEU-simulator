/** The scenario catalogue: what the Scenarios menu lists, grouped by purpose. `id` is the file name under examples/, `file` the English name used in exported videos. */
export type ScenarioGroup = 'exhibit' | 'bonus' | 'lab';
export type ScenarioInfo = { id: string; label: string; desc: string; group: ScenarioGroup; file: string };

export const GROUPS: { key: ScenarioGroup; title: string; en: string; note: string }[] = [
  { key: 'exhibit', title: '전시 시나리오', en: 'EXHIBITION', note: '전시 관람객이 실제로 보는 순서: 탑승 → 주행 → 도착' },
  { key: 'bonus', title: '번외', en: 'BONUS', note: '전시 흐름 밖의 쇼케이스' },
  { key: 'lab', title: '모션 실험', en: 'LAB', note: '모션 · 웹 · 자유 실험용' },
];

export const SCENARIOS: ScenarioInfo[] = [
  { id: '01_boarding', label: 'Boarding', desc: '차량 도착 · 환영 · 인사 · 착석 확인 · 출발(빙그르르)', group: 'exhibit', file: 'Boarding' },
  { id: '02_driving_a', label: 'Driving A', desc: '공사 감지 · 앞을 살피고 · 돌아와 우회 안내', group: 'exhibit', file: 'DrivingA' },
  { id: '04_driving_b', label: 'Driving B', desc: 'Hey LIEU 호출 · 링 쇼 · 애교 총출동', group: 'exhibit', file: 'DrivingB' },
  { id: '03_arrival', label: 'Arrival', desc: '곧 도착 · 둘러보기 · 작별 인사 · 문 쪽 안내', group: 'exhibit', file: 'Arrival' },
  { id: '07_bonus_aegyo', label: '애교 대폭발', desc: '모든 축 · 눈 · 링 · 프로젝터 총동원 · 윙크 폭탄 · 빙그르르 x2', group: 'bonus', file: 'BonusAegyo' },
  { id: '05_web_cover', label: '웹 모션 · 표지', desc: '웹 표지용: 호기심 · 상하좌우 시선 · 눈 감기 · 신남', group: 'lab', file: 'WebCover' },
  { id: '06_custom', label: 'Custom · 자유 실험', desc: '빈 시퀀스에서 마음대로 실험 (저장하면 이 칸에 유지)', group: 'lab', file: 'Custom' },
];

export const PRESET_IDS = SCENARIOS.map((s) => s.id);
export const scenarioOf = (id: string) => SCENARIOS.find((s) => s.id === id);
