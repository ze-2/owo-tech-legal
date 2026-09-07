import { test, expect, type Page, type Locator } from "@playwright/test";
const fieldControl = (page: Page, field: Locator) => page.locator(".voice-field").filter({ has: field });
async function record(control: Locator) {
  await control.getByRole("button", { name: "Start microphone" }).click();
  await expect(control.getByRole("status")).toContainText("Listening.");
  await control.getByRole("button", { name: "Stop microphone" }).click();
}

test("one account box embeds consent-aware voice input with automatic language detection", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  let requests = 0;
  await page.route("**/api/transcribe", async route => {
    requests++;
    expect(route.request().postDataBuffer()?.toString()).not.toContain('name="language"');
    await route.fulfill({ json: { text: "The delivery never arrived." } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Talk through your claim" })).toHaveCount(0);
  await expect(page.locator(".voice-toolbar")).toHaveCount(0);
  const field = page.locator("#problem");
  const control = fieldControl(page, field);
  await field.fill("I paid a deposit.");
  await control.getByRole("button", { name: "Start microphone" }).click();
  await expect(control.getByLabel("Speech language")).toHaveText("Detect language automatically");
  expect(requests).toBe(0);
  await control.getByLabel("I allow OpenRouter").check();
  await record(control);
  await expect(field).toHaveValue("I paid a deposit. The delivery never arrived.");
  await expect(control.getByRole("status")).toContainText("Check and edit");
  // The second textarea has its own mic, using the same explicit consent.
  const outcome = page.locator("#outcome");
  await record(fieldControl(page, outcome));
  await expect(outcome).toHaveValue("The delivery never arrived.");
});

test("structured inputs have embedded mics and preserve values on oversized transcription", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  let transcript = "x".repeat(100);
  await page.route("**/api/transcribe", route => route.fulfill({ json: { text: transcript } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sale of goods", exact: true }).click();
  await page.getByRole("button", { name: "Organise my claim" }).click();
  const field = page.getByLabel("Existing case reference");
  const control = fieldControl(page, field);
  await field.fill("REF");
  await control.getByRole("button", { name: "Start microphone" }).click();
  await control.getByLabel("I allow OpenRouter").check();
  await record(control);
  await expect(control.getByRole("status")).toContainText("exceeds this field’s character limit");
  await expect(field).toHaveValue("REF");
  transcript = "2026";
  await record(control);
  await expect(field).toHaveValue("REF 2026");
  for (const input of await page.locator('textarea, input:not([type]), input[type="date"]').all()) {
    await expect(input.locator("..").locator(".voice-mic")).toHaveCount(1);
  }
});

test("revoking consent cancels pending transcription without changing the field", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  let complete = () => {};
  const pending = new Promise<void>(resolve => { complete = resolve; });
  await page.route("**/api/transcribe", async route => { await pending; await route.fulfill({ json: { text: "Discard this" } }).catch(() => {}); });
  await page.goto("/");
  const field = page.locator("#problem"); const control = fieldControl(page, field);
  await field.fill("Keep my account.");
  await control.getByRole("button", { name: "Start microphone" }).click();
  await control.getByLabel("I allow OpenRouter").check();
  await record(control);
  await expect(control.getByRole("status")).toContainText("Transcribing");
  await control.getByLabel("I allow OpenRouter").uncheck(); complete();
  await expect(control.getByRole("status")).toContainText("cancelled");
  await expect(field).toHaveValue("Keep my account.");
});
