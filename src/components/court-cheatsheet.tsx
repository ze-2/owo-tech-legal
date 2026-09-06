import { ArrowDownToLine, FileText } from "lucide-react";
import type { Draft, Evidence } from "@/lib/claim";

export function CourtCheatsheet({ draft, evidence, onDownload }: {
  draft: Draft;
  evidence: Evidence[];
  onDownload: (content: string, filename: string, mime: string) => void;
}) {
  const answers = [
    ["Are you claiming as an individual?", draft.claimantType === "individual" ? "Yes — individual is selected in this draft. Confirm before filing." : "No — an entity is selected in this draft."],
    ["Are you a bankrupt?", "Not recorded — Alex needs to confirm."],
    ["Are you claiming against the party you made the agreement with?", "Alex says the agreement was with Music Elements. Check the exact legal name on the order or receipt."],
    ["Is the other party an individual?", "Not recorded — a business name alone does not establish its legal structure."],
    ["If it is a company, is it in liquidation or winding up?", "Not recorded — check the entity’s status. Any High Court permission is also not recorded."],
    ["Do you have an ACRA record from within the last month showing its address and status?", "Not recorded — no ACRA record is identified in the example."],
    ["Does that recent ACRA record show the entity as ‘Live’?", "Not recorded — check the actual record."],
    ["Does your agreement include a mediation or arbitration clause?", "Not recorded — check the order terms and any agreement."],
    ["If there is such a clause, have all parties agreed to set it aside and use SCT?", "Not recorded — any such agreement needs to be confirmed."],
  ];
  const sections = [
    {
      title: "My case in simple terms",
      paragraphs: [
        `${draft.claimant || "Alex Tan"} → ${draft.respondent || "Music Elements"} · Claim: S$${draft.amount || "800"}`,
        "I paid Music Elements an S$800 deposit for a trombone. It was supposed to arrive on 4 September 2026, but it did not. My deposit has not been returned and my calls have gone unanswered.",
        `What I am asking for: ${draft.outcome || "Return of my S$800 deposit."}`,
      ],
    },
    {
      title: "The dates and events I can explain",
      paragraphs: [
        "Payment date not recorded — S$800 deposit paid for the trombone.",
        "4 September 2026 — agreed delivery date; Alex says the trombone was not delivered.",
        "After the missed delivery — deposit still not returned; calls unanswered. Add the dates of calls and any written refund requests.",
      ],
    },
    {
      title: "Records to have beside me",
      paragraphs: [
        "Payment receipt or bank transfer showing the S$800 deposit and who received it.",
        "Order confirmation, messages or agreement showing the trombone ordered and promised delivery date.",
        "Messages asking about delivery or a refund, call logs, and any replies from the seller.",
        "Order terms and the seller’s exact legal name, address and business details.",
        evidence.length ? `Files currently attached (contents not verified): ${evidence.map((item) => item.name).join(", ")}.` : "No files attached yet. The records above are things to gather, not evidence already supplied.",
      ],
    },
    {
      title: "What I still need to be ready to explain",
      paragraphs: [
        "Why I am asking for S$800: that is the deposit I say I paid and have not received back.",
        "What the seller says: no explanation is recorded in the example. Bring any reply, revised delivery agreement or deposit terms, even if they do not support my account.",
        "What is missing: payment date, exact seller identity, supporting documents, and the unanswered checks below.",
      ],
    },
  ];
  const intro = "Fictional demo · Alex Tan / Music Elements. Personal preparation notes based on the example account, not a court form or a decision on eligibility. Check against your records before using.";
  const download = [
    "MY COURT CHEATSHEET", intro,
    ...sections.map((section) => `${section.title}\n${section.paragraphs.join("\n\n")}`),
    `Pre-filing answer record\n${answers.map(([question, answer]) => `${question}\n${answer}`).join("\n\n")}`,
  ].join("\n\n");

  return (
    <section className="form-card court-cheatsheet" aria-labelledby="court-cheatsheet-title">
      <div className="card-heading">
        <span className="section-number"><FileText size={18} /></span>
        <div>
          <h2 id="court-cheatsheet-title">Your court cheatsheet</h2>
          <p>A simple summary to keep beside you when explaining your case.</p>
        </div>
      </div>
      <p className="cheatsheet-demo">{intro}</p>
      {sections.map((section) => (
        <div className="cheatsheet-section" key={section.title}>
          <h3>{section.title}</h3>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      ))}
      <div className="cheatsheet-section">
        <h3>Pre-filing answer record</h3>
        <p>Keep track of what you know and what you still need to check.</p>
        <dl className="cheatsheet-answers">
          {answers.map(([question, answer]) => (
            <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>
          ))}
        </dl>
      </div>
      <button type="button" className="button secondary" onClick={() => onDownload(download, "alex-tan-court-cheatsheet.txt", "text/plain;charset=utf-8")}>
        <ArrowDownToLine size={16} /> Download cheatsheet
      </button>
    </section>
  );
}
