# public/vendor — 로컬 번들 출처 (EX-4)

오프라인 exe 안정성을 위해 CDN에서 받던 디코더/wasm을 저장소에 직접 둔다.
두 패키지 모두 Apache-2.0.

## draco/ — GLB draco 디코더

- 출처: `node_modules/three/examples/jsm/libs/draco/` (three@0.170.0 동봉)
- 업스트림: google/draco
- 버전: three@0.170.0 동봉본 (기존 gstatic 1.5.7 경로 대체)
- 라이선스: Apache-2.0
- 파일: `draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js`
  (`draco_encoder.js`, `gltf/` 구버전 세트는 미사용이라 복사 안 함)
- 쓰는 곳: `components/PovCreature.tsx` (`DRACOLoader.setDecoderPath("/vendor/draco/")`)

## mediapipe/ — tasks-vision ObjectDetector wasm

- 출처: `node_modules/@mediapipe/tasks-vision/wasm/`
- 버전: 1.2.0 (package.json `@mediapipe/tasks-vision`와 동일)
- 라이선스: Apache-2.0
- 파일: `vision_wasm[_module][_nosimd]_internal.js/.wasm` 6종 전부
  (`FilesetResolver.forVisionTasks`가 SIMD 지원·모듈 모드에 따라 고름)
- 쓰는 곳: `lib/motion/hazard.ts` (`forVisionTasks("/vendor/mediapipe")`)

## vad/ — 말소리 감지 Silero VAD + ONNX 런타임 (MC-1)

- 출처: `node_modules/@ricky0123/vad-web/dist/` (모델·worklet),
  `node_modules/onnxruntime-web/dist/` (wasm)
- 버전: `@ricky0123/vad-web@0.0.31` 정확 고정, `onnxruntime-web@1.17.3` 정확 고정
  (1.17.3은 싱글스레드 wasm을 동봉해서 COOP/COEP 없는 일반 페이지에서 동작.
  1.31은 스레드 단일 빌드라 제외)
- 라이선스: vad-web ISC, onnxruntime-web MIT,
  Silero 모델 가중치는 snakers4/silero-models (MIT) 계열을 vad-web이 동봉한 것
- 파일: `silero_vad_v5.onnx` (말소리 판정, v5),
  `vad.worklet.bundle.min.js` (오디오 worklet),
  `ort-wasm-simd.wasm` (싱글스레드) + `ort-wasm-simd-threaded.wasm` (멀티스레드).
  비-SIMD 구형 브라우저용 `ort-wasm*.wasm` 2종은 제외 (대상 브라우저 전부 SIMD 지원)
- 쓰는 곳: `components/MicButton.tsx`
  (`MicVAD.new({ model: "v5", baseAssetPath: "/vendor/vad/", onnxWASMBasePath: "/vendor/vad/" })`)
