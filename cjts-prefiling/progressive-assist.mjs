/** Self-contained: runs in chrome.scripting's isolated world, without Angular internals. */
export async function assistProgress(action, payload = {}) {
  const official = location.origin === "https://cjts.judiciary.gov.sg" &&
    location.pathname === "/prefiling/prefilingAssessment";
  const fixture = ["localhost", "127.0.0.1"].includes(location.hostname) &&
    location.pathname === "/mock-sct.html";
  if ((!official && !fixture) || (!fixture && sessionStorage.getItem("TribunalType") !== "SCT"))
    throw new Error("Open the SCT pre-filing assessment first.");
  const root = document.querySelector("app-sct-prefiling");
  if (!root) throw new Error("The SCT assessment is not ready.");
  const normal = (text) => (text || "").replace(/\s+/g, " ").trim();
  const visible = (el) => el && el.getClientRects().length > 0 &&
    !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
    getComputedStyle(el).visibility !== "hidden";
  const blocked = () => Boolean(document.querySelector('.modal.show, [role="dialog"][aria-modal="true"]'));
  if (blocked()) throw new Error("Close the site's dialog before continuing.");
  const descriptors = [
    { key: "incidentDate", label: "Date of Cause of Action", selector: 'input[name="d2"][ngbdatepicker]', type: "date" },
    { key: "amount", label: "Claim Amount", selector: 'input#cAmount[name="cAmount"]', type: "text" },
    ...[
      ["salesOthersDesc", "Sale of goods"], ["serviceOthersDesc", "Provision of services"],
      ["damagedOthersDesc", "Damage to property"], ["rentalOthersDesc", "Residential lease"],
    ].map(([key, label]) => ({ key, label: `${label}: specify Others`, selector: `input[name="${key}"]`, type: "text" })),
  ];
  const branch = () => [...root.querySelectorAll('input[type="checkbox"]:checked')]
    .map((el) => [el.id, el.name, normal(el.closest('label')?.textContent)]);
  const signature = (el, key) => JSON.stringify([key, el.tagName, el.id, el.name, el.type, el.maxLength, el.readOnly, branch()]);
  function fields() {
    return descriptors.flatMap((descriptor) => {
      const matches = [...root.querySelectorAll(descriptor.selector)].filter(visible);
      if (!matches.length) return [];
      const el = matches[0];
      return [{ ...descriptor, value: el.value, maxLength: el.maxLength,
        signature: signature(el, descriptor.key),
        reason: matches.length !== 1 ? "Ambiguous field; complete on CJTS" :
          el.disabled ? "Field is disabled" :
          el.readOnly && descriptor.type !== "date" ? "Field is read-only" : "" }];
    });
  }
  function questions() {
    const rows = [];
    for (const controls of root.querySelectorAll('#claimAmountConsent .form-group, #questions1Row .form-group')) {
      if (!visible(controls)) continue;
      const buttons = [...controls.querySelectorAll('button[type="button"]')]
        .filter((el) => visible(el) && !el.disabled && /^(Yes|No)$/.test(normal(el.textContent)));
      if (!buttons.length) continue;
      const textColumn = controls.parentElement?.previousElementSibling;
      if (!textColumn) continue;
      const clone = textColumn.cloneNode(true);
      clone.querySelectorAll('.validation, input, button, .tooltip').forEach((el) => el.remove());
      const text = normal(clone.textContent);
      if (!text) continue;
      const scope = controls.closest('#claimAmountConsent') ? "consent" : "question";
      const answers = buttons.map((el) => normal(el.textContent));
      rows.push({ id: `${scope}:${text}`, text, answers,
        signature: JSON.stringify([scope, text, answers, branch(), fields().map((f) => [f.key, f.value])]), controls });
    }
    return rows;
  }
  function snapshot() {
    const currentFields = fields();
    const currentQuestions = questions();
    const known = new Set(descriptors.flatMap((d) => [...root.querySelectorAll(d.selector)]));
    const unsupported = [...root.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), textarea, select')]
      .filter((el) => visible(el) && !el.disabled && !known.has(el) && !el.closest('.selectBox'))
      .map((el) => normal(el.getAttribute('aria-label') || el.title || el.name || el.id || 'Unrecognised field'));
    return { fields: currentFields, questions: currentQuestions.map(({ id, text, answers, signature }) => ({ id, text, answers, signature })),
      unsupported, messages: [...root.querySelectorAll('.validation')].filter(visible).map((el) => normal(el.textContent)).filter(Boolean),
      readyToSubmit: [...root.querySelectorAll('button')].some((el) => visible(el) && !el.disabled && normal(el.textContent) === "Submit") };
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
  async function waitFor(find) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const value = find();
      if (value) return value;
      await pause();
    }
    return null;
  }
  async function selectDate(el, value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
      throw new Error("Enter an exact valid date.");
    const [year, month, day] = value.split('-').map(Number);
    const displayed = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    if (document.querySelector('ngb-datepicker')) throw new Error("Close the open calendar and retry.");
    el.click();
    const picker = await waitFor(() => document.querySelector('ngb-datepicker'));
    if (!picker) throw new Error("CJTS did not open its date picker.");
    const choose = async (label, number) => {
      const select = picker.querySelector(`select[aria-label="${label}"]`);
      if (!select || ![...select.options].some((o) => Number(o.value) === number && !o.disabled))
        throw new Error(`Date picker ${label.toLowerCase()} is unavailable; select the date on CJTS.`);
      select.value = String(number);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await pause();
    };
    try {
      await choose('Select year', year);
      await choose('Select month', month);
      // ng-bootstrap identifies days by their full accessible date, including the year.
      const date = new Date(year, month - 1, day);
      const labels = ['en-US', 'en-GB'].map((locale) => new Intl.DateTimeFormat(locale,
        { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date));
      const days = [...picker.querySelectorAll('[role="gridcell"]')].filter((cell) =>
        visible(cell) && cell.getAttribute('aria-disabled') !== 'true' && !cell.classList.contains('disabled') &&
        labels.includes(normal(cell.getAttribute('aria-label'))));
      if (days.length !== 1) throw new Error("The exact date is unavailable in CJTS; choose it on the page.");
      days[0].click();
      if (!await waitFor(() => el.value === displayed)) throw new Error("CJTS did not accept the date.");
    } catch (error) {
      // Close only the picker opened here, through the same native toggle.
      if (picker.isConnected && el.isConnected) el.click();
      throw error;
    }
  }
  if (action === 'scan') return snapshot();
  if (action === 'answer') {
    const matches = questions().filter((q) => q.id === payload.id && q.signature === payload.signature);
    if (matches.length !== 1) throw new Error("The question changed; review the current question again.");
    const buttons = [...matches[0].controls.querySelectorAll('button[type="button"]')]
      .filter((el) => visible(el) && !el.disabled && ['Yes', 'No'].includes(payload.answer) && normal(el.textContent) === payload.answer);
    if (buttons.length !== 1) throw new Error("This answer is unavailable; scan again.");
    buttons[0].click();
    await pause();
    return snapshot();
  }
  if (action !== 'fill') throw new Error("Unknown assessment action.");
  const results = [];
  for (const [key, field] of Object.entries(payload.fields || {})) {
    const descriptor = descriptors.find((d) => d.key === key);
    if (!descriptor || field?.review !== 'approved' || typeof field.value !== 'string' || !field.value.trim()) continue;
    const row = fields().find((f) => f.key === key);
    if (!row) { results.push({ key, filled: false, reason: 'Not yet visible' }); continue; }
    if (row.reason || row.value.trim()) {
      results.push({ key, filled: false, reason: row.reason || 'Already contains a value' }); continue;
    }
    if (payload.expected?.[key] !== row.signature) {
      results.push({ key, filled: false, reason: 'Field changed; scan again' }); continue;
    }
    const el = [...root.querySelectorAll(descriptor.selector)].filter(visible)[0];
    try {
      if (blocked()) throw new Error("Close the site's dialog before continuing.");
      if (key === 'amount' && (!/^\d+(?:\.\d{1,2})?$/.test(field.value) || !Number.isFinite(Number(field.value)) || Number(field.value) <= 0))
        throw new Error('Enter a positive amount with at most two decimal places.');
      if (key === 'incidentDate') await selectDate(el, field.value);
      else {
        if ((el.maxLength >= 0 && field.value.length > el.maxLength) || /[\r\n]/.test(field.value))
          throw new Error('Value exceeds the field format or length.');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, field.value);
        if (!el.checkValidity()) { set.call(el, ''); throw new Error('CJTS rejected the value.'); }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        await pause();
        const accepted = key === 'amount' ? Number(el.value.replace(/,/g, '')) === Number(field.value) : el.value === field.value;
        if (!accepted) throw new Error('CJTS changed or rejected the value; review it on the page.');
      }
      results.push({ key, filled: true, reason: '' });
    } catch (error) { results.push({ key, filled: false, reason: error.message }); }
  }
  return { ...snapshot(), results };
}
