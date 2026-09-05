/* global chrome */
import { createProgress } from "./progressive-popup.mjs";
import { initFormTransfer } from "./form-popup.mjs";
import { assistAssessment } from "./assessment-assist.mjs";
import {
  claimTypeRecommendation,
  optionId,
  sctGroups,
} from "./claim-type.mjs";
import { runAction } from "./run-action.mjs";
import { MAX_PACKAGE_BYTES, parsePackage } from "./transfer.mjs";

const packageInput = document.querySelector("#package");
const scanButton = document.querySelector("#scan");
const applyButton = document.querySelector("#apply");
const options = document.querySelector("#options");
const status = document.querySelector("#status");
const suggestion = document.querySelector("#suggestion");
let pack = null;
let tabId = null;
let rows = [];
let generation = 0;
const progress = createProgress(() => pack);
const formTransfer = initFormTransfer(() => pack);

function resetPreview() {
  generation++;
  progress.reset();
  formTransfer.reset();
  tabId = null;
  rows = [];
  options.replaceChildren();
  applyButton.disabled = true;
  scanButton.disabled = false;
}

function setBusy(busy) {
  scanButton.disabled = busy;
  applyButton.disabled =
    busy || !rows.some((row) => row.found && !row.reason);
}

async function fillImportedPackage(current) {
  const activeId = await activeTab();
  if (current !== generation) return;
  tabId = activeId;
  const [destination] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => location.pathname,
  });
  if (current !== generation) return;
  if (!["/prefiling/prefilingAssessment", "/mock-sct.html"].includes(destination.result)) {
    const result = await formTransfer.autoFill(activeId);
    if (current === generation)
      status.textContent = `${result.filled} approved claim-form fields filled. Nothing submitted.`;
    return;
  }
  try {
    const [scan] = await chrome.scripting.executeScript({
      target: { tabId },
      func: assistAssessment,
      args: ["scan", sctGroups],
    });
    if (scan.error) throw new Error(scan.error.message);
    if (!scan.result) throw new Error("CJTS could not be inspected. Check that the SCT form is ready and no dialog is open.");
    if (current !== generation) return;
    const groups = scan.result.groups;
    const expected = Object.fromEntries(
      groups.flatMap((group) => group.options).map((row) => [row.id, row.signature]),
    );
    const selected = pack.assessment.sctOptions.map((option) =>
      optionId(option.groupId, option.label),
    );
    const [applied] = await chrome.scripting.executeScript({
      target: { tabId },
      func: assistAssessment,
      args: ["apply", sctGroups, { selected, expected }],
    });
    if (applied.error) throw new Error(applied.error.message);
    if (current !== generation) return;
    const count = applied.result.options.filter((row) => row.applied).length;
    await progress.connect(tabId, true);
    if (current === generation)
      status.textContent = `${count} reviewed SCT subtype${count === 1 ? "" : "s"} selected. Approved fields will fill as CJTS reveals them; answer CJTS questions yourself.`;
  } catch (error) {
    // A normal CJTS claim form has no pre-filing assessment root. It uses the
    // same reviewed package, so transfer its compatible fields immediately.
    if (
      ![
        "Open the official SCT pre-filing assessment first.",
      ].includes(String(error.message))
    )
      throw error;
    const result = await formTransfer.autoFill(activeId);
    if (current === generation)
      status.textContent = `${result.filled} approved claim-form field${result.filled === 1 ? "" : "s"} filled. Nothing submitted.`;
  }
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
  resetPreview();
  const current = generation;
  scanButton.disabled = true;
  pack = null;
  suggestion.textContent = "";
  try {
    const file = packageInput.files[0];
    if (!file || file.size > MAX_PACKAGE_BYTES)
      throw new Error("Choose a JSON package no larger than 2 MB.");
    const text = await file.text();
    if (current !== generation) return;
    pack = parsePackage(text);
    const claimType = pack.fields.claimType?.value;
    const recommendation = claimTypeRecommendation(claimType);
    suggestion.textContent = claimType
      ? recommendation
        ? `Approved category: ${claimType}. Its reviewed SCT subtype choices will be selected automatically.`
        : `Approved category: ${claimType}. Its reviewed SCT subtype choices will be selected automatically.`
      : "Reviewed SCT subtype choices will be selected automatically.";
    status.textContent = `${Object.keys(pack.fields).length} approved fields and ${pack.assessment.sctOptions.length} reviewed SCT subtypes loaded. Filling the active CJTS page…`;
    formTransfer.loaded();
    await fillImportedPackage(current);
  } catch (error) {
    if (current !== generation) return;
    status.textContent = error.message;
  } finally {
    if (current === generation) {
      // Selecting the same downloaded file must still trigger a fresh import.
      packageInput.value = "";
      scanButton.disabled = false;
    }
  }
});

scanButton.addEventListener("click", async () => {
  const current = generation;
  setBusy(true);
  options.replaceChildren();
  rows = [];
  try {
    const activeId = await activeTab();
    if (current !== generation) return;
    tabId = activeId;
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: assistAssessment,
      args: ["scan", sctGroups],
    });
    if (execution.error) throw new Error(execution.error.message);
    if (current !== generation) return;
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
    await progress.connect(tabId);
    const exact = recommendation?.option
      ? optionId(recommendation.groupId, recommendation.option)
      : "";
    status.textContent = exact
      ? "An exact reviewed category was preselected. Confirm it before applying."
      : recommendation
        ? "The matching group is outlined. Choose the specific dispute option(s)."
        : "Choose the specific dispute option(s), then apply.";
  } catch (error) {
    if (current !== generation) return;
    status.textContent = `Could not inspect this page: ${error.message}`;
  } finally {
    if (current === generation) setBusy(false);
  }
});

applyButton.addEventListener("click", async () => {
  const current = generation;
  setBusy(true);
  try {
    if (tabId !== (await activeTab()))
      throw new Error("The active tab changed; scan again.");
    if (current !== generation) return;
    const selected = [
      ...options.querySelectorAll(
        'input[type="checkbox"]:checked:not(:disabled)',
      ),
    ].map((input) => input.value);

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
        },
      ],
    });
    if (execution.error) throw new Error(execution.error.message);
    if (current !== generation) return;
    const result = execution.result;
    const applied = result.options.filter((row) => row.applied).length;
    const details = [
      `${applied} of ${selected.length} selected options applied.`,
    ].filter(Boolean);
    status.textContent = `${details.join(" ")} Review CJTS before submitting.`;
    applyButton.disabled = true;
    scanButton.disabled = false;
    await progress.connect(tabId, true);
  } catch (error) {
    if (current !== generation) return;
    status.textContent = `Nothing further applied: ${error.message}`;
    setBusy(false);
  }
});

document.querySelector("#clear").addEventListener("click", () => {
  resetPreview();
  pack = null;
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
