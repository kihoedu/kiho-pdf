// 한글 폰트 임베딩 검증: node bench/font-test.mjs <fontfile> [subset=true|false]
import { PDFDocument } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const fontFile = process.argv[2] ?? 'public/fonts/Pretendard-Regular.ttf';
const subset = (process.argv[3] ?? 'true') === 'true';
const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const t0 = performance.now();
const font = await doc.embedFont(readFileSync(fontFile), { subset });
const page = doc.addPage([595, 842]);
page.drawText('한글 텍스트 삽입 테스트 ABC 123 — 빨간 상자', { x: 50, y: 700, size: 14, font });
const bytes = await doc.save();
mkdirSync('bench/out', { recursive: true });
writeFileSync('bench/out/font-test.pdf', bytes);
console.log(`ok subset=${subset} ${(bytes.length / 1024).toFixed(1)} KB ${(performance.now() - t0).toFixed(0)} ms`);
