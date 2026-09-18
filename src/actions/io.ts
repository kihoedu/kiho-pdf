import { zipSync } from 'fflate';
import { buildOutputs, type OutputHandler } from '../engine/client';
import type { OptimizeOptions, OptimizeStats, OutputPlan, PagePlan, ShapeDraw, TextDraw } from '../engine/protocol';
import { viewToPdf } from '../model/geometry';
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
      return { srcId: p.srcId, srcIndex: p.srcIndex, addRotate: p.userRot, texts, shapes };
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
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 지정한 페이지들을 하나의 PDF 로 저장한다. pages 생략 시 문서 전체. */
export async function savePdf(pages?: PageItem[], suggested?: string, optimize?: OptimizeOptions): Promise<void> {
  const st = useStore.getState();
  const whole = !pages;
  const list = pages ?? st.pages;
  if (!list.length) return;
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
          await st.openFiles([{ file: await handle.getFile(), handle }], 'replace');
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
