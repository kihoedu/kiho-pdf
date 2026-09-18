// pdf-lib 분할 벤치마크: 원본 1회 파싱 → N개 그룹으로 copyPages → 저장.
// 사용: node bench/bench-split.mjs <pdf> [그룹수=20]
import { PDFDocument } from '@cantoo/pdf-lib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'bench/samples/sample_500p.pdf';
const groups = Number(process.argv[3] ?? 20);
const ms = (t) => `${(performance.now() - t).toFixed(0)} ms`;

let t = performance.now();
const bytes = readFileSync(file);
console.log(`read     ${ms(t)}  (${(bytes.length / 1048576).toFixed(1)} MB)`);

t = performance.now();
const src = await PDFDocument.load(bytes, { updateMetadata: false });
const n = src.getPageCount();
console.log(`parse    ${ms(t)}  (${n} pages)`);

mkdirSync('bench/out', { recursive: true });
const tAll = performance.now();
let total = 0;
const per = Math.ceil(n / groups);
for (let g = 0; g < groups; g++) {
  const idx = [];
  for (let p = g * per; p < Math.min(n, (g + 1) * per); p++) idx.push(p);
  if (!idx.length) break;
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, idx)) out.addPage(p);
  const ob = await out.save({ useObjectStreams: true, updateFieldAppearances: false });
  total += ob.length;
  writeFileSync(`bench/out/part_${String(g + 1).padStart(2, '0')}.pdf`, ob);
}
console.log(`split    ${ms(tAll)}  (${groups} files, 합계 ${(total / 1048576).toFixed(1)} MB)`);
console.log(`heap     ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB rss`);
