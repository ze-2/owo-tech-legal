import { test, expect } from "@playwright/test";
import { textDocx, textPdf } from "../fixtures";

test("new claim can be reviewed, researched in reference mode, and exported", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "what happened",
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-start.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Organise my claim" }).click();
  await expect(page.locator(".feedback[role=alert]")).toContainText(
    "at least 30 characters",
  );
  await page.getByRole("button", { name: "Sale of goods" }).click();
  await page
    .locator('input[aria-label="Attach evidence files"]')
    .setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Receipt for an SGD 800 trombone deposit paid to Music Elements.",
      ),
    });
  await expect(
    page.getByText("Text extracted · review against the original"),
  ).toBeVisible();
  await page
    .getByLabel("What receipt.txt shows")
    .fill("Evidence of the S$800 deposit paid for the trombone.");
  await page.getByRole("button", { name: "Organise my claim" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "clearly organised",
  );
  await expect(page.getByLabel("Your details (claimant)")).toHaveValue(
    "Alex Tan",
  );
  await expect(page.getByLabel("Total claim value (S$)")).toHaveValue("800");
  await page
    .getByLabel("What has the other party said?")
    .fill("They have not answered my calls or returned the deposit.");
  await page
    .getByLabel("Can the respondent be served in Singapore?")
    .selectOption("yes");
  await page.getByRole("button", { name: "Review official guidance" }).click();
  await expect(
    page.getByText("Reference guidance · no live research has been performed"),
  ).toBeVisible();
  await expect(page.locator(".research-card")).toHaveCount(5);
  await expect(page.locator(".order-grid > div")).toHaveCount(8);
  await page.getByRole("button", { name: "Prepare my filing pack" }).click();
  await expect(page.getByText("S$10.00", { exact: true })).toBeVisible();
  const portal = page.getByText("Continue to the CJTS portal", { exact: true });
  await expect(portal).toHaveAttribute("aria-disabled", "true");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download draft" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "clearclaim-preparation-draft.md",
  );
  await page.getByLabel("I have reviewed the draft against my records").check();
  await expect(portal).toHaveAttribute(
    "href",
    "https://cjts.judiciary.gov.sg/",
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-filing.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("starting point switches the first panel and preserves entered text", async ({
  page,
}) => {
  await page.goto("/");
  const existing = page.getByRole("button", { name: "I have an existing claim" });
  const newClaim = page.getByRole("button", { name: "Start a new claim" });
  const message = "I want to keep this unsent message.";
  await page.getByLabel("Your next message").fill(message);
  await existing.click();
  await expect(existing).toHaveAttribute("aria-pressed", "true");
  await expect(newClaim).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Import a claim document" }),
  ).toBeInViewport();
  await page.getByLabel("Existing claim text").fill("My existing claim details.");
  await newClaim.click();
  await expect(newClaim).toHaveAttribute("aria-pressed", "true");
  await expect(existing).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("heading", { name: "Talk through your claim" }),
  ).toBeInViewport();
  await expect(page.getByLabel("Your next message")).toHaveValue(message);
  await expect(page.getByLabel("What’s the problem?", { exact: true })).toHaveValue(
    "My existing claim details.",
  );
});

test("existing claim import and unread image descriptions are explicit", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have an existing claim" }).click();
  await expect(
    page.getByRole("button", { name: "Import a claim document" }),
  ).toBeInViewport();
  await page
    .locator('input[aria-label="Import claim document"]')
    .setInputFiles({
      name: "claim.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Claimant: Mei Lim\nRespondent: Example Store\nCase number: SCT-EXAMPLE-001\nRelief sought: Refund of the purchase price.\nThe purchased goods were not delivered as agreed.",
      ),
    });
  await expect(page.getByLabel("Existing claim text")).toContainText("Mei Lim");
  await page
    .locator('input[aria-label="Attach evidence files"]')
    .setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  await expect(
    page.getByText(
      "Image attached · add a description; image content is not read",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Organise my claim" }).click();
  await expect(page.getByLabel("Existing case reference")).toHaveValue(
    "SCT-EXAMPLE-001",
  );
  await page.getByRole("button", { name: "Prepare to file" }).click();
  await expect(
    page.getByText("Open my case in CJTS", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("document endpoint extracts PDF and DOCX text and rejects invalid files", async ({
  request,
}) => {
  const text = "Receipt: Kitchen cabinet installation. Amount paid SGD 2400.";
  for (const [name, mimeType, buffer] of [
    ["receipt.pdf", "application/pdf", textPdf(text)],
    [
      "receipt.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      textDocx(text),
    ],
  ] as const) {
    const response = await request.post("/api/extract", {
      multipart: { file: { name, mimeType, buffer } },
    });
    const body = await response.json();
    expect(body.error).toBeUndefined();
    expect(response.status()).toBe(200);
    expect(body.text).toContain(text);
    expect(body.status).toBe("extracted");
  }
  const invalid = await request.post("/api/extract", {
    multipart: {
      file: {
        name: "fake.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a PDF"),
      },
    },
  });
  expect(invalid.status()).toBe(400);
});
