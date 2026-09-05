import { test, expect } from "@playwright/test";
import { loadExtension } from "./extension-harness";

test("webpage JSON download imports into the CJTS helper", async ({ page, baseURL }) => {
  test.skip(test.info().project.name !== "desktop", "Chrome extension is a desktop surface");
  await page.goto("/");
  await page.getByRole("button", { name: "Sale of goods", exact: true }).click();
  await expect(page.getByLabel("What’s the problem?", { exact: true })).toHaveValue(/Claimant: Alex Tan/);
  await page.getByRole("button", { name: "Organise my claim", exact: true }).click();
  await expect(page.getByLabel("Your details (claimant)")).toHaveValue("Alex Tan");
  await page.getByRole("button", { name: /Prepare to file/ }).click();
  for (const field of ["Claimant particulars", "Claim amount", "Claim category"])
    await page.getByLabel(`Approve ${field}`, { exact: true }).check();
  await page.getByLabel("Approve CJTS subtype Defective Goods", { exact: true }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export approved filing JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("clearclaim-approved-filing.json");
  const filename = (await download.path())!;
  const { context, id } = await loadExtension("cjts-prefiling", true);
  try {
    const portal = await context.newPage();
    await portal.goto(`${baseURL}/mock-sct.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await portal.bringToFront();
    await popup.locator("#package").setInputFiles(filename);
    await expect(popup.locator("#status")).toContainText("reviewed SCT subtype selected");
    await expect(portal.locator('input#\\30')).toBeChecked();
      await expect(portal.getByLabel("Claim Amount")).toHaveValue("800");
  } finally {
    await context.close();
  }
});
