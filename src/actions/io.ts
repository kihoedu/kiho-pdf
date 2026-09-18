import { zipSync } from 'fflate';
import { buildOutputs, type OutputHandler } from '../engine/client';
import type { OptimizeOptions, OptimizeStats, OutputPlan, PagePlan, ShapeDraw, TextDraw } from '../engine/protocol';
import { encodeEdits } from '../model/editsCodec';
import { addRot, viewToPdf } from '../model/geometry';
import { finalFileNames, validate, withPdfExt } from '../model/groups';
import { hexToRgb01, planShape } from '../model/plan';
import { ensureTextFont, layoutText, TEXT_PAD } from '../model/textLayout';
import { hasEdits, type PageItem } from '../model/types';
import { pageBox } from '../pdf/loader';
import { baseName, getPdfPage, useStore } from '../store';

const hasFsAccess = 'showOpenFilePicker' in window;
const PDF_TYPES = [{ description: 'PDF 문서', accept: { 'application/pdf': ['.pdf' as const] } }];

export async function pickPdfFiles(multiple: boolean): Promise<{ file: File; handle?: FileSystemFileHandle }[]> {
  if (hasFsAccess) {
    try {
      const handles = await window.showOpenFilePicker({ multiple, types: PDF_TYPES });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return [];
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []).map((file) => ({ file })));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function filesFromDrop(dt: DataTransfer): Promise<{ file: File; handle?: FileSystemFileHandle }[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  const out = await Promise.all(
    items.map(async (item) => {
      const file = item.getAsFile();
      let handle: FileSystemFileHandle | undefined;
      if ('getAsFileSystemHandle' in item) {
        const h = await item.getAsFileSystemHandle().catch(() => null);
        if (h?.kind === 'file') handle = h as FileSystemFileHandle;
      }
      return file ? { file, handle } : null;
    }),
  );
  return out.filter((x): x is NonNullable<typeof x> => !!x && /\.pdf$/i.test(x.file.name));
}

/** 편집 목록을 저장 엔진이 이해하는 계획으로 바꾼다(텍스트 좌표를 PDF 사용자 공간으로 변환). */
async function planPages(pages: PageItem[]): Promise<PagePlan[]> {
  return Promise.all(
    pages.map(async (p) => {
      const texts: TextDraw[] = [];
      let shapes: ShapeDraw[] = [];
      if (p.shapes.length || p.texts.some((t) => t.text.trim())) {
        const box = pageBox(await getPdfPage(p));
        shapes = p.shapes.map((s) => planShape(s, box));
        for (const t of p.texts) {
          if (!t.text.trim()) continue;
          texts.push({
            lines: layoutText(t).map((l) => ({
              text: l.text,
              ...viewToPdf({ x: t.x + TEXT_PAD, y: t.y + l.baseline }, box, t.rot),
            })),
            size: t.size,
            color: hexToRgb01(t.color),
            rotate: t.rot,
          });
        }
      }
      return { srcId: p.srcId, srcIndex: p.srcIndex, addRotate: p.userRot, texts, shapes, edits: encodeEdits(p) };
    }),
  );
}

async function runBuild(
  outputs: { name: string; pages: PageItem[] }[],
  onOutput: OutputHandler,
  optimize?: OptimizeOptions,
): Promise<void> {
  const { sources } = useStore.getState();
  const needsFont = outputs.some((o) => o.pages.some((p) => p.texts.some((t) => t.text.trim())));
  const fontBytes = needsFont ? await ensureTextFont() : undefined;
  const plans: OutputPlan[] = await Promise.all(
    outputs.map(async (o) => ({ name: o.name, pages: await planPages(o.pages) })),
  );
  const used = new Set(plans.flatMap((o) => o.pages.map((p) => p.srcId)));
  await buildOutputs(
    {
      sources: [...used].map((id) => ({ id, file: sources[id].file, password: sources[id].password })),
      outputs: plans,
      fontBytes,
      optimize,
    },
    onOutput,
    (text) => useStore.getState().setBusy(text),
  );
}

/** 페이지 목록을 하나의 PDF 로 만든다. */
export async function buildSingle(
  pages: PageItem[],
  optimize?: OptimizeOptions,
): Promise<{ bytes: Uint8Array; stats?: OptimizeStats }> {
  let result: { bytes: Uint8Array; stats?: OptimizeStats } | undefined;
  await runBuild([{ name: 'out.pdf', pages }], (_i, _n, bytes, stats) => void (result = { bytes, stats }), optimize);
  if (!result) throw new Error('결과가 생성되지 않았습니다.');
  return result;
}

export async function writeTo(handle: FileSystemFileHandle, data: Uint8Array | Blob): Promise<void> {
  const w = await handle.createWritable();
  await w.write(data as Uint8Array<ArrayBuffer> | Blob);
  await w.close();
}

export function download(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const isAbort = (e: unknown) => (e as DOMException)?.name === 'AbortError';
// 확인 창에 오래 머물면 브라우저가 "사용자 동작" 권한을 거둬 저장 대화상자를 막는다. 한 번 더 누르면 된다.
export const errText = (e: unknown) =>
  (e as DOMException)?.name === 'SecurityError'
    ? '저장 대화상자를 열 수 없었습니다. 저장을 한 번 더 눌러 주세요.'
    : e instanceof Error
      ? e.message
      : String(e);

const signatureAck = new Set<string>();

/** 전자서명이 있는 원본의 쪽을 저장하기 전에 확인한다(문서마다 한 번만 묻는다). */
export function confirmSigned(pages: PageItem[]): boolean {
  const { sources } = useStore.getState();
  const signed = [...new Set(pages.map((p) => p.srcId))]
    .map((id) => sources[id])
    .filter((s) => s?.signed && !signatureAck.has(s.id));
  if (!signed.length) return true;
  const ok = window.confirm(
    `전자서명이 있는 문서입니다: ${signed.map((s) => s.name).join(', ')}\n\n` +
      '이 앱으로 저장한 파일에서는 전자서명이 무효가 됩니다. 서명된 원본이 필요하면 원본 파일에 덮어쓰지 마세요.\n\n계속할까요?',
  );
  if (ok) signed.forEach((s) => signatureAck.add(s.id));
  return ok;
}

/** 지정한 페이지들을 하나의 PDF 로 저장한다. pages 생략 시 문서 전체. */
export async function savePdf(pages?: PageItem[], suggested?: string, optimize?: OptimizeOptions): Promise<void> {
  const st = useStore.getState();
  const whole = !pages;
  const list = pages ?? st.pages;
  if (!list.length) return;
  if (!confirmSigned(list)) return;
  const primary = st.primaryId ? st.sources[st.primaryId] : undefined;
  const name = withPdfExt(suggested ?? `${baseName(primary)}_${optimize ? '최적화' : '편집'}`);
  try {
    let handle: FileSystemFileHandle | undefined;
    if (hasFsAccess) handle = await window.showSaveFilePicker({ suggestedName: name, types: PDF_TYPES });
    st.setBusy('저장하는 중…');
    const t0 = performance.now();
    const { bytes: result, stats } = await buildSingle(list, optimize);
    const size = result.length;
    if (handle) await writeTo(handle, result);
    else download(name, result, 'application/pdf');
    if (whole) st.markSaved();
    st.notify('info', `저장 완료: ${handle?.name ?? name} (${fmtSize(size)}, ${fmtSec(t0)})${describeStats(stats, optimize)}`);

    // 열려 있는 원본을 덮어썼다면 PDF.js 가 읽던 File 이 무효가 되므로 저장본으로 다시 연다.
    if (handle) {
      for (const s of Object.values(st.sources)) {
        if (s.handle && (await s.handle.isSameEntry(handle))) {
          await reopenSaved(handle, whole ? list : undefined);
          break;
        }
      }
    }
  } catch (e) {
    if (!isAbort(e)) st.notify('error', `저장 실패: ${errText(e)}`);
  } finally {
    st.setBusy(undefined);
  }
}

/**
 * 방금 저장한 파일로 문서를 다시 연다. 문서 전체를 저장한 경우에는 쪽 구성이 그대로이므로
 * 분할 그룹과 캡처 목록을 새 문서로 이어받는다(삽입 항목은 저장본의 기록에서 되살아난다).
 */
async function reopenSaved(handle: FileSystemFileHandle, savedPages?: PageItem[]): Promise<void> {
  const before = useStore.getState();
  const { groups, captures, capturesUnsaved } = before;
  await before.openFiles([{ file: await handle.getFile(), handle }], 'replace');
  const after = useStore.getState();
  if (!savedPages || after.pages.length !== savedPages.length) return;
  after.setCurrent(before.current); // 보고 있던 쪽으로 돌아간다
  if (!groups.length && !captures.length) return;
  const at = new Map(savedPages.map((p, i) => [p.uid, i]));
  const moved = captures.flatMap((c) => {
    const i = at.get(c.pageUid);
    if (i === undefined) return [];
    // 사용자 회전은 저장본의 /Rotate 에 녹아 0 이 됐다. "캡처 뒤에 돌린 만큼" 만 남도록 기준을 옮긴다.
    return [{ ...c, pageUid: after.pages[i].uid, userRot: addRot(c.userRot, -savedPages[i].userRot) }];
  });
  after.carryOver(groups, moved, capturesUnsaved);
  const { refreshPreview } = await import('./capture'); // capture.ts 가 이 파일을 쓰므로 순환 참조를 피한다
  for (const c of moved) void refreshPreview(c.id);
}

/** 분할 그룹을 한 번에 저장한다. 폴더를 한 번만 고르면 나머지는 대화상자 없이 기록된다. */
export async function saveGroups(): Promise<void> {
  const st = useStore.getState();
  const { groups, pages } = st;
  if (!groups.length) return;
  const issues = validate(groups, pages.length);
  if (issues.length) {
    st.notify('error', `저장할 수 없습니다: ${issues[0].message}`);
    return;
  }
  if (!confirmSigned(pages)) return;
  const names = finalFileNames(groups);
  const outputs = groups.map((g, i) => ({ name: names[i], pages: pages.slice(g.start - 1, g.end) }));
  try {
    let dir: FileSystemDirectoryHandle | undefined;
    if ('showDirectoryPicker' in window) {
      dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'kiho-split' });
      const existing: string[] = [];
      for (const n of names) {
        if (await dir.getFileHandle(n).then(() => true, () => false)) existing.push(n);
      }
      if (existing.length && !window.confirm(`다음 ${existing.length}개 파일을 덮어씁니다.\n\n${existing.slice(0, 10).join('\n')}${existing.length > 10 ? '\n…' : ''}`))
        return;
    }
    const t0 = performance.now();
    let done = 0;
    let total = 0;
    const zipEntries: Record<string, Uint8Array> = {};
    st.setBusy(`분할 저장 중… 0/${outputs.length}`);
    await runBuild(outputs, async (_i, name, bytes) => {
      total += bytes.length;
      if (dir) await writeTo(await dir.getFileHandle(name, { create: true }), bytes);
      else zipEntries[name] = bytes;
      useStore.getState().setBusy(`분할 저장 중… ${++done}/${outputs.length}`);
    });
    if (!dir) {
      // PDF 는 이미 압축돼 있으므로 무압축(level 0)으로 묶어 시간을 아낀다.
      const primary = st.primaryId ? st.sources[st.primaryId] : undefined;
      download(`${baseName(primary)}_분할.zip`, zipSync(zipEntries, { level: 0 }), 'application/zip');
    }
    st.notify('info', `${outputs.length}개 파일 저장 완료 (합계 ${fmtSize(total)}, ${fmtSec(t0)})`);
  } catch (e) {
    if (!isAbort(e)) st.notify('error', `분할 저장 실패: ${errText(e)}`);
  } finally {
    st.setBusy(undefined);
  }
}

/** 브라우저의 PDF 인쇄 기능을 그대로 쓴다(벡터 유지, 래스터화 없음). */
export async function printPdf(): Promise<void> {
  const st = useStore.getState();
  if (!st.pages.length) return;
  try {
    st.setBusy('인쇄 준비 중…');
    const srcIds = Object.keys(st.sources);
    const untouched =
      srcIds.length === 1 &&
      st.pages.length === st.sources[srcIds[0]].pageCount &&
      st.pages.every((p, i) => p.srcIndex === i && p.userRot === 0 && !hasEdits(p));
    let blob: Blob;
    if (untouched) {
      blob = st.sources[srcIds[0]].file;
    } else {
      blob = new Blob([(await buildSingle(st.pages)).bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    }
    const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' }));
    document.getElementById('print-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'print-frame';
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = () => setTimeout(() => frame.contentWindow?.print(), 50);
    frame.src = url;
    document.body.appendChild(frame);
  } catch (e) {
    st.notify('error', `인쇄 실패: ${errText(e)}`);
  } finally {
    st.setBusy(undefined);
  }
}

/** 최적화 결과를 한 줄로. 줄일 것이 없었다면 그 사실을 그대로 알린다. */
function describeStats(stats: OptimizeStats | undefined, opt: OptimizeOptions | undefined): string {
  if (!stats || !opt) return '';
  if (!stats.resampled) return ` — 줄일 이미지가 없습니다(모두 ${opt.dpi}dpi 이하이거나 흑백·특수 형식). 무손실로 저장했습니다.`;
  return ` — 이미지 ${stats.images}개 중 ${stats.resampled}개를 ${opt.dpi}dpi 로 조정, 이미지 용량 ${fmtSize(stats.bytesBefore)} → ${fmtSize(stats.bytesAfter)}`;
}

export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const fmtSec = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(2)}초`;
