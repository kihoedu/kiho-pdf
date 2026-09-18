# Kiho PDF — 작업 지침

브라우저에서만 동작하는 PDF 편집기(서버 없음). 구조·사용법은 README.md 참고.

## 반드시 지킬 규칙

### 1. 기능을 추가·변경하면 도움말을 함께 고친다 (사용자 지시)

우측 메뉴의 **[? 도움말]**(F1) 팝업은 사용법과 단축키의 공식 안내다. 새 기능을 넣거나 기존 기능의 동작·이름·단축키·제한이
바뀌면 **같은 변경 안에서** 도움말에 반영한다. 나중으로 미루지 않는다.

| 바뀐 것 | 고칠 곳 |
|---|---|
| 탭 추가/이름 변경 | `src/model/ui.ts` 의 `TABS` + `src/help/guide.ts` 의 `TAB_GUIDE`(Record 라서 빠뜨리면 컴파일 실패) |
| 편집 도구 추가/변경, 도구 단축키 | `src/model/ui.ts` 의 `TOOLS`(label·key·hint) — 메뉴·키 처리·도움말이 모두 여기서 읽는다 |
| 키보드 단축키 추가/변경/삭제 | `src/App.tsx` 의 키 처리 + `src/model/ui.ts` 의 `SHORTCUTS`(`codes` 포함) |
| 마우스 조작, 동작 방식, 제한 사항, 새 옵션 | `src/help/guide.ts` 의 해당 탭 `items`(필요하면 `OVERVIEW`/`EXTRA`) |
| 위 어느 것이든 | README.md 의 해당 절 |

`src/help/guide.test.ts` 가 App.tsx 의 키 처리와 도움말 단축키 표를 양방향으로 대조한다(누락·잔재 모두 실패).
단, 테스트가 잡는 것은 단축키·탭·도구뿐이다. **사용법 설명 문장은 사람이(=작업자가) 직접 맞춰야 한다.**
작업을 끝내기 전에 "이 변경으로 도움말의 어느 문장이 틀려졌는가?"를 확인한다.

### 2. 기본 저장은 항상 무손실

이미지·폰트 스트림은 재압축 없이 그대로 복사한다. 용량을 줄이는 동작은 사용자가 명시적으로 고른 "용량 최적화 저장"에서만,
OCR 품질 규칙(`src/engine/optimize.ts` 머리말) 안에서만 한다.

### 3. 속도가 최우선

파일 열기·쪽 전환·저장 속도를 떨어뜨리는 변경은 측정값과 함께 제안한다(README 의 벤치마크 절차 사용).

## 검증

```bash
npm run typecheck && npm test && npm run e2e
```

- E2E 는 설치된 Edge 를 쓴다(브라우저 다운로드 없음). 파일 선택 대화상자는 `e2e/helpers.ts` 의 OPFS 대역으로 대체한다.
- 이 앱이 저장한 파일은 다시 열면 삽입 항목이 오버레이로 되살아난다. 저장본의 본문에 실제로 그려진 결과를 검증하려면
  열기 전에 `window.__kihoTune = { noRestore: true }` 를 넣는다(`src/devTune.ts`, 개발 서버 전용).
- 화면 확인: `node bench/shot.mjs <split|text|capture|pen|find|file|help>` → `bench/out/shot-*.png` (개발 서버가 떠 있어야 한다).
- 속도 측정: `npm run bench:open`(열기 → 첫 화면), `npm run bench:split`, `npm run bench:thumb` — README 의 벤치마크 절 참고.
- 의존성을 추가·교체하면 `THIRD-PARTY-NOTICES.md` 를, 릴리스할 때는 `CHANGELOG.md` 와 `package.json` 의 `version` 을 함께 고친다.
  배포 절차는 `docs/DEPLOY.md`.
- 커밋·푸시는 사용자가 요청할 때만 한다.
