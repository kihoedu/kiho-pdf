import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { filesFromDrop, pickPdfFiles, printPdf, savePdf } from './actions/io';
import { endGroupHere } from './actions/split';
import { PageView } from './components/PageView';
import { HelpDialog } from './components/HelpDialog';
import { SidePanel } from './components/SidePanel';
import { Thumbnails } from './components/Thumbnails';
import { TOP_PANE_BASE_HEIGHT } from './model/types';
import { TOOL_KEYS } from './model/ui';
import { confirmDiscard, unsavedWarning, useStore } from './store';

const SPLITTER = 7;
const MIN_TOP = 120;
const MIN_BOTTOM = 90;

export default function App() {
  const zoom = useStore((s) => s.zoom);
  const busy = useStore((s) => s.busy);
  const left = useRef<HTMLDivElement>(null);
  const [leftH, setLeftH] = useState(0);
  /** 사용자가 분할선을 끌어 정한 높이. 없으면 750px × 배율을 따른다. */
  const [manualTop, setManualTop] = useState<number>();
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const el = left.current!;
    const ro = new ResizeObserver(() => setLeftH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useShortcuts();

  const wanted = manualTop ?? Math.round(TOP_PANE_BASE_HEIGHT * zoom);
  const topH = Math.max(MIN_TOP, Math.min(wanted, leftH - SPLITTER - MIN_BOTTOM));

  const onSplitDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = topH;
    const el = e.currentTarget;
    const move = (ev: PointerEvent) => setManualTop(Math.max(MIN_TOP, startH + ev.clientY - startY));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div
      className={`app${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={async (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(false);
        const st = useStore.getState();
        const files = await filesFromDrop(e.dataTransfer);
        if (!files.length) return st.notify('error', 'PDF 파일만 열 수 있습니다.');
        const append = st.pages.length > 0 && e.shiftKey;
        if (!append && !confirmDiscard('새 파일을 열까요?')) return;
        await st.openFiles(files, append ? 'append' : 'replace');
      }}
    >
      <main className="left" ref={left}>
        <div className="pane-top" style={{ height: topH }}>
          <PageView />
        </div>
        <div
          className="splitter"
          style={{ height: SPLITTER }}
          onPointerDown={onSplitDown}
          onDoubleClick={() => setManualTop(undefined)}
          title="끌어서 높이 조절 · 더블클릭하면 자동(750px × 배율)"
        />
        <div className="pane-bottom">
          <Thumbnails />
        </div>
      </main>
      <SidePanel />
      {busy && (
        <div className="busy">
          <div className="spinner" />
          {busy}
        </div>
      )}
      <HelpDialog />
      <Toast />
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: undefined }), toast.kind === 'error' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} onClick={() => useStore.setState({ toast: undefined })}>
      {toast.text}
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // 도움말: F1 로 여닫고, 열려 있는 동안에는 Esc 로 닫기만 받는다(뒤의 문서가 움직이지 않게).
      if (key === 'f1') {
        e.preventDefault();
        st.setHelp(!st.helpOpen);
        return;
      }
      if (st.helpOpen) {
        if (key === 'escape') st.setHelp(false);
        return;
      }

      if (mod && key === 'o') {
        e.preventDefault();
        if (!confirmDiscard('계속할까요?')) return;
        pickPdfFiles(true).then((f) => {
          if (f.length) st.openFiles(f, 'replace');
        });
      } else if (mod && key === 's') {
        e.preventDefault();
        savePdf();
      } else if (mod && key === 'p') {
        e.preventDefault();
        printPdf();
      } else if (typing) {
        return; // 입력 중에는 아래 단축키를 쓰지 않는다(브라우저 기본 Ctrl+Z 등 유지)
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod || e.altKey) {
        return;
      } else if (key === 'arrowleft' || key === 'pageup') {
        e.preventDefault();
        st.setCurrent(st.current - 1);
      } else if (key === 'arrowright' || key === 'pagedown') {
        e.preventDefault();
        st.setCurrent(st.current + 1);
      } else if (key === 'home') {
        st.setCurrent(0);
      } else if (key === 'end') {
        st.setCurrent(st.pages.length - 1);
      } else if (key === 'enter' && st.tab === 'split') {
        e.preventDefault();
        endGroupHere();
      } else if (key in TOOL_KEYS && st.pages.length) {
        st.setTool(TOOL_KEYS[key]); // 도구가 속한 탭도 함께 열린다
      } else if (key === 'escape') {
        st.setTool('select');
      } else if ((key === 'delete' || key === 'backspace') && st.activeTextId) {
        // 선택한 삽입 항목 또는 캡처 영역 삭제
        const page = st.pages[st.current];
        if (st.captures.some((c) => c.id === st.activeTextId)) st.removeCapture(st.activeTextId);
        else if (page?.shapes.some((s) => s.id === st.activeTextId)) st.removeShape(page.uid, st.activeTextId);
        else if (page?.texts.some((t) => t.id === st.activeTextId)) st.removeText(page.uid, st.activeTextId);
      }
    };
    window.addEventListener('keydown', onKey);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (unsavedWarning()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);
}
