import { test, expect } from "@playwright/test";

test("custom dropdowns support keyboard selection, escape, typeahead and pointer dismissal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sale of goods", exact: true }).click();
  await page.getByRole("button", { name: "Organise my claim" }).click();
  await expect(page.locator("select")).toHaveCount(0);
  const claimant = page.getByRole("combobox", { name: "You are claiming as" });
  await claimant.focus(); await page.keyboard.press("ArrowDown");
  await expect(claimant).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await expect(claimant).toHaveText("A business or other entity");
  await claimant.click(); await page.keyboard.press("Home"); await page.keyboard.press("Escape");
  await expect(claimant).toHaveText("A business or other entity");
  await expect(claimant).toBeFocused();
  const category = page.getByRole("combobox", { name: "Type of claim", exact: true });
  await category.focus(); await page.keyboard.press("r"); await page.keyboard.press("Enter");
  await expect(category).toHaveText("Residential tenancy");
  await category.click();
  await page.getByRole("option", { name: "Provision of services", exact: true }).click();
  await expect(category).toHaveText("Provision of services");
  await category.click(); await page.getByRole("heading", { name: "The people involved" }).click();
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: `test-results/${test.info().project.name}-integrated-fields.png`, fullPage: true });
});

test("voice language uses the shared dropdown and keeps automatic detection as the default", async ({ page }) => {
  await page.goto("/");
  const control = page.locator(".voice-field").filter({ has: page.locator("#problem") });
  await control.getByRole("button", { name: "Voice settings" }).click();
  const language = page.getByRole("combobox", { name: "Speech language" });
  await expect(language).toHaveText("Detect language automatically");
  await language.click();
  await page.getByRole("option", { name: "Mandarin Chinese" }).click();
  await expect(language).toHaveText("Mandarin Chinese");
  await language.click(); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
  await expect(language).toHaveText("Detect language automatically");
});
