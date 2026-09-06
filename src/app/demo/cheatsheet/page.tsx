"use client";

import { CourtCheatsheet } from "@/components/court-cheatsheet";
import { organiseLocally } from "@/lib/claim";
import { SAMPLE_CLAIMS } from "@/lib/workspace-draft";

const sample = SAMPLE_CLAIMS[0];
const draft = organiseLocally({
  mode: "new",
  problem: sample.problem,
  outcome: sample.outcome,
  evidence: [],
  consent: false,
});

function download(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CheatsheetDemoPage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <CourtCheatsheet draft={draft} evidence={[]} onDownload={download} />
    </main>
  );
}
