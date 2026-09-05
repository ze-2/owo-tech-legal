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

export const SAMPLE_CLAIMS = [
  {
    id: "goods",
    label: "Sale of goods",
    problem:
      "Claimant: Alex Tan\nRespondent: Music Elements\nClaim type: Sale of goods\nIncident date: 2026-09-04\nClaim amount: 800\n\nI paid Music Elements an S$800 deposit for a trombone. We agreed that the trombone would be delivered on 4 September 2026, but it was not delivered. Music Elements has not returned my deposit and is not answering my calls.",
    outcome: "I want Music Elements to return my S$800 deposit.",
  },
  {
    id: "services",
    label: "Provision of services",
    problem:
      "Claimant: Mei Lim\nRespondent: CoolAir Repairs Pte. Ltd.\nClaim type: Provision of services\nIncident date: 2026-09-03\nClaim amount: 1600\n\nI paid CoolAir Repairs S$1,600 to repair my leaking air-conditioner. Our contract required the repair to be completed on 3 September 2026. The technician attended and said the repair was complete, but the air-conditioner continued leaking afterwards.",
    outcome:
      "I want the leak repaired properly at no extra charge, or a refund of the S$1,600 repair fee.",
  },
  {
    id: "property",
    label: "Property damage",
    problem:
      "Claimant: Arjun Nair\nRespondent: Example Renovation Contractor Pte. Ltd.\nClaim type: Property damage\nIncident date: 2026-09-03\n\nWhen I came home on Thursday, 3 September 2026, I found that my window was broken. A contractor carrying out renovation work nearby had allowed a rock to strike the window. I have photographs of the broken window and the nearby works.",
    outcome:
      "I want the contractor to pay the reasonable cost of repairing or replacing my window.",
  },
  {
    id: "lease",
    label: "Lease not exceeding 2 years",
    problem:
      "Claimant: Sarah Lee\nRespondent: Daniel Tan\nClaim type: Residential tenancy\nIncident date: 2026-07-28\n\nDaniel Tan is my tenant under an 18-month residential tenancy agreement. The agreement requires rent to be paid on the 28th of each month. He did not pay the rent due on 28 July or 28 August 2026, so two months of rent remain outstanding.",
    outcome: "I want payment of the two months of outstanding rent.",
  },
] as const;
