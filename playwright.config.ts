import { defineConfig } from '@playwright/test';

// 설치된 Edge 를 그대로 쓴다(브라우저 다운로드 없음). Chrome 을 쓰려면 PW_CHANNEL=chrome.
const channel = process.env.PW_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: true,
  // CI 러너는 코어가 적어 시간에 민감한 테스트가 가끔 흔들린다. 한 번 더 돌려 보고 그래도 실패하면 실패다.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { channel, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    // 개발 서버 대상: 기능 테스트
    { name: 'app', testMatch: '**/*.e2e.ts', use: { baseURL: 'http://localhost:5173' } },
    // 빌드본 대상: 서비스 워커·오프라인
    { name: 'pwa', testMatch: '**/*.pwa.ts', use: { baseURL: 'http://localhost:4173' } },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
    { command: 'npm run build && npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120_000 },
  ],
});
