import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import './styles.css';

// 개발 중 콘솔/자동화에서 상태를 들여다보기 위한 훅
if (import.meta.env.DEV) Object.assign(window, { __kiho: { useStore } });

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
