/**
 * Fills a user-supplied .docx template's `{{placeholder}}` tags with real
 * data — the branded-template counterpart to the hand-rolled block-model
 * exporter in lib/ask-aval/export.ts (which stays as-is; see
 * docs/DECISIONS.md for why nothing found in a GitHub sourcing pass beat
 * it for markdown-to-document conversion). This path exists for the
 * opposite case: an operator has their own letterhead/branded Word
 * template and wants Aval's data dropped into it, not Aval's own fixed
 * "Aval Document Standard" layout.
 *
 * docxtemplater has no DOM dependency (unlike docx/exceljs/pptxgenjs/jsPDF,
 * which is why export.ts stays client-side) — `generate({ type:
 * "uint8array" })` below works without Node's Buffer, so this can run
 * directly in the Worker request path.
 *
 * There is no template-upload/storage UI yet (would need R2 — see
 * docs/DECISIONS.md); this ships the tested core so that surface can be
 * built later without re-solving the docxtemplater/pizzip integration.
 */

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export class DocxTemplateError extends Error {
  cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DocxTemplateError";
    this.cause = cause;
  }
}

/** `templateBytes` is a whole .docx file's raw bytes (it's a zip archive); `data` supplies every `{{tag}}` the template references. */
export function renderDocxFromTemplate(templateBytes: ArrayBuffer | Uint8Array, data: Record<string, unknown>): Uint8Array {
  let zip: PizZip;
  try {
    zip = new PizZip(templateBytes);
  } catch (err) {
    throw new DocxTemplateError("The template file is not a valid .docx (zip) archive", err);
  }

  // docxtemplater's own default delimiter is single-brace ({tag}); every
  // caller of this module (and its own tests) writes templates with the
  // more common mustache-style {{tag}}, so that has to be set explicitly —
  // left at the default, "{{title}}" parses as two back-to-back single-
  // brace tags and throws a duplicate-open/close-tag error.
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "{{", end: "}}" } });
  try {
    doc.render(data);
  } catch (err) {
    // docxtemplater throws a rich error (err.properties.errors) for things
    // like an unmatched {{tag}} — never surface its raw internals to a
    // caller that just needs to know the fill failed.
    throw new DocxTemplateError("The template's placeholder tags could not be filled — check for a misspelled or unmatched {{tag}}", err);
  }

  return doc.getZip().generate({ type: "uint8array" });
}
