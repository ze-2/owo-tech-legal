import type { Evidence } from "./claim";

// Upload guardrails shown in the dropzone copy — keep in sync with the UI text.
export const EVIDENCE_UPLOAD_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  extractTimeoutMs: 35000,
  maxTextChars: 30000,
  minReadableChars: 15,
} as const;

const CLAIM_IMPORT_PATTERN = /\.(pdf|docx|txt)$/i;
const EVIDENCE_FILE_PATTERN = /\.(pdf|docx|txt|png|jpe?g|webp)$/i;
const IMAGE_ONLY_PATTERN = /\.(png|jpe?g|webp)$/i;

export type ExtractedFile = { text: string; status: Evidence["status"] };

export function validateSelectedFiles(
  selected: File[],
  evidence: Evidence[],
  asClaimDocument: boolean,
): void {
  if (asClaimDocument && selected.length > 1) {
    throw new Error("Import one claim document at a time.");
  }
  if (
    !asClaimDocument &&
    evidence.length + selected.length > EVIDENCE_UPLOAD_LIMITS.maxFiles
  ) {
    throw new Error("You can attach up to 10 files.");
  }
  if (
    selected.some((file) => file.size > EVIDENCE_UPLOAD_LIMITS.maxFileBytes)
  ) {
    throw new Error("Each file must be smaller than 10 MB.");
  }
  const combinedBytes = [...evidence, ...selected].reduce(
    (sum, file) => sum + file.size,
    0,
  );
  if (
    !asClaimDocument &&
    combinedBytes > EVIDENCE_UPLOAD_LIMITS.maxTotalBytes
  ) {
    throw new Error("Keep the combined evidence size below 25 MB.");
  }
  const allowed = asClaimDocument
    ? CLAIM_IMPORT_PATTERN
    : EVIDENCE_FILE_PATTERN;
  if (selected.some((file) => !allowed.test(file.name))) {
    throw new Error(
      "Choose a supported file type listed below the upload area.",
    );
  }
}

/** Read one file into extracted text. Images need a human description. */
export async function extractFileText(file: File): Promise<ExtractedFile> {
  if (file.name.toLowerCase().endsWith(".txt")) {
    const text = await file.text();
    if (text.length > EVIDENCE_UPLOAD_LIMITS.maxTextChars) {
      throw new Error("Text documents must be 30,000 characters or fewer.");
    }
    return {
      text,
      status:
        text.trim().length > EVIDENCE_UPLOAD_LIMITS.minReadableChars
          ? "extracted"
          : "unreadable",
    };
  }
  if (IMAGE_ONLY_PATTERN.test(file.name))
    return { text: "", status: "description-needed" };
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/extract", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(EVIDENCE_UPLOAD_LIMITS.extractTimeoutMs),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data as ExtractedFile;
}
