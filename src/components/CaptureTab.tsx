import { useEffect, useRef, useState } from 'react';
import { captureWholePage, copyCapture, saveCaptures } from '../actions/capture';
import { CAPTURE_DPIS, capturePixels, orientedSize, validateCaptures } from '../model/captures';
import type { Capture } from '../model/types';
import { toolDef } from '../model/ui';
import { useStore } from '../store';

const CAPTURE_TOOL = toolDef('capture');

/** 영역 캡처: 끌어 담은 영역을 목록에 모아 두었다가 한꺼번에 이미지 파일로 내보낸다. */
export function CaptureTab() {
  const tool = useStore((s) => s.tool);
  const captures = useStore((s) => s.captures);
  const pages = useStore((s) => s.pages);
  const opt = useStore((s) => s.captureOptions);
  const template = useStore((s) => s.captureTemplate);
  const focusName = useStore((s) => s.captureFocusName);
  const focusId = useStore((s) => s.focusCaptureId);
  const st = useStore.getState();
  const issues = validateCaptures(captures);
  const pageNo = new Map(pages.map((p, i) => [p.uid, i + 1]));

  return (
    <>
      <section>
        <h3>캡처</h3>
        <button className={tool === 'capture' ? 'primary' : ''} onClick={() => st.setTool(tool === 'capture' ? 'select' : 'capture')} title={`단축키 ${CAPTURE_TOOL.key.toUpperCase()}`}>
          {CAPTURE_TOOL.label} {tool === 'capture' ? '— 켜짐 (Esc 로 끄기)' : '시작'}
        </button>
        <button onClick={captureWholePage}>현재 쪽 전체 담기</button>
        <p className="muted">{CAPTURE_TOOL.hint} 담긴 영역을 고치려면 Esc 로 도구를 끈 뒤 상자를 끌어 옮기거나 모서리로 크기를 바꾸세요.</p>
        <label className="check">
          <input type="checkbox" checked={focusName} onChange={(e) => st.setCaptureFocusName(e.target.checked)} />
          캡처할 때마다 바로 이름 입력
        </label>
      </section>

      <section>
        <h3>내보내기 설정</h3>
        <label className="field">
          <span>해상도</span>
          <select value={opt.dpi} onChange={(e) => st.setCaptureOptions({ dpi: Number(e.target.value) })}>
            {CAPTURE_DPIS.map((d) => (
              <option key={d} value={d}>
                {d} dpi{d === 96 ? ' (화면)' : d === 300 ? ' (인쇄·OCR 권장)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>형식</span>
          <select value={opt.format} onChange={(e) => st.setCaptureOptions({ format: e.target.value as 'png' | 'jpeg' })}>
            <option value="png">PNG (무손실)</option>
            <option value="jpeg">JPEG (작은 용량)</option>
          </select>
        </label>
        <label className="field">
          <span>이름 템플릿</span>
          <input value={template} onChange={(e) => st.setCaptureTemplate(e.target.value)} />
        </label>
        <p className="muted">{'{원본} {쪽} {번호:02}'} — 직접 입력한 이름은 유지됩니다. 화면 배율과 상관없이 PDF 에서 이 해상도로 다시 그립니다.</p>
      </section>

      <section>
        <h3>캡처 목록 {captures.length}개</h3>
        {captures.length === 0 && <p className="muted">아직 담긴 캡처가 없습니다.</p>}
        <ul className="captures">
          {captures.map((c, i) => (
            <CaptureRow
              key={c.id}
              c={c}
              no={i + 1}
              pageNo={pageNo.get(c.pageUid) ?? 0}
              dpi={opt.dpi}
              focus={c.id === focusId}
              issue={issues.find((x) => x.id === c.id)?.message}
            />
          ))}
        </ul>
        <div className="row">
          <button className="primary" disabled={!captures.length || issues.length > 0} onClick={saveCaptures}>
            모두 저장… ({captures.length}개)
          </button>
          <button disabled={!captures.length} onClick={() => st.clearCaptures()}>
            모두 지우기
          </button>
        </div>
      </section>
    </>
  );
}

function CaptureRow({ c, no, pageNo, dpi, focus, issue }: { c: Capture; no: number; pageNo: number; dpi: number; focus: boolean; issue?: string }) {
  const preview = useStore((s) => s.previews[c.id]);
  const active = useStore((s) => s.activeTextId === c.id);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(c.name);
  useEffect(() => setName(c.name), [c.name]);
  useEffect(() => {
    if (focus) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [focus]);

  const pageUserRot = useStore((s) => s.pages.find((p) => p.uid === c.pageUid)?.userRot ?? c.userRot);
  const px = capturePixels(orientedSize(c, pageUserRot), dpi);
  const show = () => {
    const st = useStore.getState();
    const i = st.pages.findIndex((p) => p.uid === c.pageUid);
    if (i >= 0 && i !== st.current) st.setCurrent(i);
    st.setActiveText(c.id);
  };
  const commitName = () => {
    const v = name.trim();
    if (v === c.name) return;
    // 비우면 자동 이름으로 되돌린다.
    useStore.getState().updateCapture(c.id, v ? { name: v, auto: false } : { auto: true });
  };

  return (
    <li className={`${active ? 'on' : ''}${issue ? ' bad' : ''}`}>
      <button className="capture-thumb" onClick={show} title={`${pageNo}쪽으로 이동`}>
        {preview ? <img src={preview} alt="" /> : <span className="muted">…</span>}
      </button>
      <div className="capture-meta">
        <input
          ref={nameRef}
          className="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className="muted">
          #{no} · {pageNo}쪽 · {px.w}×{px.h}px
        </span>
        {issue && <span className="issue-text">{issue}</span>}
      </div>
      <div className="capture-actions">
        <button className="icon" title="이 캡처를 클립보드에 복사" onClick={() => copyCapture(c.id)}>
          ⧉
        </button>
        <button className="icon" title="삭제" onClick={() => useStore.getState().removeCapture(c.id)}>
          ✕
        </button>
      </div>
    </li>
  );
}
