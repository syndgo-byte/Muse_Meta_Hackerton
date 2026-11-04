// 상단 바 공통 셸 (D1-2 항목 2). 높이 48px·버튼 36px·간격 8px·좌우 12px.
// 레이아웃 전용이며 로직·데이터를 갖지 않는다.
import type { ReactNode } from "react";

export default function TopBar({
  left,
  center,
  right,
  overlay,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  overlay?: boolean;
}) {
  return (
    <div
      className="topbar"
      style={
        overlay
          ? { position: "absolute", top: 0, left: 0, right: 0, zIndex: 30 }
          : undefined
      }
    >
      <div className="topbar-slot">{left}</div>
      <div className="topbar-slot topbar-center">{center}</div>
      <div className="topbar-slot topbar-right">{right}</div>
    </div>
  );
}
