import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { remapRect, type Rect } from '../model/geometry';
import { layoutText, LINE_HEIGHT, neededHeight, TEXT_FONT_FAMILY, TEXT_PAD } from '../model/textLayout';
import type { TextBox } from '../model/types';
import { useStore } from '../store';
import type { PageGeom } from './PageView';

type Gesture = { kind: 'move' | 'resize'; sx: number; sy: number };

export function TextBoxView({ pageUid, tb, geom, active }: { pageUid: string; tb: TextBox; geom: PageGeom; active: boolean }) {
  const { scale } = geom;
  const delta = (geom.rot - tb.rot + 360) % 360; // 화면상 시계 방향 회전량
  const editable = active && delta === 0;
  const [draft, setDraft] = useState(tb.text);
  const [live, setLive] = useState<Partial<Rect>>(); // 이동/크기 조절 중의 임시 값(텍스트 상자 좌표계)
  const gesture = useRef<Gesture>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(tb.text), [tb.text]);

  const cur = { ...tb, ...live };
  const r = remapRect(cur, geom.box, tb.rot, geom.rot);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(cur.h * scale, el.scrollHeight)}px`;
  }, [draft, cur.h, cur.w, cur.size, scale, editable]);

  useEffect(() => {
    if (editable) area.current?.focus({ preventScroll: true });
  }, [editable]);

  const commitText = () => {
    const st = useStore.getState();
    if (!draft.trim() && !tb.text.trim()) {
      st.removeText(pageUid, tb.id);
      return;
    }
    const h = Math.max(tb.h, neededHeight(layoutText({ ...tb, text: draft }).length, tb.size));
    if (draft !== tb.text || h !== tb.h) st.updateText(pageUid, tb.id, { text: draft, h });
  };

  const startGesture = (kind: Gesture['kind']) => (e: RPointerEvent<HTMLElement>) => {
    e.preventDefault(); // 텍스트 입력 포커스 유지
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, sx: e.clientX, sy: e.clientY };
  };
  const moveGesture = (e: RPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    // 화면 이동량을 텍스트 상자 좌표계로 되돌린다(역회전).
    const rad = (delta * Math.PI) / 180;
    const dx = (e.clientX - g.sx) / scale;
    const dy = (e.clientY - g.sy) / scale;
    const u = dx * Math.cos(rad) + dy * Math.sin(rad);
    const v = -dx * Math.sin(rad) + dy * Math.cos(rad);
    setLive(
      g.kind === 'move'
        ? { x: tb.x + u, y: tb.y + v }
        : { w: Math.max(tb.size * 2, tb.w + u), h: Math.max(neededHeight(1, tb.size), tb.h + v) },
    );
  };
  const endGesture = () => {
    if (!gesture.current) return;
    gesture.current = undefined;
    if (live) useStore.getState().updateText(pageUid, tb.id, live);
    setLive(undefined);
  };

  const font = {
    fontFamily: TEXT_FONT_FAMILY,
    fontSize: cur.size * scale,
    lineHeight: LINE_HEIGHT,
    color: cur.color,
  };
  const lines = editable ? [] : layoutText(cur);

  return (
    <div
      className={`mark text-box${active ? ' active' : ''}`}
      style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!active) useStore.getState().setActiveText(tb.id);
      }}
    >
      <div
        className="text-inner"
        style={{
          width: cur.w * scale,
          height: cur.h * scale,
          left: ((r.w - cur.w) * scale) / 2,
          top: ((r.h - cur.h) * scale) / 2,
          transform: delta ? `rotate(${delta}deg)` : undefined,
        }}
      >
        {editable ? (
          <textarea
            ref={area}
            value={draft}
            spellCheck={false}
            style={{ ...font, padding: TEXT_PAD * scale }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.currentTarget.blur();
                useStore.getState().setActiveText(undefined);
              }
            }}
          />
        ) : (
          lines.map((l, i) => (
            <div key={i} className="text-line" style={{ ...font, top: l.top * scale, left: TEXT_PAD * scale }}>
              {l.text}
            </div>
          ))
        )}
        {active && (
          <>
            <div
              className="text-grip"
              title="끌어서 이동"
              onPointerDown={startGesture('move')}
              onPointerMove={moveGesture}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            >
              ⠿ 이동
              <button
                title="삭제"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  useStore.getState().removeText(pageUid, tb.id);
                }}
              >
                ✕
              </button>
            </div>
            <div
              className="text-resize"
              title="끌어서 크기 조절"
              onPointerDown={startGesture('resize')}
              onPointerMove={moveGesture}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            />
          </>
        )}
      </div>
    </div>
  );
}
