/// <reference lib="webworker" />
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  degrees,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFFont,
} from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { optimizeImages } from './optimize';
import { fullPageImage } from './pageImage';
import { markDocument, recordEdits, restoreEdits, snapshotPage } from './pieceInfo';
import type { BuildRequest, EngineRequest, EngineResponse, RestoreRequest, ThumbRequest } from './protocol';

// 원본은 한 번만 파싱해 두고 분할·저장에 재사용한다.
const parsed = new Map<string, Promise<PDFDocument>>();

function loadSource(src: BuildRequest['sources'][number]): Promise<PDFDocument> {
  let p = parsed.get(src.id);
  if (!p) {
    p = src.file
      .arrayBuffer()
      .then((buf) => PDFDocument.load(buf, { updateMetadata: false, password: src.password }));
    p.catch(() => parsed.delete(src.id));
    parsed.set(src.id, p);
  }
  return p;
}

const post = (msg: EngineResponse, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

async function build(req: BuildRequest): Promise<void> {
  const srcById = new Map(req.sources.map((s) => [s.id, s]));
  for (let oi = 0; oi < req.outputs.length; oi++) {
    const plan = req.outputs[oi];
    const out = await PDFDocument.create();
    let font: PDFFont | undefined;
    let recorded = false;

    // 같은 원본에서 연속으로 가져오는 페이지는 한 번의 copyPages 로 묶는다(공유 리소스 중복 방지).
    let i = 0;
    while (i < plan.pages.length) {
      const srcId = plan.pages[i].srcId;
      let j = i;
      while (j < plan.pages.length && plan.pages[j].srcId === srcId) j++;
      const srcDoc = await loadSource(srcById.get(srcId)!);
      const copied = await out.copyPages(
        srcDoc,
        plan.pages.slice(i, j).map((p) => p.srcIndex),
      );
      for (let k = 0; k < copied.length; k++) {
        const pagePlan = plan.pages[i + k];
        const page = out.addPage(copied[k]);
        if (pagePlan.addRotate) {
          page.setRotation(degrees((page.getRotation().angle + pagePlan.addRotate) % 360));
        }
        // 다시 열었을 때 재편집할 수 있도록, 그리기 전 상태를 찍어 두었다가 덧붙인 부분을 기록한다(pieceInfo.ts).
        const before = pagePlan.edits ? snapshotPage(page) : undefined;
        // 펜 선 → 텍스트 순으로, 모두 기존 콘텐츠 뒤의 새 스트림에 그린다.
        for (const s of pagePlan.shapes) {
          const ops = [
            pushGraphicsState(),
            setStrokingColor(rgb(...s.color)),
            setLineWidth(s.width),
            setLineCap(LineCapStyle.Round),
            setLineJoin(LineJoinStyle.Round),
            moveTo(s.pts[0], s.pts[1]),
          ];
          for (let n = 2; n + 1 < s.pts.length; n += 2) ops.push(lineTo(s.pts[n], s.pts[n + 1]));
          page.pushOperators(...ops, stroke(), popGraphicsState());
        }
        if (pagePlan.texts.length) {
          if (!font) {
            if (!req.fontBytes) throw new Error('텍스트 폰트가 전달되지 않았습니다.');
            out.registerFontkit(fontkit);
            font = await out.embedFont(req.fontBytes, { subset: true });
          }
          // drawText 는 기존 콘텐츠를 q…Q 로 감싼 뒤 새 콘텐츠 스트림을 뒤에 덧붙인다.
          for (const t of pagePlan.texts) {
            for (const line of t.lines) {
              if (!line.text) continue;
              page.drawText(line.text, {
                x: line.x,
                y: line.y,
                size: t.size,
                font,
                color: rgb(...t.color),
                rotate: degrees(t.rotate),
              });
            }
          }
        }
        if (before && pagePlan.edits) {
          recordEdits(out, page, pagePlan.edits, before);
          recorded = true;
        }
      }
      i = j;
    }
    if (recorded) markDocument(out);

    const stats = req.optimize
      ? await optimizeImages(out, req.optimize, (done, total) =>
          post({ type: 'progress', jobId: req.jobId, text: `이미지 최적화 중… ${done}/${total}` }),
        )
      : undefined;

    // 기본은 무손실 저장: 스트림은 그대로 복사되고 구조(object stream)만 압축한다.
    const bytes = await out.save({ useObjectStreams: true, updateFieldAppearances: false });
    post({ type: 'output', jobId: req.jobId, index: oi, name: plan.name, bytes, stats }, [bytes.buffer]);
  }
  post({ type: 'done', jobId: req.jobId });
}

/**
 * 이 앱이 저장한 파일을 다시 열 때: 그려 넣은 삽입 항목을 걷어 낸 PDF 와 그 기록을 돌려준다.
 * 고친 문서는 그대로 파싱 캐시에 남으므로 이후 저장에서 다시 파싱하지 않는다.
 */
async function restore(req: RestoreRequest): Promise<void> {
  try {
    const doc = await loadSource(req.source);
    const pages = restoreEdits(doc);
    if (!pages.length) return post({ type: 'restored', jobId: req.jobId, pages });
    const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
    post({ type: 'restored', jobId: req.jobId, pages, bytes }, [bytes.buffer]);
  } catch (err) {
    parsed.delete(req.source.id); // 반쯤 고친 문서를 저장에 쓰지 않도록
    throw err;
  }
}

/**
 * 썸네일 빠른 경로: 쪽 전체를 덮는 이미지가 있으면 여기서 "디코딩하면서 축소"까지 끝내고 작은 비트맵만 넘긴다.
 * 맞지 않는 쪽은 비트맵 없이 답해 호출 쪽이 PDF.js 로 그리게 한다. 실패도 마찬가지로 다뤄 그리기가 멈추지 않게 한다.
 */
async function thumb(req: ThumbRequest): Promise<void> {
  const none = () => post({ type: 'thumb', jobId: req.jobId });
  let info: ReturnType<typeof fullPageImage>;
  let box: { width: number; height: number };
  let rotate = 0;
  try {
    const page = (await loadSource(req.source)).getPages()[req.index];
    if (!page) return none();
    info = fullPageImage(page);
    if (!info) return none();
    box = page.getCropBox();
    // 이미지는 쪽이 돌기 전 방향으로 들어 있다. 원본 /Rotate 에 사용자 회전을 더한 만큼 돌려야 화면과 같아진다.
    rotate = (((page.getRotation().angle + req.rotate) % 360) + 360) % 360;
  } catch {
    return none(); // 암호·손상 등으로 못 읽으면 조용히 기존 경로로 넘긴다
  }

  const swap = rotate % 180 !== 0;
  const viewW = swap ? box.height : box.width;
  const viewH = swap ? box.width : box.height;
  const scale = Math.min(req.maxW / viewW, req.maxH / viewH);
  // 내림으로 맞춘다 — PDF.js 경로(pdf/render.ts)도 내림이라 두 경로의 결과 크기가 같아야 한다.
  const outW = Math.max(1, Math.floor(viewW * scale));
  const outH = Math.max(1, Math.floor(viewH * scale));

  // 원본 크기로 펼치지 않고 목표 크기로 바로 디코딩한다 — 이것이 빠른 이유다.
  const bmp = await createImageBitmap(new Blob([info.bytes as Uint8Array<ArrayBuffer>], { type: info.mime }), {
    resizeWidth: swap ? outH : outW,
    resizeHeight: swap ? outW : outH,
    resizeQuality: 'medium',
  });
  if (!rotate) return post({ type: 'thumb', jobId: req.jobId, bitmap: bmp }, [bmp]);

  const canvas = new OffscreenCanvas(outW, outH);
  const g = canvas.getContext('2d')!;
  g.translate(outW / 2, outH / 2);
  g.rotate((rotate * Math.PI) / 180);
  g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();
  const rotated = canvas.transferToImageBitmap();
  post({ type: 'thumb', jobId: req.jobId, bitmap: rotated }, [rotated]);
}

self.onmessage = (e: MessageEvent<EngineRequest>) => {
  const req = e.data;
  if (req.type === 'forget') {
    if (req.srcIds) req.srcIds.forEach((id) => parsed.delete(id));
    else parsed.clear();
    return;
  }
  const run = req.type === 'restore' ? restore(req) : req.type === 'thumb' ? thumb(req) : build(req);
  run.catch((err) =>
    post({ type: 'error', jobId: req.jobId, message: err instanceof Error ? err.message : String(err) }),
  );
};
