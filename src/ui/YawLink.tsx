import type { Axis } from '../runtime/motor';

export function AxisLink({ axis }: { axis: Axis }) {
  return (
    <div className="row" style={{ margin: '2px 0 8px', gap: 8 }}>
      <button className="ico" disabled title="하드웨어 제어부가 초기화되어 실제 출력이 비활성화되었습니다">
        {axis} motor · disconnected
      </button>
      <span className="dim small">control reset · preview only</span>
    </div>
  );
}

export const YawLink = () => <AxisLink axis="yaw" />;
