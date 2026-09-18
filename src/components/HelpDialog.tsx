import { useEffect, useRef } from 'react';
import { EXTRA, OVERVIEW, TAB_GUIDE, type GuideSection } from '../help/guide';
import { SHORTCUTS, TABS, TOOLS, type ShortcutDef, type Tab, type ToolDef } from '../model/ui';
import { useStore } from '../store';

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];
/** 도구 단축키를 단축키 표의 어느 묶음에 보여 줄지. */
const TOOL_GROUP: Partial<Record<Tab, ShortcutDef['group']>> = { edit: '편집', capture: '캡처' };

/** 사용법 가이드 팝업. 도구·단축키 표는 model/ui.ts 의 정의에서 바로 만들어진다. */
export function HelpDialog() {
  const open = useStore((s) => s.helpOpen);
  const tab = useStore((s) => s.tab);
  const body = useRef<HTMLDivElement>(null);
  const close = () => useStore.getState().setHelp(false);

  // 열 때 지금 보고 있던 탭의 설명으로 바로 이동한다.
  useEffect(() => {
    if (!open) return;
    // 포커스는 팝업 자체에 둔다([닫기] 버튼에 두면 Enter·Space 로 실수로 닫힌다).
    body.current?.focus();
    body.current?.querySelector(`#help-${tab}`)?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const jump = (id: string) => body.current?.querySelector(`#help-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  return (
    <div className="help-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="help" role="dialog" aria-modal="true" aria-label="도움말" tabIndex={-1} ref={body}>
        <header>
          <h2>Kiho PDF 사용법</h2>
          <button className="help-close" onClick={close} title="닫기 (Esc)">
            ✕ 닫기
          </button>
        </header>
        <nav>
          <a onClick={() => jump('overview')}>화면 구성</a>
          {TABS.map((t) => (
            <a key={t.id} onClick={() => jump(t.id)}>
              {t.label}
            </a>
          ))}
          <a onClick={() => jump('shortcuts')}>
            <b>단축키</b>
          </a>
        </nav>
        <div className="help-scroll">
          <Section id="overview" s={OVERVIEW} />
          {TABS.map((t) => (
            <Section key={t.id} id={t.id} s={TAB_GUIDE[t.id]}>
              {TOOLS.some((tool) => tool.tab === t.id) && (
                <table className="help-table">
                  <thead>
                    <tr>
                      <th>도구</th>
                      <th>키</th>
                      <th>사용법</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TOOLS.filter((tool) => tool.tab === t.id).map((tool) => (
                      <tr key={tool.id}>
                        <td className="nowrap">{tool.label}</td>
                        <td>
                          <kbd>{tool.key.toUpperCase()}</kbd>
                        </td>
                        <td>{tool.hint}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          ))}
          {EXTRA.map((s) => (
            <Section key={s.title} s={s} />
          ))}

          <section id="help-shortcuts">
            <h3>단축키</h3>
            <p className="muted">입력란에 글자를 치는 동안에는 한 글자 단축키와 이동 키가 동작하지 않습니다.</p>
            {GROUPS.map((g) => (
              <ShortcutTable key={g} title={g} rows={SHORTCUTS.filter((s) => s.group === g)} tools={TOOLS.filter((t) => TOOL_GROUP[t.tab] === g)} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, s, children }: { id?: string; s: GuideSection; children?: React.ReactNode }) {
  return (
    <section id={id ? `help-${id}` : undefined}>
      <h3>{s.title}</h3>
      <p className="help-summary">{s.summary}</p>
      <ul>
        {s.items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
      {children}
    </section>
  );
}

function ShortcutTable({ title, rows, tools }: { title: string; rows: ShortcutDef[]; tools: ToolDef[] }) {
  return (
    <table className="help-table">
      <thead>
        <tr>
          <th colSpan={2}>{title}</th>
        </tr>
      </thead>
      <tbody>
        {tools.map((t) => (
          <tr key={t.id}>
            <td className="nowrap">
              <kbd>{t.key.toUpperCase()}</kbd>
            </td>
            <td>{t.label.replace(/^\S+\s/, '')} 도구</td>
          </tr>
        ))}
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="nowrap">
              {r.keys.map((k, n) => (
                <span key={k}>
                  {n > 0 && ' / '}
                  <kbd>{k}</kbd>
                </span>
              ))}
            </td>
            <td>{r.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
