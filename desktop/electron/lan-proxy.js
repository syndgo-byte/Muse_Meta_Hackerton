// electron/lan-proxy.js — PKG-3: exe의 LAN https 입구 (0.0.0.0:3443 → 127.0.0.1:PORT).
// 폰 WebView 카메라·마이크(보안 컨텍스트)용. 의존성 없음.
// 중요: 원 클라이언트 IP를 x-forwarded-for로 넘긴다. 안 그러면 미들웨어가
// 전부 루프백으로 보여 페어링이 우회된다.
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

function startLanProxy({ certDir, targetPort, lanPort }) {
  const key = fs.readFileSync(path.join(certDir, "key.pem"));
  const cert = fs.readFileSync(path.join(certDir, "cert.pem"));
  const server = https.createServer({ key, cert });
  server.on("request", (cReq, cRes) => {
    const clientIp = (cReq.socket.remoteAddress || "").replace(/^::ffff:/, "");
    const headers = { ...cReq.headers };
    delete headers.connection;
    const prior = headers["x-forwarded-for"];
    headers["x-forwarded-for"] = prior ? `${prior}, ${clientIp}` : clientIp;
    headers["x-forwarded-proto"] = "https";
    const pReq = http.request(
      { host: "127.0.0.1", port: targetPort, path: cReq.url, method: cReq.method, headers },
      (pRes) => {
        cRes.writeHead(pRes.statusCode, pRes.headers);
        pRes.pipe(cRes);
      }
    );
    pReq.on("error", () => {
      try {
        cRes.writeHead(502);
        cRes.end("lan proxy error");
      } catch {
        /* ignore */
      }
    });
    cReq.pipe(pReq);
  });
  return new Promise((resolve) => server.listen(lanPort, "0.0.0.0", resolve));
}

module.exports = { startLanProxy };
