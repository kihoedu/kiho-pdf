# 배포 계획

Kiho PDF 는 서버 로직이 없는 정적 사이트다. `npm run build` 가 만드는 `dist/` 를 그대로 올리면 된다.
빌드는 상대 경로(`base: './'`)라서 도메인 루트든 하위 경로(`/kiho-pdf/`)든 같은 산출물로 동작한다.

## 1. 어떤 호스팅이든 지켜야 할 조건

| 조건 | 이유 |
|---|---|
| **HTTPS** (또는 `localhost`) | File System Access API(폴더에 바로 저장), 서비스 워커(오프라인), PWA 설치, 클립보드 복사가 보안 컨텍스트에서만 동작한다. HTTP 로 올리면 앱은 열리지만 ZIP 내려받기로만 저장되고 오프라인이 안 된다. |
| 올바른 MIME | `.mjs`·`.js` → `text/javascript`, `.wasm` → `application/wasm`, `.webmanifest` → `application/manifest+json`, `.ttf` → `font/ttf`. `.mjs` 가 `text/plain`/`application/octet-stream` 으로 나가면 PDF.js 워커가 뜨지 않는다. |
| `sw.js`·`index.html` 을 오래 캐시하지 않기 | `Cache-Control: no-cache`(또는 짧은 max-age). 나머지 `assets/*` 는 파일명에 해시가 있어 길게 캐시해도 된다. |
| `dist/` 전체를 빠짐없이 | `sw.js` 는 빌드 때 `dist/` 의 모든 파일을 사전 캐시 목록으로 갖는다. 하나라도 빠지면 서비스 워커 설치가 실패해 오프라인이 안 된다(온라인 사용은 가능). |
| 업로드 순서: `sw.js` 와 `index.html` 을 **마지막에** | 새 `sw.js` 가 먼저 올라가면 아직 없는 파일을 사전 캐시하려다 실패한다. |

### 새 버전이 사용자에게 반영되는 방식

`sw.js` 에는 `dist/` 내용의 해시가 버전으로 박힌다. 배포 뒤 사용자가 접속하면 이번 화면은 기존 캐시로 뜨고,
그 사이 새 서비스 워커가 전체를 다시 받아 교체한다(`skipWaiting` + `clients.claim`). 따라서 **새 버전은 배포 후
두 번째 접속(또는 새로 고침)부터** 보인다. 급한 수정은 사용자에게 "새로 고침 한 번"을 안내한다.

## 2. 선택지 비교

| | GitHub Pages | Google Cloud (Firebase Hosting) | Google Cloud (Cloud Storage + HTTPS 부하 분산기) | 일반 FTP 호스팅 |
|---|---|---|---|---|
| HTTPS | 자동 | 자동 | 직접 구성(인증서·LB) | 호스팅 업체에 달림(필수 확인) |
| 비용 | 무료(공개 저장소. 비공개 저장소는 유료 플랜 필요) | 무료 구간으로 충분(전송 월 10GB 수준) | LB 고정비 발생(월 수만 원대) | 기존 호스팅 요금 |
| MIME·캐시 헤더 | 자동(수정 불가, 기본 10분 캐시라 문제없음) | `firebase.json` 으로 제어 | 객체 메타데이터로 제어 | 서버 설정(.htaccess 등) 필요할 수 있음 |
| 자동 배포 | GitHub Actions(이 저장소에 준비됨) | Actions + 서비스 계정 | Actions + 서비스 계정 | 수동 또는 lftp/WinSCP 스크립트 |
| 사용자 지정 도메인 | 가능 | 가능 | 가능 | 가능 |
| 롤백 | 이전 태그로 워크플로 재실행 | 콘솔에서 이전 릴리스로 1클릭 | 직접 | 직접 |
| 적합한 경우 | **기본 선택** | 저장소를 비공개로 두거나, 헤더·롤백을 세밀하게 다루고 싶을 때 | 이미 GCP LB 를 운영 중일 때만 | 기관 홈페이지 하위 경로에 꼭 올려야 할 때 |

> `https://storage.googleapis.com/<버킷>/index.html` 로 버킷을 직접 여는 방식은 쓰지 않는다. 모든 버킷이 같은
> 출처(origin)를 공유하므로 서비스 워커 범위·캐시·OPFS 가 다른 사람의 버킷과 섞인다.

## 3. 권장안

1. **1차: GitHub Pages** — 저장소(`kihoedu/kiho-pdf`)와 같은 곳에서 끝나고, HTTPS·MIME 가 자동이며 비용이 없다.
   주소는 `https://kihoedu.github.io/kiho-pdf/`.
2. **대안: Firebase Hosting** — 저장소를 비공개로 유지해야 하거나 사용자 지정 도메인·즉시 롤백이 중요해지면 옮긴다.
   산출물이 같으므로 이전 비용은 설정 파일 하나다.
3. **FTP** — 기관 서버에 올려야 하는 요구가 생길 때만. HTTPS 와 `.mjs`/`.wasm` MIME 을 먼저 확인한다.

서비스 워커와 설치형 앱(PWA)은 **출처(도메인)별**로 따로 설치된다. 주소를 옮기면 사용자는 새 주소에서 다시
설치해야 하므로, 공개 주소는 처음부터 하나로 정해 두는 편이 좋다(사용자 지정 도메인을 쓸 계획이면 처음부터 연결).

## 4. 절차

### 4-1. 공통: 배포 전 점검

```bash
npm ci
npm run typecheck && npm test && npm run e2e   # e2e 의 pwa 프로젝트가 빌드본·오프라인 동작까지 확인한다
npm run build                                   # dist/ 생성, 마지막 줄에 "sw.js: N files precached"
npm run preview                                 # http://localhost:4173 에서 빌드본 확인
```

릴리스할 때는 `package.json` 의 `version` 과 `CHANGELOG.md` 를 올리고 `v<버전>` 태그를 단다.

### 4-2. GitHub Pages (권장)

최초 1회(이 저장소는 2026-09-19 에 설정을 마쳤고 첫 배포가 나가 있다):

1. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꾼다.
2. (선택) 사용자 지정 도메인을 쓰면 같은 화면의 **Custom domain** 에 입력하고 DNS 에 CNAME 을 건다. **Enforce HTTPS** 를 켠다.

배포(main 에 올린 뒤):

```bash
gh workflow run "Deploy (GitHub Pages)" --ref main   # 단위 테스트 → 빌드 → 배포
gh run watch                                          # 끝날 때까지 지켜본다
git tag v0.2.0 && git push origin v0.2.0              # 배포한 커밋에 버전 태그를 남긴다
```

또는 **Actions → Deploy (GitHub Pages) → Run workflow**(브랜치 main)로 실행한다.
`github-pages` 환경은 `main` 브랜치의 배포만 허용하므로 태그나 다른 브랜치에서는 실행해도 거부된다.
롤백은 되돌릴 커밋을 main 에 올린(`git revert`) 뒤 같은 워크플로를 다시 실행한다.

### 4-3. Google Cloud — Firebase Hosting

최초 1회(`firebase-tools` 필요, GCP 프로젝트에 Firebase 를 추가한 뒤):

```bash
npm i -g firebase-tools
firebase login
firebase init hosting         # public 디렉터리 = dist, SPA rewrite = No, 자동 빌드·GitHub 연동은 선택
```

`firebase.json` 은 아래처럼 둔다(서비스 워커와 첫 화면은 캐시하지 않고, 해시가 붙은 자산은 길게 캐시).

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["**/*.map"],
    "headers": [
      { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "/assets/**", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
    ]
  }
}
```

배포·롤백:

```bash
npm run build
firebase deploy --only hosting
firebase hosting:channel:deploy preview   # (선택) 미리보기 주소에 먼저 올려 확인
```

롤백은 Firebase 콘솔 **Hosting → 릴리스 기록** 에서 이전 릴리스를 고른다.

### 4-4. Google Cloud — Cloud Storage + HTTPS 부하 분산기 (이미 LB 가 있을 때만)

```bash
npm run build
gcloud storage rsync dist gs://<버킷> --recursive --delete-unmatched-destination-objects --exclude="^(sw\.js|index\.html)$"
gcloud storage cp dist/sw.js dist/index.html gs://<버킷>/ --cache-control="no-cache"
```

버킷을 백엔드 버킷으로 연결하고 인증서를 붙인 HTTPS LB 뒤에 둔다. `.mjs` 가 `text/javascript` 로 올라갔는지
`gcloud storage objects describe gs://<버킷>/assets/<파일>.mjs` 로 확인한다.

### 4-5. 일반 FTP

1. 호스팅이 **HTTPS** 를 제공하는지 확인한다(안 되면 이 방식은 쓰지 않는다).
2. `npm run build` 뒤 `dist/` 안의 내용을 대상 디렉터리에 올린다. `sw.js`·`index.html` 은 마지막에 올린다.

```bash
# lftp 예시(SFTP/FTPS 권장). 나머지를 먼저 미러링하고, 두 파일을 마지막에 올린다.
lftp -u <사용자> sftp://<호스트> -e "mirror -R --delete --exclude-glob sw.js --exclude-glob index.html dist/ <원격경로>/; put -O <원격경로>/ dist/index.html dist/sw.js; bye"
```

3. Apache 계열에서 MIME·캐시가 맞지 않으면 대상 디렉터리에 `.htaccess` 를 둔다.

```apache
AddType text/javascript .mjs .js
AddType application/wasm .wasm
AddType application/manifest+json .webmanifest
AddType font/ttf .ttf
<FilesMatch "^(sw\.js|index\.html)$">
  Header set Cache-Control "no-cache"
</FilesMatch>
```

## 5. 배포 후 확인

1. 공개 주소를 Chrome/Edge 로 열어 PDF 하나를 열고, 분할 **모두 저장** 이 폴더 선택 한 번으로 끝나는지 본다(HTTPS 확인).
2. 개발자 도구 **Application → Service Workers** 에 `sw.js` 가 *activated* 인지, **Cache Storage** 에 `kiho-pdf-<해시>` 가 있는지 본다.
3. 네트워크를 *Offline* 으로 바꾸고 새로 고침해도 앱이 뜨고 PDF 가 열리는지 본다.
4. 주소창의 설치 아이콘으로 설치가 되는지, 설치 후 PDF 파일의 "연결 프로그램"에 나타나는지 본다.
5. 콘솔에 `.mjs`/`.wasm` MIME 오류가 없는지 본다.
