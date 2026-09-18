// 좌표 검증용 소형 샘플: 회전(/Rotate)·CropBox 오프셋·가로 페이지가 섞여 있다.
import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const specs = [
  { size: [595, 842], label: 'A4 portrait' },
  { size: [595, 842], rotate: 90, label: 'A4 /Rotate 90' },
  { size: [842, 595], label: 'A4 landscape' },
  { size: [595, 842], rotate: 180, label: 'A4 /Rotate 180' },
  { size: [595, 842], crop: [50, 100, 400, 600], label: 'CropBox 50,100 400x600' },
  { size: [595, 842], rotate: 270, crop: [30, 40, 500, 700], label: '/Rotate 270 + CropBox' },
];
for (let i = 0; i < 12; i++) {
  const s = specs[i % specs.length];
  const page = doc.addPage(s.size);
  const [w, h] = s.size;
  // 10pt 격자와 테두리
  for (let x = 0; x <= w; x += 50) page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, thickness: 0.3, color: rgb(0.8, 0.85, 1) });
  for (let y = 0; y <= h; y += 50) page.drawLine({ start: { x: 0, y }, end: { x: w, y }, thickness: 0.3, color: rgb(0.8, 0.85, 1) });
  page.drawRectangle({ x: 100, y: h - 300, width: 300, height: 100, borderColor: rgb(1, 0, 0), borderWidth: 1 });
  page.drawText(`Page ${i + 1} - ${s.label}`, { x: 110, y: h - 190, size: 18, font });
  page.drawText('target box: x=100..400, top=200..300 (from top-left, unrotated)', { x: 110, y: h - 215, size: 9, font });
  if (s.crop) page.setCropBox(...s.crop);
  if (s.rotate) page.setRotation(degrees(s.rotate));
}
mkdirSync('bench/samples', { recursive: true });
writeFileSync('bench/samples/test_12p.pdf', await doc.save());
console.log('bench/samples/test_12p.pdf');
