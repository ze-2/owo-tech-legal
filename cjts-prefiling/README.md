# Clearclaim CJTS helper

One unpacked Chrome extension for the SCT pre-filing assessment and approved claim-form transfer. No build step, remote code, or stored case data.

## Install and use

1. Open `chrome://extensions`, enable Developer mode, and load this `cjts-prefiling/` directory. Reload it after updating the code. Remove the old **Clearclaim — assisted transfer** extension if it is still installed.
2. In the webpage’s **Prepare to file** step, approve the exact values you want to transfer and choose **Export approved filing JSON**.
3. Open the official SCT assessment and import that JSON in the extension. Choose **Scan SCT options**.
4. Choose the specific dispute option(s) and press **Apply selected options**. Approved amount and date values are filled as CJTS reveals them. The date is selected through the actual calendar, including year, month and day.
5. Keep the popup open. **Continue the assessment** refreshes every second as fields and questions appear. Supply any missing amount, date or group-specific “Others” description and press **Fill these values on CJTS**. Descriptions respect CJTS’s 50-character limit.
6. Read each newly displayed question and click its **Yes** or **No** answer. This clicks that exact question’s native CJTS button, then discovers the next branch. Answers are never inferred from a narrative or defaulted to Yes/No. Consent is a separate question and also requires your answer.
7. At the end, review CJTS’s answers and validation messages. The helper reports when CJTS enables Submit, but never clicks it.

On a claim form, expand **Claim form transfer** to preview matching approved JSON fields, deselect any unwanted values, and fill them. Preview again if that form reveals additional fields. Existing values are not overwritten. The logged-in claim form’s field layout has not been verified; this semantic mapping reports unsupported or ambiguous fields rather than guessing.

Closing the popup clears its imported package. Reopen, reimport, and scan to resume from the values already on CJTS. Clearing or replacing a package clears pending previews and local answers. The extension uses only `activeTab` and `scripting`; no persistent host access, login, CAPTCHA solving, submission, evidence upload, or payment.

## What is mapped

- All 22 recorded dispute options in four groups, with the existing category recommendations. Broad categories require a subtype choice.
- `cAmount`: positive amount, with native input/change/blur events and acceptance check.
- `d2[ngbdatepicker]`: exact approved or user-entered date through the visible native calendar.
- `salesOthersDesc`, `serviceOthersDesc`, `damagedOthersDesc`, `rentalOthersDesc`: exact user-entered descriptions, without recycling the claim summary.
- Conditional consent and questionnaire Yes/No controls: the current question text and branch are rechecked before applying the user’s answer.
- Unknown visible fields and CJTS validation messages are shown for completion on the portal.

`transfer.mjs` is the single JSON contract imported by the webpage and this extension. The former `extension/` directory and duplicated contract have been removed. `form-assist.mjs` retains the general claim-form mapping.

## Verification

On 2026-09-06, the public HTML, assessment bundle `523.aa30ecea52444606.js`, live rendered assessment, calendar, and conditional questionnaire were inspected. The live test uses fictional values and stops at the enabled Submit button. The public assessment is accessible without logging in; this does not verify the authenticated claim-filing pages.

- `npm test`: transfer validation and webpage serialization tests.
- `npm run test:e2e`: real unpacked-popup tests on local fixtures, including delayed field creation, all four Others descriptions, exact calendar selection, consent, successive questions, stale/ambiguous controls, import reset, and no submission.
- `npm run test:cjts:live`: opt-in live public assessment tests across all four dispute groups. Requires installed Playwright Chromium and network access. Uses fictional values and Yes for the fictional consent question, No for later questions solely to exercise those branches. Never submits. Different answers can follow different branches.

Local fixtures model recorded DOM shapes and deliberate delays; they are not copies of the portal. A live test covers its scripted branches, not every possible path or future portal changes.
