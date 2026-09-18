// 열기 → 첫 화면 시간 측정(개발 서버가 떠 있어야 한다: npm run dev)
//   node bench/open-bench.mjs [pdf=bench/samples/sample_500p.pdf] [반복=3]
// 같은 파일을 (1) 통째로 읽기 (2) 구간 읽기(Range) — 청크 크기별 — 로 열어 비교한다.
// 구간 읽기는 원래 1GB 초과 파일에서만 쓰지만, 개발용 조정값(window.__kihoTune, src/devTune.ts)으로
// 작은 샘플에서도 그 경로를 강제로 태운다. 파일은 OPFS(디스크)에 넣어 실제 디스크 읽기와 같게 한다.
import { chromium } from '@playwright/test';
import { basename } from 'node:path';

const file = process.argv[2] ?? 'bench/samples/sample_500p.pdf';
const repeat = Number(process.argv[3] ?? 3);
const MB = 1024 * 1024;
const cases = [
  { label: '통째로 읽기(기본)', tune: {} },
  { label: '구간 읽기 8MB(현재값)', tune: { wholeFileLimit: 0, rangeChunk: 8 * MB } },
  { label: '구간 읽기 32MB', tune: { wholeFileLimit: 0, rangeChunk: 32 * MB } },
  { label: '구간 읽기 64MB', tune: { wholeFileLimit: 0, rangeChunk: 64 * MB } },
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/');
const name = basename(file);
const sizeMB = await page.evaluate(async (path) => {
  const root = await navigator.storage.getDirectory();
  const res = await fetch('/' + path);
  if (!res.ok) throw new Error(`샘플을 찾을 수 없습니다: ${path} (npm run bench:sample)`);
  const w = await (await root.getFileHandle('bench.pdf', { create: true })).createWritable();
  await res.body.pipeTo(w);
  return (await (await root.getFileHandle('bench.pdf')).getFile()).size / 1048576;
}, file.replace(/\\/g, '/'));
console.log(`${name}  ${sizeMB.toFixed(1)} MB, ${repeat}회 반복(중앙값)`);

for (const c of cases) {
  const times = [];
  for (let i = 0; i < repeat; i++) {
    const ms = await page.evaluate(async (tune) => {
      const st = window.__kiho.useStore.getState();
      await st.closeAll();
      document.querySelector('.page-canvas canvas')?.remove();
      window.__kihoTune = tune;
      const handle = await (await navigator.storage.getDirectory()).getFileHandle('bench.pdf');
      const f = await handle.getFile();
      const t0 = performance.now();
      const opening = st.openFiles([{ file: f }], 'replace');
      await new Promise((resolve) => {
        const tick = () => (document.querySelector('.page-canvas canvas') ? resolve() : requestAnimationFrame(tick));
        tick();
      });
      const t = performance.now() - t0;
      await opening;
      return t;
    }, c.tune);
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  console.log(`${c.label.padEnd(24)} ${times[Math.floor(times.length / 2)].toFixed(0).padStart(6)} ms   (${times.map((t) => t.toFixed(0)).join(', ')})`);
}
await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('bench.pdf'));
await browser.close();
