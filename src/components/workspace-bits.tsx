"use client";

import type { ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  FileCheck2,
  ListChecks,
  MessageSquareText,
} from "lucide-react";
import type { ResearchSection } from "@/lib/claim";


export const WORKSPACE_STEPS = [
  {
    name: "Tell your story",
    caption: "Start with what happened",
    icon: MessageSquareText,
  },
  {
    name: "Organise your claim",
    caption: "Put the details in place",
    icon: ListChecks,
  },
  {
    name: "Review the guidance",
    caption: "Ground your next steps",
    icon: BookOpen,
  },
  {
    name: "Prepare to file",
    caption: "Your CJTS filing pack",
    icon: FileCheck2,
  },
];

export function SourceLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="source-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={13} />
    </a>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {hint && <span className="field-hint">{hint}</span>}
      {children}
    </label>
  );
}

export function ResearchCard({ section }: { section: ResearchSection }) {
  const guidanceSources = section.fieldSources.guidance ?? section.sources;
  return (
    <section className="form-card research-card">
      <div className="research-heading">
        <span className="research-icon">
          <BookOpen size={18} />
        </span>
        <h2>{section.title}</h2>
        <span className={`research-status ${section.status}`}>
          {section.status === "live" ? "SOURCE-BACKED" : "REFERENCE"}
        </span>
      </div>
      {section.error && (
        <p className="research-error">
          {section.error} Showing reference guidance.
        </p>
      )}
      <p className="research-guidance">{section.guidance}</p>
      <div className="research-detail">
        <span>Also consider</span>
        <p>{section.counterpoint}</p>
        {section.fieldSources.counterpoint?.map((source) => (
          <SourceLink key={source.url} href={source.url}>
            {source.title}
          </SourceLink>
        ))}
      </div>
      <div className="research-detail">
        <span>Still to verify</span>
        <p>{section.missingInfo}</p>
        {section.fieldSources.missingInfo?.map((source) => (
          <SourceLink key={source.url} href={source.url}>
            {source.title}
          </SourceLink>
        ))}
      </div>
      <div className="research-sources">
        {guidanceSources.map((source) => (
          <SourceLink key={source.url} href={source.url}>
            {source.title}
          </SourceLink>
        ))}
      </div>
      <details className="search-query">
        <summary>
          View research query <ChevronDown size={12} />
        </summary>
        <p>{section.query}</p>
        <small>
          {section.status === "live"
            ? "Searched official Judiciary sources; guidance drafted by the AI provider."
            : "Suggested query. This section has no completed live search."}
        </small>
      </details>
    </section>
  );
}
