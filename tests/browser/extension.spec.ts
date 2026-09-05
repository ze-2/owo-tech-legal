import { test, expect } from "@playwright/test";
import { loadExtension } from "./extension-harness";

const approvedPackage = {
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
    amount: { value: "2400", review: "approved", provenance: "user" },
    summary: {
      value: "Kitchen renovation was left unfinished.",
      review: "approved",
      provenance: "user",
    },
  },
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
  const { context, id } = await loadExtension("extension");
  try {
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

test("the loaded popup previews, honours deselection, fills, and never submits", async ({
  baseURL,
}) => {
  test.skip(
    test.info().project.name !== "desktop",
    "Chrome extension is a desktop surface",
  );
  const { context, id } = await loadExtension("extension", true);
  try {
    const form = await context.newPage();
    await form.goto(`${baseURL}/mock-cjts.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    // The popup asks for the active tab, so the form must be the active one —
    // exactly the arrangement a real toolbar-invoked popup sees.
    await form.bringToFront();

    await popup
      .getByLabel("Approved filing package")
      .setInputFiles(packageFile(approvedPackage));
    await expect(popup.getByRole("status")).toContainText(
      "4 approved fields loaded",
    );

    await popup
      .getByRole("button", { name: "Preview compatible fields" })
      .dispatchEvent("click");
    await expect(popup.getByRole("status")).toContainText("compatible fields");
    const fillButton = popup.getByRole("button", {
      name: "Fill selected fields",
    });
    await expect(fillButton).toBeEnabled();

    // Deselect one approved field: the user's choice must be respected.
    const respondentRow = popup
      .locator("#fields label")
      .filter({ hasText: "Respondent particulars" })
      .locator("input[type=checkbox]");
    await expect(respondentRow).toBeChecked();
    await respondentRow.uncheck({ force: true });

    await fillButton.dispatchEvent("click");
    await expect(popup.getByRole("status")).toContainText("fields filled");

    await expect(form.getByLabel("Claimant particulars")).toHaveValue("Mei Lim");
    await expect(form.getByLabel("Claim amount (SGD)")).toHaveValue("2400");
    await expect(form.getByLabel("Description of claim")).toHaveValue(
      "Kitchen renovation was left unfinished.",
    );
    // Deselected, so it must remain untouched even though it was approved.
    await expect(form.getByLabel("Respondent particulars")).toHaveValue("");

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
  const { context, id } = await loadExtension("extension", true);
  try {
    const form = await context.newPage();
    await form.goto(`${baseURL}/mock-cjts.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await form.bringToFront();

    await popup
      .getByLabel("Approved filing package")
      .setInputFiles(packageFile(approvedPackage));
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
    await expect(popup.getByRole("status")).toContainText("filled");
    await expect(form.locator("#claimant-renamed")).toHaveValue("");
    expect(await form.evaluate(
      () => (window as unknown as { submissionCount: number }).submissionCount,
    )).toBe(0);
  } finally {
    await context.close();
  }
});
