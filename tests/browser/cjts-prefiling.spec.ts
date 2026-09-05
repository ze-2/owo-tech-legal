import { expect, test } from "@playwright/test";
import { assistAssessment } from "../../cjts-prefiling/assessment-assist.mjs";
import { sctGroups } from "../../cjts-prefiling/claim-type.mjs";
import { runAction } from "../../cjts-prefiling/run-action.mjs";
import { loadExtension, readClicks } from "./extension-harness";

type ScanResult = {
  groups: Array<{
    options: Array<{ id: string; signature: string }>;
  }>;
};
type ApplyResult = {
  options: Array<{ applied: boolean; reason: string }>;
  amount: { filled: boolean };
  incidentDate: { reason: string };
};

function callSource(action: string, payload: object = {}) {
  return `(${assistAssessment.toString()})(${JSON.stringify(action)}, ${JSON.stringify(sctGroups)}, ${JSON.stringify(payload)})`;
}

test("SCT helper scans exact options, clicks a reviewed target, and fills amount", async ({
  page,
}) => {
  await page.goto("/mock-sct.html");
  const scan = (await page.evaluate(callSource("scan"))) as ScanResult;
  expect(scan.groups).toHaveLength(1);
  expect(scan.groups[0].options).toHaveLength(8);
  const target = scan.groups[0].options[0];

  const approvedAmount = {
    value: "1500.50",
    review: "approved",
    provenance: "user",
  };

  const rejected = (await page.evaluate(
    callSource("apply", {
      selected: [target.id],
      expected: { [target.id]: "changed" },
      amount: approvedAmount,
    }),
  )) as ApplyResult;
  expect(rejected.options[0]).toMatchObject({
    applied: false,
    reason: "Form changed since preview",
  });
  await expect(page.locator("input#\\30")).not.toBeChecked();

  const applied = (await page.evaluate(
    callSource("apply", {
      selected: [target.id],
      expected: { [target.id]: target.signature },
      amount: approvedAmount,
      incidentDate: {
        value: "2026-09-01",
        review: "approved",
        provenance: "user",
      },
    }),
  )) as ApplyResult;
  expect(applied.options[0].applied).toBe(true);
  expect(applied.amount.filled).toBe(true);
  expect(applied.incidentDate.reason).toContain("date picker");
  await expect(page.locator("input#\\30")).toBeChecked();
  await expect(page.getByLabel("Claim Amount")).toHaveValue("1500.50");
});

// The SCT helper's own manifest, popup and chrome.scripting wiring previously
// had no coverage of any kind: every assertion above calls the injected function
// directly. These load the extension for real.

test("the loaded SCT popup scans, applies a reviewed option and fills the amount", async ({
  baseURL,
}) => {
  test.skip(
    test.info().project.name !== "desktop",
    "Chrome extension is a desktop surface",
  );
  const { context, id } = await loadExtension("cjts-prefiling", true);
  try {
    const portal = await context.newPage();
    await portal.goto(`${baseURL}/mock-sct.html`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await portal.bringToFront();

    const pack = {
      version: 1,
      generatedAt: new Date().toISOString(),
      userReviewed: true,
      fields: {
        claimType: {
          value: "Sale of goods",
          review: "approved",
          provenance: "user",
        },
        amount: { value: "1500.50", review: "approved", provenance: "user" },
      },
    };
    await popup
      .getByLabel("Approved filing package (optional)")
      .setInputFiles({
        name: "approved.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(pack)),
      });
    await expect(popup.getByRole("status")).toContainText(
      "2 approved fields loaded",
    );

    await popup
      .getByRole("button", { name: "Scan SCT options" })
      .dispatchEvent("click");
    await expect(popup.locator("#options fieldset")).toHaveCount(1);
    await expect(popup.locator("#options label")).toHaveCount(8);

    const target = popup
      .locator("#options label")
      .filter({ hasText: "Defective Goods" })
      .locator("input[type=checkbox]");
    await target.check({ force: true });

    await popup
      .getByRole("button", { name: "Apply selected options" })
      .dispatchEvent("click");
    await expect(popup.getByRole("status")).toContainText("applied");

    await expect(portal.locator("input#\\30")).toBeChecked();
    await expect(portal.getByLabel("Claim Amount")).toHaveValue("1500.50");
    // The date picker is deliberately never written to.
    await expect(portal.locator('input[name="d2"]')).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("terms-page actions click only allowlisted controls and never submit", async ({
  page,
}) => {
  await page.goto("/mock-terms.html");
  const call = (action: unknown) =>
    `(${runAction.toString()})(${JSON.stringify(action)})`;

  expect(await page.evaluate(call("cancel"))).toMatchObject({
    action: "cancel",
    clicked: true,
  });
  expect(await page.evaluate(readClicks)).toEqual(["Cancel"]);

  expect(await page.evaluate(call("terms"))).toMatchObject({ clicked: true });

  // Anything outside the hardcoded allowlist is refused, including selectors an
  // imported package might try to smuggle in.
  await expect(page.evaluate(call("evil"))).rejects.toThrow("Unknown action");
  await expect(
    page.evaluate(call('button[aria-label="Proceed"]')),
  ).rejects.toThrow("Unknown action");

  // An open dialog blocks every action.
  await page.evaluate(() => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
  });
  await expect(page.evaluate(call("cancel"))).rejects.toThrow(
    "Close the site's dialog",
  );
  await page.evaluate(() =>
    document.querySelector('[role="dialog"]')!.remove(),
  );

  // A disabled control is the site's decision and must be respected.
  await page.evaluate(() =>
    document
      .querySelector("#btnSubmit")!
      .setAttribute("aria-disabled", "true"),
  );
  await expect(page.evaluate(call("proceed"))).rejects.toThrow(
    "The site has disabled this action",
  );
  await page.evaluate(() =>
    document.querySelector("#btnSubmit")!.removeAttribute("aria-disabled"),
  );

  // An ambiguous match means the page is not what was reviewed.
  await page.evaluate(() => {
    const extra = document.createElement("button");
    extra.type = "button";
    extra.setAttribute("aria-label", "Cancel");
    extra.textContent = "Cancel";
    document.querySelector("app-prefiling-terms")!.append(extra);
  });
  await expect(page.evaluate(call("cancel"))).rejects.toThrow(
    "Expected one visible control",
  );
});

test("terms-page actions refuse to run on any other page", async ({ page }) => {
  await page.goto("/mock-sct.html");
  await expect(
    page.evaluate(`(${runAction.toString()})("proceed")`),
  ).rejects.toThrow("Open the official CJTS pre-filing terms page first");
});

test("the injected script re-checks approval at its own boundary", async ({
  page,
}) => {
  await page.goto("/mock-sct.html");
  const scan = (await page.evaluate(callSource("scan"))) as ScanResult;
  const target = scan.groups[0].options[0];
  const base = {
    selected: [target.id],
    expected: { [target.id]: target.signature },
  };

  // An unapproved value must not be written even though it reached the
  // injected script — matching the same re-check assistForm performs.
  for (const amount of [
    { value: "1500.50", review: "unreviewed", provenance: "user" },
    { value: "1500.50", provenance: "user" },
    "1500.50",
  ]) {
    await page.goto("/mock-sct.html");
    const result = (await page.evaluate(
      callSource("apply", { ...base, amount }),
    )) as ApplyResult;
    expect(result.amount).toBeNull();
    await expect(page.getByLabel("Claim Amount")).toHaveValue("");
  }
});
