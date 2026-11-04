import type { Metadata } from "next";
import "./globals.css";
import "../components/battle/fx.css"; // 9-E: 배틀 연출 키프레임 (미임포트로 무스타일이었음)

export const metadata: Metadata = {
  title: "OiShi-e! (AR 뮤즈)",
  description: "거울 퀘스트가 있는 현실 크리처 수집",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
