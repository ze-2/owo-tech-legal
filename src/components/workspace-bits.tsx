"use client";

import { useId, cloneElement, isValidElement, type ReactNode, type ReactElement } from "react";
import { sectionFootnotes } from "@/lib/research-footnotes";
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
  const id = useId();
  const control = isValidElement(children) ? children as ReactElement<{ id?: string }> : null;
  const fieldId = control?.props.id || id;
  return (
    <div className="field">
      <label className="field-label" htmlFor={fieldId}>{label}</label>
      {hint && <span className="field-hint">{hint}</span>}
      {control ? cloneElement(control, { id: fieldId }) : children}
    </div>
  );
}

export function ResearchCard({ section }: { section: ResearchSection }) {
  const { notes, markers } = sectionFootnotes(section);
  const prefix = useId();
  const footnotes = (field: string) => markers[field].map(number => (
    <sup key={number} className="research-footnote-marker">
      <a href={`#${prefix}-source-${number}`} aria-label={`Source ${number} for ${field}`}>[{number}]</a>
    </sup>
  ));
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
      <p className="research-guidance">{section.guidance}{footnotes("guidance")}</p>
      <div className="research-detail">
        <span>Also consider</span>
        <p>{section.counterpoint}{footnotes("counterpoint")}</p>
      </div>
      <div className="research-detail">
        <span>Still to verify</span>
        <p>{section.missingInfo}{footnotes("missingInfo")}</p>
      </div>
      <ol className="research-footnotes" aria-label="Source footnotes">
        {notes.map((source, index) => (
          <li key={`${source.url}-${index}`} id={`${prefix}-source-${index + 1}`}>
            <SourceLink href={source.url}>{source.title}</SourceLink>
            {source.snippet && <><small>Retrieved source excerpt</small><blockquote>{source.snippet}</blockquote></>}
          </li>
        ))}
      </ol>
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
