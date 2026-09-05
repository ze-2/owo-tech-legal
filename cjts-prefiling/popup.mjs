/* global chrome */
import { assistAssessment } from "./assessment-assist.mjs";
import {
  claimTypeRecommendation,
  optionId,
  sctGroups,
} from "./claim-type.mjs";
import { runAction } from "./run-action.mjs";
import { parsePackage } from "./transfer.mjs";

const packageInput = document.querySelector("#package");
const scanButton = document.querySelector("#scan");
const applyButton = document.querySelector("#apply");
const options = document.querySelector("#options");
const status = document.querySelector("#status");
const suggestion = document.querySelector("#suggestion");
let pack = null;
let tabId = null;
let rows = [];

function setBusy(busy) {
  scanButton.disabled = busy;
  applyButton.disabled =
    busy || !rows.some((row) => row.found && !row.reason);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) throw new Error("No active tab.");
  return tab.id;
}

packageInput.addEventListener("change", async () => {
  pack = null;
  suggestion.textContent = "";
  try {
    const file = packageInput.files[0];
    if (!file || file.size > 350000)
      throw new Error("Choose a JSON package smaller than 350 KB.");
    pack = parsePackage(await file.text());
    const claimType = pack.fields.claimType?.value;
    const recommendation = claimTypeRecommendation(claimType);
    suggestion.textContent = claimType
      ? recommendation
        ? `Approved category: ${claimType}. Scan to review the matching portal group.`
        : `Approved category: ${claimType}. It has no unique SCT option mapping.`
      : "The package has no approved claim category; choose portal options manually.";
    status.textContent = `${Object.keys(pack.fields).length} approved fields loaded.`;
  } catch (error) {
    status.textContent = error.message;
  }
});

scanButton.addEventListener("click", async () => {
  setBusy(true);
  options.replaceChildren();
  rows = [];
  try {
    tabId = await activeTab();
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: assistAssessment,
      args: ["scan", sctGroups],
    });
    if (execution.error) throw new Error(execution.error.message);
    const groups = execution.result.groups;
    rows = groups.flatMap((group) => group.options);
    const recommendation = claimTypeRecommendation(pack?.fields.claimType?.value);
    for (const group of groups) {
      const fieldset = document.createElement("fieldset");
      if (recommendation?.groupId === group.id)
        fieldset.classList.add("recommended");
      const legend = document.createElement("legend");
      legend.textContent = group.label;
      fieldset.append(legend);
      for (const row of group.options) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = row.id;
        checkbox.checked =
          row.checked ||
          (recommendation?.option === row.label &&
            recommendation.groupId === group.id);
        checkbox.disabled =
          !row.found || row.disabled || Boolean(row.reason) || row.checked;
        const text = document.createElement("span");
        text.textContent = row.checked
          ? `${row.label} (already selected)`
          : row.label;
        label.append(checkbox, text);
        if (row.reason) {
          const reason = document.createElement("span");
          reason.className = "reason";
          reason.textContent = row.reason;
          label.append(reason);
        }
        fieldset.append(label);
      }
      options.append(fieldset);
    }
    const exact = recommendation?.option
      ? optionId(recommendation.groupId, recommendation.option)
      : "";
    status.textContent = exact
      ? "An exact reviewed category was preselected. Confirm it before applying."
      : recommendation
        ? "The matching group is outlined. Choose the specific dispute option(s)."
        : "Choose the specific dispute option(s), then apply.";
  } catch (error) {
    status.textContent = `Could not inspect this page: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

applyButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    if (tabId !== (await activeTab()))
      throw new Error("The active tab changed; scan again.");
    const selected = [
      ...options.querySelectorAll(
        'input[type="checkbox"]:checked:not(:disabled)',
      ),
    ].map((input) => input.value);
    if (!selected.length)
      throw new Error("Select at least one new dispute option.");
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: assistAssessment,
      args: [
        "apply",
        sctGroups,
        {
          selected,
          expected: Object.fromEntries(
            rows.map((row) => [row.id, row.signature]),
          ),
          // Pass the approved field objects, not bare values, so the injected
          // script can re-verify approval at its own boundary.
          amount: pack?.fields.amount || null,
          incidentDate: pack?.fields.incidentDate || null,
        },
      ],
    });
    if (execution.error) throw new Error(execution.error.message);
    const result = execution.result;
    const applied = result.options.filter((row) => row.applied).length;
    const details = [
      `${applied} of ${selected.length} selected options applied.`,
      result.amount?.filled ? "Claim Amount filled." : result.amount?.reason,
      result.incidentDate?.reason,
    ].filter(Boolean);
    status.textContent = `${details.join(" ")} Review CJTS before submitting.`;
    applyButton.disabled = true;
  } catch (error) {
    status.textContent = `Nothing further applied: ${error.message}`;
    setBusy(false);
  }
});

document.querySelector("#clear").addEventListener("click", () => {
  pack = null;
  tabId = null;
  rows = [];
  packageInput.value = "";
  options.replaceChildren();
  suggestion.textContent = "";
  applyButton.disabled = true;
  status.textContent = "Cleared. Open the SCT assessment, then scan.";
});

for (const button of document.querySelectorAll("button[data-action]")) {
  button.addEventListener("click", async () => {
    try {
      const id = await activeTab();
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: runAction,
        args: [button.dataset.action],
      });
      if (execution.error) throw new Error(execution.error.message);
      status.textContent = "Clicked. Check the CJTS page for the result.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
}
