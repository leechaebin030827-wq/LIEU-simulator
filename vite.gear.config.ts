import { defineConfig } from 'vite';

/** 기어 미리보기 전용 : 모터 브리지(motorBridge)와 저장 플러그인 없이 gear-preview.html 만 띄운다.
 *  앱 본체와 의존성 캐시를 나누고, 스캔 범위를 이 페이지 하나로 좁혀 첫 실행이 빠르다. */
export default defineConfig({
  cacheDir: 'node_modules/.vite-gear',
  server: { port: 5174, fs: { allow: ['.'] } },
  optimizeDeps: {
    entries: ['gear-preview.html'],
    include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js', 'three/examples/jsm/controls/OrbitControls.js'],
  },
});
