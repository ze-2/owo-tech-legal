# Clearclaim SCT assessment helper

This is a standalone Chrome Manifest V3 extension for the current CJTS Small Claims Tribunals pre-filing flow. There is no build step or remote code.

The public Angular source and live rendered DOM were inspected on 2026-09-05. The HTML shell loaded `main.85c8b8e0558a36d3.js`; its lazy pre-filing route loaded `523.aa30ecea52444606.js`, as resolved by `runtime.b6d0b24c3ef47a02.js`. The inspected portal footer reported “Last updated: 01 Sep 2026”.

## Install and use

1. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this `cjts-prefiling/` directory.
2. In Clearclaim, approve the filing fields and export the approved filing JSON.
3. Complete the official terms/reCAPTCHA step and open the SCT Pre-Filing Assessment.
4. Open the extension and optionally import the JSON. Choose **Scan SCT options**.
5. Review the detected options. An exact approved category may be preselected; a broad category only outlines its matching group so you can choose the subtype.
6. Choose **Apply selected options**, then review every change in CJTS.

The extension checks the exact official origin, assessment route, `TribunalType=SCT`, component, option group text, option label, and the control signature captured during the scan. It clicks only the selected SCT checkboxes. If the imported package contains an approved amount and selecting an option reveals the empty native Claim Amount input, it fills that amount. Existing values are left untouched.

The CJTS cause-of-action date is a read-only `ngbdatepicker` control, so the extension reports it for manual selection. It does not infer a date-picker action, “Others” description, or later yes/no assessment answers.

## Claim-category mapping

| Clearclaim category | Extension behavior |
| --- | --- |
| Sale of goods | Highlights **CONTRACT FOR SALE OF GOODS**; user chooses subtype. |
| Provision of services | Highlights **CONTRACT FOR PROVISION OF SERVICES**; user chooses subtype. |
| Residential tenancy | Highlights the residential lease group; user chooses subtype. |
| Property damage | Highlights **DAMAGE TO PROPERTY**; user chooses subtype. |
| Motor vehicle deposit | Preselects **Refund (motor vehicle deposit)**. |
| Unfair practice | Highlights the goods group; the portal option is narrower, so the user chooses. |
| Other / Not sure yet | No automatic recommendation. |

The exact motor-vehicle-deposit mapping still requires the user to review and press Apply. Broad categories cannot determine facts such as non-delivery versus defective goods, landlord versus tenant obligations, whether an unfair practice concerns hire purchase, or whether property damage arose from a motor accident.

`claim-type.mjs` contains the reviewed mapping and all 22 current portal options. `assessment-assist.mjs` performs the isolated scan/click/fill actions. `actions.json` is the machine-readable source record. `transfer.mjs` validates the local Clearclaim package before using its approved category or amount.

The terms page itself has no editable fields. Its available actions remain under **Terms-page actions** in the popup: Terms of Use, Cancel, and Proceed. Proceed uses the portal’s own reCAPTCHA verification. The helper does not solve CAPTCHA, log in, submit the assessment, file a claim, upload evidence, or make payments.
