import { create } from 'zustand';
import type { PDFPageProxy } from 'pdfjs-dist';
import { devTune } from './devTune';
import { forgetSources, restoreSource } from './engine/client';
import { DEFAULT_CAPTURE_TEMPLATE, normalizeCaptures } from './model/captures';
import { decodeEdits, type PageEdits } from './model/editsCodec';
import { DEFAULT_TEMPLATE, normalize } from './model/groups';
import { addRot } from './model/geometry';
import {
  DEFAULT_ZOOM,
  uid,
  type Capture,
  type CaptureOptions,
  type PageItem,
  type Rot,
  type Shape,
  type SplitGroup,
  type TextBox,
} from './model/types';
import { toolDef, type Tab, type Tool } from './model/ui';
import { clearRenderCaches } from './pdf/caches';
import { clearPageTexts } from './pdf/pageText';
import { isPasswordError, openPdf, readDocFlags, type LoadedPdf } from './pdf/loader';

export interface Source {
  id: string;
  file: File;
  handle?: FileSystemFileHandle;
  name: string;
  loaded: LoadedPdf;
  pageCount: number;
  password?: string;
  /** 전자서명이 있는 문서. 수정·저장하면 서명이 무효가 되므로 저장 전에 한 번 확인한다. */
  signed: boolean;
}

export type { Tab, Tool } from './model/ui';

interface Snapshot {
  pages: PageItem[];
  groups: SplitGroup[];
  captures: Capture[];
}

interface State {
  sources: Record<string, Source>;
  /** 처음 연 문서(저장 파일명·이름 템플릿의 기준). */
  primaryId?: string;
  pages: PageItem[];
  current: number;
  selected: Set<string>;
  zoom: number;
  /** 위쪽 화면(현재 페이지 영역)의 크기(px). 너비/쪽 맞춤 계산용. */
  paneSize: { w: number; h: number };
  tab: Tab;
  tool: Tool;
  textStyle: { size: number; color: string };
  shapeStyle: { color: string; width: number };
  /** 선택된 텍스트 상자·펜 선·캡처 영역의 id. */
  activeTextId?: string;
  /** 캡처 목록(임시 보관). "모두 저장" 으로 한꺼번에 이미지 파일이 된다. */
  captures: Capture[];
  captureOptions: CaptureOptions;
  captureTemplate: string;
  /** 캡처 id → 목록에 보여 줄 작은 미리보기(blob URL). */
  previews: Record<string, string>;
  focusCaptureId?: string;
  /** 캡처 직후 이름 입력란으로 포커스를 옮길지. */
  captureFocusName: boolean;
  /** 캡처 목록에 아직 이미지 파일로 내보내지 않은 변경이 있다(목록은 임시 보관이라 닫으면 사라진다). */
  capturesUnsaved: boolean;
  groups: SplitGroup[];
  template: string;
  focusGroupId?: string;
  helpOpen: boolean;
  busy?: string;
  toast?: { kind: 'info' | 'error'; text: string };
  dirty: boolean;
  past: Snapshot[];
  future: Snapshot[];

  openFiles(items: { file: File; handle?: FileSystemFileHandle }[], mode: 'replace' | 'append'): Promise<void>;
  closeAll(): Promise<void>;
  setCurrent(i: number): void;
  setZoom(z: number): void;
  setTab(t: Tab): void;
  setTool(t: Tool): void;
  setTextStyle(p: Partial<State['textStyle']>): void;
  setActiveText(id?: string): void;
  select(uid: string, mode: 'single' | 'toggle' | 'range'): void;
  rotatePages(uids: string[], delta: number): void;
  deletePages(uids: string[]): void;
  movePages(uids: string[], toIndex: number): void;
  addText(pageUid: string, tb: TextBox): void;
  updateText(pageUid: string, id: string, patch: Partial<TextBox>): void;
  setPaneSize(w: number, h: number): void;
  removeText(pageUid: string, id: string): void;
  setShapeStyle(p: Partial<State['shapeStyle']>): void;
  addShape(pageUid: string, shape: Shape, keepActive?: boolean): void;
  updateShape(pageUid: string, id: string, patch: Partial<Shape>): void;
  removeShape(pageUid: string, id: string): void;
  addCapture(c: Capture, focus?: boolean): void;
  updateCapture(id: string, patch: Partial<Capture>): void;
  removeCapture(id: string): void;
  clearCaptures(): void;
  setCaptureOptions(p: Partial<CaptureOptions>): void;
  setCaptureTemplate(tpl: string): void;
  setPreview(id: string, url?: string): void;
  setCaptureFocusName(on: boolean): void;
  markCapturesSaved(): void;
  /** 저장본으로 다시 연 직후, 쪽 구성이 같은 이전 문서의 분할 그룹·캡처 목록을 이어받는다(실행 취소 기록 없이). */
  carryOver(groups: SplitGroup[], captures: Capture[], capturesUnsaved: boolean): void;
  setGroups(groups: SplitGroup[], focusId?: string): void;
  setTemplate(tpl: string): void;
  undo(): void;
  redo(): void;
  setHelp(open: boolean): void;
  setBusy(text?: string): void;
  notify(kind: 'info' | 'error', text: string): void;
  markSaved(): void;
}

const HISTORY_LIMIT = 100;

export const baseName = (s?: Source): string => (s ? s.name.replace(/\.pdf$/i, '') : '문서');

export const useStore = create<State>((set, get) => {
  /** pages/groups/captures 를 바꾸는 모든 편집은 여기를 거쳐 실행 취소 기록을 남긴다. */
  const commit = (next: Partial<Snapshot> & Partial<State>) => {
    const { pages, groups, captures, past, dirty, capturesUnsaved } = get();
    const nextCaptures = renameCaptures(next.captures ?? captures, next.pages ?? pages);
    // 캡처 목록만 바뀐 편집은 PDF 를 바꾸지 않으므로 "변경됨" 으로 치지 않고 따로 센다.
    const pdfChanged = !!next.pages || !!next.groups;
    set({
      ...next,
      captures: nextCaptures,
      capturesUnsaved: nextCaptures.length > 0 && (capturesUnsaved || !!next.captures || nextCaptures.length !== captures.length),
      past: [...past.slice(-HISTORY_LIMIT + 1), { pages, groups, captures }],
      future: [],
      dirty: dirty || pdfChanged,
    });
  };
  const primaryBase = () => {
    const s = get();
    return baseName(s.primaryId ? s.sources[s.primaryId] : undefined);
  };
  const renameCaptures = (captures: Capture[], pages: PageItem[]) =>
    normalizeCaptures(captures, pages, get().captureTemplate, primaryBase());
  const renormalize = (groups: SplitGroup[]) => normalize(groups, get().template, primaryBase());
  const mapPage = (pages: PageItem[], pageUid: string, fn: (p: PageItem) => PageItem) =>
    pages.map((p) => (p.uid === pageUid ? fn(p) : p));

  return {
    sources: {},
    pages: [],
    current: 0,
    selected: new Set(),
    zoom: DEFAULT_ZOOM,
    paneSize: { w: 0, h: 0 },
    tab: 'file',
    tool: 'select',
    textStyle: { size: 12, color: '#000000' },
    shapeStyle: { color: '#d63031', width: 1.5 },
    captures: [],
    captureOptions: { dpi: 300, format: 'png' },
    captureTemplate: DEFAULT_CAPTURE_TEMPLATE,
    previews: {},
    captureFocusName: false,
    capturesUnsaved: false,
    groups: [],
    template: DEFAULT_TEMPLATE,
    helpOpen: false,
    dirty: false,
    past: [],
    future: [],

    async openFiles(items, mode) {
      if (!items.length) return;
      if (mode === 'replace') await get().closeAll();
      set({ busy: '파일을 여는 중…' });
      try {
        for (const { file, handle } of items) {
          set({ busy: '파일을 여는 중…' });
          let password: string | undefined;
          let loaded: LoadedPdf;
          for (;;) {
            try {
              loaded = await openPdf(file, password);
              break;
            } catch (e) {
              if (!isPasswordError(e)) throw e;
              const input = window.prompt(`"${file.name}" 은(는) 암호로 보호되어 있습니다. 암호를 입력하세요.`);
              if (input === null) throw new Error('암호 입력이 취소되었습니다.');
              password = input;
            }
          }
          const id = uid();
          const flags = await readDocFlags(loaded.pdf);
          // 이 앱이 삽입 항목과 함께 저장한 파일이면, 그려 넣은 부분을 걷어 낸 PDF 로 바꿔 열고 항목을 되살린다.
          let source = file;
          const restored = new Map<number, PageEdits>();
          if (flags.kihoEdits && !devTune().noRestore) {
            set({ busy: '삽입한 텍스트·펜 선을 다시 편집할 수 있게 여는 중…' });
            try {
              const r = await restoreSource({ id, file, password });
              if (r.bytes) {
                const clean = new File([r.bytes as Uint8Array<ArrayBuffer>], file.name, { type: 'application/pdf', lastModified: file.lastModified });
                const reopened = await openPdf(clean);
                await loaded.destroy().catch(() => {});
                loaded = reopened;
                source = clean;
                password = undefined; // 저장 엔진이 다시 쓴 PDF 에는 암호가 없다
                for (const p of r.pages) {
                  const edits = decodeEdits(p.edits);
                  if (edits) restored.set(p.index, edits);
                }
              }
            } catch (e) {
              // 되살리지 못해도 파일은 그대로 열린다(삽입 항목은 본문에 고정된 채로 보인다).
              console.warn('삽입 항목을 되살리지 못했습니다', e);
              forgetSources([id]);
            }
          }
          const src: Source = {
            id,
            file: source,
            handle,
            name: file.name,
            loaded,
            pageCount: loaded.pdf.numPages,
            password,
            signed: flags.signed,
          };
          const newPages: PageItem[] = Array.from({ length: src.pageCount }, (_, i) => ({
            uid: uid(),
            srcId: src.id,
            srcIndex: i,
            userRot: 0 as Rot,
            texts: restored.get(i)?.texts ?? [],
            shapes: restored.get(i)?.shapes ?? [],
          }));
          const s = get();
          const first = s.pages.length === 0;
          if (first) {
            set({ sources: { ...s.sources, [src.id]: src }, primaryId: src.id, pages: newPages, current: 0 });
          } else {
            // 현재 페이지 뒤에 삽입
            const at = s.current + 1;
            set({ sources: { ...s.sources, [src.id]: src } });
            commit({ pages: [...s.pages.slice(0, at), ...newPages, ...s.pages.slice(at)] });
          }
        }
      } catch (e) {
        get().notify('error', `열기 실패: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        set({ busy: undefined });
      }
    },

    async closeAll() {
      const { sources, previews } = get();
      forgetSources();
      clearRenderCaches();
      clearPageTexts();
      Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
      set({
        captures: [],
        capturesUnsaved: false,
        previews: {},
        focusCaptureId: undefined,
        sources: {},
        primaryId: undefined,
        pages: [],
        current: 0,
        selected: new Set(),
        groups: [],
        past: [],
        future: [],
        dirty: false,
        activeTextId: undefined,
      });
      await Promise.all(Object.values(sources).map((s) => s.loaded.destroy().catch(() => {})));
    },

    setCurrent(i) {
      const n = get().pages.length;
      if (n) set({ current: Math.max(0, Math.min(n - 1, i)), activeTextId: undefined });
    },
    setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(8, Math.round(z * 100) / 100)) }),
    // 도구는 자기 탭에서만 쓴다: 다른 탭으로 가면 선택 도구로 돌아간다.
    setTab: (tab) => set(toolDef(get().tool).tab === tab ? { tab } : { tab, tool: 'select', activeTextId: undefined }),
    // 도구를 고르면 그 도구가 속한 탭이 열린다(선택 도구는 어느 탭에서나 쓴다).
    setTool: (tool) => set({ tool, tab: tool === 'select' ? get().tab : toolDef(tool).tab, activeTextId: undefined }),
    setTextStyle: (p) => set({ textStyle: { ...get().textStyle, ...p } }),
    setActiveText: (activeTextId) => set({ activeTextId }),

    select(pageUid, mode) {
      const { selected, pages, current } = get();
      const idx = pages.findIndex((p) => p.uid === pageUid);
      if (idx < 0) return;
      let next: Set<string>;
      if (mode === 'toggle') {
        next = new Set(selected);
        if (!next.delete(pageUid)) next.add(pageUid);
      } else if (mode === 'range') {
        const [a, b] = [Math.min(current, idx), Math.max(current, idx)];
        next = new Set(pages.slice(a, b + 1).map((p) => p.uid));
      } else {
        next = new Set([pageUid]);
      }
      set({ selected: next, ...(mode === 'range' ? {} : { current: idx, activeTextId: undefined }) });
    },

    rotatePages(uids, delta) {
      const ids = new Set(uids);
      commit({ pages: get().pages.map((p) => (ids.has(p.uid) ? { ...p, userRot: addRot(p.userRot, delta) } : p)) });
    },

    deletePages(uids) {
      const ids = new Set(uids);
      const { pages, current, groups } = get();
      const next = pages.filter((p) => !ids.has(p.uid));
      if (!next.length) {
        get().notify('error', '모든 페이지를 삭제할 수는 없습니다.');
        return;
      }
      const removedBefore = pages.slice(0, current).filter((p) => ids.has(p.uid)).length;
      commit({
        pages: next,
        current: Math.max(0, Math.min(next.length - 1, current - removedBefore)),
        selected: new Set(),
        // 페이지 구성이 바뀌면 범위를 새 쪽수에 맞춰 자른다.
        groups: renormalize(
          groups.filter((g) => g.start <= next.length).map((g) => ({ ...g, end: Math.min(g.end, next.length) })),
        ),
      });
    },

    movePages(uids, toIndex) {
      const ids = new Set(uids);
      const { pages, current } = get();
      const moving = pages.filter((p) => ids.has(p.uid));
      if (!moving.length) return;
      const insertAt = pages.slice(0, toIndex).filter((p) => !ids.has(p.uid)).length;
      const rest = pages.filter((p) => !ids.has(p.uid));
      const next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
      const curUid = pages[current]?.uid;
      commit({ pages: next, current: Math.max(0, next.findIndex((p) => p.uid === curUid)) });
    },

    addText(pageUid, tb) {
      commit({ pages: mapPage(get().pages, pageUid, (p) => ({ ...p, texts: [...p.texts, tb] })), activeTextId: tb.id });
    },

    updateText(pageUid, id, patch) {
      commit({
        pages: mapPage(get().pages, pageUid, (p) => ({
          ...p,
          texts: p.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      });
    },

    removeText(pageUid, id) {
      commit({
        pages: mapPage(get().pages, pageUid, (p) => ({ ...p, texts: p.texts.filter((t) => t.id !== id) })),
        activeTextId: undefined,
      });
    },

    setShapeStyle: (p) => set({ shapeStyle: { ...get().shapeStyle, ...p } }),

    addShape(pageUid, shape, keepActive = true) {
      commit({
        pages: mapPage(get().pages, pageUid, (p) => ({ ...p, shapes: [...p.shapes, shape] })),
        activeTextId: keepActive ? shape.id : undefined,
      });
    },

    updateShape(pageUid, id, patch) {
      commit({
        pages: mapPage(get().pages, pageUid, (p) => ({
          ...p,
          shapes: p.shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)),
        })),
      });
    },

    removeShape(pageUid, id) {
      commit({
        pages: mapPage(get().pages, pageUid, (p) => ({ ...p, shapes: p.shapes.filter((s) => s.id !== id) })),
        activeTextId: undefined,
      });
    },

    addCapture(c, focus = false) {
      commit({ captures: [...get().captures, c], activeTextId: c.id, focusCaptureId: focus ? c.id : undefined });
    },

    updateCapture(id, patch) {
      commit({ captures: get().captures.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    },

    removeCapture(id) {
      commit({ captures: get().captures.filter((c) => c.id !== id), activeTextId: undefined });
      get().setPreview(id);
    },

    clearCaptures() {
      commit({ captures: [], activeTextId: undefined });
    },

    setCaptureFocusName: (captureFocusName) => set({ captureFocusName }),
    markCapturesSaved: () => set({ capturesUnsaved: false }),
    carryOver(groups, captures, capturesUnsaved) {
      const kept = renameCaptures(captures, get().pages);
      set({ groups: renormalize(groups), captures: kept, capturesUnsaved: capturesUnsaved && kept.length > 0 });
    },
    setCaptureOptions: (p) => set({ captureOptions: { ...get().captureOptions, ...p } }),

    setCaptureTemplate(captureTemplate) {
      set({ captureTemplate });
      set({ captures: renameCaptures(get().captures, get().pages) });
    },

    setPreview(id, url) {
      const previews = { ...get().previews };
      if (previews[id]) URL.revokeObjectURL(previews[id]);
      if (url) previews[id] = url;
      else delete previews[id];
      set({ previews });
    },

    setGroups(groups, focusId) {
      commit({ groups: renormalize(groups), focusGroupId: focusId });
    },

    setTemplate(template) {
      set({ template });
      set({ groups: renormalize(get().groups) });
    },

    undo() {
      const { past, future, pages, groups, captures, current } = get();
      const prev = past.at(-1);
      if (!prev) return;
      set({
        ...prev,
        past: past.slice(0, -1),
        future: [{ pages, groups, captures }, ...future],
        current: Math.min(current, prev.pages.length - 1),
        activeTextId: undefined,
        capturesUnsaved: prev.captures.length > 0 && (get().capturesUnsaved || prev.captures !== captures),
        dirty: true,
      });
    },

    redo() {
      const { past, future, pages, groups, captures, current } = get();
      const next = future[0];
      if (!next) return;
      set({
        ...next,
        past: [...past, { pages, groups, captures }],
        future: future.slice(1),
        current: Math.min(current, next.pages.length - 1),
        activeTextId: undefined,
        capturesUnsaved: next.captures.length > 0 && (get().capturesUnsaved || next.captures !== captures),
        dirty: true,
      });
    },

    setPaneSize: (w, h) => set({ paneSize: { w, h } }),
    setHelp: (helpOpen) => set({ helpOpen }),
    setBusy: (busy) => set({ busy }),
    notify: (kind, text) => set({ toast: { kind, text } }),
    markSaved: () => set({ dirty: false }),
  };
});

/** 지금 문서를 닫으면 잃는 것이 있으면 그 설명을 돌려준다. */
export function unsavedWarning(): string | undefined {
  const s = useStore.getState();
  const parts: string[] = [];
  if (s.dirty) parts.push('저장하지 않은 변경 사항');
  if (s.capturesUnsaved && s.captures.length) parts.push(`아직 이미지 파일로 저장하지 않은 캡처 ${s.captures.length}장`);
  return parts.length ? `${parts.join('과(와) ')}이(가) 있습니다.` : undefined;
}

/** 문서를 닫거나 바꾸기 전에 확인한다. 잃을 것이 없으면 묻지 않는다. */
export function confirmDiscard(question: string): boolean {
  const warning = unsavedWarning();
  return !warning || window.confirm(`${warning} ${question}`);
}

export async function getPdfPage(item: PageItem): Promise<PDFPageProxy> {
  const src = useStore.getState().sources[item.srcId];
  if (!src) throw new Error('원본 문서를 찾을 수 없습니다.');
  return src.loaded.getPage(item.srcIndex);
}
