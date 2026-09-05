# Clearclaim assisted transfer

Load this folder directly; there is no build step and no remote code.

1. Run the website (`npm run dev`). In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/`.
2. In Clearclaim, organise the claim, inspect **Challenge my account**, correct unsupported wording and explicitly approve individual filing fields.
3. Choose **Export approved filing JSON**. This file contains only approved values, their provenance/review markers, format version and generation time. It does not embed evidence, original messages outside approved fields, research, or keys. An approved summary can itself contain sensitive information.
4. Open `http://localhost:3000/mock-cjts.html` (or `http://127.0.0.1:3100/mock-cjts.html` while testing), then open the extension. Import the JSON and select **Preview compatible fields**.
5. Read every proposed value, deselect fields as needed, and choose **Fill selected fields**. Green outlines identify filled controls. Review the form manually.

The popup uses only `activeTab` and `scripting` permissions. It processes files in memory, uses no network/storage APIs and forgets the package when closed. Closing the popup does not erase the downloaded file or values already placed in the form. No website message channel is installed. The approval marker is an assertion from the exported local file, not a cryptographic signature or identity proof; only import files you exported and inspected.

## Supported mapping

`form-assist.mjs` is the single mapping implementation used by the extension and browser tests. It matches exact normalised labels/ARIA labels (for example **Description of claim**), or explicit demo attributes (`data-clearclaim-field="summary"`, `name="clearclaim_summary"`). The keys and accepted label aliases are listed in its `mapping` object. The shared contract and validation are in `shared/transfer.mjs`, imported directly by both website and extension.

Supported keys: claimant/respondent **particulars**, claim amount, category, summary, requested outcome, cause-of-action date, chronology, existing case reference, assessment ID. Particulars may include names and addresses, so they are deliberately not mapped into a name-only field. The requested outcome is a free-text remedy, not an automatic selection of one of the court's order types.

**No live authenticated CJTS field selectors have been verified.** Semantic matches on the real site are tentative and require careful preview. The fixture is the tested compatibility target, not a replica of the official portal. To add a verified live field, inspect only that control manually, record its meaning here, add a precise alias/attribute in the mapping, and add a fixture test. Do not infer selectors or assume a field is equivalent because it looks similar.

Only the exact HTTPS CJTS hostname and localhost `/mock-cjts.html` are allowed. Controls must be visible, enabled, writable, native and uniquely matched. Existing values, multiline text in single-line inputs, unsupported select options, length/validity failures and changed control signatures are skipped. No iframe, shadow-DOM, custom widget, address splitting, attachments, repeat-party sections or multistep navigation support is claimed. Preview again after moving to another form page.

The extension never clicks controls, calls `submit`/`requestSubmit`, pays, handles credentials, bypasses Singpass or CAPTCHA, or makes jurisdiction decisions. It dispatches normal `input`/`change` events so page forms can register edits. The destination page controls its own event handlers and any autosave behavior. Only test against reviewed forms before real use.

[Chrome scripting documentation](https://developer.chrome.com/docs/extensions/reference/api/scripting) describes the temporary `activeTab` injection mechanism.
