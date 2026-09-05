/** Runs unchanged in a Chrome isolated world and in browser fixture tests.
 * Only top-level, visible, uniquely matched native controls are supported. */
export function assistForm(action, fields, selected = [], expected = {}) {
  const url = new URL(location.href);
  const allowed =
    (url.protocol === "https:" &&
      url.hostname === "cjts.judiciary.gov.sg" &&
      !url.port) ||
    (["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname === "/mock-cjts.html");
  if (!allowed)
    throw new Error("Open official CJTS or the localhost mock CJTS form.");
  const mapping = {
    claimant: ["claimant particulars", "claimant details"],
    respondent: ["respondent particulars", "respondent details"],
    amount: ["claim amount", "total claim value (s$)", "claim amount (sgd)"],
    claimType: ["claim category", "type of claim"],
    summary: ["description of claim", "summary of claim"],
    outcome: ["requested outcome", "desired remedy"],
    incidentDate: ["cause-of-action date"],
    timeline: ["chronology", "timeline"],
    caseNumber: ["existing case reference"],
    assessmentId: ["pre-filing assessment id"],
  };
  const normal = (text) =>
    text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\s*\*$/, "")
      .trim();
  const controls = Array.from(
    document.querySelectorAll("input, textarea, select"),
  ).filter(
    (el) =>
      !el.matches(":disabled") &&
      !el.readOnly &&
      !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
      el.getClientRects().length &&
      getComputedStyle(el).visibility !== "hidden" &&
      (el.tagName !== "INPUT" || ["text", "number", "date"].includes(el.type)),
  );
  const rows = [];
  for (const [key, field] of Object.entries(fields)) {
    if (
      !Object.hasOwn(mapping, key) ||
      field?.review !== "approved" ||
      typeof field.value !== "string" ||
      !field.value.trim()
    )
      continue;
    const matches = controls.filter((el) => {
      const labels = [
        ...Array.from(el.labels ?? []).map((label) =>
          normal(label.textContent ?? ""),
        ),
        normal(el.getAttribute("aria-label") ?? ""),
      ];
      // Names/data attributes are demo contracts, not verified live CJTS selectors.
      return (
        el.getAttribute("data-clearclaim-field") === key ||
        el.name === `clearclaim_${key}` ||
        labels.some((label) => mapping[key].includes(label))
      );
    });
    let reason =
      matches.length === 0
        ? "No supported field found"
        : matches.length > 1
          ? "Ambiguous fields — fill manually"
          : "";
    const el = matches.length === 1 ? matches[0] : null;
    const signature = el
      ? `${el.tagName}|${el.id}|${el.name}|${Array.from(el.labels ?? [])
          .map((l) => normal(l.textContent ?? ""))
          .join("|")}`
      : "";
    let value = field.value;
    if (el) {
      if (el.value.trim())
        reason = "Already contains a value — review manually";
      if (el.maxLength >= 0 && value.length > el.maxLength)
        reason = "Value exceeds field length";
      if (el.tagName === "SELECT") {
        const options = Array.from(el.options).filter(
          (o) =>
            !o.disabled &&
            (o.value === value ||
              normal(o.textContent ?? "") === normal(value)),
        );
        if (options.length !== 1)
          reason = "No unique matching option — choose manually";
        else value = options[0].value;
      }
      if (el.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
        reason = "Exact ISO date required";
      if (el.tagName === "INPUT" && /[\r\n]/.test(value))
        reason = "Multiline particulars need a multiline field";
    }
    let filled = false;
    if (action === "fill" && selected.includes(key) && el && !reason) {
      if (expected[key] !== signature)
        reason = "Form changed since preview — preview again";
      else {
        const prototype =
          el.tagName === "SELECT"
            ? HTMLSelectElement.prototype
            : el.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(el, value);
        if (el.value !== value || !el.checkValidity()) {
          setter?.call(el, "");
          reason = "Form rejected the value — complete manually";
        } else {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          filled = el.value === value;
          if (filled) {
            el.style.outline = "3px solid #517346";
            el.setAttribute("data-clearclaim-filled", "true");
            el.title = "Filled by Clearclaim — please review";
          } else reason = "The page changed the value — review manually";
        }
      }
    }
    rows.push({ key, found: !!el && !reason, reason, signature, filled });
  }
  return rows;
}
