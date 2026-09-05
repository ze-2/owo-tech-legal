# Clearclaim

Clearclaim is a Next.js app for preparing Singapore Small Claims Tribunals claims. Users describe a dispute, attach records, review an editable draft and official-source guidance, then export their preparation work or approved fields for assisted form entry. It is a local prototype, not an official court form, legal adviser, or filing service.

## Handoff: unresolved blockers (2026-09-06)

The next agent should treat both items below as open even though the current automated tests pass. The tests use mocked provider responses and simplified local portal fixtures; they do not reproduce the reported failures in the real workflow.

### 1. Make `/api/prepare` reliable

**Reported symptom:** organising a claim through `/api/prepare` is intermittent. The failure has not yet been reduced to a deterministic test. Local organisation and the mocked route tests pass, so first reproduce with the same consent, provider and deployment configuration as the failing run. Record request duration, HTTP status, the sanitised error response and server-side failure class; do not log the claim text or evidence.

Start at `src/components/claim-workspace.tsx` (`prepare`), `src/lib/api-client.ts`, `src/app/api/prepare/route.ts`, `src/lib/http.ts` (`withCapacity`) and `src/lib/openai.ts` (`completeJson`/`completeValidated`). In particular, reconcile the current timing budgets: the browser aborts after 65 seconds, the route declares a 60-second maximum, a provider attempt may take 55 seconds, and validation can trigger a second provider attempt. Provider SDK retries may extend this further. Also verify that `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `OPENAI_TEXT_MODEL` describe one compatible provider configuration; the sample environment defaults the compatible endpoint to OpenRouter even though several UI/error strings call the service OpenAI.

The fix is complete when:

- AI-disabled/basic organisation remains deterministic and does not make a provider call.
- The AI path has one end-to-end deadline below the route/platform limit, aborts downstream work when the client disconnects where supported, and returns a useful retry/basic-mode error.
- Slow responses, an invalid first model response, provider rate limits and concurrent prepare requests are covered without relying on a live provider.
- Repeated clicks cannot leave the workspace permanently busy or allow an older response to overwrite a newer draft.
- A repeated browser run covers both consent-off and consent-on behavior; a mocked provider integration is sufficient for CI, followed by one separately documented live smoke test with fictional data.

Do not mark this resolved only because `tests/openai.test.ts` passes: it injects an immediate fake client and therefore does not exercise route duration, network cancellation, SDK retry behavior or deployment timeouts.

### 2. Repair and clarify the Chrome extension workflow

**Reported symptom:** the extension does not work correctly in the intended CJTS flow. There are currently two unpacked Manifest V3 extensions, and the root documentation previously mentioned only the older one:

- `extension/` (v0.1) imports approved JSON and attempts general semantic field transfer. Its supported test target is `/mock-cjts.html`; live authenticated CJTS field selectors are unverified.
- `cjts-prefiling/` (v0.2) targets the SCT terms and pre-filing assessment pages, recommends dispute options and can fill a revealed claim amount. Its helper test target is `/mock-sct.html`.

First confirm which folder the user loaded and capture the exact popup status, active tab URL, manifest version and rendered CJTS control markup. Then decide which extension is the supported product path and make the website/root instructions point to it unambiguously. The live assessment helper currently depends on exact route, `sessionStorage.TribunalType`, Angular component/class names, label nesting, option text and amount selectors; compare every assumption in `cjts-prefiling/assessment-assist.mjs` and `run-action.mjs` with the current rendered portal before changing selectors. Preserve the guardrails against submission, CAPTCHA handling, credentials and broad/ambiguous matches.

The test gap is important:

- `tests/browser/extension.spec.ts` loads the real `extension/` popup, but its only scripting action intentionally fails because opening the popup URL as a tab does not grant `activeTab`.
- `tests/browser/multimodal.spec.ts` proves successful `/mock-cjts.html` filling by calling `assistForm` directly, not through the loaded popup.
- `tests/browser/cjts-prefiling.spec.ts` calls `assistAssessment` directly on a simplified fixture. It does not load the `cjts-prefiling/` manifest/popup, exercise `activeTab`, import a package, run terms-page actions or verify authenticated CJTS.

The fix is complete when a loaded unpacked extension has a successful popup-to-fixture test (scan/preview, selection, apply/fill, and no submission), failure tests cover the wrong page/tab changes/stale signatures, and a manual fictional-data smoke test confirms the current live CJTS DOM. Keep a sanitised DOM fixture representative of the verified controls so the test does not merely encode an invented markup shape. Consolidate the duplicated transfer validation in `extension/shared/transfer.mjs` and `cjts-prefiling/transfer.mjs`, or add contract-parity tests so they cannot drift.

### Current verification baseline

As of 2026-09-06, `npm run typecheck` passes and `npm test` reports 39/39 passing. A focused desktop Playwright run against the already-running server passed six workspace/extension-helper tests:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e -- \
  tests/browser/workspace.spec.ts \
  tests/browser/extension.spec.ts \
  tests/browser/cjts-prefiling.spec.ts \
  --project=desktop
```

This baseline does **not** clear either blocker. Stop or reuse an existing `next dev` process before running Playwright; otherwise its configured web server exits because Next.js already holds the development lock. A clean server restart is also advisable before investigating hydration/HMR noise.

## Run locally

Use Node.js 22 or 24 and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open [localhost:3000](http://localhost:3000). **Try a fictional example** fills the long-form intake; **Talk through your claim** accepts short messages. Basic organisation and reference guidance work without API keys.

Optional server configuration in `.env`:

| Variable | Enables |
| --- | --- |
| `OPENAI_API_KEY` | AI organisation, conversational interpretation and research drafting with OpenAI, after the user gives AI consent. |
| `OPENAI_TEXT_MODEL` | Text generation model; defaults to `gpt-5.6-terra`. |
| `EXA_API_KEY` | Official-source retrieval for live research, after the user gives AI consent. |
| `OPENROUTER_API_KEY` | Voice transcription through OpenRouter, after separate audio consent and browser microphone permission. |
| `OPENROUTER_TRANSCRIPTION_MODEL` | Transcription model; defaults to `openai/whisper-large-v3`. |

Restart the server after changing configuration. Keep keys server-side; never give them a `NEXT_PUBLIC_` prefix. OpenAI handles organisation and research drafting, Exa handles official-source retrieval, so those features do not need another model-provider key or a vector database.

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
| `src/lib/openai.ts` | OpenAI organisation, conversational interpretation and research drafting with structured output; validates model output. |
| `src/lib/exa.ts` | Retrieval-only Exa search plus five concurrent research orchestrations; validates citation provenance. |
| `src/lib/sources.ts` | Official-source registry, URL allowlist, generic search queries and reference guidance. |
| `src/lib/speech.ts` | Browser recording lifecycle, language hints, transcription requests and user-facing audio errors. |
| `src/lib/workspace-draft.ts` | Merges proposals while preserving user edits; provides the fictional example. |
| `src/lib/workspace-upload.ts` | Browser file limits, TXT reading and calls to document extraction. |
| `src/lib/export.ts` | Markdown preparation-draft content; the workspace appends its conversation/review trail. |
| `src/lib/api-client.ts`, `src/lib/http.ts` | Browser JSON requests; server body limits, origin checks, error responses and an in-process concurrency guard. |
| `extension/` | Original standalone Chrome popup and general semantic form mapping. `shared/transfer.mjs` defines the package contract used by the app. |
| `cjts-prefiling/` | Newer standalone Chrome helper for the SCT terms and pre-filing assessment pages. It currently duplicates transfer-package validation and needs the live-flow work described in the handoff above. |
| `public/mock-cjts.html` | Local form fixture for assisted-transfer demonstrations and browser tests. |
| `tests/` | Logic/API tests, generated document fixtures and Playwright browser tests. |

### API routes and data flow

All routes accept `POST` requests and run in the Node.js runtime. Provider credentials are read on the server.

| Endpoint | Input and behavior |
| --- | --- |
| `/api/prepare` | Validates long-form intake, then returns a `Draft` organised with OpenAI or conservative local extraction when consent/key is absent. |
| `/api/conversation` | Accepts the accumulated account, desired outcome and evidence. Returns a draft, observations and a follow-up prompt using OpenAI or limited local patterns. |
| `/api/research` | Requires a valid draft, AI consent and both provider keys. Runs five section-specific Exa searches drafted with OpenAI; unavailable sections remain explicit. Reference mode is selected by the workspace, not returned as a successful live search by this route. |
| `/api/extract` | Reads multipart PDF/DOCX uploads in memory using `pdf-parse`/`mammoth`; validates file signatures and extraction limits. TXT is read in the browser. |
| `/api/transcribe` | Receives one complete audio recording and an optional language hint, then forwards it to OpenRouter and returns transcript text. |

OpenAI requests use structured output; Exa retrieval is restricted to allowed Judiciary/CJTS sources. A research field must cite an allowed HTTPS URL returned by that search; unsupported guidance falls back to labelled reference material or verification prompts. This validates citation provenance, not whether a source actually proves the generated interpretation.

Generic search queries omit raw particulars and case text is never sent to Exa; consented case text, draft fields and extracted evidence go to OpenAI's drafting context. Generic queries are not anonymisation.

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
| `tests/openai.test.ts` | OpenAI organisation and conversation proposals carry structured-output schemas; malformed output is rejected; provider errors stay explicit; conversation source fragments and vague dates are checked. |
| `tests/review.test.ts` | Approximate dates cannot become invented exact dates; narrow challenge rules flag unsupported statements and conflicting records; only approved, unchanged values are exported; invalid/versioned packages are rejected; Mandarin originals and payment-versus-claim distinctions survive local organisation; short conversation turns work without AI consent. |
| `tests/speech.test.ts` | Locale hints and automatic detection, server-side credentials, audio formats/model overrides, multilingual transcript passthrough, invalid requests, sanitized provider failures, cancellation forwarding and empty-transcript rejection. Audio and provider replies are synthetic. |

Playwright starts a development server at `127.0.0.1:3100` with AI disabled and runs the browser suites in Chromium at desktop and emulated iPhone 13 sizes. The mobile project is Chromium emulation, not Safari or a physical phone. Tests run with one worker.

| Browser suite | What it exercises |
| --- | --- |
| `tests/browser/workspace.spec.ts` | New-claim validation → example/evidence upload → editable fields → reference research → Markdown download and gated CJTS link. Also tests existing-claim import, explicit image-description states, actual PDF/DOCX extraction with generated fixtures, invalid-document rejection, horizontal overflow and page errors. |
| `tests/browser/multimodal.spec.ts` | Conversation → challenge cards → individual approval → JSON export → selected mock-form filling without submission. Checks approval invalidation and skips ambiguous, hidden, occupied, overlong or incompatible destination controls. Audio cases cover denied permission, missing recording support, track cleanup, editable transcripts and cancellation races. Most use stubs; one calls Chromium's native media API with a synthetic audio device to verify the response policy permits the microphone. |
| `tests/browser/extension.spec.ts` | Loads the actual unpacked extension in a separate desktop Chromium context, rejects malformed imports, accepts approved packages, clears them, and fails safely when the popup lacks page permission. It deliberately skips the mobile project. |
| `tests/browser/cjts-prefiling.spec.ts` | Calls the SCT assessment helper directly on `/mock-sct.html`, checks stale-signature rejection, selects one fixture checkbox, fills the revealed amount and leaves the date picker manual. It does not load the actual extension popup. |

`tests/fixtures.ts` generates small valid PDF/DOCX files in memory. The successful mock-form transfer uses the same `assistForm` function shipped in the extension; the unpacked-extension test covers the actual popup and permission failure, not a successful authenticated CJTS transfer.

Screenshots in `test-results/` are inspection artifacts, not visual snapshot assertions. Failure traces and screenshots are retained there too. To inspect a trace, use `npx playwright show-trace <path-to-trace.zip>`.

To reuse a running server or select a suite:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
npm run test:e2e -- tests/browser/workspace.spec.ts --project=mobile
npx tsx --test --test-name-pattern="consent" tests/*.test.ts
```

Use a server with AI disabled (no provider keys) for deterministic reference-mode checks. Automated tests do not establish live provider availability, transcription/translation accuracy, legal correctness, accessibility conformance or compatibility with authenticated CJTS pages. Those require separate verification.

## Documents, audio and session state

Drafts, original files and conversation records live in the current tab's memory. Refreshing or closing the tab loses the session; download work before leaving. The app does not save case data in localStorage, cookies or a database.

- Evidence: up to 10 files, 10 MB each and 25 MB combined. PDF extraction is limited to 80 pages; document text is limited to 30,000 characters. Oversized text is rejected rather than silently truncated.
- Images are attached without OCR or visual analysis. Scanned/unreadable PDFs need transcription or a description. Evidence links and descriptions are user assertions, not proof of authenticity.
- PDF/DOCX and audio uploads are processed in server memory without application-level storage or request-body logging. Provider and infrastructure retention are separate operational concerns. Google Fonts serves the typefaces, with system-font fallbacks.
- Voice needs HTTPS or localhost, `MediaRecorder`, audio consent and microphone permission. Recordings stop after 60 seconds and are limited to 10 MB. Language hints include English, Mandarin, Malay and Tamil, or automatic detection. Review the editable transcript before adding it to the account.
- If microphone access is denied, check browser site permissions and system microphone permissions. Cancelling a pending request prevents a late recording/transcript from replacing typed text. Audio is for intake transcription, not evidentiary recording.

Local conversational patterns cover only a few English/Mandarin examples, not general translation. Broader interpretation depends on OpenAI and user review. Original wording is retained; approximate dates stay unresolved, and an amount paid is not automatically the amount claimed. Challenge rules are intentionally narrow and do not determine truth or case strength.

## Chrome extension

There are currently two experimental unpacked extensions and no build step. Follow [extension/README.md](extension/README.md) for the original approved-field transfer demo on `/mock-cjts.html`. Follow [cjts-prefiling/README.md](cjts-prefiling/README.md) for the newer SCT pre-filing assessment helper on `/mock-sct.html` and the narrowly targeted official assessment route. See the unresolved handoff above before treating either as the supported live workflow.

Both extensions use `activeTab` and `scripting`, process the package in memory, and do not submit forms. Successful operation through a loaded popup and current authenticated CJTS compatibility still require verification. Closing a popup clears its imported package, but not downloaded JSON or values already entered in a page.

## Reference guidance and deployment

The source registry and recorded review date are in `src/lib/sources.ts`. Recheck the linked official material when updating reference guidance or preparing a public release; automated tests verify the implemented rules, not current court requirements.

This prototype has bounded request bodies and an in-process concurrency guard. Before public deployment, add authenticated access, per-user quotas and a shared rate limiter; isolate untrusted document parsing in resource-limited workers; and assess operational privacy, retention, compressed-document handling and accessibility.
