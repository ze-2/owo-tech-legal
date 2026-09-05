import type { Draft } from "./claim";
import type { Reviews } from "./review";

// Explicit user edits in the workspace win over later AI proposals.

type EditableDraftKey = keyof Draft;

export function mergeConversationDraft(
  proposal: Draft,
  current: Draft | null,
  reviews: Reviews,
  editedFields: ReadonlySet<EditableDraftKey>,
): Draft {
  const merged = { ...proposal };
  if (!current) return merged;
  for (const key of Object.keys(reviews)) {
    if (editedFields.has(key as EditableDraftKey)) {
      (merged as unknown as Record<string, unknown>)[key] =
        current[key as EditableDraftKey];
    }
  }
  // Workspace-level toggles are never AI-proposed; always keep the local copy.
  merged.claimantType = current.claimantType;
  merged.respondentInSingapore = current.respondentInSingapore;
  merged.consentToHigherLimit = current.consentToHigherLimit;
  if (current.opposingView) merged.opposingView = current.opposingView;
  return merged;
}

export function mergePreparedDraft(
  proposal: Draft,
  current: Draft | null,
  reviews: Reviews,
  editedFields: ReadonlySet<EditableDraftKey>,
): Draft {
  const next = { ...proposal };
  if (!current) return next;
  for (const key of Object.keys(reviews)) {
    if (editedFields.has(key as EditableDraftKey)) {
      (next as unknown as Record<string, unknown>)[key] =
        current[key as EditableDraftKey];
    }
  }
  next.opposingView = current.opposingView || next.opposingView;
  next.claimantType = current.claimantType;
  next.respondentInSingapore = current.respondentInSingapore;
  next.consentToHigherLimit = current.consentToHigherLimit;
  return next;
}

export const SAMPLE_CLAIM = {
  problem:
    "Claimant: Alex Tan\nRespondent: Example Home Services Pte. Ltd.\nClaim type: Provision of services\nIncident date: 2026-06-15\nClaim amount: 2400\n\nI paid S$2,400 for the supply and installation of kitchen cabinets. Our written agreement required completion by 15 June 2026. The contractor installed the cabinets, but two doors do not close and a drawer is missing. I emailed photographs on 18 June and asked for the defects to be fixed. The contractor said the doors were within tolerance and offered to replace only the drawer. We have not agreed on a resolution.",
  outcome:
    "I would like the defective doors repaired and the missing drawer installed, or a refund of S$2,400 if the work cannot be put right.",
};
