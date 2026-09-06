"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Copy,
  FileText,
  FolderOpen,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  claimTypes,
  eligibilityChecks,
  filingFee,
  missingFields,
  orderTypes,
  organiseLocally,
  type Draft,
  type Evidence,
  type Intake,
  type Research,
} from "@/lib/claim";
import { filingPack } from "@/lib/export";
import { postJson } from "@/lib/api-client";
import { extractFileText, validateSelectedFiles } from "@/lib/workspace-upload";
import {
  SAMPLE_CLAIMS,
  mergeConversationDraft,
  mergePreparedDraft,
} from "@/lib/workspace-draft";
import { ConversationIntake } from "./conversation-intake";
import { ClaimReview } from "./claim-review";
import { CourtCheatsheet } from "./court-cheatsheet";
import {
  Field,
  ResearchCard,
  SourceLink,
  WORKSPACE_STEPS,
} from "./workspace-bits";
import {
  approvedPackage,
  initialReviews,
  followUp,
  uncertainDates,
  type Assertion,
  type FilingField,
  type Reviews,
  type SctOption,
  type Statement,
} from "@/lib/review";
import type { Observation } from "@/lib/conversation";
import { referenceResearch, sources, SOURCE_REVIEW_DATE } from "@/lib/sources";

const MAX_ACCOUNT_CHARS = 30000;

export function ClaimWorkspace({
  researchConfigured,
}: {
  researchConfigured: boolean;
}) {
  const [step, setStep] = useState(0);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [conversationPrompt, setConversationPrompt] = useState("");
  const [accountChanged, setAccountChanged] = useState(false);
  const [reviews, setReviews] = useState<Reviews>({});
  const [sctOptions, setSctOptions] = useState<SctOption[]>([]);
  const previousPrompt = useRef("");
  const editedFields = useRef(new Set<keyof Draft>());
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [problem, setProblem] = useState("");
  const [outcome, setOutcome] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [draftMode, setDraftMode] = useState<"basic" | "ai">("basic");
  const [sourceModal, setSourceModal] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [copied, setCopied] = useState("");
  const evidenceInput = useRef<HTMLInputElement>(null);
  const claimInput = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const originals = useRef<Map<string, File>>(new Map());
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  /**
   * Supersede in-flight provider work. Starting a new organise/research cancels
   * the previous one and stamps a token, so a late response from the older
   * request can never overwrite the newer draft. The disabled fieldset makes
   * overlap unlikely, not impossible — this is the actual guarantee.
   */
  function beginRequest() {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const token = ++requestSeq.current;
    return {
      signal: controller.signal,
      isCurrent: () => requestSeq.current === token,
    };
  }

  useEffect(() => {
    if (sourceModal) dialogRef.current?.showModal();
  }, [sourceModal]);

  function navigate(next: number) {
    setStep(next);
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => summaryRef.current?.focus(), 50);
  }

  function resetApprovals() {
    setSctOptions([]);
    setReviews((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, meta]) => [
          key,
          { ...meta, review: "unreviewed" },
        ]),
      ),
    );
  }

  function invalidate(accountChangedFlag = false) {
    if (accountChangedFlag) setAccountChanged(true);
    setResearch(null);
    setReviewed(false);
    resetApprovals();
  }

  function approveField(key: FilingField, approved: boolean) {
    if (!draft) return;
    setReviews((current) => ({
      ...current,
      [key]: {
        provenance: current[key]?.provenance ?? "unknown",
        value: draft[key],
        review: approved ? "approved" : "unreviewed",
      },
    }));
  }

  function exportApproved() {
    if (!draft) return;
    try {
      saveFile(
        JSON.stringify(approvedPackage(draft, reviews, sctOptions), null, 2),
        "clearclaim-approved-filing.json",
        "application/json",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No approved fields available.",
      );
    }
  }

  async function addMessage(
    messageText: string,
    language: string,
    input: Statement["input"],
  ): Promise<boolean> {
    const original = [problem, messageText].filter(Boolean).join("\n");
    if (original.length > MAX_ACCOUNT_CHARS) {
      setError("The combined account must be 30,000 characters or fewer.");
      return false;
    }
    // Commit original wording before provider work so a failure cannot discard it.
    setStatements((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        text: messageText,
        language,
        input,
        createdAt: new Date().toISOString(),
      },
    ]);
    setProblem(original);
    invalidate(true);
    setError("");
    const request = beginRequest();
    setBusy("Organising your latest message…");
    try {
      const result = await postJson<{
        draft: Draft;
        observations: Observation[];
        mode: "basic" | "ai";
        followUp: string;
      }>(
        "/api/conversation",
        { original, outcome, evidence, consent },
        request.signal,
      );
      if (!request.isCurrent()) return true;
      const merged = mergeConversationDraft(
        result.draft,
        draft,
        reviews,
        editedFields.current,
      );
      setDraft(merged);
      setAccountChanged(false);
      setDraftMode(result.mode);
      setObservations(result.observations);
      setReviews((current) => {
        const next = initialReviews(
          merged,
          result.mode === "ai" ? "ai-organised" : "user",
        );
        for (const [key, meta] of Object.entries(current)) {
          if (editedFields.current.has(key as keyof Draft)) {
            next[key as FilingField] = {
              ...meta,
              value: merged[key as FilingField],
              review: "unreviewed",
            };
          }
        }
        return next;
      });
      const prompt = followUp(merged, original);
      const prefix =
        result.mode === "basic"
          ? "Local mode: limited labelled-field extraction and a few example patterns; full multilingual interpretation needs AI consent and configuration. "
          : "";
      const suffix =
        prompt === previousPrompt.current
          ? "That detail remains unresolved; leave it blank if unknown. You can review the organised claim or add another detail."
          : prompt;
      setConversationPrompt(`${prefix}${suffix}`);
      previousPrompt.current = prompt;
    } catch (err) {
      if (!request.isCurrent()) return true;
      setError(
        err instanceof Error ? err.message : "Could not organise the message.",
      );
      setConversationPrompt(
        "Your original message is retained. Continue with basic organisation or retry later.",
      );
    } finally {
      if (request.isCurrent()) setBusy("");
    }
    return true;
  }
  function updateDraft(key: keyof Draft, value: string | boolean) {
    editedFields.current.add(key);
    if (key === "outcome" && typeof value === "string") setOutcome(value);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setResearch(null);
    setReviewed(false);
    resetApprovals();
    if (typeof value === "string")
      setReviews((current) => ({
        ...current,
        [key]: { value, provenance: "user", review: "unreviewed" },
      }));
  }

  async function addFiles(
    files: FileList | File[] | null,
    asClaimDocument = false,
  ) {
    if (!files?.length || uploadLock.current || busy) return;
    uploadLock.current = true;
    setError("");
    setBusy(
      asClaimDocument
        ? "Reading your claim document…"
        : "Reading your evidence…",
    );
    const selected = Array.from(files);
    try {
      validateSelectedFiles(selected, evidence, asClaimDocument);
      if (asClaimDocument) {
        await importClaimDocument(selected[0]);
      } else {
        await appendEvidenceFiles(selected);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The file could not be read.",
      );
    } finally {
      setBusy("");
      uploadLock.current = false;
      if (evidenceInput.current) evidenceInput.current.value = "";
      if (claimInput.current) claimInput.current.value = "";
    }
  }

  async function importClaimDocument(file: File) {
    const parsed = await extractFileText(file);
    if (parsed.status !== "extracted") {
      throw new Error(
        "No readable text was found. Paste the claim text below; scanned documents need transcription.",
      );
    }
    setProblem(parsed.text);
    invalidate(true);
    setNotice(`Imported ${file.name}. Check the extracted text below.`);
  }

  async function appendEvidenceFiles(selected: File[]) {
    const added: Evidence[] = [];
    const failures: string[] = [];
    for (const file of selected) {
      const id = crypto.randomUUID();
      let parsed: { text: string; status: Evidence["status"] } = {
        text: "",
        status: "unreadable",
      };
      try {
        parsed = await extractFileText(file);
      } catch (err) {
        failures.push(
          `${file.name}: ${err instanceof Error ? err.message : "Could not read this file."}`,
        );
      }
      originals.current.set(id, file);
      added.push({
        id,
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        ...parsed,
        note: "",
      });
    }
    setEvidence((current) => [...current, ...added]);
    invalidate(false);
    if (failures.length) setError(failures.join(" "));
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  function buildIntake(): Intake {
    return { mode, problem, outcome, evidence, consent };
  }

  async function prepare(basic = false) {
    setError("");
    if (problem.trim().length < 30) {
      setError(
        "Tell us a little more about what happened — at least 30 characters.",
      );
      return;
    }
    if (mode === "new" && outcome.trim().length < 5) {
      setError("Add a few words about the outcome you want.");
      return;
    }
    const request = beginRequest();
    setBusy("Organising your account into claim information…");
    try {
      const result = basic
        ? { draft: organiseLocally(buildIntake()), mode: "basic" as const }
        : await postJson<{ draft: Draft; mode: "basic" | "ai" }>(
            "/api/prepare",
            buildIntake(),
            request.signal,
          );
      if (!request.isCurrent()) return;
      const next = mergePreparedDraft(
        result.draft,
        draft,
        reviews,
        editedFields.current,
      );
      const nextReviews = initialReviews(
        next,
        result.mode === "ai" ? "ai-organised" : "user",
      );
      for (const key of editedFields.current) {
        if (nextReviews[key as FilingField])
          nextReviews[key as FilingField]!.provenance = "user";
      }
      setDraft(next);
      setAccountChanged(false);
      setReviews(nextReviews);
      setDraftMode(result.mode);
      setResearch(null);
      setReviewed(false);
      navigate(1);
    } catch (err) {
      if (!request.isCurrent()) return;
      setError(
        err instanceof Error
          ? err.message
          : "Could not organise the claim. Please try basic organisation.",
      );
    } finally {
      if (request.isCurrent()) setBusy("");
    }
  }

  async function runResearch() {
    if (!draft) return;
    if (!consent || !researchConfigured) {
      setResearch(referenceResearch());
      navigate(2);
      return;
    }
    const request = beginRequest();
    setBusy("Checking five sections against official SCT sources…");
    setError("");
    try {
      const result = await postJson<Research>(
        "/api/research",
        { draft, evidence, consent },
        request.signal,
      );
      if (!request.isCurrent()) return;
      setResearch(result);
      navigate(2);
    } catch (err) {
      if (!request.isCurrent()) return;
      setError(
        err instanceof Error
          ? err.message
          : "Research could not be completed. Your draft is still here.",
      );
    } finally {
      if (request.isCurrent()) setBusy("");
    }
  }

  function saveFile(content: string, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setError(
        "Clipboard access is unavailable. Download the filing pack instead.",
      );
    }
  }

  function downloadPack() {
    if (!draft) return;
    saveFile(
      filingPack(draft, evidence, research, problem) +
        `\n\n## Conversation originals and review trail\n\nThis record is a preparation draft, not an approved transfer package. Working translations are not legally authoritative.\n\n${JSON.stringify({ statements, observations, fieldReviews: reviews, assertions }, null, 2)}\n`,
      "clearclaim-preparation-draft.md",
      "text/markdown;charset=utf-8",
    );
  }

  const missingItems = draft ? missingFields(draft, evidence) : [];
  const completedCount = [
    problem.trim().length >= 30,
    evidence.length > 0,
    outcome.trim().length >= 5,
  ].filter(Boolean).length;
  const progressPercent = `${(completedCount / 3) * 100}%`;

  const conversationIntake = (
    <Fragment key="conversation-intake">
      <ConversationIntake
        statements={statements}
        observations={observations}
        prompt={conversationPrompt}
        onSend={addMessage}
      />
      {draft && !accountChanged && (
        <section className="form-card conversation">
          <h2>Organised claim so far</h2>
          <p>Working draft · not approved. Unknown details stay blank.</p>
          <dl>
            <dt>Claimant</dt>
            <dd>{draft.claimant || "Unknown"}</dd>
            <dt>Respondent</dt>
            <dd>{draft.respondent || "Unknown"}</dd>
            <dt>Claim amount (SGD)</dt>
            <dd>{draft.amount || "Unknown; amount paid may differ"}</dd>
            <dt>Working summary</dt>
            <dd>{draft.summary}</dd>
          </dl>
          <button
            type="button"
            className="button secondary"
            onClick={() => navigate(1)}
          >
            Review organised conversation
          </button>
        </section>
      )}
    </Fragment>
  );

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Clearclaim home">
          <span className="brand-mark">
            <Scale size={25} strokeWidth={1.45} />
          </span>
          <span>
            clearclaim<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="header-divider" />
        <span className="header-caption">
          A little clarity. A confident next step.
        </span>
        <div className="header-right">
          <span className="jurisdiction">
            <span className="status-dot" />
            Singapore · Small Claims Tribunals
          </span>
          <button className="help-button" onClick={() => setSourceModal(true)}>
            <CircleHelp size={17} />
            <span>How it works</span>
          </button>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="sidebar" aria-label="Claim preparation steps">
          <div className="sidebar-top">
            <span className="eyebrow">YOUR CLAIM WORKSPACE</span>
            <span className="draft-tag">DRAFT</span>
          </div>
          <nav className="step-list">
            {WORKSPACE_STEPS.map((item, index) => (
              <button
                key={item.name}
                aria-label={item.name}
                className={`step-button ${step === index ? "active" : ""} ${step > index ? "complete" : ""}`}
                onClick={() => navigate(index)}
                disabled={
                  Boolean(busy) || (index > 0 && (!draft || accountChanged))
                }
                aria-current={step === index ? "step" : undefined}
              >
                <span className="step-number">
                  {step > index ? <Check size={15} /> : `0${index + 1}`}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.caption}</small>
                </span>
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <LockKeyhole size={17} />
            <div>
              <strong>Room to think it through.</strong>
              <p>
                Your work stays in this tab. Download a copy before leaving.
              </p>
            </div>
          </div>
          <div className="sidebar-bottom">
            <div className="small-serif">Clarity comes first.</div>
            <p>
              You don’t need legal language.
              <br />
              You just need your side of the story.
            </p>
            <button
              className="text-button"
              onClick={() => setSourceModal(true)}
            >
              About this workspace <ArrowUpRight size={14} />
            </button>
          </div>
        </aside>

        <main id="main" className="main-content">
          <div className="content-topline">
            <div className="breadcrumb">
              Your workspace <span>/</span>{" "}
              <strong>{WORKSPACE_STEPS[step].name}</strong>
            </div>
            <div className="session-indicator">
              <span className="status-dot" />
              {busy ? "Working on your draft" : "Private session"}
            </div>
          </div>
          <div className="page-heading">
            <div className="eyebrow">SMALL CLAIMS. CLEAR NEXT STEPS.</div>
            <h1 ref={summaryRef} tabIndex={-1}>
              {step === 0 ? (
                <>
                  Let’s make sense
                  <br />
                  of <em>what happened.</em>
                </>
              ) : step === 1 ? (
                <>
                  Your story,
                  <br />
                  <em>clearly organised.</em>
                </>
              ) : step === 2 ? (
                <>
                  A little context.
                  <br />
                  <em>A clearer perspective.</em>
                </>
              ) : (
                <>
                  Prepared for
                  <br />
                  <em>your next step.</em>
                </>
              )}
            </h1>
            <p>
              {step === 0
                ? "Tell us the problem, bring your evidence, and share the outcome you’re hoping for. We’ll help you put the pieces together."
                : step === 1
                  ? "Review the details below. Keep what’s accurate, correct what isn’t, and fill in the gaps before checking the guidance."
                  : step === 2
                    ? "Review official guidance alongside your account. Consider the gaps and the other side before deciding how to proceed."
                    : "Take your reviewed information to the court portal. You stay in control of what you file."}
            </p>
          </div>

          {(error || notice || busy) && (
            <div
              className={`feedback ${error ? "error" : ""}`}
              role={error ? "alert" : "status"}
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : error ? (
                <CircleHelp size={18} />
              ) : (
                <Check size={18} />
              )}
              <span>{busy || error || notice}</span>
              {error && !busy && (
                <button
                  aria-label="Dismiss message"
                  onClick={() => setError("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}

          <div className="content-grid">
            <fieldset
              className="primary-column workspace-fields"
              disabled={Boolean(busy)}
            >
              <legend className="sr-only">{WORKSPACE_STEPS[step].name}</legend>
              {step === 0 && (
                <>
                  <div
                    className="mode-selector"
                    role="group"
                    aria-label="Starting point"
                  >
                    <button
                      type="button"
                      aria-pressed={mode === "new"}
                      className={mode === "new" ? "selected" : ""}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setMode("new");
                        invalidate(true);
                      }}
                    >
                      <Plus size={17} /> Start a new claim
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "existing"}
                      className={mode === "existing" ? "selected" : ""}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setMode("existing");
                        invalidate(true);
                      }}
                    >
                      <FolderOpen size={17} /> I have an existing claim
                    </button>
                  </div>

                  {mode === "new" && conversationIntake}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void prepare();
                    }}
                  >
                    <section className="form-card story-card">
                      <div className="card-heading">
                        <span className="section-number">01</span>
                        <div>
                          <h2>
                            {mode === "new"
                              ? "What’s the problem?"
                              : "Bring your existing claim"}
                          </h2>
                          <p>
                            {mode === "new"
                              ? "Start wherever feels natural, in your own language."
                              : "Import a document or paste your claim. We’ll separate the details."}
                          </p>
                        </div>
                        <MessageSquareText
                          className="card-heading-icon"
                          size={21}
                          strokeWidth={1.4}
                        />
                      </div>
                      {mode === "existing" && (
                        <>
                          <button
                            className="import-button"
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => claimInput.current?.click()}
                          >
                            <Upload size={17} />
                            Import a claim document{" "}
                            <span>PDF, DOCX or TXT</span>
                          </button>
                          <input
                            ref={claimInput}
                            type="file"
                            accept=".pdf,.docx,.txt"
                            hidden
                            aria-label="Import claim document"
                            onChange={(event) =>
                              void addFiles(event.target.files, true)
                            }
                          />
                        </>
                      )}
                      <label className="sr-only" htmlFor="problem">
                        {mode === "new"
                          ? "What’s the problem?"
                          : "Existing claim text"}
                      </label>
                      <textarea
                        id="problem"
                        className="story-textarea"
                        placeholder={
                          mode === "new"
                            ? "For example, I paid a contractor to renovate my kitchen, but the work was left unfinished. I’ve tried contacting them…"
                            : "Paste your claim, case summary, or relevant correspondence here…"
                        }
                        value={problem}
                        onChange={(event) => {
                          setProblem(event.target.value);
                          invalidate(true);
                        }}
                        maxLength={30000}
                        disabled={Boolean(busy)}
                      />
                      <div className="input-footnote">
                        <span>
                          Helpful details: who, what, when, and what you’ve
                          tried.
                        </span>
                        <span>{problem.length.toLocaleString()} / 30,000</span>
                      </div>
                      <div className="example-line">
                        <Sparkles size={13} />
                        <span>Try a fictional example:</span>
                        <div className="example-options">
                          {SAMPLE_CLAIMS.map((sample) => (
                            <button
                              key={sample.id}
                              type="button"
                              className="text-button"
                              disabled={Boolean(busy) || Boolean(problem)}
                              onClick={() => {
                                setProblem(sample.problem);
                                setOutcome(sample.outcome);
                                invalidate(true);
                                setNotice(
                                  `${sample.label} example loaded. Replace these fictional details with your own before preparing a claim.`,
                                );
                              }}
                            >
                              {sample.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>

                    <section className="form-card">
                      <div className="card-heading">
                        <span className="section-number">02</span>
                        <div>
                          <h2>
                            Attach your evidence{" "}
                            <span className="optional">Optional for now</span>
                          </h2>
                          <p>The documents that help tell your story.</p>
                        </div>
                        <FileText
                          className="card-heading-icon"
                          size={21}
                          strokeWidth={1.4}
                        />
                      </div>
                      <div
                        className={`dropzone ${dragging ? "dragging" : ""}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={handleDrop}
                      >
                        <span className="upload-icon">
                          <Upload size={22} strokeWidth={1.4} />
                        </span>
                        <p>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => evidenceInput.current?.click()}
                          >
                            Click to upload
                          </button>{" "}
                          or drag and drop
                        </p>
                        <span>
                          Receipts, agreements, photos, messages — whatever you
                          have.
                        </span>
                        <small>
                          PDF, DOCX, TXT, JPG, PNG, WEBP · 10 MB per file · 10
                          files / 25 MB total
                        </small>
                        <input
                          ref={evidenceInput}
                          type="file"
                          accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp"
                          multiple
                          hidden
                          aria-label="Attach evidence files"
                          onChange={(event) =>
                            void addFiles(event.target.files)
                          }
                        />
                      </div>
                      {evidence.length > 0 && (
                        <div className="evidence-list">
                          {evidence.map((item, index) => (
                            <div className="evidence-item" key={item.id}>
                              <div className="evidence-title">
                                <FileText size={17} />
                                <strong>
                                  E{index + 1} · {item.name}
                                </strong>
                                <small>
                                  {(item.size / 1024).toFixed(0)} KB
                                </small>
                                <button
                                  type="button"
                                  className="icon-button"
                                  disabled={Boolean(busy)}
                                  aria-label={`Remove ${item.name}`}
                                  onClick={() => {
                                    setEvidence((current) =>
                                      current.filter(
                                        (file) => file.id !== item.id,
                                      ),
                                    );
                                    originals.current.delete(item.id);
                                    invalidate();
                                  }}
                                >
                                  <X size={15} />
                                </button>
                              </div>
                              <span
                                className={`extraction-status ${item.status !== "extracted" ? "needs-note" : ""}`}
                              >
                                {item.status === "extracted"
                                  ? "Text extracted · review against the original"
                                  : item.status === "description-needed"
                                    ? "Image attached · add a description; image content is not read"
                                    : "Text unreadable · add a description or transcript"}
                              </span>
                              <label
                                className="sr-only"
                                htmlFor={`note-${item.id}`}
                              >
                                What {item.name} shows
                              </label>
                              <input
                                id={`note-${item.id}`}
                                value={item.note}
                                maxLength={2000}
                                disabled={Boolean(busy)}
                                placeholder="What does this show? Connect it to a date, event or amount."
                                onChange={(event) => {
                                  setEvidence((current) =>
                                    current.map((file) =>
                                      file.id === item.id
                                        ? { ...file, note: event.target.value }
                                        : file,
                                    ),
                                  );
                                  invalidate();
                                }}
                              />
                              {item.text && (
                                <details>
                                  <summary>
                                    Review extracted text{" "}
                                    <ChevronDown size={12} />
                                  </summary>
                                  <pre>{item.text}</pre>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="quiet-note">
                        <LockKeyhole size={12} />
                        Documents are read in memory. Keep your originals for
                        filing.
                      </p>
                    </section>

                    <section className="form-card">
                      <div className="card-heading">
                        <span className="section-number">03</span>
                        <div>
                          <h2>What outcome would help?</h2>
                          <p>
                            Tell us what putting things right would look like.
                          </p>
                        </div>
                        <Scale
                          className="card-heading-icon"
                          size={21}
                          strokeWidth={1.4}
                        />
                      </div>
                      <label className="sr-only" htmlFor="outcome">
                        What outcome would help?
                      </label>
                      <textarea
                        id="outcome"
                        className="outcome-textarea"
                        placeholder="For example, a refund of S$2,400, the work completed, or a replacement for the faulty item…"
                        value={outcome}
                        maxLength={5000}
                        disabled={Boolean(busy)}
                        onChange={(event) => {
                          setOutcome(event.target.value);
                          if (draft) updateDraft("outcome", event.target.value);
                          invalidate(true);
                        }}
                      />
                      <div className="suggestion-chips">
                        {[
                          "A refund or payment",
                          "Repair or replacement",
                          "An agreed settlement",
                        ].map((item) => (
                          <button
                            type="button"
                            key={item}
                            disabled={Boolean(busy)}
                            onClick={() => {
                              setOutcome((current) =>
                                current ? `${current}\n${item}.` : `${item}. `,
                              );
                              invalidate(true);
                            }}
                          >
                            <Plus size={11} />
                            {item}
                          </button>
                        ))}
                      </div>
                    </section>
                    <div className="consent-box">
                      <label>
                        <input
                          type="checkbox"
                          checked={consent}
                          disabled={!researchConfigured || Boolean(busy)}
                          onChange={(event) => setConsent(event.target.checked)}
                        />
                        <span>
                          Use AI to organise my claim and research official SCT
                          guidance.
                          <small>
                            {researchConfigured
                              ? "Your account, extracted document text and evidence descriptions will be sent to the configured AI provider (OpenRouter by default) for organisation and research drafting, and generic queries go to Exa search. Remove sensitive information you don’t want to share. Original files are sent to neither."
                              : "Live research is not configured. You can still organise your information and read the official reference guidance."}
                          </small>
                        </span>
                      </label>
                    </div>
                    <div className="form-actions">
                      <span>
                        <ShieldCheck size={15} />A draft to review. Always your
                        decision.
                      </span>
                      <button
                        className="button primary"
                        type="submit"
                        disabled={Boolean(busy)}
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <>
                            Organise my claim <ArrowRight size={17} />
                          </>
                        )}
                      </button>
                    </div>
                    {error && (
                      <button
                        className="text-button basic-fallback"
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void prepare(true)}
                      >
                        Continue with basic organisation{" "}
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </form>
                  {mode === "existing" && conversationIntake}
                </>
              )}

              {step === 1 && draft && (
                <>
                  <div className="section-banner">
                    <Sparkles size={17} />
                    <span>
                      {draftMode === "ai"
                        ? "AI-organised draft · check every detail against your originals"
                        : "Basic organisation · your account is preserved; complete the fields below"}
                    </span>
                  </div>
                  {uncertainDates(problem).length > 0 && (
                    <section className="form-card conversation">
                      <h2>Dates still to confirm</h2>
                      {uncertainDates(problem).map((date, i) => (
                        <p key={i}>
                          Original: {date.raw}
                          <br />
                          Exact date: unknown · {date.certainty}
                        </p>
                      ))}
                      <p>
                        Do not replace an approximate date with an invented day.
                        Enter an exact cause-of-action date only after checking
                        the event and your records.
                      </p>
                    </section>
                  )}
                  <section className="form-card">
                    <div className="card-heading">
                      <span className="section-number">01</span>
                      <div>
                        <h2>The people involved</h2>
                        <p>
                          Use legal names. Add contact and address details when
                          ready.
                        </p>
                      </div>
                    </div>
                    <div className="field-grid">
                      <Field label="Your details (claimant)">
                        <textarea
                          value={draft.claimant}
                          maxLength={2000}
                          placeholder="Name, contact details and address"
                          onChange={(e) =>
                            updateDraft("claimant", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="The other party (respondent)">
                        <textarea
                          value={draft.respondent}
                          maxLength={2000}
                          placeholder="Legal name and address for service"
                          onChange={(e) =>
                            updateDraft("respondent", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="You are claiming as">
                        <select
                          value={draft.claimantType}
                          onChange={(e) =>
                            updateDraft("claimantType", e.target.value)
                          }
                        >
                          <option value="individual">An individual</option>
                          <option value="entity">
                            A business or other entity
                          </option>
                        </select>
                      </Field>
                      <Field label="Can the respondent be served in Singapore?">
                        <select
                          value={draft.respondentInSingapore}
                          onChange={(e) =>
                            updateDraft("respondentInSingapore", e.target.value)
                          }
                        >
                          <option value="unknown">I need to confirm</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </Field>
                    </div>
                  </section>
                  <section className="form-card">
                    <div className="card-heading">
                      <span className="section-number">02</span>
                      <div>
                        <h2>The claim details</h2>
                        <p>
                          Unknown information stays blank until you confirm it.
                        </p>
                      </div>
                    </div>
                    <div className="field-grid">
                      <Field label="Type of claim">
                        <select
                          value={draft.claimType}
                          onChange={(e) =>
                            updateDraft("claimType", e.target.value)
                          }
                        >
                          {claimTypes.map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        label="Total claim value (S$)"
                        hint="Include the value of non-monetary relief."
                      >
                        <input
                          inputMode="decimal"
                          value={draft.amount}
                          maxLength={40}
                          placeholder="e.g. 2400"
                          onChange={(e) =>
                            updateDraft("amount", e.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="Cause-of-action date"
                        hint="When the event creating the claim happened."
                      >
                        <input
                          type="date"
                          value={draft.incidentDate}
                          onChange={(e) =>
                            updateDraft("incidentDate", e.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="Existing case reference"
                        hint="If already filed. Otherwise leave blank."
                      >
                        <input
                          value={draft.caseNumber}
                          maxLength={100}
                          placeholder="Your CJTS case reference"
                          onChange={(e) =>
                            updateDraft("caseNumber", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={draft.consentToHigherLimit}
                        onChange={(e) =>
                          updateDraft("consentToHigherLimit", e.target.checked)
                        }
                      />
                      <span>
                        Both parties have signed a Memorandum of Consent for the
                        S$30,000 limit.
                      </span>
                    </label>
                    <Field label="Summary of what happened">
                      <textarea
                        className="long-textarea"
                        value={draft.summary}
                        maxLength={30000}
                        onChange={(e) => updateDraft("summary", e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Timeline"
                      hint="One event per line. Link events to evidence references such as E1."
                    >
                      <textarea
                        value={draft.timeline}
                        maxLength={12000}
                        placeholder="Date — event — supporting evidence"
                        onChange={(e) =>
                          updateDraft("timeline", e.target.value)
                        }
                      />
                    </Field>
                    <details className="original-account">
                      <summary>
                        Compare with your original account{" "}
                        <ChevronDown size={14} />
                      </summary>
                      <pre>{problem}</pre>
                    </details>
                  </section>
                  <section className="form-card">
                    <div className="card-heading">
                      <span className="section-number">03</span>
                      <div>
                        <h2>The outcome & the other side</h2>
                        <p>
                          A complete account makes room for what’s disputed.
                        </p>
                      </div>
                    </div>
                    <Field label="What you are asking for">
                      <textarea
                        value={draft.outcome}
                        maxLength={5000}
                        onChange={(e) => updateDraft("outcome", e.target.value)}
                      />
                    </Field>
                    <Field
                      label="What has the other party said?"
                      hint="Include any disagreement, explanation, or settlement offer. If you don’t know, say so."
                    >
                      <textarea
                        value={draft.opposingView}
                        maxLength={5000}
                        placeholder="They may see things differently. Record their actual response here."
                        onChange={(e) =>
                          updateDraft("opposingView", e.target.value)
                        }
                      />
                    </Field>
                  </section>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => navigate(3)}
                  >
                    Challenge my account & approve fields
                  </button>
                  {researchConfigured && !consent && (
                    <label className="check-label consent-box">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        Allow AI processing of this draft, extracted document text
                        and evidence descriptions for official-source research
                        (Exa search plus AI drafting).
                      </span>
                    </label>
                  )}
                  <div className="form-actions">
                    <button
                      className="button secondary"
                      disabled={Boolean(busy)}
                      onClick={() => navigate(0)}
                    >
                      <ArrowLeft size={15} />
                      Your story
                    </button>
                    <button
                      className="button primary"
                      disabled={Boolean(busy)}
                      onClick={() => void runResearch()}
                    >
                      {busy ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <>
                          {" "}
                          {researchConfigured && consent
                            ? "Research my claim"
                            : "Review official guidance"}
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}

              {step === 2 && draft && (
                <>
                  <div className="section-banner">
                    <BookOpen size={17} />
                    <span>
                      {research?.mode === "live"
                        ? "Live AI research · official Judiciary sources"
                        : research?.mode === "partial"
                          ? "Some searches were unavailable · reference guidance shown where needed"
                          : "Reference guidance · no live research has been performed"}
                    </span>
                  </div>
                  {(research ?? referenceResearch()).sections.map((section) => (
                    <ResearchCard key={section.id} section={section} />
                  ))}
                  <section className="form-card orders-card">
                    <div className="card-heading">
                      <Scale size={21} />
                      <div>
                        <h2>Understand the possible orders</h2>
                        <p>Remedies and procedural outcomes are different.</p>
                      </div>
                    </div>
                    <div className="order-grid">
                      {orderTypes.map((order, index) => (
                        <div key={order.name}>
                          <span className="order-index">0{index + 1}</span>
                          <h3>{order.name}</h3>
                          <p>{order.description}</p>
                        </div>
                      ))}
                    </div>
                    <SourceLink href={sources.outcomes.url}>
                      Read the conditions for each order
                    </SourceLink>
                  </section>
                  <div className="form-actions">
                    <button
                      className="button secondary"
                      disabled={Boolean(busy)}
                      onClick={() => navigate(1)}
                    >
                      <ArrowLeft size={15} />
                      Edit details
                    </button>
                    <button
                      className="button primary"
                      disabled={Boolean(busy)}
                      onClick={() => navigate(3)}
                    >
                      Prepare my filing pack <ArrowRight size={16} />
                    </button>
                  </div>
                  {researchConfigured && consent && (
                    <button
                      className="text-button retry-button"
                      disabled={Boolean(busy)}
                      onClick={() => void runResearch()}
                    >
                      <Search size={14} />
                      Refresh research for all sections
                    </button>
                  )}
                </>
              )}

              {step === 3 && draft && (
                <>
                  <ClaimReview
                    draft={draft}
                    evidence={evidence}
                    original={[problem, ...statements.map((s) => s.text)].join(
                      "\n",
                    )}
                    assertions={assertions}
                    onAssertions={(items) => {
                      setAssertions(items);
                      resetApprovals();
                      setReviewed(false);
                    }}
                    reviews={reviews}
                    onReview={approveField}
                    sctOptions={sctOptions}
                    onSctOptions={setSctOptions}
                    onEdit={() => navigate(1)}
                    onExport={exportApproved}
                  />
                  <div className="section-banner">
                    <ClipboardCheck size={17} />
                    <span>
                      Preparation draft · nothing has been submitted to the
                      court
                    </span>
                  </div>
                  <section className="form-card">
                    <div className="card-heading">
                      <span className="section-number">01</span>
                      <div>
                        <h2>Your information, ready to review</h2>
                        <p>
                          Copy each section into the corresponding CJTS fields.
                        </p>
                      </div>
                    </div>
                    {[
                      ["Claimant particulars", draft.claimant],
                      ["Respondent particulars", draft.respondent],
                      ["Summary of claim", draft.summary],
                      ["Chronology", draft.timeline],
                      ["Requested outcome", draft.outcome],
                    ].map(([title, value]) => (
                      <div className="pack-field" key={title}>
                        <div>
                          <h3>{title}</h3>
                          <button
                            className="text-button"
                            disabled={!value}
                            onClick={() => void copy(value, title)}
                          >
                            {copied === title ? (
                              <CheckCheck size={14} />
                            ) : (
                              <Copy size={14} />
                            )}
                            {copied === title ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <p className={!value ? "missing-text" : ""}>
                          {value ||
                            "Not provided — return to the review step to complete."}
                        </p>
                      </div>
                    ))}
                  </section>
                  <section className="form-card">
                    <div className="card-heading">
                      <span className="section-number">02</span>
                      <div>
                        <h2>Your evidence index</h2>
                        <p>
                          Keep original records and prepare PDFs for the portal.
                        </p>
                      </div>
                    </div>
                    {evidence.length ? (
                      evidence.map((item, index) => (
                        <div className="pack-evidence" key={item.id}>
                          <span className="evidence-ref">E{index + 1}</span>
                          <div>
                            <strong>{item.name}</strong>
                            <p>
                              {item.note ||
                                "Add a description in the story step."}
                            </p>
                            <small>
                              {item.status === "extracted"
                                ? "Text extracted; original not verified"
                                : "Content not read; verify manually"}
                            </small>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="empty-note">
                        No evidence attached. You can return to your story to
                        add documents.
                      </p>
                    )}
                    <SourceLink href={sources.filing.url}>
                      Check document requirements
                    </SourceLink>
                  </section>
                  <section className="form-card">
                    <div className="card-heading">
                      <span className="section-number">03</span>
                      <div>
                        <h2>Before you open CJTS</h2>
                        <p>
                          Use the court’s assessment and check the final
                          requirements.
                        </p>
                      </div>
                    </div>
                    <Field
                      label="Pre-filing assessment ID"
                      hint="Enter the ID supplied by CJTS, if you have completed the assessment."
                    >
                      <input
                        value={draft.assessmentId}
                        maxLength={100}
                        placeholder="Enter your assessment ID"
                        onChange={(e) =>
                          updateDraft("assessmentId", e.target.value)
                        }
                      />
                    </Field>
                    {missingItems.length > 0 && (
                      <div className="missing-box">
                        <strong>
                          {missingItems.length} items to complete or verify
                        </strong>
                        <ul>
                          {missingItems.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <label className="check-label final-check">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      <span>
                        I have reviewed the draft against my records and
                        understand I am responsible for the information I
                        submit.
                      </span>
                    </label>
                    <div className="export-actions">
                      <button
                        className="button secondary"
                        onClick={downloadPack}
                      >
                        <ArrowDownToLine size={16} />
                        Download draft
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => window.print()}
                      >
                        <FileText size={16} />
                        Print / save PDF
                      </button>
                    </div>
                    <a
                      className={`button primary portal-button ${!reviewed ? "disabled-link" : ""}`}
                      href={reviewed ? sources.portal.url : undefined}
                      aria-disabled={!reviewed}
                      tabIndex={reviewed ? 0 : -1}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {draft.caseNumber
                        ? "Open my case in CJTS"
                        : "Continue to the CJTS portal"}
                      <ArrowUpRight size={17} />
                    </a>
                    <p className="quiet-note portal-note">
                      You’ll sign in and submit on the official portal.{" "}
                      {draft.caseNumber
                        ? "Use your existing case reference; do not create a duplicate claim."
                        : "This app does not submit or pay on your behalf."}
                    </p>
                  </section>
                  {problem.trim() === SAMPLE_CLAIMS[0].problem &&
                    outcome.trim() === SAMPLE_CLAIMS[0].outcome &&
                    statements.length === 0 &&
                    draft.claimant === "Alex Tan" &&
                    draft.respondent === "Music Elements" &&
                    draft.amount === "800" &&
                    draft.incidentDate === "2026-09-04" &&
                    draft.claimType === "Sale of goods" && (
                      <CourtCheatsheet draft={draft} evidence={evidence} onDownload={saveFile} />
                    )}
                  <div className="form-actions">
                    <button
                      className="button secondary"
                      onClick={() => navigate(2)}
                    >
                      <ArrowLeft size={15} />
                      Back to guidance
                    </button>
                    <span className="end-note">
                      One step closer to clarity.
                    </span>
                  </div>
                </>
              )}
            </fieldset>

            <aside className="context-column">
              {step === 0 ? (
                <>
                  <section className="context-card intro-context">
                    <div className="context-icon">
                      <Landmark size={23} strokeWidth={1.4} />
                    </div>
                    <h2>A good place to start.</h2>
                    <p>
                      This workspace helps you prepare for Singapore’s Small
                      Claims Tribunals, one step at a time.
                    </p>
                    <div className="context-divider" />
                    <div className="fact-row">
                      <span>Standard claim limit</span>
                      <strong>S$20,000</strong>
                    </div>
                    <div className="fact-row">
                      <span>With both parties’ consent</span>
                      <strong>S$30,000</strong>
                    </div>
                    <div className="fact-row">
                      <span>Usual filing window</span>
                      <strong>2 years</strong>
                    </div>
                    <SourceLink href={sources.eligibility.url}>
                      Check eligibility and exceptions
                    </SourceLink>
                  </section>
                  <section className="next-context">
                    <span className="eyebrow">WHAT WE’LL DO TOGETHER</span>
                    <div className="mini-step">
                      <span>1</span>
                      <div>
                        <strong>Make a clear account</strong>
                        <p>Bring your facts and evidence into one place.</p>
                      </div>
                    </div>
                    <div className="mini-step">
                      <span>2</span>
                      <div>
                        <strong>Find the relevant guidance</strong>
                        <p>
                          Check official SCT sources and what might be missing.
                        </p>
                      </div>
                    </div>
                    <div className="mini-step">
                      <span>3</span>
                      <div>
                        <strong>Prepare for the portal</strong>
                        <p>Take a reviewed draft to CJTS when you’re ready.</p>
                      </div>
                    </div>
                  </section>
                  <div className="progress-note">
                    <div>
                      <span>Your starting point</span>
                      <strong>{completedCount} of 3</strong>
                    </div>
                    <div className="progress-track">
                      <span
                        style={
                          {
                            "--progress": progressPercent,
                            width: progressPercent,
                          } as CSSProperties
                        }
                      />
                    </div>
                    <small>Evidence can always be added later.</small>
                  </div>
                </>
              ) : (
                draft && (
                  <>
                    <section className="context-card">
                      <div className="context-icon">
                        <ShieldCheck size={23} strokeWidth={1.4} />
                      </div>
                      <h2>A preliminary check.</h2>
                      <p>
                        A starting point, not a decision on eligibility or the
                        merits of your claim.
                      </p>
                      <div className="eligibility-list">
                        {eligibilityChecks(draft).map((check) => (
                          <div
                            className={`eligibility-item ${check.level}`}
                            key={check.title}
                          >
                            <span>
                              {check.level === "check" ? (
                                <Check size={14} />
                              ) : (
                                <CircleHelp size={14} />
                              )}
                            </span>
                            <div>
                              <strong>{check.title}</strong>
                              <p>{check.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <SourceLink href={sources.eligibility.url}>
                        Full eligibility conditions
                      </SourceLink>
                    </section>
                    {step === 3 ? (
                      <section className="context-card fee-card">
                        <span className="eyebrow">ESTIMATED FILING FEE</span>
                        <div className="fee">
                          {filingFee(draft) === null
                            ? "To confirm"
                            : `S$${filingFee(draft)!.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </div>
                        <p>
                          Based on the stated value and claimant type. Verify in
                          CJTS.
                        </p>
                        <SourceLink href={sources.filing.url}>
                          Fee schedule
                        </SourceLink>
                      </section>
                    ) : (
                      <section className="next-context">
                        <span className="eyebrow">A BALANCED ACCOUNT</span>
                        <div className="quote-mark">“</div>
                        <p className="reflection">
                          What might the other party disagree with — and what do
                          your records actually show?
                        </p>
                        <span className="reflection-caption">
                          A useful question at every step.
                        </span>
                      </section>
                    )}
                    <section className="context-card portal-process">
                      <h3>What happens after filing?</h3>
                      <ol>
                        <li>
                          Serve the claim and consultation notice within 7 days.
                        </li>
                        <li>
                          File the Declaration of Service before the first
                          consultation.
                        </li>
                        <li>
                          Explore settlement, then attend scheduled sessions.
                        </li>
                      </ol>
                      <SourceLink href={sources.filing.url}>
                        Follow the filing and service guide
                      </SourceLink>
                    </section>
                  </>
                )
              )}
              <div className="responsible-note">
                <ShieldCheck size={17} />
                <p>
                  <strong>Guidance, with care.</strong>This is an independent
                  preparation tool, not legal advice or a court service. Always
                  verify your information.
                  <SourceLink href={sources.ai.url}>
                    Using AI responsibly
                  </SourceLink>
                </p>
              </div>
            </aside>
          </div>
          <footer className="page-footer">
            <span>Made for a clearer way forward.</span>
            <span>
              Independent tool <span>·</span> Official sources <span>·</span>{" "}
              Your judgement
            </span>
          </footer>
        </main>
      </div>
      {sourceModal && (
        <dialog
          ref={dialogRef}
          className="info-modal"
          aria-label="About Clearclaim"
          onCancel={() => setSourceModal(false)}
        >
          <button
            className="modal-close icon-button"
            aria-label="Close about panel"
            autoFocus
            onClick={() => setSourceModal(false)}
          >
            <X size={20} />
          </button>
          <span className="context-icon">
            <Scale size={25} />
          </span>
          <h2>A clearer way to prepare.</h2>
          <p>
            Clearclaim helps you organise a new dispute or an existing claim,
            compare your account with official SCT guidance, and prepare
            information for CJTS.
          </p>
          <p>
            Nothing is filed here. The court decides jurisdiction and the
            outcome. If you already have a case, use that case in CJTS.
          </p>
          <h3>Your information</h3>
          <p>
            Your workspace is held in this tab’s memory and clears on refresh.
            PDF and DOCX files are sent to this app’s server for text extraction
            in memory. Photos need your descriptions. If you enable research,
            case text and evidence descriptions are sent to the configured AI
            provider (OpenRouter by default) for organisation and research
            drafting, while generic search queries go
            through Exa search. Download a
            draft before leaving.
          </p>
          <h3>Our reference sources</h3>
          <div className="modal-sources">
            {Object.values(sources).map((source) => (
              <SourceLink key={source.url} href={source.url}>
                {source.title}
              </SourceLink>
            ))}
          </div>
          <p className="small-muted">
            Reference guidance reviewed {SOURCE_REVIEW_DATE}. Live research is
            labelled separately.
          </p>
        </dialog>
      )}
    </div>
  );
}
