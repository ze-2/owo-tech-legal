"use client";
import type { Statement } from "@/lib/review";
import type { Observation } from "@/lib/conversation";

/** Read-only review trail; the account field is the single typing/dictation surface. */
export function ConversationRecord({ statements, observations, prompt }: {
  statements: Statement[]; observations: Observation[]; prompt: string;
}) {
  return <div className="conversation">
      {prompt && (
        <p className="conversation-prompt" role="status">
          {prompt}
        </p>
      )}
      {statements.length > 0 && (
        <details open>
          <summary>Account snapshots ({statements.length})</summary>
          {statements.map((statement) => (
            <blockquote key={statement.id}>
              <small>
                {statement.language} · {statement.input} · original wording
                {statement.input === "voice"
                  ? " (reviewed transcript, no audio retained)"
                  : ""}
              </small>
              <p lang={statement.language}>{statement.text}</p>
            </blockquote>
          ))}
        </details>
      )}
      {observations.length > 0 && (
        <div>
          <h3>Extracted details to check</h3>
          {observations.map((observation, index) => (
            <div className="observation" key={`${observation.kind}-${index}`}>
              <small>
                {observation.kind} · {observation.certainty}
              </small>
              <p>Original: {observation.raw}</p>
              <p>
                Working interpretation:{" "}
                {observation.value ?? "Unknown — exact value unresolved"}
              </p>
            </div>
          ))}
        </div>
      )}
  </div>;
}
