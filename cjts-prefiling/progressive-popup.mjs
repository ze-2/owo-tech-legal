/* global chrome */
import { assistProgress } from './progressive-assist.mjs';

export function createProgress(getPack) {
  const container = document.querySelector('#progress-fields');
  const questions = document.querySelector('#questions');
  const status = document.querySelector('#progress-status');
  const fill = document.querySelector('#fill-progress');
  let tabId = null, epoch = 0, busy = false, snapshot = null, rendered = '', autoFill = false;
  const attempted = new Set();
  const drafts = new Map();
  function reset() {
    epoch++;
    tabId = null;
    snapshot = null;
    rendered = '';
    busy = false;
    autoFill = false;
    attempted.clear();
    drafts.clear();
    container.replaceChildren();
    questions.replaceChildren();
    fill.disabled = true;
    status.textContent = 'Scan the assessment to see fields as they appear.';
  }
  async function execute(action, payload = {}, current = epoch) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current !== epoch) throw new Error('Package changed; scan again.');
    if (tab?.id !== tabId) throw new Error('Return to the scanned CJTS tab, then scan again.');
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: assistProgress, args: [action, payload] });
    if (result.error) throw new Error(result.error.message);
    return result.result;
  }
  function render(data) {
    snapshot = data;
    const serialized = JSON.stringify(data);
    if (serialized === rendered) return;
    rendered = serialized;
    // Retain in-progress answers when an unrelated field/question appears.
    for (const input of container.querySelectorAll('input'))
      drafts.set(input.dataset.key, { value: input.value, signature: input.dataset.signature });
    container.replaceChildren();
    for (const row of data.fields) {
      const label = document.createElement('label');
      const title = document.createElement('span');
      title.textContent = row.label;
      const input = document.createElement('input');
      input.type = row.type;
      input.dataset.key = row.key;
      input.dataset.signature = row.signature;
      input.setAttribute('aria-label', row.label);
      if (row.maxLength > 0) input.maxLength = row.maxLength;
      const old = drafts.get(row.key);
      const imported = getPack()?.fields[row.key]?.value || '';
      input.value = row.value && row.type === 'date'
        ? row.value.split('/').reverse().join('-')
        : row.value || (old?.signature === row.signature ? old.value : imported);
      input.disabled = Boolean(row.reason || row.value.trim());
      const note = document.createElement('small');
      note.textContent = row.reason || (row.value ? 'Already on CJTS; edit there to change it.' : imported ? 'Approved value from your JSON.' : 'Enter the exact value to use on CJTS.');
      label.append(title, input, note);
      container.append(label);
    }
    questions.replaceChildren();
    for (const row of data.questions) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = row.text;
      fieldset.append(legend);
      for (const answer of row.answers) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = answer;
        button.addEventListener('click', () => run(async (current) => {
          const next = await execute('answer', { id: row.id, signature: row.signature, answer }, current);
          if (current !== epoch) return;
          render(next);
          status.textContent = 'Answer applied. Watching for the next question…';
        }));
        fieldset.append(button);
      }
      questions.append(fieldset);
    }
    fill.disabled = busy || !data.fields.some((row) => !row.value && !row.reason);
    const notes = [...data.messages, ...data.unsupported.map((name) => `Complete on CJTS: ${name}`)];
    status.textContent = notes.length ? notes.join(' ') : data.readyToSubmit
      ? 'CJTS has enabled Submit. Review every answer on the page; nothing has been submitted.'
      : `${data.fields.filter((row) => !row.value).length} empty fields; ${data.questions.length} unanswered questions. Watching for new fields…`;
  }
  async function run(work) {
    if (busy || tabId === null) return;
    busy = true;
    fill.disabled = true;
    questions.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    const current = epoch;
    try { await work(current); }
    catch (error) { if (current === epoch) status.textContent = error.message; }
    finally {
      if (current === epoch) {
        busy = false;
        fill.disabled = !snapshot?.fields.some((row) => !row.value && !row.reason);
        questions.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      }
    }
  }
  async function refresh(current) {
    let data = await execute('scan', {}, current);
    if (current !== epoch) return;
    if (autoFill) {
      const fields = {}, expected = {};
      for (const row of data.fields) {
        const imported = getPack()?.fields[row.key];
        const key = JSON.stringify([row.key, row.signature, imported?.value]);
        if (!row.value && !row.reason && imported && !attempted.has(key)) {
          fields[row.key] = imported;
          expected[row.key] = row.signature;
          attempted.add(key);
        }
      }
      if (Object.keys(fields).length) {
        data = await execute('fill', { fields, expected }, current);
        if (current !== epoch) return;
      }
    }
    render(data);
    const failures = data.results?.filter((row) => !row.filled);
    if (failures?.length) status.textContent = failures.map((row) => `${row.key}: ${row.reason}`).join(' ');
  }
  fill.addEventListener('click', () => run(async (current) => {
    const fields = {}, expected = {};
    for (const input of container.querySelectorAll('input:not(:disabled)')) {
      if (!input.value.trim()) continue;
      fields[input.dataset.key] = { value: input.value, review: 'approved', provenance: 'user' };
      expected[input.dataset.key] = input.dataset.signature;
    }
    const data = await execute('fill', { fields, expected }, current);
    if (current !== epoch) return;
    render(data);
    const failed = data.results.filter((row) => !row.filled);
    status.textContent = failed.length ? failed.map((row) => `${row.key}: ${row.reason}`).join(' ') : 'Values applied. Watching for more fields and questions…';
  }));
  const timer = setInterval(() => { if (tabId !== null) void run(refresh); }, 1000);
  window.addEventListener('pagehide', () => { clearInterval(timer); reset(); });
  return {
    reset,
    async connect(id, fillApproved = false) {
      if (tabId !== id) reset();
      tabId = id;
      autoFill ||= fillApproved;
      await run(refresh);
    },
  };
}
