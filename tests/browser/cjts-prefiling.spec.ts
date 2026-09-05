import { expect, test } from "@playwright/test";
import { assistAssessment } from "../../cjts-prefiling/assessment-assist.mjs";
import { sctGroups } from "../../cjts-prefiling/claim-type.mjs";

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

  const rejected = (await page.evaluate(
    callSource("apply", {
      selected: [target.id],
      expected: { [target.id]: "changed" },
      amount: "1500.50",
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
      amount: "1500.50",
      incidentDate: "2026-09-01",
    }),
  )) as ApplyResult;
  expect(applied.options[0].applied).toBe(true);
  expect(applied.amount.filled).toBe(true);
  expect(applied.incidentDate.reason).toContain("date picker");
  await expect(page.locator("input#\\30")).toBeChecked();
  await expect(page.getByLabel("Claim Amount")).toHaveValue("1500.50");
});
