/* global chrome */
import { filingFields, parsePackage } from "./shared/transfer.mjs";
import { assistForm } from "./form-assist.mjs";
const input = document.querySelector("#package"),
  status = document.querySelector("#status");
const preview = document.querySelector("#preview"),
  fill = document.querySelector("#fill"),
  container = document.querySelector("#fields");
let pack = null,
  tabId = null,
  rows = [];
function reset() {
  pack = null;
  rows = [];
  tabId = null;
  preview.disabled = true;
  fill.disabled = true;
  container.replaceChildren();
}
input.addEventListener("change", async () => {
  reset();
  try {
    const file = input.files[0];
    if (!file || file.size > 350000)
      throw new Error("Choose a JSON package smaller than 350 KB.");
    pack = parsePackage(await file.text());
    preview.disabled = false;
    status.textContent = `${Object.keys(pack.fields).length} approved fields loaded. Preview before filling.`;
  } catch (error) {
    status.textContent = error.message;
  }
});
preview.addEventListener("click", async () => {
  fill.disabled = true;
  container.replaceChildren();
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tab.id;
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: assistForm,
      args: ["preview", pack.fields],
    });
    rows = result[0].result;
    for (const row of rows) {
      const label = document.createElement("label"),
        checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = row.key;
      checkbox.checked = row.found;
      checkbox.disabled = !row.found;
      const text = document.createElement("span");
      text.textContent = `${filingFields[row.key]}: ${pack.fields[row.key].value}${row.reason ? ` — ${row.reason}` : ""}`;
      label.append(checkbox, text);
      container.append(label);
    }
    status.textContent = `${rows.filter((r) => r.found).length} compatible fields. Missing and unapproved fields are not invented. Deselect any value you do not want to transfer.`;
    fill.disabled = !rows.some((r) => r.found);
  } catch (error) {
    status.textContent = `Could not inspect this page: ${error.message}`;
  }
});
fill.addEventListener("click", async () => {
  fill.disabled = true;
  try {
    const selected = Array.from(
      container.querySelectorAll("input:checked"),
    ).map((el) => el.value);
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: assistForm,
      args: [
        "fill",
        pack.fields,
        selected,
        Object.fromEntries(rows.map((r) => [r.key, r.signature])),
      ],
    });
    const filled = result[0].result.filter((row) => row.filled).length;
    status.textContent = `${filled} fields filled. ${selected.length - filled} selected fields skipped. Please review every field in CJTS before continuing. Clearclaim has not submitted anything. Preview again to inspect skipped fields.`;
  } catch (error) {
    status.textContent = `Nothing further filled: ${error.message}`;
  }
});
document.querySelector("#clear").addEventListener("click", () => {
  reset();
  input.value = "";
  status.textContent = "Package cleared.";
});
