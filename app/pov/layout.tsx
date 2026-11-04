// 서버 레이아웃에서 세그먼트 강제 dynamic: "use client" page.tsx의
// export const dynamic은 무시되므로 여기서 no-store를 확정한다.
export const dynamic = "force-dynamic";

export default function PovLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
