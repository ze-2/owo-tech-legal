/* global chrome */
import { assistForm } from './form-assist.mjs';
import { filingFields } from './transfer.mjs';

export function initFormTransfer(getPack) {
  const preview = document.querySelector('#preview');
  const fill = document.querySelector('#fill');
  const container = document.querySelector('#fields');
  const status = document.querySelector('#form-status');
  let tabId = null, rows = [], epoch = 0;
  function reset() {
    epoch++;
    tabId = null;
    rows = [];
    preview.disabled = true;
    fill.disabled = true;
    container.replaceChildren();
    status.textContent = 'Import an approved JSON package first.';
  }
  preview.addEventListener('click', async () => {
    const current = ++epoch;
    fill.disabled = true;
    container.replaceChildren();
    try {
      const pack = getPack();
      if (!pack) throw new Error('Import an approved JSON package first.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (current !== epoch) return;
      tabId = tab.id;
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: assistForm, args: ['preview', pack.fields] });
      if (current !== epoch) return;
      if (result.error) throw new Error(result.error.message);
      rows = result.result;
      for (const row of rows) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = row.key;
        checkbox.checked = row.found;
        checkbox.disabled = !row.found;
        const text = document.createElement('span');
        text.textContent = `${filingFields[row.key]}: ${pack.fields[row.key].value}${row.reason ? ` — ${row.reason}` : ''}`;
        label.append(checkbox, text);
        container.append(label);
      }
      fill.disabled = !rows.some((row) => row.found);
      status.textContent = `${rows.filter((row) => row.found).length} compatible fields. Deselect any value you do not want to transfer.`;
    } catch (error) { if (current === epoch) status.textContent = `Could not inspect this page: ${error.message}`; }
  });
  fill.addEventListener('click', async () => {
    const current = epoch;
    fill.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (current !== epoch) return;
      if (tab?.id !== tabId) throw new Error('Active tab changed; preview again.');
      const selected = [...container.querySelectorAll('input:checked:not(:disabled)')].map((el) => el.value);
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: assistForm,
        args: ['fill', getPack().fields, selected, Object.fromEntries(rows.map((row) => [row.key, row.signature]))] });
      if (current !== epoch) return;
      if (result.error) throw new Error(result.error.message);
      status.textContent = `${result.result.filter((row) => row.filled).length} fields filled. Preview again for newly revealed fields. Nothing submitted.`;
    } catch (error) { if (current === epoch) status.textContent = `Nothing further filled: ${error.message}`; }
  });
  async function autoFill(id) {
    const current = ++epoch;
    const pack = getPack();
    if (!pack) throw new Error('Import an approved JSON package first.');
    tabId = id;
    const [previewResult] = await chrome.scripting.executeScript({ target: { tabId }, func: assistForm, args: ['preview', pack.fields] });
    if (current !== epoch) return { filled: 0 };
    if (previewResult.error) throw new Error(previewResult.error.message);
    rows = previewResult.result;
    const selected = rows.filter((row) => row.found).map((row) => row.key);
    if (!selected.length) return { filled: 0, available: 0 };
    const [fillResult] = await chrome.scripting.executeScript({ target: { tabId }, func: assistForm,
      args: ['fill', pack.fields, selected, Object.fromEntries(rows.map((row) => [row.key, row.signature]))] });
    if (current !== epoch) return { filled: 0 };
    if (fillResult.error) throw new Error(fillResult.error.message);
    const filled = fillResult.result.filter((row) => row.filled).length;
    status.textContent = `${filled} approved fields filled. Nothing submitted.`;
    return { filled, available: selected.length };
  }
  return { reset, loaded() { preview.disabled = false; }, autoFill };
}
