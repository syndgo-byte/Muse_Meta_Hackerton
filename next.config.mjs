/** @type {import('next').NextConfig} */
const nextConfig = {
  // F2: 설치본 내장 서버용 자립 실행물(.next/standalone + 최소 node_modules).
  output: "standalone",
  // SEC-1b: 이미지 최적화 API 비활성(next/image 0건 확인) — RCE/DoS 완화.
  images: { unoptimized: true },
  // 릴리스 빌드는 dev 서버의 .next와 충돌하므로 별도 폴더로 격리.
  // 원복: NEXT_DIST_DIR을 지우면 기본 .next로 돌아간다.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 뒤로가기 BFCache + 중간 캐시 방지: 항상 최신 화면을 서빙.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};
export default nextConfig;
