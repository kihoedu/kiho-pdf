import { describe, expect, it } from 'vitest';
import { applyCaptureTemplate, capturePixels, orientedSize, DEFAULT_CAPTURE_TEMPLATE, normalizeCaptures, uniqueFileNames, validateCaptures } from './captures';
import type { Capture, PageItem } from './types';

const page = (uid: string): PageItem => ({ uid, srcId: 's', srcIndex: 0, userRot: 0, texts: [], shapes: [] });
const cap = (id: string, pageUid: string, name = '', auto = true): Capture => ({ id, pageUid, x: 0, y: 0, w: 72, h: 36, rot: 0, userRot: 0, name, auto });

describe('캡처 목록', () => {
  it('이름 템플릿', () => {
    expect(applyCaptureTemplate(DEFAULT_CAPTURE_TEMPLATE, '계약서', 7, 3)).toBe('계약서_7쪽_03');
    expect(applyCaptureTemplate('{쪽:03}-{번호}', 'x', 7, 12)).toBe('007-12');
  });

  it('쪽 순서대로 정렬하고 자동 이름만 다시 매긴다', () => {
    const pages = [page('a'), page('b'), page('c')];
    const out = normalizeCaptures([cap('1', 'c'), cap('2', 'a', '직접', false), cap('3', 'a'), cap('4', 'c')], pages, DEFAULT_CAPTURE_TEMPLATE, 'doc');
    expect(out.map((c) => c.id)).toEqual(['2', '3', '1', '4']); // 같은 쪽 안에서는 담은 순서 유지
    expect(out.map((c) => c.name)).toEqual(['직접', 'doc_1쪽_02', 'doc_3쪽_03', 'doc_3쪽_04']);
  });

  it('쪽이 없어지면 그 쪽의 캡처를 버리고, 순서가 바뀌면 쪽 번호가 따라 바뀐다', () => {
    const caps = [cap('1', 'a'), cap('2', 'b')];
    expect(normalizeCaptures(caps, [page('b')], '{쪽}', 'd').map((c) => [c.id, c.name])).toEqual([['2', '1']]);
    expect(normalizeCaptures(caps, [page('b'), page('a')], '{쪽}', 'd').map((c) => [c.id, c.name])).toEqual([
      ['2', '1'],
      ['1', '2'],
    ]);
  });

  it('파일명 검증과 중복 처리', () => {
    expect(validateCaptures([cap('1', 'a', 'ok', false), cap('2', 'a', ' ', false), cap('3', 'a', 'a/b', false)]).map((i) => i.id)).toEqual(['2', '3']);
    expect(uniqueFileNames(['그림', '그림', '그림.PNG', 'b'], 'png')).toEqual(['그림.png', '그림_2.png', '그림_3.png', 'b.png']);
    expect(uniqueFileNames(['a.jpeg', 'a'], 'jpg')).toEqual(['a.jpg', 'a_2.jpg']);
  });

  it('dpi 에 따른 픽셀 크기', () => {
    expect(capturePixels({ w: 72, h: 36 }, 300)).toEqual({ w: 300, h: 150 });
    expect(capturePixels({ w: 0.01, h: 0.01 }, 96)).toEqual({ w: 1, h: 1 });
    // 캡처 뒤에 쪽을 90° 돌리면 가로·세로가 바뀌고, 180° 면 그대로다
    expect(orientedSize(cap('1', 'a'), 90)).toEqual({ w: 36, h: 72 });
    expect(orientedSize(cap('1', 'a'), 180)).toEqual({ w: 72, h: 36 });
    expect(orientedSize({ ...cap('1', 'a'), userRot: 270 }, 0)).toEqual({ w: 36, h: 72 });
  });
});
