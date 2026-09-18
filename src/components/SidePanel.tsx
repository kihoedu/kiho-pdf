import { useEffect, useRef, useState } from 'react';
import { pickPdfFiles, printPdf, saveGroups, savePdf } from '../actions/io';
import { clearSearch, runSearch, searchSummary, stepSearch } from '../actions/search';
import { endGroupHere } from '../actions/split';
import { addRot, viewSize } from '../model/geometry';
import { everyN, fromBookmarks, GROUP_COLORS, parseRangeList, unassignedPages, validate } from '../model/groups';
import { compactText } from '../model/search';
import { CSS_UNITS, type SplitGroup } from '../model/types';
import { pageBox, pageRot } from '../pdf/loader';
import { loadOutline, type OutlineEntry } from '../pdf/outline';
import { TABS } from '../model/ui';
import { confirmDiscard, getPdfPage, useStore } from '../store';
import { EditTab } from './EditTab';
import { CaptureTab } from './CaptureTab';

export function SidePanel() {
  const tab = useStore((s) => s.tab);
  const hasDoc = useStore((s) => s.pages.length > 0);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState();
  return (
    <aside className="side">
      <div className="side-top">
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => st.setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="row">
          <button disabled={!canUndo} onClick={st.undo} title="Ctrl+Z">
            ↶ 실행 취소
          </button>
          <button disabled={!canRedo} onClick={st.redo} title="Ctrl+Y">
            ↷ 다시 실행
          </button>
          <button className="help-btn" onClick={() => st.setHelp(true)} title="사용법과 단축키 (F1)">
            ? 도움말
          </button>
        </div>
      </div>
      <div className="side-body">
        {tab === 'file' && <FileTab />}
        {hasDoc && tab === 'view' && <ViewTab />}
        {hasDoc && tab === 'split' && <SplitTab />}
        {hasDoc && tab === 'pages' && <PagesTab />}
        {hasDoc && tab === 'edit' && <EditTab />}
        {hasDoc && tab === 'capture' && <CaptureTab />}
        {!hasDoc && tab !== 'file' && <p className="muted">먼저 PDF 파일을 여세요.</p>}
      </div>
    </aside>
  );
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function FileTab() {
  const sources = useStore((s) => s.sources);
  const pages = useStore((s) => s.pages);
  const dirty = useStore((s) => s.dirty);
  const st = useStore.getState();
  const hasDoc = pages.length > 0;

  const open = async (mode: 'replace' | 'append') => {
    if (mode === 'replace' && !confirmDiscard('계속할까요?')) return;
    const files = await pickPdfFiles(true);
    if (files.length) await st.openFiles(files, mode);
  };

  return (
    <>
      <section>
        <button className="primary" onClick={() => open('replace')} title="Ctrl+O">
          열기…
        </button>
        <button disabled={!hasDoc} onClick={() => open('append')}>
          다른 PDF 삽입(병합)…
        </button>
        <button disabled={!hasDoc} onClick={() => savePdf()} title="Ctrl+S">
          저장…
        </button>
        <button disabled={!hasDoc} onClick={printPdf} title="Ctrl+P">
          인쇄
        </button>
        <button
          disabled={!hasDoc}
          onClick={() => confirmDiscard('닫을까요?') && st.closeAll()}
        >
          닫기
        </button>
      </section>
      {hasDoc && (
        <section>
          <h3>문서 정보</h3>
          <table className="info">
            <tbody>
              {Object.values(sources).map((s) => (
                <tr key={s.id}>
                  <td title={s.name}>{s.name}</td>
                  <td>{s.pageCount}쪽</td>
                  <td>{fmtSize(s.file.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            현재 구성 {pages.length}쪽{dirty ? ' · 변경됨' : ''}
          </p>
          <p className="muted">저장은 무손실입니다. 이미지·폰트 데이터는 재압축 없이 그대로 복사됩니다.</p>
          {Object.values(sources).some((s) => s.signed) && (
            <p className="warn">전자서명이 있는 문서입니다. 이 앱으로 저장한 파일에서는 서명이 무효가 됩니다.</p>
          )}
        </section>
      )}
      {hasDoc && <OptimizeSection />}
    </>
  );
}

/** 선택 기능: OCR 품질을 지키는 범위에서만 이미지를 줄여 저장한다. 기본 저장에는 영향이 없다. */
function OptimizeSection() {
  const [dpi, setDpi] = useState(300);
  const [quality, setQuality] = useState(0.9);
  return (
    <section>
      <h3>용량 최적화 저장 (선택)</h3>
      <label className="field">
        <span>기준 해상도</span>
        <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
          <option value={300}>300 dpi (OCR 권장 최소)</option>
          <option value={400}>400 dpi</option>
          <option value={600}>600 dpi</option>
        </select>
      </label>
      <label className="field">
        <span>JPEG 품질</span>
        <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
          <option value={0.95}>매우 높음 (95)</option>
          <option value={0.9}>높음 (90)</option>
          <option value={0.85}>보통 (85)</option>
        </select>
      </label>
      <button onClick={() => savePdf(undefined, undefined, { dpi, quality })}>최적화하여 다른 이름으로 저장…</button>
      <p className="muted">
        기준 해상도를 <b>넘는</b> 회색조·컬러 이미지만 기준 해상도까지 줄입니다. 기준 이하인 이미지, 흑백(1비트) 스캔, 마스크·
        투명도가 있는 이미지는 그대로 둡니다. 원본 파일은 바뀌지 않습니다.
      </p>
    </section>
  );
}

function useOutline(): OutlineEntry[] {
  const primary = useStore((s) => (s.primaryId ? s.sources[s.primaryId] : undefined));
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  useEffect(() => {
    let alive = true;
    setOutline([]);
    if (primary) loadOutline(primary.loaded.pdf).then((o) => alive && setOutline(o), () => {});
    return () => {
      alive = false;
    };
  }, [primary]);
  return outline;
}

/** 원본 쪽 번호 → 현재 페이지 구성에서의 위치(0-based), 없으면 -1. */
function locate(srcIndex: number): number {
  const s = useStore.getState();
  return s.pages.findIndex((p) => p.srcId === s.primaryId && p.srcIndex === srcIndex);
}

function ViewTab() {
  const current = useStore((s) => s.current);
  const count = useStore((s) => s.pages.length);
  const zoom = useStore((s) => s.zoom);
  const outline = useOutline();
  const st = useStore.getState();

  const fit = async (mode: 'width' | 'page') => {
    const s = useStore.getState();
    const item = s.pages[s.current];
    const page = await getPdfPage(item);
    const v = viewSize(pageBox(page), addRot(pageRot(page), item.userRot));
    const w = (s.paneSize.w - 40) / (v.w * CSS_UNITS);
    const h = (s.paneSize.h - 24) / (v.h * CSS_UNITS);
    s.setZoom(mode === 'width' ? w : Math.min(w, h));
  };

  return (
    <>
      <FindSection />
      <section>
        <h3>페이지 이동</h3>
        <div className="row">
          <button onClick={() => st.setCurrent(0)} title="Home">⏮</button>
          <button onClick={() => st.setCurrent(current - 1)} title="←">◀</button>
          <PageInput />
          <span className="muted">/ {count}</span>
          <button onClick={() => st.setCurrent(current + 1)} title="→">▶</button>
          <button onClick={() => st.setCurrent(count - 1)} title="End">⏭</button>
        </div>
      </section>
      <section>
        <h3>배율</h3>
        <div className="row">
          <button onClick={() => st.setZoom(zoom / 1.1)}>−</button>
          <span className="zoom-val">{Math.round(zoom * 100)}%</span>
          <button onClick={() => st.setZoom(zoom * 1.1)}>＋</button>
        </div>
        <div className="row">
          {[0.5, 0.75, 1, 1.5].map((z) => (
            <button key={z} className={Math.abs(zoom - z) < 0.005 ? 'on' : ''} onClick={() => st.setZoom(z)}>
              {z * 100}%
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => fit('width')}>너비 맞춤</button>
          <button onClick={() => fit('page')}>쪽 맞춤</button>
        </div>
        <p className="muted">Ctrl+휠로도 확대/축소할 수 있습니다. 위쪽 화면 높이는 750px × 배율로 맞춰집니다.</p>
      </section>
      <section>
        <h3>목차</h3>
        {outline.length ? (
          <ul className="outline">
            {outline.map((o, i) => (
              <li key={i} style={{ paddingLeft: o.depth * 12 }}>
                <a
                  onClick={() => {
                    const at = locate(o.srcIndex);
                    if (at >= 0) st.setCurrent(at);
                  }}
                >
                  {o.title || '(제목 없음)'}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">목차(북마크)가 없습니다.</p>
        )}
      </section>
    </>
  );
}

/** 본문 찾기. 문서 전체에서 찾아 일치한 곳을 차례로 오간다(Ctrl+F 로 이 칸에 온다). */
function FindSection() {
  const search = useStore((s) => s.search);
  const focusTick = useStore((s) => s.searchFocusTick);
  // 아래 두 값은 "n / 전체" 를 다시 계산하게 하려고 구독한다.
  useStore((s) => s.searchPos);
  useStore((s) => s.pages);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(search.raw); // 다른 탭에 다녀와도 찾던 말이 남아 있게

  useEffect(() => {
    if (!focusTick) return;
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);
  // 문서를 닫으면 찾던 말도 비운다.
  useEffect(() => {
    if (!search.query && !search.running) setText((t) => (compactText(t) ? '' : t));
  }, [search]);

  const go = (dir: 1 | -1) => {
    if (compactText(text) !== search.query) void runSearch(text);
    else stepSearch(dir);
  };
  const { ordinal, total } = searchSummary();
  const status = !search.query
    ? '띄어쓰기와 대소문자는 구분하지 않습니다.'
    : search.running
      ? `찾는 중… ${search.done}/${search.total}쪽 · ${total}곳`
      : total
        ? `${ordinal} / ${total}곳`
        : '찾는 말이 없습니다. (스캔 이미지로만 된 쪽에는 글자가 없습니다)';

  return (
    <section>
      <h3>본문 찾기</h3>
      <div className="row">
        <input
          ref={input}
          className="find-input"
          type="search"
          placeholder="찾을 말"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) clearSearch();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.currentTarget.blur();
            }
          }}
        />
        <button onClick={() => go(-1)} disabled={!compactText(text)} title="이전 (Shift+Enter)">
          ◀
        </button>
        <button onClick={() => go(1)} disabled={!compactText(text)} title="다음 (Enter)">
          ▶
        </button>
      </div>
      <p className="muted find-status">{status}</p>
    </section>
  );
}

function PageInput() {
  const current = useStore((s) => s.current);
  const [v, setV] = useState(String(current + 1));
  useEffect(() => setV(String(current + 1)), [current]);
  const go = () => {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) useStore.getState().setCurrent(n - 1);
    else setV(String(current + 1));
  };
  return (
    <input
      className="page-input"
      value={v}
      inputMode="numeric"
      onChange={(e) => setV(e.target.value)}
      onBlur={go}
      onKeyDown={(e) => e.key === 'Enter' && (go(), e.currentTarget.blur())}
    />
  );
}

function SplitTab() {
  const groups = useStore((s) => s.groups);
  const count = useStore((s) => s.pages.length);
  const current = useStore((s) => s.current);
  const template = useStore((s) => s.template);
  const focusId = useStore((s) => s.focusGroupId);
  const outline = useOutline();
  const [n, setN] = useState(10);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const st = useStore.getState();
  const issues = validate(groups, count);
  const unassigned = unassignedPages(groups, count);

  const confirmReplace = () => !groups.length || window.confirm('현재 그룹 목록을 새로 만든 목록으로 바꿉니다.');

  const byBookmarks = (maxDepth: number) => {
    if (!confirmReplace()) return;
    const items = outline
      .filter((o) => o.depth <= maxDepth)
      .map((o) => ({ title: o.title, page: locate(o.srcIndex) + 1 }))
      .filter((o) => o.page >= 1);
    if (!items.length) return st.notify('error', '사용할 수 있는 북마크가 없습니다.');
    st.setGroups(fromBookmarks(items, count));
  };

  const applyPaste = () => {
    const { groups: gs, errors } = parseRangeList(paste);
    if (errors.length) return st.notify('error', errors[0]);
    if (!gs.length || !confirmReplace()) return;
    st.setGroups(gs);
    setShowPaste(false);
  };

  return (
    <>
      <section>
        <h3>빠른 흐름</h3>
        <button className="primary" onClick={() => endGroupHere()} title="Enter">
          현재 쪽({current + 1})에서 그룹 종료 ⏎
        </button>
        <p className="muted">
          문서를 넘기다가 묶음의 마지막 쪽에서 <kbd>Enter</kbd> → 파일명 입력 → <kbd>Enter</kbd> 를 반복하세요. 아래
          썸네일 사이의 ✂ 를 눌러도 분할 지점이 토글됩니다.
        </p>
      </section>

      <section>
        <h3>자동 생성</h3>
        <div className="row">
          <input
            type="number"
            min={1}
            value={n}
            onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 64 }}
          />
          <span>쪽마다</span>
          <button onClick={() => confirmReplace() && st.setGroups(everyN(count, n))}>분할</button>
        </div>
        <div className="row">
          <button disabled={!outline.length} onClick={() => byBookmarks(0)}>
            북마크(1단계) 기준
          </button>
          <button disabled={!outline.length} onClick={() => byBookmarks(99)}>
            북마크 전체
          </button>
        </div>
        <div className="row">
          <button onClick={() => setShowPaste((v) => !v)}>범위 목록 붙여넣기…</button>
        </div>
        {showPaste && (
          <>
            <textarea
              className="paste"
              rows={6}
              placeholder={'한 줄에 하나씩:\n1-5 계약서\n6-12 부속서\n13 영수증'}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button onClick={applyPaste}>목록 적용</button>
          </>
        )}
        <label className="field">
          <span>이름 템플릿</span>
          <input value={template} onChange={(e) => st.setTemplate(e.target.value)} />
        </label>
        <p className="muted">{'{원본} {번호:02} {시작} {끝} {쪽수}'} — 직접 입력한 이름은 유지됩니다.</p>
      </section>

      <section>
        <h3>
          그룹 {groups.length}개
          {unassigned > 0 && groups.length > 0 && <span className="warn"> · 미할당 {unassigned}쪽(저장 안 됨)</span>}
        </h3>
        {groups.length > 0 && (
          <table className="groups">
            <thead>
              <tr>
                <th>#</th>
                <th>범위</th>
                <th>파일명</th>
                <th>쪽</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <GroupRow
                  key={g.id}
                  g={g}
                  no={i + 1}
                  focus={g.id === focusId}
                  issue={issues.find((x) => x.id === g.id)?.message}
                />
              ))}
            </tbody>
          </table>
        )}
        <div className="row">
          <button className="primary" disabled={!groups.length || issues.length > 0} onClick={saveGroups}>
            모두 저장… ({groups.length}개)
          </button>
          <button disabled={!groups.length} onClick={() => st.setGroups([])}>
            모두 지우기
          </button>
        </div>
      </section>
    </>
  );
}

function GroupRow({ g, no, focus, issue }: { g: SplitGroup; no: number; focus: boolean; issue?: string }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [range, setRange] = useState(`${g.start}-${g.end}`);
  const [name, setName] = useState(g.name);
  useEffect(() => setRange(`${g.start}-${g.end}`), [g.start, g.end]);
  useEffect(() => setName(g.name), [g.name]);
  useEffect(() => {
    if (focus) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [focus]);

  const patch = (p: Partial<SplitGroup>) => {
    const st = useStore.getState();
    st.setGroups(st.groups.map((x) => (x.id === g.id ? { ...x, ...p } : x)));
  };
  const commitRange = () => {
    const m = /^\s*(\d+)\s*(?:[-~–]\s*(\d+))?\s*$/.exec(range);
    if (!m) return setRange(`${g.start}-${g.end}`);
    const start = Number(m[1]);
    const end = Number(m[2] ?? m[1]);
    if (start !== g.start || end !== g.end) patch({ start, end });
  };
  const commitName = () => {
    const v = name.trim();
    if (v === g.name) return;
    // 비우면 자동 이름으로 되돌린다.
    patch(v ? { name: v, auto: false } : { auto: true });
  };

  return (
    <>
      <tr className={issue ? 'bad' : ''}>
        <td>
          <span className="dot" style={{ background: GROUP_COLORS[(no - 1) % GROUP_COLORS.length] }} />
          {no}
        </td>
        <td>
          <input
            className="range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            onBlur={commitRange}
            onFocus={() => useStore.getState().setCurrent(g.start - 1)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </td>
        <td>
          <input
            ref={nameRef}
            className="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.currentTarget.blur();
              // 이름을 확정하면 다음 묶음의 첫 쪽으로 넘어간다.
              const st = useStore.getState();
              if (g.end < st.pages.length) st.setCurrent(g.end);
            }}
          />
        </td>
        <td className="num">{g.end - g.start + 1}</td>
        <td>
          <button
            className="icon"
            title="그룹 삭제"
            onClick={() => {
              const st = useStore.getState();
              st.setGroups(st.groups.filter((x) => x.id !== g.id));
            }}
          >
            ✕
          </button>
        </td>
      </tr>
      {issue && (
        <tr className="issue">
          <td />
          <td colSpan={4}>{issue}</td>
        </tr>
      )}
    </>
  );
}

function PagesTab() {
  const pages = useStore((s) => s.pages);
  const selected = useStore((s) => s.selected);
  const current = useStore((s) => s.current);
  const st = useStore.getState();
  const targets = selected.size ? pages.filter((p) => selected.has(p.uid)) : pages[current] ? [pages[current]] : [];
  const ids = targets.map((p) => p.uid);
  const label = selected.size > 1 ? `선택한 ${selected.size}쪽` : `${(selected.size ? pages.findIndex((p) => p.uid === ids[0]) : current) + 1}쪽`;

  return (
    <>
      <section>
        <h3>대상: {label}</h3>
        <p className="muted">썸네일을 Ctrl/Shift+클릭하면 여러 쪽을 선택합니다. 썸네일을 끌어서 순서를 바꿀 수 있습니다.</p>
        <div className="row">
          <button onClick={() => st.rotatePages(ids, -90)}>⟲ 왼쪽 회전</button>
          <button onClick={() => st.rotatePages(ids, 90)}>⟳ 오른쪽 회전</button>
        </div>
        <div className="row">
          <button onClick={() => st.rotatePages(ids, 180)}>180° 회전</button>
          <button onClick={() => st.rotatePages(pages.map((p) => p.uid), 90)}>전체 ⟳</button>
        </div>
        <button onClick={() => savePdf(targets, `${label.replace(/\s/g, '')}_추출`)}>추출하여 저장…</button>
        <button
          className="danger"
          onClick={() => window.confirm(`${label}을(를) 삭제할까요? (실행 취소 가능)`) && st.deletePages(ids)}
        >
          삭제
        </button>
      </section>
      <section>
        <h3>이동</h3>
        <div className="row">
          <button onClick={() => st.movePages(ids, 0)}>맨 앞으로</button>
          <button onClick={() => st.movePages(ids, pages.length)}>맨 뒤로</button>
        </div>
      </section>
    </>
  );
}
