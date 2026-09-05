import {
  checkOrigin,
  errorResponse,
  json,
  readForm,
  RequestError,
  withCapacity,
} from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 11 * 1024 * 1024;
const MAX_TEXT_CHARS = 30000;
const MAX_PDF_PAGES = 80;
const MIN_READABLE_CHARS = 15;

// Page-number separators alone are not meaningful extracted content.
const PAGE_MARKER_PATTERN = /--\s*\d+\s+of\s+\d+\s*--/g;
const PDF_SIGNATURE = "%PDF-";
const ZIP_SIGNATURE = [0x50, 0x4b];

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const form = await readForm(request, MAX_REQUEST_BYTES);
    const file = form.get("file");
    if (!(file instanceof File))
      throw new RequestError("Choose a document to read.");
    if (file.size > MAX_UPLOAD_BYTES)
      throw new RequestError("Use a document smaller than 10 MB.", 413);
    const data = new Uint8Array(await file.arrayBuffer());
    const isPdf =
      file.name.toLowerCase().endsWith(".pdf") && hasPdfSignature(data);
    const isDocx =
      file.name.toLowerCase().endsWith(".docx") && hasZipSignature(data);
    if (!isPdf && !isDocx)
      throw new RequestError(
        "Use a valid PDF or DOCX document, or paste its text.",
      );
    const text = await withCapacity(() => extractDocumentText(data, isPdf));
    if (text.length > MAX_TEXT_CHARS) {
      throw new RequestError(
        "This document contains more than 30,000 characters. Split it into smaller documents or paste the relevant text.",
      );
    }
    const meaningfulText = text.replace(PAGE_MARKER_PATTERN, "").trim();
    return json({
      text: meaningfulText,
      status:
        meaningfulText.length > MIN_READABLE_CHARS ? "extracted" : "unreadable",
    });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error);
    return errorResponse(
      new RequestError(
        "This document could not be read. It may be scanned, password-protected or damaged. Paste its text or add a description.",
      ),
    );
  }
}

function hasPdfSignature(data: Uint8Array): boolean {
  return (
    Buffer.from(data.subarray(0, PDF_SIGNATURE.length)).toString() ===
    PDF_SIGNATURE
  );
}

function hasZipSignature(data: Uint8Array): boolean {
  return data[0] === ZIP_SIGNATURE[0] && data[1] === ZIP_SIGNATURE[1];
}

async function extractDocumentText(
  data: Uint8Array,
  isPdf: boolean,
): Promise<string> {
  if (!isPdf) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value;
  }
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data, isEvalSupported: false });
  try {
    const info = await parser.getInfo();
    if (info.total > MAX_PDF_PAGES)
      throw new RequestError("Use a PDF with 80 pages or fewer.");
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}
