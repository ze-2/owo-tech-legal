/** Self-contained for chrome.scripting.executeScript's isolated world. */
export function runAction(actionId) {
  if (location.origin !== "https://cjts.judiciary.gov.sg" ||
      location.pathname !== "/prefiling/prefilingTerms") {
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
