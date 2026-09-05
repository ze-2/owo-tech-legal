import { test, expect, chromium } from "@playwright/test";
import path from "node:path";

test("unpacked extension validates imports and fails safely without page permission", async ({
  baseURL,
}) => {
  // Extension UIs are desktop Chrome surfaces, independent of the phone workspace test.
  test.skip(
    test.info().project.name !== "desktop",
    "Chrome extension is a desktop surface",
  );
  const extension = path.resolve("extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  try {
    const manager = await context.newPage();
    await manager.goto("chrome://extensions");
    const item = manager
      .locator("extensions-item")
      .filter({ hasText: "Clearclaim" });
    await expect(item).toHaveCount(1);
    const id = await item.getAttribute("id");
    const form = await context.newPage();
    await form.goto(`${baseURL}/mock-cjts.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    // Opening the popup as a tab does not grant activeTab. Exercise this actual
    // permission failure boundary without adding host permissions to production.
    await popup
      .getByLabel("Approved filing package")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"version":2}'),
      });
    await expect(popup.getByRole("status")).toContainText(
      "Unsupported transfer version",
    );
    const pack = {
      version: 1,
      generatedAt: new Date().toISOString(),
      userReviewed: true,
      fields: {
        claimant: { value: "Mei Lim", review: "approved", provenance: "user" },
        respondent: {
          value: "Example Renovation",
          review: "approved",
          provenance: "user",
        },
      },
    };
    await popup
      .getByLabel("Approved filing package")
      .setInputFiles({
        name: "approved.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(pack)),
      });
    await expect(popup.getByRole("status")).toContainText(
      "2 approved fields loaded",
    );
    await expect(
      popup.getByRole("button", { name: "Preview compatible fields" }),
    ).toBeEnabled();
    // Test actual popup failure boundary: opening an unsupported tab cannot fill it.
    await popup
      .getByRole("button", { name: "Preview compatible fields" })
      .click();
    await expect(popup.getByRole("status")).toContainText(
      "Could not inspect this page",
    );
    await expect(
      popup.getByRole("button", { name: "Fill selected fields" }),
    ).toBeDisabled();
    await expect(form.getByLabel("Claimant particulars")).toHaveValue("");
    await expect(form.locator("#submission-status")).toHaveText(
      "Nothing submitted.",
    );
    await popup.getByRole("button", { name: "Clear package" }).click();
    await expect(popup.getByRole("status")).toHaveText("Package cleared.");
  } finally {
    await context.close();
  }
});
