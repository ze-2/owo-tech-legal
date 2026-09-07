"use client";

import { ArrowDownToLine, Scale } from "lucide-react";

const intro = "Fictional demo · Alex Tan / Music Elements. Neutral reading brief based only on the claimant’s example account. No respondent account or supporting documents have been supplied. No findings have been made.";

const sections = [
  {
    title: "Case at a glance",
    paragraphs: [
      "Claimant: Alex Tan · Respondent named in the account: Music Elements.",
      "Dispute: sale of goods — a trombone allegedly not delivered. Amount sought: S$800, described as the deposit paid.",
      "Requested outcome: return of the S$800 deposit. Exact respondent legal identity and case reference are not recorded.",
    ],
  },
  {
    title: "The parties’ positions",
    paragraphs: [
      "Claimant’s account: Alex says he paid Music Elements an S$800 deposit for a trombone, with delivery agreed for 4 September 2026. He says the instrument was not delivered, the deposit has not been returned, and his calls have gone unanswered.",
      "Respondent’s position: not supplied. The record does not establish whether Music Elements accepts or disputes the payment, delivery date, non-delivery or refund request.",
      "Agreed facts: none recorded as agreed by both parties. The account above remains the claimant’s account.",
    ],
  },
  {
    title: "Chronology from the claimant’s account",
    paragraphs: [
      "Date not recorded — alleged payment of an S$800 deposit for a trombone.",
      "4 September 2026 — alleged agreed delivery date; Alex reports no delivery.",
      "Dates not recorded — calls allegedly unanswered and deposit allegedly still outstanding. Dates and wording of any refund demand are not supplied.",
    ],
  },
  {
    title: "Questions to clarify with the parties",
    paragraphs: [
      "Agreement and identity — who entered into the sale agreement, and is Music Elements the correct legal party? What was ordered and on what terms?",
      "Payment — was S$800 paid, when, and to whom? Was it a deposit towards a larger price?",
      "Delivery — was 4 September 2026 agreed? Was delivery attempted, postponed or changed by agreement? What does each party say happened?",
      "Refund — what do the deposit and cancellation terms say? Was a refund requested or agreed, and has any money since been returned?",
      "Amount sought — is the full S$800 still outstanding? What explanation does each party give for whether it should be returned?",
    ],
  },
  {
    title: "Evidence available and gaps",
    paragraphs: [
      "Available: the fictional claimant’s written account only. No supporting files or respondent documents are attached.",
      "Payment receipt or bank record — would help identify the amount, payment date and recipient.",
      "Order confirmation, agreement and messages — would help establish the item, contracting party, delivery date and deposit terms.",
      "Delivery records and correspondence — would help assess delivery attempts, changes to the agreement, refund requests and replies.",
      "Business particulars — would help establish the respondent’s exact legal name, structure, address and status.",
    ],
  },
];

const checks = [
  ["Claimant acting as an individual", "Individual is selected in the example draft; confirmation is still needed."],
  ["Claimant’s bankruptcy status", "Not recorded."],
  ["Correct contracting respondent", "Music Elements is named by the claimant; exact legal identity is unverified."],
  ["Respondent an individual or an entity", "Not recorded. The trading name alone does not establish this."],
  ["Liquidation or winding-up status; any High Court permission", "Not recorded."],
  ["ACRA record within the last month showing address and status", "Not supplied or identified in the example."],
  ["Entity shown as ‘Live’ in that record", "Not established; no ACRA record supplied."],
  ["Mediation or arbitration clause", "Not recorded; agreement terms not supplied."],
  ["Agreement by all parties to dispense with any such clause and use SCT", "Not recorded; relevance depends on the agreement terms."],
];

function download() {
  const content = [
    "JUDGE’S CASE CHEATSHEET", intro,
    ...sections.map(({ title, paragraphs }) => `${title}\n${paragraphs.join("\n\n")}`),
    `Pre-filing information on record\n${checks.map(([question, answer]) => `${question}\n${answer}`).join("\n\n")}`,
  ].join("\n\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "alex-tan-judge-cheatsheet.txt";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function JudgeCheatsheetDemoPage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <section className="form-card court-cheatsheet" aria-labelledby="judge-cheatsheet-title">
        <div className="card-heading">
          <span className="section-number"><Scale size={18} /></span>
          <div>
            <h1 id="judge-cheatsheet-title" style={{ fontSize: "1.5rem", margin: 0 }}>Judge’s case cheatsheet</h1>
            <p>Alex Tan / Music Elements · S$800 deposit dispute</p>
          </div>
        </div>
        <p className="cheatsheet-demo">{intro}</p>
        {sections.map(({ title, paragraphs }) => (
          <div className="cheatsheet-section" key={title}>
            <h2 style={{ fontSize: "1.1rem" }}>{title}</h2>
            {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        ))}
        <div className="cheatsheet-section">
          <h2 style={{ fontSize: "1.1rem" }}>Pre-filing information on record</h2>
          <p>Recorded answers and outstanding information; eligibility has not been determined.</p>
          <dl className="cheatsheet-answers">
            {checks.map(([question, answer]) => (
              <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>
            ))}
          </dl>
        </div>
        <button type="button" className="button secondary" onClick={download}>
          <ArrowDownToLine size={16} /> Download cheatsheet
        </button>
      </section>
    </main>
  );
}
