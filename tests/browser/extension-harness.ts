import { expect, chromium, type BrowserContext } from "@playwright/test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Load an unpacked extension, optionally granting host permissions for the local
 * fixture only.
 *
 * The shipped manifests rely on `activeTab`, which Chrome grants only when the
 * user invokes the extension from its toolbar icon — a gesture no headless
 * harness can produce. Without it every scripting call fails, which is why the
 * only extension test that used to exist asserted a failure. Staging a copy with
 * a fixture-scoped host permission exercises the real popup, the real
 * `chrome.scripting` call and the real page write; the shipped manifests are
 * untouched and still carry `activeTab` alone.
 */
export async function loadExtension(
  directory: string,
  fixtureHostAccess = false,
): Promise<{ context: BrowserContext; id: string }> {
  let extension = path.resolve(directory);
  if (fixtureHostAccess) {
    const staged = mkdtempSync(path.join(tmpdir(), "clearclaim-ext-"));
    cpSync(extension, staged, { recursive: true });
    const manifestPath = path.join(staged, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.host_permissions = [
      "http://127.0.0.1/*",
      "http://127.0.0.1:*/*",
      "http://localhost/*",
      "http://localhost:*/*",
    ];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    extension = staged;
  }
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  const item = manager
    .locator("extensions-item")
    .filter({ hasText: "Clearclaim" });
  await expect(item).toHaveCount(1);
  const id = await item.getAttribute("id");
  await manager.close();
  return { context, id: id! };
}

/** Read the fixture's click log without leaking `any` into the specs. */
export function readClicks(): string[] {
  return (window as unknown as { clicks: string[] }).clicks;
}
