// 서비스 워커 원본. 빌드 때 아래 두 상수의 자리표시자가 채워져 dist/sw.js 로 나간다(vite.config.ts 참고).
// 앱은 서버와 통신하지 않으므로 전부 사전 캐시해 두면 오프라인에서도 그대로 동작한다.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `kiho-pdf-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kiho-pdf-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // 페이지 이동은 항상 앱 셸로 응답한다.
      // ignoreVary: 서버가 Vary(Origin 등)를 붙이면 사전 캐시 때와 요청 헤더가 달라 일치가 빗나간다.
      const hit = await cache.match(e.request.mode === 'navigate' ? './index.html' : e.request, {
        ignoreSearch: true,
        ignoreVary: true,
      });
      return hit ?? fetch(e.request);
    }),
  );
});
