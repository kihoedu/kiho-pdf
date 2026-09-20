import { createRoot } from 'react-dom/client';
import App from './App';
import { THUMB_CONCURRENCY, clearRenderCaches, fastThumbState } from './pdf/caches';
import { renderThumb } from './pdf/thumbs';
import { useStore } from './store';
import './styles.css';

// 개발 중 콘솔·자동화(E2E, bench)에서 쓰는 훅. 벤치가 모듈을 따로 import 하면 개발 서버의 HMR 때문에
// 앱과 다른 사본을 잡을 수 있으므로(캐시가 서로 달라진다), 앱이 실제로 쓰는 것을 그대로 내보낸다.
if (import.meta.env.DEV) {
  Object.assign(window, { __kiho: { useStore, renderThumb, clearRenderCaches, fastThumbState, THUMB_CONCURRENCY } });
}

createRoot(document.getElementById('root')!).render(<App />);

// 오프라인 지원: 빌드본에서만 서비스 워커를 등록한다(개발 서버의 HMR 과 충돌하지 않게).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('서비스 워커 등록 실패', e));
  });
}

// 설치형 앱(PWA)에서 "연결 프로그램"으로 PDF 를 열었을 때
interface LaunchParams {
  files: FileSystemFileHandle[];
}
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void } }).launchQueue;
launchQueue?.setConsumer(async ({ files }) => {
  const items = await Promise.all(files.map(async (handle) => ({ file: await handle.getFile(), handle })));
  if (items.length) await useStore.getState().openFiles(items, 'replace');
});
