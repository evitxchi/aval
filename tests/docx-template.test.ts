import assert from "node:assert/strict";
import test from "node:test";
import { Document, Packer, Paragraph, TextRun } from "docx";
import PizZip from "pizzip";
import { DocxTemplateError, renderDocxFromTemplate } from "../lib/ask-aval/docx-template.ts";

async function buildTemplateBuffer(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("Report: {{title}}")] }),
          new Paragraph({ children: [new TextRun("Summary: {{summary}}")] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

test("renderDocxFromTemplate fills {{tags}} with real data and leaves no raw tags behind", async () => {
  const template = await buildTemplateBuffer();
  const filled = renderDocxFromTemplate(template, { title: "Q3 Report", summary: "Strong quarter" });

  const zip = new PizZip(filled);
  const xml = zip.file("word/document.xml")!.asText();

  assert.ok(xml.includes("Q3 Report"), "expected the filled title to appear in document.xml");
  assert.ok(xml.includes("Strong quarter"), "expected the filled summary to appear in document.xml");
  assert.ok(!xml.includes("{{title}}"), "the raw {{title}} tag should have been replaced");
  assert.ok(!xml.includes("{{summary}}"), "the raw {{summary}} tag should have been replaced");
});

test("renderDocxFromTemplate rejects a non-zip file as a DocxTemplateError", () => {
  const garbage = new TextEncoder().encode("this is not a docx file");
  assert.throws(() => renderDocxFromTemplate(garbage, {}), DocxTemplateError);
});
