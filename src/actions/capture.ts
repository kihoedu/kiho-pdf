import { zipSync } from 'fflate';
import { capturePixels, MAX_CAPTURE_PIXELS, uniqueFileNames, validateCaptures } from '../model/captures';
import { addRot, remapPts, remapRect, viewSize } from '../model/geometry';
import { ensureTextFont, layoutText, TEXT_FONT_FAMILY, TEXT_PAD } from '../model/textLayout';
import { uid, type Capture } from '../model/types';
import { pageBox, pageRot } from '../pdf/loader';
import { baseName, getPdfPage, useStore } from '../store';
import { download, errText, fmtSec, fmtSize, isAbort, writeTo } from './io';

const JPEG_QUALITY = 0.92;
const PREVIEW_MAX_PX = 160;

/**
 * 캡처 영역을 dpi 해상도로 그린다. 화면 캔버스를 잘라 내는 것이 아니라 PDF 에서 그 영역만 다시 렌더하므로
 * 화면 배율과 무관하게 선명하다. 삽입한 텍스트·펜 선도 화면에 보이는 그대로 포함한다.
 */
export async function renderCapture(c: Capture, dpi: number): Promise<HTMLCanvasElement> {
  const item = useStore.getState().pages.find((p) => p.uid === c.pageUid);
  if (!item) throw new Error('캡처한 쪽이 문서에 없습니다.');
  const page = await getPdfPage(item);
  const box = pageBox(page);
  const rot = addRot(pageRot(page), item.userRot);
  const r = remapRect(c, box, c.rot, rot); // 지금 화면 회전 기준의 영역(pt)
  const scale = dpi / 72;
  const px = capturePixels(r, dpi);
  if (px.w * px.h > MAX_CAPTURE_PIXELS) {
    throw new Error(`"${c.name}" 이(가) 너무 큽니다(${px.w}×${px.h}px). 해상도를 낮추거나 영역을 줄이세요.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = px.w;
  canvas.height = px.h;
  // 영역의 왼쪽 위가 캔버스 원점에 오도록 뷰포트를 민다 → 필요한 부분만 그린다(바탕은 PDF.js 가 흰색으로 칠한다).
  const viewport = page.getViewport({ scale, rotation: rot, offsetX: -r.x * scale, offsetY: -r.y * scale });
  await page.render({ canvas, viewport }).promise;
  const ctx = canvas.getContext('2d')!;

  if (item.shapes.length || item.texts.some((t) => t.text.trim())) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, -r.x * scale, -r.y * scale); // 이하 좌표는 현재 회전 기준 pt
    for (const s of item.shapes) {
      const pts = remapPts(s.pts, box, s.rot, rot);
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (item.texts.some((t) => t.text.trim())) await ensureTextFont();
    for (const t of item.texts) {
      if (!t.text.trim()) continue;
      const cur = remapRect(t, box, t.rot, rot);
      ctx.save();
      // 텍스트는 삽입 당시 방향(t.rot)으로 서 있으므로, 그 차이만큼 상자 중심에서 돌린다.
      ctx.translate(cur.x + cur.w / 2, cur.y + cur.h / 2);
      ctx.rotate((((rot - t.rot + 360) % 360) * Math.PI) / 180);
      ctx.translate(-t.w / 2, -t.h / 2);
      ctx.font = `${t.size}px ${TEXT_FONT_FAMILY}`;
      ctx.fillStyle = t.color;
      ctx.textBaseline = 'alphabetic';
      for (const line of layoutText(t)) ctx.fillText(line.text, TEXT_PAD, line.baseline);
      ctx.restore();
    }
    ctx.restore();
  }
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, format: 'png' | 'jpeg'): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들 수 없습니다.'))), `image/${format}`, JPEG_QUALITY),
  );

/** 현재 쪽의 영역(현재 화면 회전 기준 pt)을 캡처 목록에 담는다. */
export function addCaptureRect(pageUid: string, rect: { x: number; y: number; w: number; h: number }, rot: Capture['rot'], focusName = false): void {
  const item = useStore.getState().pages.find((p) => p.uid === pageUid);
  if (!item) return;
  const c: Capture = { id: uid(), pageUid, ...rect, rot, userRot: item.userRot, name: '', auto: true };
  useStore.getState().addCapture(c, focusName);
  void refreshPreview(c.id);
}

export async function captureWholePage(): Promise<void> {
  const st = useStore.getState();
  const item = st.pages[st.current];
  if (!item) return;
  const page = await getPdfPage(item);
  const rot = addRot(pageRot(page), item.userRot);
  const v = viewSize(pageBox(page), rot);
  addCaptureRect(item.uid, { x: 0, y: 0, w: v.w, h: v.h }, rot);
}

/** 목록에 보여 줄 작은 미리보기를 (다시) 만든다. */
export async function refreshPreview(id: string): Promise<void> {
  const c = useStore.getState().captures.find((x) => x.id === id);
  if (!c) return;
  try {
    const dpi = Math.max(8, (72 * PREVIEW_MAX_PX) / Math.max(c.w, c.h));
    const blob = await toBlob(await renderCapture(c, dpi), 'png');
    // 그리는 사이에 지워졌으면 버린다.
    if (useStore.getState().captures.some((x) => x.id === id)) useStore.getState().setPreview(id, URL.createObjectURL(blob));
  } catch (e) {
    console.warn('미리보기를 만들지 못했습니다', e);
  }
}

export async function copyCapture(id: string): Promise<void> {
  const st = useStore.getState();
  const c = st.captures.find((x) => x.id === id);
  if (!c) return;
  try {
    // 클립보드는 PNG 만 받는다. Promise 를 그대로 넘겨야 사용자 동작(클릭) 권한이 유지된다.
    const blob = renderCapture(c, st.captureOptions.dpi).then((canvas) => toBlob(canvas, 'png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    st.notify('info', `"${c.name}" 을(를) 클립보드에 복사했습니다.`);
  } catch (e) {
    st.notify('error', `복사 실패: ${errText(e)}`);
  }
}

/** 캡처 목록을 한꺼번에 이미지 파일로 내보낸다. 폴더를 한 번만 고르면 나머지는 대화상자 없이 기록된다. */
export async function saveCaptures(): Promise<void> {
  const st = useStore.getState();
  const { captures, captureOptions: opt } = st;
  if (!captures.length) return;
  const issues = validateCaptures(captures);
  if (issues.length) {
    st.notify('error', `저장할 수 없습니다: ${issues[0].message}`);
    return;
  }
  const ext = opt.format === 'jpeg' ? 'jpg' : 'png';
  const names = uniqueFileNames(captures.map((c) => c.name), ext);
  try {
    let dir: FileSystemDirectoryHandle | undefined;
    if ('showDirectoryPicker' in window) {
      dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'kiho-capture' });
      const existing: string[] = [];
      for (const n of names) {
        if (await dir.getFileHandle(n).then(() => true, () => false)) existing.push(n);
      }
      if (existing.length && !window.confirm(`다음 ${existing.length}개 파일을 덮어씁니다.\n\n${existing.slice(0, 10).join('\n')}${existing.length > 10 ? '\n…' : ''}`))
        return;
    }
    const t0 = performance.now();
    let total = 0;
    const zipEntries: Record<string, Uint8Array> = {};
    for (let i = 0; i < captures.length; i++) {
      st.setBusy(`캡처 저장 중… ${i}/${captures.length}`);
      const canvas = await renderCapture(captures[i], opt.dpi);
      const blob = await toBlob(canvas, opt.format);
      canvas.width = canvas.height = 0; // 큰 캔버스 메모리를 바로 돌려준다
      total += blob.size;
      if (dir) await writeTo(await dir.getFileHandle(names[i], { create: true }), blob);
      else zipEntries[names[i]] = new Uint8Array(await blob.arrayBuffer());
    }
    if (!dir) {
      const primary = st.primaryId ? st.sources[st.primaryId] : undefined;
      // 이미지는 이미 압축돼 있으므로 무압축으로 묶는다.
      download(`${baseName(primary)}_캡처.zip`, zipSync(zipEntries, { level: 0 }), 'application/zip');
    }
    // 저장하는 사이에 목록이 바뀌지 않았을 때만 "저장됨" 으로 친다.
    if (useStore.getState().captures === captures) useStore.getState().markCapturesSaved();
    st.notify('info', `이미지 ${captures.length}개 저장 완료 (${opt.dpi}dpi ${ext.toUpperCase()}, 합계 ${fmtSize(total)}, ${fmtSec(t0)})`);
  } catch (e) {
    if (!isAbort(e)) st.notify('error', `캡처 저장 실패: ${errText(e)}`);
  } finally {
    st.setBusy(undefined);
  }
}
