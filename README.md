# Clearclaim

Clearclaim is a Next.js app for preparing Singapore Small Claims Tribunals claims. Users describe a dispute, attach records, review an editable draft and official-source guidance, then export their preparation work or approved fields for assisted form entry. It is a local prototype, not an official court form, legal adviser, or filing service.

## Status (2026-09-06)

Both blockers from the previous handoff are resolved and covered by tests. What
remains genuinely unverified is listed under "Known limits" below.

### 1. `/api/prepare` reliability — fixed

The reported "intermittent" failure was not intermittent: the AI path failed
essentially every time, and only the *error* varied (validation failure, provider
rate limit, or timeout), which made it look sporadic.

**Cause.** The eight allowed `claimType` values were communicated to the model
only inside `response_format.json_schema`. Providers silently discard that block
for models without structured-output support, so the model was never told the
allowed values and returned free text such as `"Consumer goods – defective
second-hand laptop, refund claim"`. Zod then rejected the entire extraction —
discarding eight correct fields because of one — and the repair attempt repeated
the same omission. Measured against the previously configured model: 0 of 8
first attempts passed.

**Fix.**

- `extractionJsonSchema()` now emits a real `enum` instead of describing one in prose.
- The field contract (category list, digits-only amount, ISO date) is also stated
  in the system prompt, so it survives a dropped schema on any provider.
- Model output is normalised before validation via `normalizeClaimType`,
  `normalizeAmount` and `normalizeIsoDate` in `src/lib/claim.ts`, shared with
  local extraction. An unusable field becomes blank for the user to correct
  instead of failing the request.
- One end-to-end deadline (`PROVIDER_BUDGET_MS`) now covers every attempt and
  sits below the route's `maxDuration`; per-attempt timeouts derive from the time
  remaining, and SDK retries are disabled in favour of one explicit, bounded
  retry with backoff for upstream 429s.
- `request.signal` is threaded through `/api/prepare`, `/api/conversation` and
  `/api/research`, so a client disconnect cancels provider work instead of
  leaving it holding a `withCapacity` slot.
- The workspace stamps each request and ignores superseded responses, so a slow
  earlier reply cannot overwrite a newer draft.

Measured after the fix, same model and prompt: 6 of 6, then 3 of 3 on a
subsequent run.

### 2. Chrome extension workflow — fixed

**Both extensions are supported**; neither was deleted. `extension/` is the
general approved-field transfer tool, `cjts-prefiling/` is the SCT pre-filing
assessment helper. See "Chrome extensions" below for which to use when.

- The duplicated transfer contract is now byte-identical in both folders, with
  `tests/transfer-parity.test.ts` failing if they diverge (they already had: a
  version-2 package reported two different errors, and only one was asserted).
- Both extensions now load as real unpacked extensions in tests, with successful
  popup → `chrome.scripting` → page-fill coverage. Previously no test drove a
  successful fill through a popup at all; the only unpacked-extension test
  asserted the `activeTab` failure boundary, which is retained.
- `cjts-prefiling/run-action.mjs` — the one module that clicks portal buttons —
  had no coverage anywhere and now has tests for its allowlist, dialog, disabled
  and ambiguous-match guards.
- `assistAssessment` now re-checks `review === "approved"` at the injected-script
  boundary, as `assistForm` already did.

### Known limits

- **The live CJTS selectors are still unverified.** Everything in
  `cjts-prefiling/actions.json` was inspected once on 2026-09-05 against the real
  portal and has not been re-confirmed since. The fixtures encode those recorded
  shapes, not a live guarantee. Confirm manually with fictional data before
  relying on either extension against authenticated CJTS.
- No free model is reliable enough for production. The default
  (`dots-studio/dots-3-note-preview:free`) honours the schema and is consistently
  available, but is slow (10-30s) and inconsistent in category choice. Prefer a
  paid model for real use.
- Automated tests still do not establish legal correctness, transcription
  accuracy, accessibility conformance, or authenticated-portal compatibility.

### Verification baseline

```sh
npm ci
npm run typecheck && npm run lint && npm test   # 48 passing
npx playwright install chromium
npm run test:e2e                                # 36 passing, 4 skipped
npm run build
npm run test:live -- 3 research                 # needs real keys; fictional data
```

The four skips are the desktop-only extension tests under the mobile project.
Stop or reuse an existing `next dev` process before running Playwright; otherwise
its configured web server exits because Next.js already holds the development
lock.

## Run locally

Use Node.js 22 or newer (verified on 22, 24 and 26) and npm. There is one
lockfile, `package-lock.json`; do not add a second package manager's lockfile.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open [localhost:3000](http://localhost:3000). **Try a fictional example** fills the long-form intake; **Talk through your claim** accepts short messages. Basic organisation and reference guidance work without API keys.

Optional server configuration in `.env`:

| Variable | Enables |
| --- | --- |
| `OPENAI_API_KEY` | AI organisation, conversational interpretation and research drafting, after the user gives AI consent. |
| `OPENAI_BASE_URL` | The OpenAI-compatible endpoint. Defaults to `https://openrouter.ai/api/v1`; set `https://api.openai.com/v1` for OpenAI directly. |
| `OPENAI_TEXT_MODEL` | Text generation model; defaults to `dots-studio/dots-3-note-preview:free`. |
| `EXA_API_KEY` | Official-source retrieval for live research, after the user gives AI consent. |
| `OPENROUTER_API_KEY` | Voice transcription through OpenRouter, after separate audio consent and browser microphone permission. |
| `OPENROUTER_TRANSCRIPTION_MODEL` | Transcription model; defaults to `openai/whisper-large-v3`. |

Restart the server after changing configuration. Keep keys server-side; never give them a `NEXT_PUBLIC_` prefix. One model provider handles organisation and research drafting and Exa handles official-source retrieval, so those features do not need another model-provider key or a vector database.

### Choosing a model

The endpoint defaults to OpenRouter, so `OPENAI_API_KEY` is normally an
OpenRouter key and `OPENAI_TEXT_MODEL` an OpenRouter model slug. Two properties
matter:

- **Structured-output support.** OpenRouter silently drops `response_format` for
  models that do not support it. The app no longer depends on that — the field
  contract is also in the prompt and output is normalised — but a model that
  honours the schema drifts less. Check `supported_parameters` for
  `structured_outputs` in <https://openrouter.ai/api/v1/models>.
- **Availability.** Free tiers return upstream 429s under shared load. The app
  retries once with backoff and then reports it plainly.

The default is the most reliable free option measured; a paid model is advisable
for real use. After changing models, confirm with `npm run test:live`.

For a production build:

```sh
npm run build
npm start
```

## User workflow

1. **Describe the dispute.** Type a conversation, use an editable voice transcript, enter a longer account, or import an existing claim from PDF, DOCX or TXT. Attach evidence and describe what each record shows.
2. **Organise the claim.** Review the parties, amount, dates, chronology, requested outcome and other party's position. Explicit workspace edits take precedence over later AI proposals.
3. **Review guidance.** Inspect five sections covering parties, eligibility, facts/evidence, outcomes and filing/service. The app includes eight order types, preliminary checks, missing-information prompts and fee estimates. Reference guidance is labelled separately from live research.
4. **Challenge and approve.** Inspect unsupported assertions, possible conflicting evidence and unresolved dates. Link assertions to evidence and approve individual field values only after checking them. Changes to the account, evidence, assertion links or draft clear approvals; material edits also invalidate research.
5. **Export and review.** Download the Markdown preparation draft, print/save as PDF, or export approved filing JSON. The Markdown draft includes the evidence index, original account, conversation and review trail; original attachments are supplied separately. JSON contains only approved fields and transfer metadata. CJTS sign-in, final review, submission and payment remain manual.

The global CJTS review checkbox enables the portal link. It does not approve individual fields for JSON export. The exporter also rejects approvals whose stored value no longer matches the draft.

## Codebase map

The app uses the Next.js App Router, React and TypeScript. Zod validates request and model output shapes. State lives in the main client component; there is no database, account system or persistent session store.

| Location | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Server entry point; passes AI availability to the workspace without exposing keys. |
| `src/app/layout.tsx` | Metadata and ordered global CSS imports. |
| `src/components/claim-workspace.tsx` | Owns the draft, evidence, conversation, research, approvals and navigation between the four steps. Coordinates uploads, API calls and downloads. |
| `src/components/conversation-intake.tsx` | Message composer, language selection, audio consent, recording and transcript review. |
| `src/components/claim-review.tsx` | Original statements, uncertainty, assertion/evidence links, challenge cards and field approvals. |
| `src/components/workspace-bits.tsx` | Step metadata and reusable field, source-link and research-card components. |
| `src/lib/claim.ts` | Shared data schemas, conservative labelled-field extraction, preliminary checks and fee calculations. |
| `src/lib/conversation.ts` | Conversation schemas, limited local observations and validation of model source fragments. |
| `src/lib/review.ts` | Provenance, uncertainty, assertion IDs, review issues and approved-package construction. |
| `src/lib/openai.ts` | Organisation, conversational interpretation and research drafting against any OpenAI-compatible provider. Emits a real JSON Schema, repeats the field contract in the prompt so it survives providers that drop the schema, normalises model output, and enforces one end-to-end deadline with a bounded 429 retry. |
| `src/lib/exa.ts` | Retrieval-only Exa search plus five concurrent research orchestrations; validates citation provenance. |
| `src/lib/sources.ts` | Official-source registry, URL allowlist, generic search queries and reference guidance. |
| `src/lib/speech.ts` | Browser recording lifecycle, language hints, transcription requests and user-facing audio errors. |
| `src/lib/workspace-draft.ts` | Merges proposals while preserving user edits; provides the fictional example. |
| `src/lib/workspace-upload.ts` | Browser file limits, TXT reading and calls to document extraction. |
| `src/lib/export.ts` | Markdown preparation-draft content; the workspace appends its conversation/review trail. |
| `src/lib/api-client.ts`, `src/lib/http.ts` | Browser JSON requests; server body limits, origin checks, error responses and an in-process concurrency guard. |
| `extension/` | Standalone Chrome popup for general semantic form mapping. `shared/transfer.mjs` defines the package contract used by the app. |
| `cjts-prefiling/` | Standalone Chrome helper for the SCT terms and pre-filing assessment pages. Its `transfer.mjs` is a required byte-identical mirror of `extension/shared/transfer.mjs`. |
| `public/mock-cjts.html`, `mock-sct.html`, `mock-terms.html` | Local fixtures for the general transfer form, the SCT assessment page and the terms page. Each encodes the recorded control shapes, not a portal replica. |
| `tests/` | Logic/API tests, generated document fixtures and Playwright browser tests. |

### API routes and data flow

All routes accept `POST` requests and run in the Node.js runtime. Provider credentials are read on the server.

| Endpoint | Input and behavior |
| --- | --- |
| `/api/prepare` | Validates long-form intake, then returns a `Draft` organised by the AI provider, or conservative local extraction when consent/key is absent. |
| `/api/conversation` | Accepts the accumulated account, desired outcome and evidence. Returns a draft, observations and a follow-up prompt using the AI provider, or limited local patterns. |
| `/api/research` | Requires a valid draft, AI consent and both provider keys. Runs five section-specific Exa searches drafted by the AI provider, under one shared deadline; unavailable sections remain explicit. Reference mode is selected by the workspace, not returned as a successful live search by this route. |
| `/api/extract` | Reads multipart PDF/DOCX uploads in memory using `pdf-parse`/`mammoth`; validates file signatures and extraction limits. TXT is read in the browser. |
| `/api/transcribe` | Receives one complete audio recording and an optional language hint, then forwards it to OpenRouter and returns transcript text. |

Model requests ask for structured output and also state the field contract in the prompt, because providers silently drop `response_format` for models that do not support it. Exa retrieval is restricted to allowed Judiciary/CJTS sources. A research field must cite an allowed HTTPS URL returned by that search; unsupported guidance falls back to labelled reference material or verification prompts. This validates citation provenance, not whether a source actually proves the generated interpretation.

Generic search queries omit raw particulars and case text is never sent to Exa; consented case text, draft fields and extracted evidence go to the AI provider's drafting context (OpenRouter by default). Generic queries are not anonymisation.

### Styles

CSS is global and imported once in `src/app/layout.tsx`. Preserve the import order: tokens → base → shared UI → workspace layout → claim workspace → conversation intake → claim review → research.

- `src/app/styles/tokens.css`: shared palette, fonts and used design tokens.
- `src/app/styles/base.css`: reset, element defaults, focus behavior and accessibility helpers.
- `src/app/styles/ui.css`: shared buttons, cards, fields and conversation/review presentation.
- `src/components/workspace-layout.css`: header, navigation, page layout, context column, modal and footer.
- The remaining component CSS files hold their feature styles and responsive/print rules. Screen-only typography remains separate from print formatting.
- `extension/popup.css` is standalone because the extension runs outside the app.

For UI changes, check desktop and phone layouts, keyboard focus, and print output. Next.js can merge CSS differently in production, so also run the build. The installed framework guides are in `node_modules/next/dist/docs/`; see `AGENTS.md` before changing framework code.

## What the tests do

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

`typecheck` runs TypeScript without emitting JavaScript. `lint` runs ESLint. `npm test` uses Node's test runner through `tsx`; it imports helpers and route handlers directly, without starting Next.js. Provider responses are mocked.

| Test file | What it verifies |
| --- | --- |
| `tests/claim.test.ts` | Labelled extraction preserves the original story; ambiguous amounts/dates stay unresolved; fee bands, claim limits and Singapore calendar-date boundaries behave as coded; unsafe/lookalike source URLs are rejected; generic queries omit private particulars; exports retain review notices. |
| `tests/exa.test.ts` | Five distinct retrieval-only research requests carry domain restrictions and no generation payload; unsupported citations and malformed output are rejected; provider errors stay explicit; consent prevents provider calls; API handlers reject invalid JSON, cross-origin requests and oversized bodies. |
| `tests/openai.test.ts` | Organisation and conversation proposals carry structured-output schemas; malformed output is rejected; provider errors stay explicit without leaking upstream text; conversation source fragments and vague dates are checked. Also the regression set for the fixed blocker: the emitted schema really constrains `claimType` and the prompt repeats the contract; a free-text category, a formatted amount and a written date normalise instead of discarding the draft; a 429 is retried once and then reported; the request signal reaches the provider, an exhausted deadline starts no attempt, and an already-aborted request never calls out. |
| `tests/transfer-parity.test.ts` | The two extensions' transfer contracts are byte-identical and agree on an 18-case accept/reject corpus. Guards against the drift that had already occurred. |
| `tests/review.test.ts` | Approximate dates cannot become invented exact dates; narrow challenge rules flag unsupported statements and conflicting records; only approved, unchanged values are exported; invalid/versioned packages are rejected; Mandarin originals and payment-versus-claim distinctions survive local organisation; short conversation turns work without AI consent. |
| `tests/speech.test.ts` | Locale hints and automatic detection, server-side credentials, audio formats/model overrides, multilingual transcript passthrough, invalid requests, sanitized provider failures, cancellation forwarding and empty-transcript rejection. Audio and provider replies are synthetic. |

Playwright starts a development server at `127.0.0.1:3100` with AI disabled and runs the browser suites in Chromium at desktop and emulated iPhone 13 sizes. The mobile project is Chromium emulation, not Safari or a physical phone. Tests run with one worker.

| Browser suite | What it exercises |
| --- | --- |
| `tests/browser/workspace.spec.ts` | New-claim validation → example/evidence upload → editable fields → reference research → Markdown download and gated CJTS link. Also tests existing-claim import, explicit image-description states, actual PDF/DOCX extraction with generated fixtures, invalid-document rejection, horizontal overflow and page errors. |
| `tests/browser/multimodal.spec.ts` | Conversation → challenge cards → individual approval → JSON export → selected mock-form filling without submission. Checks approval invalidation and skips ambiguous, hidden, occupied, overlong or incompatible destination controls. Audio cases cover denied permission, missing recording support, track cleanup, editable transcripts and cancellation races. Most use stubs; one calls Chromium's native media API with a synthetic audio device to verify the response policy permits the microphone. |
| `tests/browser/extension.spec.ts` | Loads `extension/` unpacked in a separate desktop Chromium context. Rejects malformed imports, accepts approved packages, and fails safely when the popup lacks page permission. Then drives the real popup end to end: preview, deselect one approved field, fill, and assert the deselected field stayed blank and nothing was submitted. Also that a page changed after preview refuses to fill. Skips the mobile project. |
| `tests/browser/cjts-prefiling.spec.ts` | Calls `assistAssessment` directly on `/mock-sct.html` for stale-signature rejection, checkbox selection, amount fill and manual date picker, and checks that an unapproved value is refused at the injected-script boundary. Also loads `cjts-prefiling/` unpacked and drives its real popup through scan → apply. Covers `run-action.mjs` on `/mock-terms.html`: the allowlist rejects unknown actions and smuggled selectors, and open dialogs, disabled controls, ambiguous matches and wrong pages all refuse. |

`tests/browser/extension-harness.ts` loads an unpacked extension and can stage a
copy with a fixture-scoped `host_permissions` entry. That staging exists because
`activeTab` is granted only when a user clicks the toolbar icon, which no
headless harness can do — without it every scripting call fails, which is why the
suite previously contained no successful fill. The shipped manifests are never
modified and still declare `activeTab` alone; the permission-failure test runs
against the unmodified manifest.

`tests/fixtures.ts` generates small valid PDF/DOCX files in memory. These tests
cover the popup, the `chrome.scripting` path and the fixtures — not a successful
authenticated CJTS transfer, which remains manual.

Screenshots in `test-results/` are inspection artifacts, not visual snapshot assertions. Failure traces and screenshots are retained there too. To inspect a trace, use `npx playwright show-trace <path-to-trace.zip>`.

To reuse a running server or select a suite:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
npm run test:e2e -- tests/browser/workspace.spec.ts --project=mobile
npx tsx --test --test-name-pattern="consent" tests/*.test.ts
```

Use a server with AI disabled (no provider keys) for deterministic reference-mode checks. Automated tests do not establish live provider availability, transcription/translation accuracy, legal correctness, accessibility conformance or compatibility with authenticated CJTS pages. Those require separate verification.

### Live provider smoke test

Everything above mocks the providers, so it proves the app's logic but not that
the configured model and keys work. `npm run test:live` runs the real
organisation path (and research with `research`) against live providers using
fictional data, reading `.env` directly:

```sh
npm run test:live               # organise three times
npm run test:live -- 5          # repeat five times
npm run test:live -- 3 research # also run one live research section
```

Run it after changing `OPENAI_TEXT_MODEL`, `OPENAI_BASE_URL` or provider keys. It
exits non-zero if any organisation run fails, and prints the model and endpoint
in use so a misconfiguration is visible immediately.

## Documents, audio and session state

Drafts, original files and conversation records live in the current tab's memory. Refreshing or closing the tab loses the session; download work before leaving. The app does not save case data in localStorage, cookies or a database.

- Evidence: up to 10 files, 10 MB each and 25 MB combined. PDF extraction is limited to 80 pages; document text is limited to 30,000 characters. Oversized text is rejected rather than silently truncated.
- Images are attached without OCR or visual analysis. Scanned/unreadable PDFs need transcription or a description. Evidence links and descriptions are user assertions, not proof of authenticity.
- PDF/DOCX and audio uploads are processed in server memory without application-level storage or request-body logging. Provider and infrastructure retention are separate operational concerns. Google Fonts serves the typefaces, with system-font fallbacks.
- Voice needs HTTPS or localhost, `MediaRecorder`, audio consent and microphone permission. Recordings stop after 60 seconds and are limited to 10 MB. Language hints include English, Mandarin, Malay and Tamil, or automatic detection. Review the editable transcript before adding it to the account.
- If microphone access is denied, check browser site permissions and system microphone permissions. Cancelling a pending request prevents a late recording/transcript from replacing typed text. Audio is for intake transcription, not evidentiary recording.

Local conversational patterns cover only a few English/Mandarin examples, not general translation. Broader interpretation depends on the AI provider and user review. Original wording is retained; approximate dates stay unresolved, and an amount paid is not automatically the amount claimed. Challenge rules are intentionally narrow and do not determine truth or case strength.

## Chrome extensions

Two unpacked extensions, both supported, no build step. They cover different
pages — pick by which page you are on:

| Use | Extension | Page | Fixture |
| --- | --- | --- | --- |
| Transfer approved fields into a claim form | `extension/` — see [its README](extension/README.md) | a general CJTS claim form | `/mock-cjts.html` |
| Choose dispute options and fill the claim amount | `cjts-prefiling/` — see [its README](cjts-prefiling/README.md) | the SCT pre-filing **assessment** page | `/mock-sct.html` |
| Open Terms, Cancel or Proceed | `cjts-prefiling/` | the SCT pre-filing **terms** page | `/mock-terms.html` |

Load either with **chrome://extensions → Developer mode → Load unpacked**.

Both use `activeTab` and `scripting`, process the package in memory, and never
submit a form, sign in, solve CAPTCHA, or pay. Closing a popup clears its
imported package, but not downloaded JSON or values already entered in a page.

### The shared transfer contract

`extension/shared/transfer.mjs` and `cjts-prefiling/transfer.mjs` must stay
**byte-identical**. Each extension loads under its own `chrome-extension://`
origin and cannot import across folders, and there is no build step, so the
contract is duplicated on disk by necessity. Edit one and copy it to the other;
`tests/transfer-parity.test.ts` fails on both file divergence and any behavioural
disagreement.

### Before trusting either against live CJTS

The live selectors in `cjts-prefiling/assessment-assist.mjs` and `run-action.mjs`
depend on the exact route, `sessionStorage.TribunalType`, Angular component and
class names, label nesting, option text, and the `cAmount`/`d2` field names. All
were inspected once on 2026-09-05 (recorded in `cjts-prefiling/actions.json`) and
**have not been re-confirmed**. The fixtures encode those recorded shapes, so a
passing test suite does not mean the live portal still matches. Re-check each
assumption against the rendered portal, with fictional data, before relying on
either extension for real filing.

## Reference guidance and deployment

The source registry and recorded review date are in `src/lib/sources.ts`. Recheck the linked official material when updating reference guidance or preparing a public release; automated tests verify the implemented rules, not current court requirements.

This prototype has bounded request bodies and an in-process concurrency guard. Before public deployment, add authenticated access, per-user quotas and a shared rate limiter; isolate untrusted document parsing in resource-limited workers; and assess operational privacy, retention, compressed-document handling and accessibility.
