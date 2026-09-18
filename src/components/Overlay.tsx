import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { addCaptureRect, refreshPreview } from '../actions/capture';
import { boundsOf, remapPts, remapRect, viewSize, type Rect } from '../model/geometry';
import { ensureTextFont, neededHeight } from '../model/textLayout';
import { uid, type Capture, type PageItem, type Shape } from '../model/types';
import { useStore } from '../store';
import type { PageGeom } from './PageView';
import { TextBoxView } from './TextBoxView';

const MIN_DRAG_PX = 6;
const INK_STEP_PX = 2;
const NO_CAPTURES: Capture[] = [];

type Draft = { kind: 'box'; rect: Rect } | { kind: 'path'; pts: number[] };

/**
 * 페이지 위에 얹는 작업 층(삽입 텍스트·펜 선·캡처 영역). PDF 자체는 저장할 때까지 건드리지 않는다.
 * 선택 도구일 때는 빈 곳의 입력을 아래(본문 텍스트 선택)로 흘려보낸다.
 */
export function Overlay({ item, geom }: { item: PageItem; geom: PageGeom }) {
  const tool = useStore((s) => s.tool);
  const activeId = useStore((s) => s.activeTextId);
  const tab = useStore((s) => s.tab);
  const shapeStyle = useStore((s) => s.shapeStyle);
  // 캡처 영역은 캡처 탭에서만 보인다(편집 중에 거슬리지 않게).
  const captures = useStore((s) => (s.tab === 'capture' ? s.captures : NO_CAPTURES));
  const [fontReady, setFontReady] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const origin = useRef<{ x: number; y: number }>(undefined);
  const { scale } = geom;

  const needFont = tool === 'text' || item.texts.length > 0;
  useEffect(() => {
    if (!needFont || fontReady) return;
    let alive = true;
    ensureTextFont().then(
      () => alive && setFontReady(true),
      () => useStore.getState().notify('error', '텍스트 폰트를 불러오지 못했습니다.'),
    );
    return () => {
      alive = false;
    };
  }, [needFont, fontReady]);

  const local = (e: RPointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (tool === 'select' || e.button !== 0) return;
    if ((e.target as Element).closest('.mark')) return; // 기존 객체 위에서는 그 객체가 처리한다
    (document.activeElement as HTMLElement | null)?.blur?.(); // 편집 중이던 텍스트 확정
    useStore.getState().setActiveText(undefined);
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    origin.current = p;
    setDraft(tool === 'ink' ? { kind: 'path', pts: [p.x, p.y, p.x, p.y] } : { kind: 'box', rect: { ...p, w: 0, h: 0 } });
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const o = origin.current;
    if (!o || !draft) return;
    const p = local(e);
    if (draft.kind === 'box') {
      setDraft({ kind: 'box', rect: { x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) } });
    } else {
      const n = draft.pts.length;
      if (Math.hypot(p.x - draft.pts[n - 2], p.y - draft.pts[n - 1]) >= INK_STEP_PX) {
        setDraft({ kind: 'path', pts: [...draft.pts, p.x, p.y] });
      }
    }
  };

  const onUp = () => {
    const o = origin.current;
    const d = draft;
    origin.current = undefined;
    setDraft(undefined);
    if (!o || !d) return;
    const st = useStore.getState();
    const view = viewSize(geom.box, geom.rot);

    if (d.kind === 'path') {
      const pts = d.pts.map((v) => v / scale);
      const b = boundsOf(pts);
      if (Math.max(b.w, b.h) * scale < MIN_DRAG_PX) return;
      st.addShape(item.uid, { id: uid(), kind: 'ink', rot: geom.rot, pts, ...st.shapeStyle }, false);
      return;
    }

    const dragged = d.rect.w >= MIN_DRAG_PX && d.rect.h >= MIN_DRAG_PX;
    const r = { x: d.rect.x / scale, y: d.rect.y / scale, w: d.rect.w / scale, h: d.rect.h / scale };

    if (tool === 'capture') {
      if (!dragged) return;
      // 쪽 밖으로 나간 부분은 잘라 낸다.
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      const w = Math.min(view.w, r.x + r.w) - x;
      const h = Math.min(view.h, r.y + r.h) - y;
      if (w > 1 && h > 1) addCaptureRect(item.uid, { x, y, w, h }, geom.rot, st.captureFocusName);
    } else if (tool === 'text') {
      const { size, color } = st.textStyle;
      const minH = neededHeight(1, size);
      // 드래그 없이 클릭만 했으면 그 자리에서 기본 너비의 상자를 만든다.
      const x = dragged ? r.x : o.x / scale;
      const box = {
        id: uid(),
        rot: geom.rot,
        x,
        y: dragged ? r.y : o.y / scale - minH / 2,
        w: dragged ? r.w : Math.max(60, Math.min(260, view.w - x - 8)),
        h: Math.max(minH, dragged ? r.h : 0),
        text: '',
        size,
        color,
      };
      // 폰트를 아직 받는 중이어도 입력을 버리지 않는다(받자마자 상자가 생긴다).
      ensureTextFont().then(
        () => useStore.getState().addText(item.uid, box),
        () => {},
      );
    }
  };

  const mine = captures.filter((c) => c.pageUid === item.uid);
  const numberOf = new Map(captures.map((c, i) => [c.id, i + 1]));

  return (
    <div
      className={`overlay${tool !== 'select' ? ' creating' : ''}${tab === 'edit' ? ' edit-on' : ''}${tab === 'capture' ? ' capture-on' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {item.shapes.map((s) => (
        <InkView key={s.id} pageUid={item.uid} shape={s} geom={geom} active={s.id === activeId} />
      ))}
      {fontReady &&
        item.texts.map((tb) => <TextBoxView key={tb.id} pageUid={item.uid} tb={tb} geom={geom} active={tb.id === activeId} />)}
      {mine.map((c) => (
        <CaptureBox key={c.id} capture={c} no={numberOf.get(c.id)!} geom={geom} active={c.id === activeId} />
      ))}
      {draft?.kind === 'box' && (
        <div
          className={`draft-box${tool === 'capture' ? ' capture' : ''}`}
          style={{ left: draft.rect.x, top: draft.rect.y, width: draft.rect.w, height: draft.rect.h }}
        />
      )}
      {draft?.kind === 'path' && (
        <svg className="draft-path">
          <polyline points={draft.pts.join(' ')} stroke={shapeStyle.color} strokeWidth={shapeStyle.width * scale} />
        </svg>
      )}
    </div>
  );
}

interface Live {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}
const STILL: Live = { dx: 0, dy: 0, dw: 0, dh: 0 };

/** 끌어서 이동/크기 조절하는 공통 동작. 값은 현재 화면 회전 기준 pt. */
function useDragGesture(scale: number, onSelect: () => void, onCommit: (l: Live) => void) {
  const [live, setLive] = useState<Live>();
  const gesture = useRef<{ kind: 'move' | 'resize'; sx: number; sy: number }>(undefined);
  const start = (kind: 'move' | 'resize') => (e: RPointerEvent<Element>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, sx: e.clientX, sy: e.clientY };
    onSelect();
  };
  const move = (e: RPointerEvent<Element>) => {
    const g = gesture.current;
    if (!g) return;
    const mx = (e.clientX - g.sx) / scale;
    const my = (e.clientY - g.sy) / scale;
    setLive(g.kind === 'move' ? { dx: mx, dy: my, dw: 0, dh: 0 } : { dx: 0, dy: 0, dw: mx, dh: my });
  };
  const end = () => {
    if (!gesture.current) return;
    gesture.current = undefined;
    if (live && (live.dx || live.dy || live.dw || live.dh)) onCommit(live);
    setLive(undefined);
  };
  const handlers = (kind: 'move' | 'resize') => ({ onPointerDown: start(kind), onPointerMove: move, onPointerUp: end, onPointerCancel: end });
  return { live: live ?? STILL, handlers };
}

function InkView({ pageUid, shape: s, geom, active }: { pageUid: string; shape: Shape; geom: PageGeom; active: boolean }) {
  const { scale, box, rot } = geom;
  const base = remapPts(s.pts, box, s.rot, rot);
  const { live, handlers } = useDragGesture(
    scale,
    () => !active && useStore.getState().setActiveText(s.id),
    (l) => useStore.getState().updateShape(pageUid, s.id, { pts: remapPts(base.map((v, i) => v + (i % 2 ? l.dy : l.dx)), box, rot, s.rot) }),
  );
  const pts = base.map((v, i) => (v + (i % 2 ? live.dy : live.dx)) * scale);
  const b = boundsOf(pts);
  return (
    <>
      <svg className="mark shape-path">
        {/* 넓은 투명 선으로 집기 쉽게 한다 */}
        <polyline className="hit" points={pts.join(' ')} strokeWidth={Math.max(12, s.width * scale)} {...handlers('move')} />
        <polyline points={pts.join(' ')} stroke={s.color} strokeWidth={s.width * scale} />
      </svg>
      {active && (
        <div className="mark shape-frame" style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          <button
            className="shape-del"
            title="삭제 (Delete)"
            onPointerDown={(e) => {
              e.stopPropagation();
              useStore.getState().removeShape(pageUid, s.id);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

function CaptureBox({ capture: c, no, geom, active }: { capture: Capture; no: number; geom: PageGeom; active: boolean }) {
  const { scale, box, rot } = geom;
  const r = remapRect(c, box, c.rot, rot);
  const view = viewSize(box, rot);
  const { live, handlers } = useDragGesture(
    scale,
    () => !active && useStore.getState().setActiveText(c.id),
    (l) => {
      useStore.getState().updateCapture(c.id, remapRect(apply(l), box, rot, c.rot));
      void refreshPreview(c.id);
    },
  );
  /** 이동·크기 조절을 반영하되 쪽 안에 머물게 한다. */
  function apply(l: Live): Rect {
    const w = Math.max(4, Math.min(view.w, r.w + l.dw));
    const h = Math.max(4, Math.min(view.h, r.h + l.dh));
    return { x: Math.max(0, Math.min(view.w - w, r.x + l.dx)), y: Math.max(0, Math.min(view.h - h, r.y + l.dy)), w, h };
  }
  const cur = apply(live);
  return (
    <div
      className={`mark cap capture-box${active ? ' active' : ''}`}
      style={{ left: cur.x * scale, top: cur.y * scale, width: cur.w * scale, height: cur.h * scale }}
      {...handlers('move')}
    >
      <span className="capture-tag" title={c.name}>
        #{no} {c.name}
      </span>
      {active && (
        <>
          <button
            className="shape-del"
            title="캡처 영역 삭제 (Delete)"
            onPointerDown={(e) => {
              e.stopPropagation();
              useStore.getState().removeCapture(c.id);
            }}
          >
            ✕
          </button>
          <div className="text-resize" title="끌어서 크기 조절" {...handlers('resize')} />
        </>
      )}
    </div>
  );
}
