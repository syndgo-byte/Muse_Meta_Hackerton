"use client";
import { useRef, useState } from "react";

export type Creature = {
 name: string;
 element: string;
 personality: string;
 attack: number;
 defense: number;
 flavor: string;
};

export default function CaptureBox({
 onCapture,
}: {
 onCapture: (c: Creature, photo: string | null) => void;
}) {
 const videoRef = useRef<HTMLVideoElement>(null);
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const [active, setActive] = useState(false);
 const [desc, setDesc] = useState("");
 const [photo, setPhoto] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const [msg, setMsg] = useState("스마트 글래스 비전 센서 대기 중");
 const [listening, setListening] = useState(false);

 async function startCamera() {
 try {
 const stream = await navigator.mediaDevices.getUserMedia({
 video: { facingMode: "environment" },
 });
 if (videoRef.current) {
 videoRef.current.srcObject = stream;
 await videoRef.current.play();
 setActive(true);
 setMsg("HUD 카메라 활성화됨. 사물을 조준하고 'Capture!'를 외치거나 스냅샷을 찍으세요.");
 }
 } catch {
 setMsg("카메라를 열 수 없습니다. 파일 업로드를 이용해 주세요.");
 }
 }

 function stopCamera() {
 const s = videoRef.current?.srcObject as MediaStream | null;
 s?.getTracks().forEach((t) => t.stop());
 if (videoRef.current) videoRef.current.srcObject = null;
 setActive(false);
 setMsg("카메라 종료됨");
 }

 function snap() {
 const v = videoRef.current;
 const c = canvasRef.current;
 if (!v || !c || !v.videoWidth) {
 setMsg("카메라가 켜져 있을 때 스냅샷할 수 있습니다.");
 return;
 }
 c.width = 640;
 c.height = Math.round((640 * v.videoHeight) / v.videoWidth);
 c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
 const url = c.toDataURL("image/jpeg", 0.8);
 setPhoto(url);
 setMsg(" 타겟 스냅샷 완료! '크리처 소환'을 누르면 몬스터가 탄생합니다.");
 }

 function onFile(f: File | undefined) {
 if (!f) return;
 const r = new FileReader();
 r.onload = () => {
 const url = String(r.result);
 const img = new Image();
 img.onload = () => {
 const c = document.createElement("canvas");
 const scale = Math.min(1, 768 / img.width);
 c.width = Math.round(img.width * scale);
 c.height = Math.round(img.height * scale);
 c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
 setPhoto(c.toDataURL("image/jpeg", 0.82));
 setMsg(" 사진 업로드 완료! '크리처 소환'을 누르세요.");
 };
 img.src = url;
 };
 r.readAsDataURL(f);
 }

 function voiceCommand() {
 const SR =
 (window as unknown as { webkitSpeechRecognition?: new () => any })
 .webkitSpeechRecognition ??
 (window as unknown as { SpeechRecognition?: new () => any })
 .SpeechRecognition;
 if (!SR) {
 setMsg('이 브라우저는 음성 인식을 지원하지 않습니다. 버튼을 이용해 주세요.');
 return;
 }
 const rec = new SR();
 rec.lang = "ko-KR";
 setListening(true);
 setMsg(" 마이크 활성화 중... 'Capture!' 또는 사물 이름을 말씀하세요.");
 rec.onresult = (e: any) => {
 const said: string = e.results[0][0].transcript ?? "";
 setListening(false);
 if (/capture|캡처|잡아|포획/i.test(said)) {
 setMsg(`음성 명령 인식: "${said}" 크리처 소환 시작!`);
 void create();
 } else {
 setDesc((d) => (d ? `${d} / ${said}` : said));
 setMsg(`음성 설명 인식: "${said}"`);
 }
 };
 rec.onerror = () => {
 setListening(false);
 setMsg("음성 인식에 실패했습니다.");
 };
 rec.onend = () => setListening(false);
 rec.start();
 }

 async function create() {
 if (!desc.trim() && !photo) {
 setMsg("사물 사진을 찍거나 설명을 입력해 주세요.");
 return;
 }
 setBusy(true);
 setMsg(" Meta Muse Spark 엔진이 사물을 분석하여 크리처를 생성 중입니다...");
 try {
 const res = await fetch("/api/creature", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ description: desc, imageDataUrl: photo }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "failed");
 if (data.fallback) throw new Error("AI 연결이 끊겼어요. 다시 시도해 주세요");
 onCapture(data.creature as Creature, photo);
 setMsg(` 신규 크리처 등록 완료: ${(data.creature as Creature).name}`);
 } catch (e) {
 setMsg(` 생성 실패: ${e instanceof Error ? e.message : "unknown"}`);
 } finally {
 setBusy(false);
 }
 }

 return (
 <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
 {/* HUD Camera Viewfinder */}
 <div style={{
 position: "relative",
 background: "rgba(0, 0, 0, 0.6)",
 border: "1px solid rgba(0, 242, 254, 0.3)",
 borderRadius: "14px",
 overflow: "hidden",
 minHeight: "220px",
 display: "flex",
 alignItems: "center",
 justifyContent: "center",
 boxShadow: "inset 0 0 20px rgba(0, 242, 254, 0.1)"
 }}>
 {/* HUD Targeting Overlays */}
 <div style={{
 position: "absolute",
 top: 10,
 left: 14,
 fontSize: "11px",
 fontFamily: "monospace",
 color: active ? "#ff4d4d": "#00f2fe",
 display: "flex",
 alignItems: "center",
 gap: "6px"
 }}>
 <span style={{
 display: "inline-block",
 width: "8px",
 height: "8px",
 borderRadius: "50%",
 background: active ? "#ff4d4d": "#00f2fe",
 boxShadow: `0 0 8px ${active ? "#ff4d4d": "#00f2fe"}`
 }} />
 {active ? "HUD STREAM [LIVE]": "VISION SENSOR [STANDBY]"}
 </div>

 <video
 ref={videoRef}
 playsInline
 muted
 style={{ width: "100%", maxHeight: "360px", objectFit: "cover", display: active ? "block": "none" }}
 />

 {!active && !photo && (
 <div style={{ textAlign: "center", color: "#64748b", padding: "20px" }}>
 <div style={{ fontSize: "32px", marginBottom: "8px" }}></div>
 <div style={{ fontSize: "14px" }}>카메라를 켜거나 사진을 업로드하여 현실 사물을 스캔하세요</div>
 </div>
 )}

 {photo && !active && (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={photo} alt="촬영한 사물" style={{ width: "100%", maxHeight: "360px", objectFit: "contain" }} />
 )}

 <canvas ref={canvasRef} style={{ display: "none" }} />
 </div>

 {/* Control Buttons */}
 <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
 {!active ? (
 <button onClick={startCamera} style={{ flex: 1, minWidth: "140px" }}>
 글래스 / 폰 카메라 켜기
 </button>
 ) : (
 <>
 <button onClick={snap} style={{ flex: 1, background: "linear-gradient(135deg, #10b981 0%, #059669 100%)" }}>
 사물 락온 & 스냅샷
 </button>
 <button onClick={stopCamera} style={{ background: "rgba(255, 255, 255, 0.1)" }}>
 카메라 끄기
 </button>
 </>
 )}

 <button onClick={voiceCommand} disabled={listening} style={{ flex: 1, minWidth: "140px", background: listening ? "#e11d48": undefined }}>
 {listening ? " 음성 듣는 중...": ' "Capture!" 음성 명령'}
 </button>

 <button onClick={create} disabled={busy} style={{ flex: "2 1 200px", background: "linear-gradient(135deg, #00f2fe 0%, #0081fb 100%)", color: "#000", fontWeight: "bold" }}>
 {busy ? " 크리처 생성 연산 중...": " 사물에서 크리처 소환하기"}
 </button>
 </div>

 {/* Fallback File Upload & Manual Text Description */}
 <div style={{
 display: "grid",
 gridTemplateColumns: "1fr 1fr",
 gap: "12px",
 background: "rgba(0, 0, 0, 0.2)",
 padding: "14px",
 borderRadius: "12px"
 }}>
 <div>
 <label htmlFor="photofile" style={{ margin: "0 0 6px" }}> 사진 파일로 업로드 (선택)</label>
 <input
 id="photofile"
 type="file"
 accept="image/*"
 capture="environment"
 onChange={(e) => onFile(e.target.files?.[0])}
 style={{ fontSize: "12px", padding: "8px" }}
 />
 </div>
 <div>
 <label htmlFor="obj" style={{ margin: "0 0 6px" }}> 사물 힌트/설명 보태기</label>
 <input
 id="obj"
 type="text"
 placeholder="예: 김이 모락모락 나는 에스프레소 머그잔"
 value={desc}
 onChange={(e) => setDesc(e.target.value)}
 style={{ fontSize: "13px" }}
 />
 </div>
 </div>

 {/* Status HUD Log */}
 <div style={{
 fontSize: "12px",
 fontFamily: "monospace",
 color: "#38bdf8",
 background: "rgba(0, 15, 30, 0.6)",
 border: "1px solid rgba(0, 242, 254, 0.15)",
 borderRadius: "8px",
 padding: "10px 14px"
 }}>
 SYSTEM LOG: {msg}
 </div>
 </div>
 );
}
