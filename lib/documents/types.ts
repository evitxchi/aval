/**
 * Document ingestion — the layer two deferred agent ideas needed: extracting
 * named financial fields from an owner/lender statement, and answering
 * questions about a specific lease.
 *
 * **Text in, not files.** Aval runs on Cloudflare Workers with no object
 * store, and `lib/infrastructure/bill-extraction.ts` already established the
 * working shape for this app: the user provides a document's text and a model
 * turns it into structured fields for review. Adding R2, upload signing, and
 * PDF/OCR decoding would be a much larger surface to secure for the same
 * outcome, so a paste/import path reuses a pattern already proven here.
 */

export const DOCUMENT_KINDS = ["lease", "ownerStatement", "lenderStatement", "vendorEstimate", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Caps chosen against what a model can actually read in one pass and what a
 * D1 row should carry. A lease running past this is truncated with the
 * truncation *stated*, never silently — an answer drawn from a document whose
 * back half was dropped without saying so is the worst failure this feature
 * has.
 */
export const MAX_DOCUMENT_CHARS = 60_000;
export const MAX_DOCUMENT_TITLE_CHARS = 200;

/** How much document text a single model call is given. */
export const MAX_EXTRACTION_CHARS = 12_000;

export interface StoredDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  charCount: number;
  createdAt: Date;
}

/**
 * A field pulled from a document. `value` is null when the document does not
 * state it — the extraction prompt requires leaving a field blank rather than
 * inferring one, which is the same discipline as the faithfulness gate.
 */
export interface ExtractedField {
  label: string;
  value: string | null;
  /** The document's own wording for this field, so a reviewer can check it. */
  sourceQuote: string | null;
}
