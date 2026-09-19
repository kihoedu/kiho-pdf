# 인수인계 · 작업 기록

여러 데스크탑에서 여러 작업자(사람·AI 에이전트)가 이어서 작업하기 위한 문서다.
**작업을 시작할 때 1~3절을 읽고, 끝낼 때 2절을 고치고 6절 맨 위에 기록을 추가한다.**

| 무엇을 알고 싶은가 | 볼 곳 |
|---|---|
| 지켜야 할 규칙(도움말 동기화 · 무손실 · 속도), 검증 명령 | [CLAUDE.md](../CLAUDE.md) |
| 기능·화면·구조·벤치마크 | [README.md](../README.md) |
| 버전별로 바뀐 것 | [CHANGELOG.md](../CHANGELOG.md) |
| 배포 방법 | [DEPLOY.md](DEPLOY.md) |
| **지금 어디까지 했고, 다음에 무엇을 하며, 무엇을 조심해야 하는가** | 이 문서 |

이 문서에는 위 문서들의 내용을 옮겨 적지 않는다. 코드·git 기록으로 알 수 없는 것(결정의 이유, 미해결 사항, 기기별 함정)만 적는다.

---

## 1. 새 기기에서 시작하기

```bash
git clone https://github.com/kihoedu/kiho-pdf.git && cd kiho-pdf
npm ci                       # postinstall 이 PDF.js 자산·폰트를 public/ 으로 복사한다(public/pdfjs, public/fonts 는 git 에 없다)
npm run dev                  # http://localhost:5173
npm run typecheck && npm test && npm run e2e
```

- Node.js 24 권장(`.nvmrc`), 22.12 이상이면 된다. 2026-09-19 의 작업 기기는 22.23 이었고 문제없었다.
- E2E 는 **설치된 Edge** 를 쓴다(Chrome 은 `PW_CHANNEL=chrome`). 브라우저를 내려받지 않는다. 전체 21개, 약 1분.
- **`npm install` 로 `package-lock.json` 을 다시 쓰지 않는다.** npm 버전이 낮으면 선택적 의존성의 `libc` 항목이 통째로 빠진다
  (2026-09-19 에 실제로 겪음). 의존성을 바꾸지 않았다면 `npm ci` 만 쓰고, 버전 같은 값만 고칠 때는 lock 파일의 해당 줄만 손으로 고친다.
- 줄바꿈: 이 저장소의 Windows 작업본은 CRLF 다(`core.autocrlf=true`). 스크립트로 파일을 고칠 때 LF 를 섞지 않는다.
- 생성물은 git 에 없다: `dist/`, `public/pdfjs/`, `public/fonts/`, `bench/out/`, `bench/samples/`, `test-results/`.
  `bench/samples/test_12p.pdf` 는 E2E 가 없으면 자동으로 만든다. 196MB 샘플은 `npm run bench:sample`.

## 2. 현재 상태 (2026-09-19 02:10 KST 기준)

| 항목 | 값 |
|---|---|
| 브랜치 | `main` = `origin/main`, 작업본 깨끗함. 마지막 코드 변경은 `c68fdab`(그 뒤는 이 문서를 추가한 문서 커밋) |
| 버전 · 태그 | 0.2.0 · `v0.2.0` → `4452e99` |
| 배포 | https://kihoedu.github.io/kiho-pdf/ — `9c6cae1` 빌드. 이후 커밋 2개는 테스트·워크플로·문서만 바꿔 앱(`dist/`)은 같다 |
| CI | 마지막 코드 변경 `c68fdab` 통과(Linux·Chrome, 타입 검사 · 단위 52 · E2E 21) |
| 로컬 검증 | Windows·Edge 에서 `npm run e2e` 21개 통과 · 1.1분 · 정상 종료(2회 연속) |
| 진행 중인 작업 | 없음 |

저장소 설정(코드 밖에 있어 git 으로는 알 수 없는 것):

- GitHub Pages: Source = **GitHub Actions**, HTTPS 강제. 저장소는 **공개**(무료 플랜의 Pages 조건).
- `github-pages` 환경은 **`main` 브랜치의 배포만 허용**한다. 태그·다른 브랜치에서 배포 워크플로를 돌리면 거부된다.
  그래서 배포는 `gh workflow run "Deploy (GitHub Pages)" --ref main` 으로 한다(자동 배포 아님).
- 워크플로 파일을 푸시하려면 토큰에 `workflow` 권한이 있어야 한다.

## 3. 열려 있는 일

### 3-1. 소유자(프로젝트 주인)의 결정이 필요한 것

| # | 내용 | 지금 상태 |
|---|---|---|
| D1 | **라이선스**: 에이전트가 관례에 따라 MIT, 저작권자 "Eunkwang Choi" 로 정해 공개했다. 소유자가 명시적으로 고른 것이 아니다 | 이의가 없으면 그대로. 바꾸려면 `LICENSE`, `package.json` 의 `license`, README 마지막 절 |
| D2 | **본문 찾기(Ctrl+F)**: 예전에 의도적으로 뺀 기능으로 보인다(기존 E2E 가 "Ctrl+F·검색 탭이 없다"고 단언하고 있었다). 작업 목록 15번으로 승인받아 **새 탭 없이 보기 탭 안에** 다시 넣었다. 뺀 이유는 기록이 없어 모른다 | 배포됨. 빼려면 5절의 "본문 찾기 되돌리기" |
| D3 | **공개 주소**: PWA·서비스 워커는 주소(출처)별로 설치된다. 사용자 지정 도메인을 쓸 계획이면 사용자가 늘기 전에 옮기는 편이 낫다 | `kihoedu.github.io/kiho-pdf` 사용 중 |

### 3-2. 다음 작업 후보 (우선순위 순)

1. `bench/*.mjs`(`shot`, `open-bench`, `thumb-bench`)가 브라우저를 직접 띄우고 `browser.close()` 를 기다린다. 4절의 임시 프로필 문제로
   Windows 에서 가끔 끝에서 오래 걸린다. E2E 와 같은 방식(서버 프로세스 + 트리 종료)이나, 닫기를 기다리지 않고 `process.exit` 하는 식으로 고친다.
2. README 벤치마크 표의 "열기 → 첫 화면 약 0.45초"는 초기 구현 때의 값이다. `npm run bench:open` 의 2026-09-18 측정은 1.19초
   (개발 서버·OPFS·다른 부하가 있던 기기)라 조건이 다르다. 같은 조건(빌드본, 한가한 기기)으로 다시 재서 표를 하나의 기준으로 맞춘다.
3. 빌드 경고: 번들 청크가 500KB 를 넘는다(vite 경고). 첫 로딩에만 영향이 있고 PWA 캐시 뒤에는 무관하다. 손대려면 규칙 3에 따라 전후를 잰다.
4. GitHub Actions 경고: `actions/*@v4` 가 Node 20 기반이라는 폐기 예고, `ubuntu-latest` 가 2026-10-19 부터 Ubuntu 26 으로 바뀐다는 예고. 지금은 동작한다.
5. 본문 찾기: 다른 PDF 를 삽입(병합)한 뒤에는 다시 찾아야 새 쪽이 결과에 들어간다(자동 재검색 없음). 도움말에 그렇게 적혀 있다.
6. 재편집 표시는 "편집이 있는 쪽이 하나라도 있는 저장"에서만 문서 정보에 남는다. 표시 없이 쪽의 기록만 남은 파일(다른 도구가 Info 를 지운 경우 등)은
   되살리지 않는다. 드문 경우라 그대로 두었다.

## 4. 함정 — 같은 데서 시간을 버리지 않도록

### E2E · 테스트

- **E2E 의 브라우저는 별도 프로세스 서버다**(`e2e/global-setup.ts` → `e2e/browser-server.mjs`, 워커는 `connectOptions` 로 접속). **되돌리지 않는다.**
  워커가 브라우저를 직접 띄우면, 워커가 끝날 때 Playwright 가 임시 프로필(`%TEMP%\playwright_chromiumdev_profile-*`)을 지운다.
  Windows 에서는 방금 닫힌 프로필의 파일이 약 3번에 1번꼴로 "삭제 대기"로 묶이는데(같은 사용자의 프로세스는 핸들을 쥐고 있지 않았다 —
  ESET 같은 시스템 쪽으로 추정, 미확인), Playwright 가 파일 150여 개를 10번씩 재시도하느라 워커가 끝나지 않는다.
  증상은 "app 테스트가 다 끝났는데 pwa 테스트가 시작되지 않고 러너가 요약 줄 없이 남는다"였다.
  - 처음에는 "Edge 가 워커를 못 닫는다"고 **잘못 진단**했다. Edge 프로세스는 정상 종료된다. Chrome 도 마지막 정리에서 같은 식으로 남았다.
  - 빈 페이지만 열고 닫아도 재현된다(headless). 앱 코드와 무관하다.
- 워커들이 브라우저 하나를 나눠 쓰므로 부하가 몰리면 느리다. 그래서 `expect.timeout` 이 15초다. 5초로 되돌리면 재편집 테스트가 흔들린다.
- **E2E 가 도는 동안 `src/` 를 고치지 않는다.** 개발 서버의 HMR 이 테스트 중인 페이지를 다시 읽어 엉뚱한 실패가 난다.
- 에이전트가 E2E 를 돌릴 때: 파이프(`| tail`)나 짧은 셸 타임아웃으로 끊으면 node·vite 프로세스가 고아로 남아 다음 실행(포트 5173/4173)을 방해한다.
  백그라운드 + 로그 파일로 돌리고, 남은 것은 CommandLine 에 `kiho-pdf` 가 든 `node.exe` 만 골라 `taskkill /T /F` 한다. **사용자의 Edge 창은 건드리지 않는다.**
- 이 앱이 저장한 파일을 다시 열면 삽입 항목이 오버레이로 되살아난다. "본문에 실제로 그려졌는가"를 검증하는 테스트는 열기 전에
  `window.__kihoTune = { noRestore: true }` 를 넣어야 한다(`src/devTune.ts`, 개발 서버 전용 — 빌드본을 쓰는 `*.pwa.ts` 에서는 듣지 않는다).
- `mockPickers` 는 `window.confirm` 을 항상 승인으로 덮어쓴다. 확인 창의 문구·거절을 검증하려면 `e2e/guard.e2e.ts` 의 `recordConfirms` 를 쓴다
  (나중에 덮어써도 남도록 `defineProperty` 로 고정해 둔 것이다).
- `e2e/optimize.e2e.ts` 는 큰 JPEG 을 base64 로 주고받아 원래 오래 걸린다(20초~1분). 고장이 아니다.
- CI 에서는 실패한 테스트를 한 번 재시도한다(`retries`). 캡처 미리보기 테스트가 Linux 러너에서 한 번 실패한 적이 있다(재실행은 통과, 원인 미확정).
- 텍스트 도구로 클릭한 직후 바로 타이핑하면 안 된다. 상자는 폰트를 받은 뒤에 생기므로 `.text-box textarea` 가 포커스될 때까지 기다린다.

### 코드

- 도움말 E2E(`e2e/help.e2e.ts`)와 `src/help/guide.test.ts` 는 "없어진 기능이 도움말·단축키에 남아 있지 않은지"도 본다. 기능을 넣고 뺄 때 함께 고친다.
- 단축키를 넣을 때는 `src/App.tsx` 의 비교식 모양(`mod && key === 'f'`)을 지킨다. `guide.test.ts` 가 정규식으로 이 모양을 읽어 도움말 표와 대조한다.
- 실행 취소 기록을 남기는 편집은 모두 `store.ts` 의 `commit()` 을 거친다. 캡처 목록만 바꾸는 편집은 PDF 를 "변경됨" 으로 만들지 않고
  `capturesUnsaved` 로 따로 센다(닫기 전 경고용).
- 저장 엔진(Worker)은 원본을 한 번만 파싱해 `src.id` 로 캐시한다. 재편집 복원은 **그 캐시된 문서를 직접 고친다** — 복원 뒤의 `Source.file` 은
  그려 넣은 부분을 걷어 낸 새 `File` 이고, 암호는 지운다(다시 쓴 PDF 에는 암호가 없다).
- pdf-lib 가 쪽에 그릴 때 끼우는 `q`/`Q` 스트림은 **문서 전체가 하나를 공유**한다. 복원은 `/Contents` 배열에서 참조만 빼고 객체는 지우지 않는다.
- 폰트 사전은 여러 쪽이 함께 쓸 수 있다. 복원에 실패한 쪽이 하나라도 있으면 추가했던 폰트 이름을 지우지 않는다(그 쪽의 글자가 그 폰트를 쓴다).
- 전자서명 확인 창은 저장 대화상자 **앞**에 뜬다. 확인 창에 오래 머물면 브라우저가 "사용자 동작" 권한을 거둬 저장 대화상자가 막힐 수 있어,
  그때는 "한 번 더 눌러 주세요"로 안내하고 승인은 기억해 둔다(`io.ts` 의 `errText`, `signatureAck`).

## 5. 결정과 그 이유

| 결정 | 이유 | 되돌리려면 |
|---|---|---|
| 본문 찾기를 새 탭이 아니라 보기 탭에 둠 | 기존 테스트가 "검색 탭 없음"을 단언(의도적으로 뺀 흔적). 탭 구성은 건드리지 않음 | **본문 찾기 되돌리기**: `src/actions/search.ts`, `src/model/search.ts`(+test), `SidePanel.tsx` 의 `FindSection`, `TextLayerView.tsx` 의 강조 effect, `store.ts` 의 `search`·`searchPos`·`openSearch`, `App.tsx` 의 `mod+f`, `ui.ts` 의 SHORTCUTS 2줄, `pageText.ts` 의 `getPageCompact`, `styles.css` 의 `::highlight`, `guide.ts`·README, `e2e/find.e2e.ts`, `help.e2e.ts` 의 단언 |
| 찾기는 공백·대소문자를 무시한 "압축 문자열"에서 | PDF 의 글자 조각 사이 공백이 제각각(한글은 글자마다 조각이 나뉘기도 함). 대가: `a b` 가 `ab` 와도 일치 | `model/search.ts` |
| 찾기는 쪽의 글자를 찾을 때 처음 읽고, TextContent 대신 문자열만 캐시 | 규칙 3(열기·쪽 전환 속도에 영향 없음), 수백 쪽 문서의 메모리 | — |
| 일치 강조는 CSS Custom Highlight API | 글자 층 DOM 을 건드리지 않음. 없는 브라우저에서는 강조 없이 쪽 이동만 | — |
| 재편집 기록은 쪽의 `/PieceInfo` + 문서 정보의 `KihoEdits` 표시 | `/PieceInfo` 는 응용 프로그램 전용 자료를 두는 PDF 표준 자리. 표시를 Info 에 둔 것은 PDF.js 의 `getMetadata()` 한 번(3~5ms)으로 확인하려고 — 표시 없는 파일은 여는 속도가 그대로 | `engine/pieceInfo.ts`, `model/editsCodec.ts` |
| 파일 안의 기록은 엄격히 검증하고, 어긋나면 그 쪽은 건드리지 않음 | 파일은 믿을 수 없는 입력. 되살리지 못해도 **그린 내용이 사라지면 안 된다** | — |
| 대용량 열기(구간 읽기 청크)는 바꾸지 않음 | 측정: 8/32/64MB 가 1.25/1.35/1.27초로 차이 없음. 평평한 페이지 트리는 어차피 파일 전체를 훑는다 | README 벤치마크 절 |
| 서명 여부는 AcroForm 의 SigFlags(PDF.js `IsSignaturesPresent`)로 판단 | 열 때 이미 부르는 `getMetadata()` 에 들어 있어 추가 비용 없음 | — |
| 덮어쓰기 후 다시 열 때 분할 그룹·캡처·보던 쪽을 이어받음 | 이전에는 저장 한 번에 목록이 모두 사라졌다(데이터 손실). 문서 전체를 저장한 경우에만(쪽 구성이 같으므로) | `io.ts` 의 `reopenSaved` |
| 배포는 main 에서 수동 실행 | `github-pages` 환경이 main 만 허용. main 에 올릴 때마다 자동 배포하지 않는 것은 검증 없이 나가는 것을 막으려고 | `deploy.yml` 의 `on:` |
| 0.2.0 작업을 브랜치·PR 없이 main 에 직접 커밋 | 1인 저장소였고 배포가 main 에서만 가능. **여러 명이 작업하는 지금부터는 7절의 규칙을 따른다** | — |

## 6. 작업 기록 (최신이 위)

### 2026-09-19 · Windows 11 데스크탑(`F:\Manuscripts\GitHub\kiho-pdf`) · Claude Code(Fable 5.1), 지시: Eunkwang Choi

| 커밋 | 내용 |
|---|---|
| (문서 커밋) | 이 문서(`docs/HANDOFF.md`) 추가, CLAUDE.md·README 에서 연결 |
| `c68fdab` | E2E 가 Windows 에서 끝나지 않던 문제 수정(브라우저 서버 분리), `expect.timeout` 15초 |
| `4452e99` | 배포 워크플로를 main 수동 실행으로, 캡처 E2E 보강, CI 재시도 1회. `v0.2.0` 태그 |
| `9c6cae1` | 0.2.0 전체: 아래 목록 |

한 일(처음에 문서를 검토해 만든 20개 항목을 순서대로 진행):

- **문서**: README 전면 보완(파일·보기·페이지 탭, PWA, 단축키 표, 스크립트, 구조, 벤치마크 절차), CLAUDE.md 검증 절 보강.
- **저장소**: MIT 라이선스, `THIRD-PARTY-NOTICES.md`, Pretendard OFL 전문을 배포본에 포함, CI·배포 워크플로, `docs/DEPLOY.md`
  (GitHub Pages · Firebase Hosting · Cloud Storage+LB · FTP 비교와 절차), `.nvmrc`·`engines`, `CHANGELOG.md`, 버전 0.2.0.
- **테스트**: 단위 4종(`textLayout`, `plan`, `editsCodec`, `search`), E2E 5종(`lossless`, `reedit`, `find`, `guard`, 폼 XObject 최적화).
- **기능**: 본문 찾기 · 삽입 항목 재편집 · 폼 XObject 안 이미지 최적화 · 전자서명 저장 전 확인 · 캡처 미저장 경고 ·
  덮어쓰기 후 상태 이어받기. 도움말(`guide.ts`, `ui.ts`)과 README 를 같은 커밋에서 고쳤다.
- **측정**: `npm run bench:open` 추가. 구간 읽기 청크 크기 비교(변경 불필요로 결론), 문서 정보 확인의 열기 비용 3~5ms.
- **배포**: GitHub Pages 첫 배포. 배포 주소에서 첫 화면 · 콘솔 오류 없음 · HTTPS · 서비스 워커 등록 · 폴더 저장 API · MIME 을 확인.

검증: 타입 검사 통과, 단위 52개, E2E 21개(Windows·Edge 2회, Linux·Chrome CI).

남긴 것: 3절 전부. 이 기기의 `%TEMP%` 에 지워지지 않는 `playwright_chromiumdev_profile-*` 폴더 40여 개(개당 약 8MB) — 재부팅 뒤 지울 수 있다.

### 2026-09-18 · `d777e24`

초기 구현(0.1.0). 작업 기록 없음 — 내용은 CHANGELOG 의 0.1.0 과 README.

---

## 7. 여러 명이 함께 작업하는 규칙

1. **시작할 때** `git pull --rebase` → 이 문서의 2·3절 확인. 2절의 "진행 중인 작업"에 누가 무엇을 잡고 있는지 본다.
2. **작업은 브랜치에서** 한다(`feat/…`, `fix/…`). 하루를 넘기거나 기기를 옮길 때는 끝나지 않았어도 브랜치를 푸시한다 —
   다른 데스크탑에서 이어받을 수 있는 유일한 방법이다. 커밋 메시지에 `WIP` 를 붙이고, 2절의 "진행 중인 작업"에 브랜치 이름과 남은 일을 적는다.
3. **main 에 합치기 전에** `npm run typecheck && npm test && npm run e2e`. CI 가 같은 것을 다시 돌린다.
4. **배포는 한 사람이** main 에서 수동으로 실행한다. 배포했으면 2절의 "배포" 줄을 고친다. 버전을 올렸으면 CHANGELOG·`package.json`·태그.
5. **끝낼 때** 2절을 현재 값으로 고치고, 6절 맨 위에 아래 틀로 기록을 추가해 **같은 커밋(또는 같은 PR)에** 넣는다.
   - 한 일은 CHANGELOG 와 겹치지 않게 짧게. **남긴 것(미완성·미검증·임시 조치)과 이유**를 빠뜨리지 않는다.
   - 새로 알게 된 함정은 4절에, 되돌릴 수 있는 선택은 5절에, 끝내지 못한 일은 3절에 옮긴다. 해결된 항목은 지운다.
6. AI 에이전트의 개인 메모리(`~/.claude/projects/…/memory`)는 **기기마다 따로**라 다른 작업자에게 보이지 않는다.
   다음 사람이 알아야 하는 것은 반드시 이 문서에 적는다.
7. 비밀값(토큰·서비스 계정 키)은 어떤 문서에도 적지 않는다. 필요한 권한의 **종류**만 적는다(예: "`workflow` 권한이 있는 GitHub 토큰").

기록 틀:

```markdown
### YYYY-MM-DD · 기기/OS · 작업자(에이전트면 모델과 지시한 사람)

| 커밋(또는 브랜치) | 내용 |
|---|---|
| `abc1234` | … |

한 일: …
검증: 무엇을 어디서 돌렸고 결과가 어땠는지(돌리지 못한 것은 그렇게 적는다)
남긴 것: …
```
