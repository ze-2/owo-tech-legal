/** Self-contained for chrome.scripting.executeScript's isolated world. */
export function runAction(actionId) {
  const isOfficial =
    location.origin === "https://cjts.judiciary.gov.sg" &&
    location.pathname === "/prefiling/prefilingTerms";
  // Same narrow fixture allowance form-assist.mjs and assessment-assist.mjs
  // already use. Without it this module could not be tested at all, which is
  // why it was the only one clicking portal buttons with no coverage.
  const isFixture =
    ["localhost", "127.0.0.1"].includes(location.hostname) &&
    location.pathname === "/mock-terms.html";
  if (!isOfficial && !isFixture) {
    throw new Error("Open the official CJTS pre-filing terms page first.");
  }
  // Keep this allowlist aligned with actions.json; never accept imported selectors.
  const selectors = {
    terms: 'a.terms-of-use-blue[target="_blank"]',
    cancel: 'button[type="button"][aria-label="Cancel"]',
    proceed: 'button#btnSubmit[aria-label="Proceed"]',
  };
  if (!Object.hasOwn(selectors, actionId)) throw new Error("Unknown action.");
  if (document.querySelector('.modal.show, [role="dialog"][aria-modal="true"]')) {
    throw new Error("Close the site's dialog before running an action.");
  }
  const controls = [...document.querySelectorAll(
    `app-prefiling-terms ${selectors[actionId]}`,
  )].filter((el) => el.getClientRects().length &&
    getComputedStyle(el).visibility === "visible" &&
    !el.closest('[hidden], [inert], [aria-hidden="true"]'));
  if (controls.length !== 1) throw new Error("Expected one visible control; the page may have changed.");
  const control = controls[0];
  if (control.matches(':disabled, [aria-disabled="true"]')) throw new Error("The site has disabled this action.");
  if (actionId === "terms" && !/^https?:$/.test(new URL(control.href).protocol)) {
    throw new Error("The terms link is not ready.");
  }
  control.click();
  return { action: actionId, clicked: true };
}
