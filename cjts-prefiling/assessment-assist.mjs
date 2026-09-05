/** Self-contained for chrome.scripting.executeScript's isolated world. */
export async function assistAssessment(action, supportedGroups, payload = {}) {
  const isOfficial =
    location.origin === "https://cjts.judiciary.gov.sg" &&
    location.pathname === "/prefiling/prefilingAssessment";
  const isFixture =
    ["localhost", "127.0.0.1"].includes(location.hostname) &&
    location.pathname === "/mock-sct.html";
  if (!isOfficial && !isFixture)
    throw new Error("Open the official SCT pre-filing assessment first.");
  if (!isFixture && sessionStorage.getItem("TribunalType") !== "SCT")
    throw new Error("This helper supports the Small Claims Tribunals assessment only.");
  if (document.querySelector('.modal.show, [role="dialog"][aria-modal="true"]'))
    throw new Error("Close the site's dialog before continuing.");
  const root = document.querySelector("app-sct-prefiling");
  if (!root) throw new Error("The SCT assessment form is not ready.");

  const normal = (text) => text.replace(/\s+/g, " ").trim();
  const supported = new Map(
    supportedGroups.flatMap((group) =>
      group.options.map((label, index) => [
        `${group.id}:${index}`,
        { groupId: group.id, groupLabel: group.label, label },
      ]),
    ),
  );
  const liveGroups = [...root.querySelectorAll(".form-group")]
    .map((container) => {
      const select = container.querySelector(".selectBox select");
      if (!select) return null;
      const groupLabel = normal(select.value || select.textContent || "");
      const declared = supportedGroups.find((group) => group.label === groupLabel);
      if (!declared) return null;
      const options = declared.options.map((label, index) => {
        const matches = [...container.querySelectorAll('label input[type="checkbox"]')]
          .map((checkbox) => ({
            checkbox,
            label: normal(checkbox.closest("label")?.textContent || ""),
          }))
          .filter((entry) => entry.label === label);
        const checkbox = matches.length === 1 ? matches[0].checkbox : null;
        return {
          id: `${declared.id}:${index}`,
          label,
          found: Boolean(checkbox),
          checked: checkbox?.checked === true,
          disabled: checkbox?.disabled === true,
          signature: checkbox
            ? `${groupLabel}|${label}|${checkbox.id}|${checkbox.name}`
            : "",
          reason:
            matches.length === 0
              ? "Option not found"
              : matches.length > 1
                ? "Option is ambiguous"
                : checkbox.disabled
                  ? "Option is disabled"
                  : "",
        };
      });
      return { id: declared.id, label: groupLabel, options };
    })
    .filter(Boolean);

  if (action === "scan") return { groups: liveGroups };
  if (action !== "apply") throw new Error("Unknown assessment action.");

  const selected = Array.isArray(payload.selected) ? payload.selected : [];
  const expected =
    payload.expected && typeof payload.expected === "object"
      ? payload.expected
      : {};
  const results = [];
  for (const id of selected) {
    const target = supported.get(id);
    if (!target) {
      results.push({ id, applied: false, reason: "Unsupported option" });
      continue;
    }
    const group = liveGroups.find((entry) => entry.id === target.groupId);
    const row = group?.options.find((entry) => entry.id === id);
    if (!row?.found || row.reason) {
      results.push({ id, applied: false, reason: row?.reason || "Option not found" });
      continue;
    }
    if (expected[id] !== row.signature) {
      results.push({ id, applied: false, reason: "Form changed since preview" });
      continue;
    }
    const groupContainer = [...root.querySelectorAll(".form-group")].find(
      (container) =>
        normal(container.querySelector(".selectBox select")?.value || "") ===
        target.groupLabel,
    );
    const matches = [
      ...(groupContainer?.querySelectorAll('label input[type="checkbox"]') || []),
    ].filter(
      (checkbox) =>
        normal(checkbox.closest("label")?.textContent || "") === target.label,
    );
    const checkbox = matches.length === 1 ? matches[0] : null;
    if (!checkbox || checkbox.disabled) {
      results.push({ id, applied: false, reason: "Option is unavailable" });
      continue;
    }
    // CJTS keeps each group's options (and its Others input) under a hidden
    // dropdown. Open it using the portal's own toggle before applying a choice.
    if (checkbox.closest('[hidden]') || !checkbox.getClientRects().length) {
      groupContainer.querySelector('.selectBox')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (!checkbox.isConnected || checkbox.disabled) {
      results.push({ id, applied: false, reason: "Option changed; scan again" });
      continue;
    }
    if (!checkbox.checked) checkbox.click();
    results.push({
      id,
      applied: checkbox.checked,
      reason: checkbox.checked ? "" : "The portal did not accept the click",
    });
  }

  return { options: results };
}
