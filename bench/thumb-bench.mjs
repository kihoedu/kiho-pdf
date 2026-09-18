// 썸네일 렌더 방식 비교 벤치마크(개발 서버가 떠 있어야 한다)
//   node bench/thumb-bench.mjs [쪽수=40]          합성 스캔본으로 A·B·C 비교
//   node bench/thumb-bench.mjs <실제.pdf> [최대쪽=60]  실제 파일로 A·B 비교(파일은 bench/samples/_real.pdf 로 복사된다)
// 스캔본형 PDF(쪽마다 300dpi A4 JPEG 1장)를 만들어 다음을 잰다.
//   A. 현재 방식: PDF.js 워커 1개, 동시 2건
//   B. PDF.js 워커 N개로 나눠 그리기
//   C. 내장 JPEG 을 PDF.js 없이 브라우저 디코더로 바로 축소(createImageBitmap resize)
import { chromium } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const REAL = process.argv[2] && /\.pdf$/i.test(process.argv[2]) ? process.argv[2] : undefined;
let PAGES = REAL ? Number(process.argv[3] ?? 60) : Number(process.argv[2] ?? 40);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://localhost:5173/');

mkdirSync('bench/samples', { recursive: true });
let sampleName = `scan_${PAGES}p.pdf`;
// 1) 문서처럼 보이는 300dpi JPEG (쪽마다 내용이 조금씩 달라 캐시가 통하지 않게 한다)
const jpegs = REAL ? [] : await page.evaluate(async (n) => {
  const out = [];
  for (let p = 0; p < n; p++) {
    const c = new OffscreenCanvas(2480, 3508);
    const g = c.getContext('2d');
    g.fillStyle = '#fdfcf8';
    g.fillRect(0, 0, 2480, 3508);
    g.fillStyle = '#111';
    g.font = '52px serif';
    for (let y = 160; y < 3400; y += 78) g.fillText(`${p + 1}쪽 — 다람쥐 헌 쳇바퀴에 타고파 The quick brown fox 0123456789 `.repeat(2), 120, y);
    // 스캔 잡음
    const d = g.getImageData(0, 0, 2480, 400);
    for (let i = 0; i < d.data.length; i += 16) d.data[i] = d.data[i + 1] = d.data[i + 2] = d.data[i] - ((i * 7 + p) % 9);
    g.putImageData(d, 0, 0);
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    out.push(btoa(s));
  }
  return out;
}, PAGES);

if (REAL) {
  sampleName = '_real.pdf';
  copyFileSync(REAL, 'bench/samples/_real.pdf');
  console.log(`real file: ${REAL}`);
} else {
  const doc = await PDFDocument.create();
  for (const b64 of jpegs) {
    const img = await doc.embedJpg(Buffer.from(b64, 'base64'));
    doc.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  const bytes = await doc.save();
  writeFileSync(`bench/samples/${sampleName}`, bytes);
  console.log(`sample: ${sampleName} ${(bytes.length / 1048576).toFixed(1)} MB`);
}

// 2) 측정
const result = await page.evaluate(
  async ([maxPages, jpegB64, name]) => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
    const data = new Uint8Array(await (await fetch(`/bench/samples/${name}`)).arrayBuffer());
    const probe = pdfjs.getDocument({ data: data.slice() });
    const n = Math.min(maxPages, (await probe.promise).numPages);
    await probe.destroy();

    // 메인 스레드가 얼마나 막히는지: 4ms 타이머가 늦게 도는 만큼을 "막힘"으로 본다.
    function heartbeat() {
      let last = performance.now(), blocked = 0, worst = 0;
      const id = setInterval(() => {
        const now = performance.now();
        const late = now - last - 4;
        if (late > 8) { blocked += late; worst = Math.max(worst, late); }
        last = now;
      }, 4);
      return () => { clearInterval(id); return { blockedMs: Math.round(blocked), worstMs: Math.round(worst) }; };
    }
    const THUMB_W = 120 * 2; // dpr 2 기준

    async function renderThumb(pdf, i) {
      const pg = await pdf.getPage(i + 1);
      const base = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: THUMB_W / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      await pg.render({ canvas, viewport: vp }).promise;
      pg.cleanup();
    }
    async function pool(items, concurrency, fn) {
      let next = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => { while (next < items.length) await fn(items[next++]); }));
    }
    const idx = Array.from({ length: n }, (_, i) => i);

    async function withWorkers(k, perWorkerConcurrency) {
      const tasks = [];
      for (let w = 0; w < k; w++) tasks.push(pdfjs.getDocument({ data: data.slice(), worker: new pdfjs.PDFWorker() }));
      const docs = await Promise.all(tasks.map((t) => t.promise));
      const stop = heartbeat();
      const t0 = performance.now();
      // 쪽을 워커에 번갈아 배정
      await Promise.all(docs.map((pdf, w) => pool(idx.filter((i) => i % k === w), perWorkerConcurrency, (i) => renderThumb(pdf, i))));
      const ms = performance.now() - t0;
      const hb = stop();
      await Promise.all(tasks.map((t) => t.destroy()));
      return { ms: Math.round(ms), ...hb };
    }

    const out = { cores: navigator.hardwareConcurrency, pages: n };
    await withWorkers(1, 2); // 워밍업(JIT·워커 로드)
    out.A_current_1worker = await withWorkers(1, 2);
    out.B_2workers = await withWorkers(2, 2);
    out.B_3workers = await withWorkers(3, 2);
    out.B_4workers = await withWorkers(4, 2);

    if (!jpegB64.length) return out; // 실제 파일: 원본 JPEG 을 꺼내는 경로는 앱에 구현돼야 잴 수 있다
    // C. JPEG 직접 디코딩: 브라우저 디코더가 축소까지 한다(메인 스레드 밖)
    const blobs = jpegB64.map((b) => new Blob([Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0))], { type: 'image/jpeg' }));
    const direct = async (conc) => {
      const stop = heartbeat();
      const t0 = performance.now();
      await pool(idx, conc, async (i) => {
        const bmp = await createImageBitmap(blobs[i], { resizeWidth: THUMB_W, resizeQuality: 'medium' });
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
      });
      const ms = Math.round(performance.now() - t0);
      return { ms, ...stop() };
    };
    await direct(4);
    out.C_directJpeg_conc4 = await direct(4);
    out.C_directJpeg_conc8 = await direct(8);
    return out;
  },
  [PAGES, jpegs, sampleName],
);
PAGES = result.pages;

const per = (r) => `${String(r.ms).padStart(5)} ms  ${(r.ms / PAGES).toFixed(1).padStart(5)} ms/쪽  ${(PAGES / (r.ms / 1000)).toFixed(0).padStart(3)} 쪽/초   메인 스레드 막힘 ${String(r.blockedMs).padStart(5)} ms (최장 ${r.worstMs} ms)`;
console.log(`\n${PAGES}쪽 썸네일 전체 렌더 시간 — 논리 코어 ${result.cores}개`);
for (const [k, v] of Object.entries(result)) if (typeof v === 'object') console.log(`  ${k.padEnd(22)} ${per(v)}`);
await browser.close();
