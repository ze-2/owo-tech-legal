import { test, expect } from "@playwright/test";
import { loadExtension } from "./extension-harness";

const approvedPackage = {
  version: 2,
  generatedAt: new Date().toISOString(),
  userReviewed: true,
  fields: {
    claimant: { value: "Mei Lim", review: "approved", provenance: "user" },
    respondent: {
      value: "Example Renovation",
      review: "approved",
      provenance: "user",
    },
    amount: { value: "2400", review: "approved", provenance: "user" },
    summary: {
      value: "Kitchen renovation was left unfinished.",
      review: "approved",
      provenance: "user",
    },
  },
  assessment: { sctOptions: [{ groupId: "services", label: "Incomplete Services" }] },
};

function packageFile(pack: unknown) {
  return {
    name: "approved.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack)),
  };
}

test("unpacked extension validates imports and fails safely without page permission", async ({
  baseURL,
}) => {
  // Extension UIs are desktop Chrome surfaces, independent of the phone workspace test.
  test.skip(
    test.info().project.name !== "desktop",
    "Chrome extension is a desktop surface",
  );
  const { context, id } = await loadExtension("cjts-prefiling");
  try {
    const form = await context.newPage();
    await form.goto(`${baseURL}/mock-cjts.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByText("Claim form transfer", { exact: true }).click();
    // Opening the popup as a tab does not grant activeTab. Exercise this actual
    // permission failure boundary without adding host permissions to production.
    await popup
      .locator("#package")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"version":1}'),
      });
    await expect(popup.locator("#status")).toContainText(
      "Unsupported transfer version",
    );
    const pack = {
      version: 2,
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
      assessment: { sctOptions: [{ groupId: "services", label: "Incomplete Services" }] },
    };
    await popup
      .locator("#package")
      .setInputFiles({
        name: "approved.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(pack)),
      });
    await expect(popup.locator("#status")).toContainText(
      "Cannot access",
    );
    await expect(
      popup.getByRole("button", { name: "Preview compatible fields" }),
    ).toBeEnabled();
    // Test actual popup failure boundary: opening an unsupported tab cannot fill it.
    await popup
      .getByRole("button", { name: "Preview compatible fields" })
      .click();
    await expect(popup.locator("#form-status")).toContainText(
      "Could not inspect this page",
    );
    await expect(
      popup.getByRole("button", { name: "Fill selected fields" }),
    ).toBeDisabled();
    await expect(form.getByLabel("Claimant particulars")).toHaveValue("");
    await expect(form.locator("#submission-status")).toHaveText(
      "Nothing submitted.",
    );
    await popup.getByRole("button", { name: "Clear" }).click();
    await expect(popup.locator("#status")).toHaveText("Cleared. Open the SCT assessment, then scan.");
  } finally {
    await context.close();
  }
});

test("import alone fills every compatible approved field and never submits", async ({
  baseURL,
}) => {
  test.skip(
    test.info().project.name !== "desktop",
    "Chrome extension is a desktop surface",
  );
  const { context, id } = await loadExtension("cjts-prefiling", true);
  try {
    const form = await context.newPage();
    await form.goto(`${baseURL}/mock-cjts.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByText("Claim form transfer", { exact: true }).click();
    // The popup asks for the active tab, so the form must be the active one —
    // exactly the arrangement a real toolbar-invoked popup sees.
    await form.bringToFront();

    await popup
      .locator("#package")
      .setInputFiles(packageFile(approvedPackage));
    await expect(popup.locator("#status")).toContainText(
      "4 approved claim-form fields filled",
    );

    await expect(form.getByLabel("Claimant particulars")).toHaveValue("Mei Lim");
    await expect(form.getByLabel("Claim amount (SGD)")).toHaveValue("2400");
    await expect(form.getByLabel("Description of claim")).toHaveValue(
      "Kitchen renovation was left unfinished.",
    );
    await expect(form.getByLabel("Respondent particulars")).toHaveValue("Example Renovation");

    // The load-bearing guarantee: assisted transfer never submits.
    expect(await form.evaluate(
      () => (window as unknown as { submissionCount: number }).submissionCount,
    )).toBe(0);
    await expect(form.locator("#submission-status")).toHaveText(
      "Nothing submitted.",
    );
  } finally {
    await context.close();
  }
});

test("a stale preview signature refuses to fill after the page changes", async ({
  baseURL,
}) => {
  test.skip(
    test.info().project.name !== "desktop",
    "Chrome extension is a desktop surface",
  );
  const { context, id } = await loadExtension("cjts-prefiling", true);
  try {
    const form = await context.newPage();
    await form.goto(`${baseURL}/mock-cjts.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByText("Claim form transfer", { exact: true }).click();
    await form.bringToFront();

    await popup
      .locator("#package")
      .setInputFiles(packageFile(approvedPackage));
    await expect(form.getByLabel("Claimant particulars")).toHaveValue("Mei Lim");
    await form.getByLabel("Claimant particulars").fill("");
    await popup
      .getByRole("button", { name: "Preview compatible fields" })
      .dispatchEvent("click");
    await expect(
      popup.getByRole("button", { name: "Fill selected fields" }),
    ).toBeEnabled();

    // The page changes between preview and fill: the values the user reviewed
    // are no longer the values on screen, so nothing may be written.
    await form.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>("#claimant")!;
      el.setAttribute("aria-label", "Renamed since preview");
      el.id = "claimant-renamed";
    });

    await popup
      .getByRole("button", { name: "Fill selected fields" })
      .dispatchEvent("click");
    await expect(popup.locator("#form-status")).toContainText("filled");
    await expect(form.locator("#claimant-renamed")).toHaveValue("");
    expect(await form.evaluate(
      () => (window as unknown as { submissionCount: number }).submissionCount,
    )).toBe(0);
  } finally {
    await context.close();
  }
});
