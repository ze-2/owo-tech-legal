import { defineConfig, devices } from "@playwright/test";

const existingServer = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: existingServer || "http://127.0.0.1:3100",
    channel: "chromium",
    launchOptions: { args: ["--use-fake-device-for-media-stream"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: existingServer
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: false,
        timeout: 60000,
        env: { EXA_API_KEY: "", OPENAI_API_KEY: "" },
      },
});
