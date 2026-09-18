import { useEffect } from 'react';
import { ensureTextFont } from '../model/textLayout';
import { TOOLS, toolDef } from '../model/ui';
import { useStore } from '../store';

const COLORS = ['#000000', '#d63031', '#0652dd', '#009432'];
const EDIT_TOOLS = TOOLS.filter((t) => t.tab === 'edit');

export function EditTab() {
  const tool = useStore((s) => s.tool);
  const textStyle = useStore((s) => s.textStyle);
  const shapeStyle = useStore((s) => s.shapeStyle);
  const activeId = useStore((s) => s.activeTextId);
  const page = useStore((s) => s.pages[s.current]);
  const st = useStore.getState();
  // 편집 탭을 여는 순간 텍스트 폰트를 미리 받아 둔다(첫 입력이 기다리지 않도록).
  useEffect(() => void ensureTextFont().catch(() => {}), []);
  const activeText = page?.texts.find((t) => t.id === activeId);
  const activeInk = page?.shapes.find((s) => s.id === activeId);

  /** 선택된 항목이 있으면 그 항목에, 없으면 다음에 만들 항목의 기본값에 적용한다. */
  const applyText = (p: { size?: number; color?: string }) => {
    st.setTextStyle(p);
    if (activeText && page) st.updateText(page.uid, activeText.id, p);
  };
  const applyInk = (p: { color?: string; width?: number }) => {
    st.setShapeStyle(p);
    if (activeInk && page) st.updateShape(page.uid, activeInk.id, p);
  };

  const showText = tool === 'text' || !!activeText;
  const showInk = tool === 'ink' || !!activeInk;
  const inkColor = activeInk?.color ?? shapeStyle.color;
  const inkWidth = activeInk?.width ?? shapeStyle.width;

  return (
    <>
      <section>
        <h3>도구</h3>
        <div className="tool-grid">
          {EDIT_TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => st.setTool(t.id)} title={`단축키 ${t.key.toUpperCase()}`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="muted">{toolDef(tool).tab === 'edit' ? toolDef(tool).hint : toolDef('select').hint}</p>
      </section>

      {showText && (
        <section>
          <h3>{activeText ? '선택한 텍스트' : '새 텍스트 기본값'}</h3>
          <label className="field">
            <span>크기(pt)</span>
            <input
              type="number"
              min={4}
              max={200}
              value={activeText?.size ?? textStyle.size}
              onChange={(e) => applyText({ size: Math.max(4, Math.min(200, Number(e.target.value) || 12)) })}
            />
          </label>
          <div className="row">
            {[9, 10, 12, 14, 18, 24].map((s) => (
              <button key={s} className={(activeText?.size ?? textStyle.size) === s ? 'on' : ''} onClick={() => applyText({ size: s })}>
                {s}
              </button>
            ))}
          </div>
          <label className="field">
            <span>색</span>
            <input type="color" value={activeText?.color ?? textStyle.color} onChange={(e) => applyText({ color: e.target.value })} />
          </label>
          <div className="row">
            {COLORS.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} onClick={() => applyText({ color: c })} title={c} />
            ))}
          </div>
        </section>
      )}

      {showInk && (
        <section>
          <h3>{activeInk ? '선택한 펜 선' : '펜 기본값'}</h3>
          <label className="field">
            <span>색</span>
            <input type="color" value={inkColor} onChange={(e) => applyInk({ color: e.target.value })} />
          </label>
          <div className="row">
            {COLORS.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} onClick={() => applyInk({ color: c })} title={c} />
            ))}
          </div>
          <label className="field">
            <span>굵기(pt)</span>
            <input
              type="number"
              min={0.25}
              max={20}
              step={0.25}
              value={inkWidth}
              onChange={(e) => applyInk({ width: Math.max(0.25, Math.min(20, Number(e.target.value) || 1)) })}
            />
          </label>
          <div className="row">
            {[0.5, 1, 1.5, 3, 5].map((w) => (
              <button key={w} className={inkWidth === w ? 'on' : ''} onClick={() => applyInk({ width: w })}>
                {w}
              </button>
            ))}
          </div>
        </section>
      )}

      {page && page.texts.length + page.shapes.length > 0 && (
        <section>
          <h3>이 쪽의 삽입 항목 {page.texts.length + page.shapes.length}개</h3>
          <ul className="text-list">
            {page.texts.map((t) => (
              <li key={t.id} className={t.id === activeId ? 'on' : ''}>
                <a onClick={() => st.setActiveText(t.id)}>Ｔ {t.text.split('\n')[0] || '(빈 텍스트)'}</a>
                <button className="icon" onClick={() => st.removeText(page.uid, t.id)} title="삭제">
                  ✕
                </button>
              </li>
            ))}
            {page.shapes.map((s) => (
              <li key={s.id} className={s.id === activeId ? 'on' : ''}>
                <a onClick={() => st.setActiveText(s.id)}>
                  <span className="dot" style={{ background: s.color }} />펜
                </a>
                <button className="icon" onClick={() => st.removeShape(page.uid, s.id)} title="삭제">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted">
        삽입 항목은 저장 시 기존 내용을 건드리지 않고 새 콘텐츠 스트림으로 덧붙여집니다. 한글 폰트는 사용한 글자만 포함됩니다.
      </p>
    </>
  );
}
