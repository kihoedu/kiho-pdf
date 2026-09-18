import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LINE_HEIGHT, TEXT_PAD, layoutText, neededHeight } from './textLayout';

/**
 * 줄바꿈은 화면(TextBoxView)·캡처·저장(io.planPages)이 모두 layoutText 하나를 쓴다.
 * 여기서는 글자 너비를 고정한 가짜 캔버스로 그 규칙 자체를 검증한다: 한글 = size, 그 밖 = size / 2.
 */
const ASCENT = 0.95;
const DESCENT = 0.25;

beforeAll(() => {
  let size = 0;
  const ctx = {
    set font(v: string) {
      size = parseFloat(v);
    },
    measureText: (s: string) => ({
      width: Array.from(s).reduce((w, ch) => w + (/[가-힣]/.test(ch) ? size : size / 2), 0),
      fontBoundingBoxAscent: size * ASCENT,
      fontBoundingBoxDescent: size * DESCENT,
    }),
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
});

const lines = (text: string, w: number, size = 10) => layoutText({ text, w, size }).map((l) => l.text);

describe('layoutText', () => {
  it('영역 너비(안쪽 여백 제외)를 넘기 직전에 글자 단위로 줄을 바꾼다', () => {
    // 안쪽 너비 = 54 - 2×2 = 50 → 한글(10) 5자
    expect(lines('가나다라마바사', 54)).toEqual(['가나다라마', '바사']);
    // 영문(5) 10자
    expect(lines('abcdefghijkl', 54)).toEqual(['abcdefghij', 'kl']);
    // 정확히 맞으면 넘기지 않는다
    expect(lines('가나다라마', 54)).toEqual(['가나다라마']);
  });

  it('줄바꿈 문자는 그대로 문단을 나누고 빈 줄도 유지한다', () => {
    expect(lines('가\n\n나', 100)).toEqual(['가', '', '나']);
    expect(lines('', 100)).toEqual(['']);
  });

  it('상자가 글자보다 좁아도 한 줄에 한 글자는 들어간다', () => {
    expect(lines('가나', 3)).toEqual(['가', '나']);
  });

  it('서로게이트 쌍(이모지)을 쪼개지 않는다', () => {
    const out = lines('😀😀😀', 14); // 안쪽 너비 10 → 5씩 2개
    expect(out).toEqual(['😀😀', '😀']);
  });

  it('줄 위치: 줄 높이 = size × 1.3, 기준선은 줄 안에서 세로 가운데 정렬', () => {
    const size = 20;
    const out = layoutText({ text: '가\n나', w: 200, size });
    const lh = size * LINE_HEIGHT;
    const baseOff = (lh - size * (ASCENT + DESCENT)) / 2 + size * ASCENT;
    expect(out[0].top).toBeCloseTo(TEXT_PAD);
    expect(out[0].baseline).toBeCloseTo(TEXT_PAD + baseOff);
    expect(out[1].top).toBeCloseTo(TEXT_PAD + lh);
    expect(out[1].baseline - out[0].baseline).toBeCloseTo(lh);
  });

  it('같은 입력은 항상 같은 결과를 낸다(화면과 저장본이 같은 계산을 쓴다는 전제)', () => {
    const tb = { text: '한글 ABC 123 — 자동 줄바꿈 확인용 문장입니다.', w: 120, size: 12 };
    expect(layoutText(tb)).toEqual(layoutText({ ...tb }));
  });
});

describe('neededHeight', () => {
  it('줄 수 × 줄 높이 + 위아래 여백', () => {
    expect(neededHeight(1, 10)).toBeCloseTo(10 * LINE_HEIGHT + TEXT_PAD * 2);
    expect(neededHeight(3, 12)).toBeCloseTo(3 * 12 * LINE_HEIGHT + TEXT_PAD * 2);
  });
});
