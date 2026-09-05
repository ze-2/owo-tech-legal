"use client";
import type { Draft, Evidence } from "@/lib/claim";
import {
  assertionsFor,
  reviewIssues,
  type Assertion,
  type FilingField,
  type Reviews,
  type SctOption,
} from "@/lib/review";
import { filingFields, validField } from "../../cjts-prefiling/transfer.mjs";
import { sctGroups, sctOptionsForClaimType } from "../../cjts-prefiling/claim-type.mjs";

type ClaimReviewProps = {
  draft: Draft;
  evidence: Evidence[];
  original: string;
  assertions: Assertion[];
  onAssertions: (items: Assertion[]) => void;
  reviews: Reviews;
  onReview: (key: FilingField, approved: boolean) => void;
  sctOptions: SctOption[];
  onSctOptions: (items: SctOption[]) => void;
  onEdit: () => void;
  onExport: () => void;
};

export function ClaimReview({
  draft,
  evidence,
  original,
  assertions,
  onAssertions,
  reviews,
  onReview,
  sctOptions,
  onSctOptions,
  onEdit,
  onExport,
}: ClaimReviewProps) {
  const facts = assertionsFor(draft, assertions);
  const issues = reviewIssues(draft, evidence, facts, original);
  const fieldKeys = Object.keys(filingFields) as FilingField[];
  const approvedKeys = fieldKeys.filter(
    (key) =>
      reviews[key]?.review === "approved" && reviews[key]?.value === draft[key],
  );
  const availableSctOptions = sctOptionsForClaimType(draft.claimType);
  const availableIds = new Set(
    availableSctOptions.map((option) => `${option.groupId}:${option.label}`),
  );
  const selectedSctOptions = sctOptions.filter((option) =>
    availableIds.has(`${option.groupId}:${option.label}`),
  );

  function setSctOption(option: SctOption, checked: boolean) {
    const id = `${option.groupId}:${option.label}`;
    onSctOptions(
      checked
        ? [...selectedSctOptions, option]
        : selectedSctOptions.filter(
            (item) => `${item.groupId}:${item.label}` !== id,
          ),
    );
  }

  function setEvidenceLink(
    assertionId: string,
    kind: "supporting" | "contradictory",
    evidenceId: string,
    checked: boolean,
  ) {
    onAssertions(
      facts.map((assertion) => {
        if (assertion.id !== assertionId) return assertion;
        if (checked)
          return {
            ...assertion,
            [kind]: [...new Set([...assertion[kind], evidenceId])],
          };
        return {
          ...assertion,
          [kind]: assertion[kind].filter((id) => id !== evidenceId),
        };
      }),
    );
  }

  function setAssumption(assertionId: string, isAssumption: boolean) {
    onAssertions(
      facts.map((assertion) =>
        assertion.id === assertionId
          ? { ...assertion, assumption: isAssumption }
          : assertion,
      ),
    );
  }

  return (
    <>
      <section className="form-card claim-review">
        <h2>Challenge my account</h2>
        <p>
          These explainable checks do not determine truth or case strength.
          Automatic checks cover limited patterns; compare every assertion
          yourself. No issue found does not mean verified.
        </p>
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            evidence={evidence}
            onEdit={onEdit}
          />
        ))}
        <details>
          <summary>Link assertions to evidence ({facts.length})</summary>
          {facts.map((fact) => (
            <AssertionCard
              key={fact.id}
              assertion={fact}
              evidence={evidence}
              onAssumption={(checked) => setAssumption(fact.id, checked)}
              onLink={(kind, evidenceId, checked) =>
                setEvidenceLink(fact.id, kind, evidenceId, checked)
              }
            />
          ))}
        </details>
      </section>

      <section className="form-card claim-review">
        <h2>Review & approve filing fields</h2>
        <p>
          Approve each value you intend to transfer. AI organisation and working
          translations need your review. Unverified allegations must be
          accurately described as allegations. Missing or unapproved fields stay
          out of the extension package.
        </p>
        {fieldKeys.map((key) => {
          const meta = reviews[key];
          const checked =
            meta?.review === "approved" && meta.value === draft[key];
          const status = checked
            ? "approved"
            : meta?.review === "needs-attention"
              ? "needs attention"
              : "unreviewed";
          return (
            <div className="approval-field" key={key}>
              <h3>{filingFields[key]}</h3>
              <p className="review-status">
                Provenance: {meta?.provenance ?? "unknown"} · {status}
              </p>
              <pre>{draft[key] || "Unknown — not available for transfer"}</pre>
              <label className="check-label">
                <input
                  type="checkbox"
                  aria-label={`Approve ${filingFields[key]}`}
                  checked={checked}
                  disabled={!validField(key, draft[key])}
                  onChange={(event) => onReview(key, event.target.checked)}
                />
                I reviewed this exact value and approve its transfer
              </label>
            </div>
          );
        })}
        <p role="status">
          {approvedKeys.length} approved fields. Edits to your account or
          evidence require renewed approval.
        </p>
        <div className="approval-field">
          <h3>CJTS dispute subtype(s)</h3>
          <p className="review-status">
            Choose every exact subtype that you reviewed. The extension will
            select these choices when it opens the SCT assessment. CJTS
            questions and any description for “Others” remain for you to
            complete.
          </p>
          {sctGroups
            .filter((group) =>
              availableSctOptions.some((option) => option.groupId === group.id),
            )
            .map((group) => (
              <fieldset key={group.id}>
                <legend>{group.label}</legend>
                {availableSctOptions
                  .filter((option) => option.groupId === group.id)
                  .map((option) => {
                    const checked = selectedSctOptions.some(
                      (item) =>
                        item.groupId === option.groupId && item.label === option.label,
                    );
                    return (
                      <label className="check-label" key={option.label}>
                        <input
                          type="checkbox"
                          aria-label={`Approve CJTS subtype ${option.label}`}
                          checked={checked}
                          onChange={(event) =>
                            setSctOption(option, event.target.checked)
                          }
                        />
                        I reviewed {option.label} for CJTS transfer
                      </label>
                    );
                  })}
              </fieldset>
            ))}
          <p role="status">
            {selectedSctOptions.length} reviewed SCT subtype
            {selectedSctOptions.length === 1 ? "" : "s"} selected.
          </p>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={!approvedKeys.length || !selectedSctOptions.length}
          onClick={onExport}
        >
          Export approved filing JSON
        </button>
        <p>
          Import this private file in the Clearclaim Chrome extension. It
          contains only approved fields; keep it on a trusted device.{" "}
          <a href="/mock-cjts.html" target="_blank" rel="noreferrer">
            Open the mock CJTS form
          </a>{" "}
          for a demonstration.
        </p>
      </section>
    </>
  );
}

function IssueCard({
  issue,
  evidence,
  onEdit,
}: {
  issue: ReturnType<typeof reviewIssues>[number];
  evidence: Evidence[];
  onEdit: () => void;
}) {
  return (
    <article className="issue-card">
      <h3>{issue.title}</h3>
      {issue.statement && <blockquote>{issue.statement}</blockquote>}
      <p>{issue.detail}</p>
      {issue.evidenceIds.map((id) => {
        const record = evidence.find((item) => item.id === id);
        if (!record) return null;
        return (
          <details key={id} open>
            <summary>
              {record.name} · compare extracted text with original
            </summary>
            <pre>{record.text || record.note}</pre>
          </details>
        );
      })}
      <button className="text-button" type="button" onClick={onEdit}>
        Correct statement / add evidence
      </button>
      <p className="review-status">
        Kept as unverified until you correct it or link and check evidence.
        Approval does not establish its truth.
      </p>
    </article>
  );
}

function AssertionCard({
  assertion,
  evidence,
  onAssumption,
  onLink,
}: {
  assertion: Assertion;
  evidence: Evidence[];
  onAssumption: (checked: boolean) => void;
  onLink: (
    kind: "supporting" | "contradictory",
    evidenceId: string,
    checked: boolean,
  ) => void;
}) {
  const supportNote = assertion.supporting.length
    ? "Evidence linked by you — authenticity and meaning require review"
    : "No supporting evidence linked";
  return (
    <article className="assertion">
      <p>{assertion.text}</p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={assertion.assumption}
          onChange={(event) => onAssumption(event.target.checked)}
        />
        This is my assumption, not an established fact
      </label>
      {evidence.map((record) => (
        <div key={record.id}>
          <span>{record.name}</span>
          <label className="check-label">
            <input
              type="checkbox"
              checked={assertion.supporting.includes(record.id)}
              onChange={(event) =>
                onLink("supporting", record.id, event.target.checked)
              }
            />
            I checked this record; it supports this assertion
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={assertion.contradictory.includes(record.id)}
              onChange={(event) =>
                onLink("contradictory", record.id, event.target.checked)
              }
            />
            This record may contradict this assertion
          </label>
        </div>
      ))}
      <small>{supportNote}</small>
    </article>
  );
}
