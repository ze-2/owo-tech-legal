# CJTS verification — 6 September 2026

Inspected the public SCT assessment at `https://cjts.judiciary.gov.sg/prefiling/prefilingAssessment`, the rendered DOM, and its published `523.aa30ecea52444606.js` bundle.

The final `npm run test:cjts:live` run used the same injected functions shipped with the extension. For each group it scanned the initially collapsed options, opened the selected group, chose Others, filled a fictional description, selected 12 March 2026 through the native calendar, and entered a fictional SGD 25,000 amount. It then answered the revealed consent and questionnaire controls, checking the current question before each click.

| Group | Filled fields | Questions answered | End state |
| --- | ---: | ---: | --- |
| Sale of goods | 3 | 19 | Submit enabled; not clicked |
| Provision of services | 3 | 24 | Submit enabled; not clicked |
| Damage to property | 3 | 17 | Submit enabled; not clicked |
| Residential tenancy | 3 | 18 | Submit enabled; not clicked |

All four runs retained the exact date `12/03/2026`, detected no unknown editable controls, and stayed on the assessment page. These deliberately fictional branches answered Yes to consent and No to later questions; CJTS displayed the corresponding guidance and eligibility warnings. Enabling Submit is evidence of reaching the end of those branches, not evidence that the fictional claims were eligible.

Local browser tests additionally load the real unpacked popup with permission limited to the local fixture. They exercise both Yes and No branches, delayed field insertion, absent JSON values, import replacement, input validation, stale questions, ambiguous controls and no submission.

Scope: public SCT assessment only. The authenticated claim form, every possible answer combination, and future portal changes are not covered by this live run. The live test is opt-in and reproducible from `tests/live-cjts.mts`.
