import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { GROUP_COLORS, groupIndexByPage, toggleCut } from '../model/groups';
import { hasEdits, type PageItem } from '../model/types';
import { thumbQueue } from '../pdf/caches';
import { renderThumb } from '../pdf/thumbs';
import { useStore } from '../store';

const THUMB_W = 120;
const THUMB_H = 160;
const CELL_W = 144;
const CELL_H = 196;
const PAD = 8;
/** 화면 밖으로 미리 그려 두는 줄 수. 가는 방향은 더 넉넉히 잡아 스크롤을 따라가게 한다. */
const OVERSCAN_AHEAD = 4;
const OVERSCAN_BEHIND = 2;


export function Thumbnails() {
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.current);
  const selected = useStore((s) => s.selected);
  const groups = useStore((s) => s.groups);
  const splitMode = useStore((s) => s.tab === 'split');
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [dropAt, setDropAt] = useState<number>();
  // 아래로 굴리는 중이면 아래쪽을, 위로 굴리는 중이면 위쪽을 더 미리 그린다.
  const down = useRef(true);
  const lastTop = useRef(0);

  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((width - PAD * 2) / CELL_W));
  const rows = Math.ceil(pages.length / cols);

  // 현재 페이지의 썸네일이 보이도록 스크롤
  useEffect(() => {
    const el = host.current;
    if (!el || !pages.length) return;
    const top = PAD + Math.floor(current / cols) * CELL_H;
    if (top < el.scrollTop) el.scrollTop = top - PAD;
    else if (top + CELL_H > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL_H - el.clientHeight + PAD;
  }, [current, cols, pages.length]);

  const groupOf = useMemo(() => groupIndexByPage(groups, pages.length), [groups, pages.length]);

  const firstRow = Math.max(0, Math.floor((scrollTop - PAD) / CELL_H) - (down.current ? OVERSCAN_BEHIND : OVERSCAN_AHEAD));
  const lastRow = Math.min(rows - 1, Math.floor((scrollTop + height) / CELL_H) + (down.current ? OVERSCAN_AHEAD : OVERSCAN_BEHIND));
  const from = firstRow * cols;
  const to = Math.min(pages.length, (lastRow + 1) * cols);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const at = dropAt;
    setDropAt(undefined);
    const raw = e.dataTransfer.getData('application/x-kiho-pages');
    if (raw && at !== undefined) useStore.getState().movePages(JSON.parse(raw) as string[], at);
  };

  return (
    <div
      className="thumbs"
      ref={host}
      onScroll={(e) => {
        // currentTarget 은 핸들러가 끝나면 비워지므로 여기서 값을 꺼내 둔다(상태 갱신 함수 안에서 읽으면 null 이다).
        const top = e.currentTarget.scrollTop;
        if (top !== lastTop.current) down.current = top > lastTop.current;
        lastTop.current = top;
        setScrollTop(top);
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-kiho-pages') && e.preventDefault()}
      onDrop={onDrop}
      onDragLeave={(e) => e.currentTarget === e.target && setDropAt(undefined)}
    >
      <div style={{ height: rows * CELL_H + PAD * 2, position: 'relative' }}>
        {pages.slice(from, to).map((p, k) => {
          const i = from + k;
          const pageNo = i + 1;
          const g = groupOf[pageNo];
          const boundary = pageNo < pages.length && g !== groupOf[pageNo + 1];
          return (
            <Thumb
              key={p.uid}
              item={p}
              index={i}
              left={PAD + (i % cols) * CELL_W}
              top={PAD + Math.floor(i / cols) * CELL_H}
              isCurrent={i === current}
              isSelected={selected.has(p.uid)}
              color={g >= 0 ? GROUP_COLORS[g % GROUP_COLORS.length] : undefined}
              groupNo={g >= 0 && (pageNo === 1 || groupOf[pageNo - 1] !== g) ? g + 1 : undefined}
              cut={splitMode && pageNo < pages.length ? (boundary ? 'on' : 'off') : undefined}
              dropMark={dropAt === i ? 'before' : dropAt === i + 1 && (i + 1) % cols === 0 ? 'after' : undefined}
              onDropAt={setDropAt}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ThumbProps {
  item: PageItem;
  index: number;
  left: number;
  top: number;
  isCurrent: boolean;
  isSelected: boolean;
  color?: string;
  groupNo?: number;
  cut?: 'on' | 'off';
  dropMark?: 'before' | 'after';
  onDropAt(i: number | undefined): void;
}

const Thumb = memo(function Thumb(p: ThumbProps) {
  const holder = useRef<HTMLDivElement>(null);
  const { item } = p;

  useEffect(() => {
    let alive = true;
    const place = (c: HTMLCanvasElement) => {
      const el = holder.current;
      if (!alive || !el) return;
      // 캐시의 캔버스는 큰 화면의 임시 표시에도 쓰이므로 복사본을 붙인다.
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext('2d')!.drawImage(c, 0, 0);
      el.replaceChildren(copy);
    };
    thumbQueue.push(
      () => alive,
      async () => place(await renderThumb(item, THUMB_W, THUMB_H, Math.min(window.devicePixelRatio || 1, 2))),
    );
    return () => {
      alive = false;
    };
  }, [item.uid, item.userRot]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = (e: MouseEvent) => {
    useStore.getState().select(item.uid, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single');
  };

  const onDragStart = (e: DragEvent) => {
    const st = useStore.getState();
    const ids = st.selected.has(item.uid) ? st.pages.filter((x) => st.selected.has(x.uid)).map((x) => x.uid) : [item.uid];
    e.dataTransfer.setData('application/x-kiho-pages', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-kiho-pages')) return;
    const r = e.currentTarget.getBoundingClientRect();
    p.onDropAt(e.clientX < r.left + r.width / 2 ? p.index : p.index + 1);
  };

  return (
    <div
      className={`thumb${p.isCurrent ? ' current' : ''}${p.isSelected ? ' selected' : ''}`}
      style={{ left: p.left, top: p.top, width: CELL_W, height: CELL_H }}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
    >
      {p.dropMark && <div className={`drop-mark ${p.dropMark}`} />}
      <div className="thumb-img" ref={holder} style={{ width: THUMB_W, height: THUMB_H }} />
      <div className="thumb-label" style={p.color ? { background: p.color, color: '#111' } : undefined}>
        {p.groupNo !== undefined && <b>#{p.groupNo} </b>}
        {p.index + 1}
        {hasEdits(item) && <span title="삽입한 항목 있음"> ✎</span>}
      </div>
      {p.cut && (
        <button
          className={`cut ${p.cut}`}
          title={p.cut === 'on' ? '분할 지점 해제' : `${p.index + 1}쪽 뒤에서 분할`}
          onClick={(e) => {
            e.stopPropagation();
            const st = useStore.getState();
            st.setGroups(toggleCut(st.groups, p.index + 1, st.pages.length));
          }}
        >
          ✂
        </button>
      )}
    </div>
  );
});
