// 스캔본을 흉내 낸 대용량 샘플 PDF 생성: 페이지마다 압축 불가능한 회색조 이미지 1장.
// 사용: node bench/make-sample.mjs [쪽수=500] [쪽당KB=400]
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { randomFillSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const pages = Number(process.argv[2] ?? 500);
const kbPerPage = Number(process.argv[3] ?? 400);
const W = 800;
const H = Math.round((kbPerPage * 1024) / W);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < pages; i++) {
  const data = new Uint8Array(W * H);
  // randomFillSync는 호출당 크기 제한이 있어 나눠 채운다
  for (let o = 0; o < data.length; o += 65536) randomFillSync(data, o, Math.min(65536, data.length - o));
  const img = doc.context.stream(data, {
    Type: 'XObject', Subtype: 'Image', Width: W, Height: H,
    ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  });
  const ref = doc.context.register(img);
  const page = doc.addPage([595, 842]);
  page.node.setXObject(PDFName.of('Im0'), ref);
  page.drawText(`Page ${i + 1}`, { x: 40, y: 800, size: 24, font });
  const cs = doc.context.stream(`q 515 0 0 700 40 60 cm /Im0 Do Q`);
  page.node.addContentStream(doc.context.register(cs));
}
mkdirSync('bench/samples', { recursive: true });
const out = `bench/samples/sample_${pages}p.pdf`;
const bytes = await doc.save({ useObjectStreams: false });
writeFileSync(out, bytes);
console.log(`${out}  ${(bytes.length / 1048576).toFixed(1)} MB`);
