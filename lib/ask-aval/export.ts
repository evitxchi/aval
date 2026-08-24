/**
 * Client-side export of a finished Ask Aval draft into a real file.
 * Runs in the browser, not the Worker — docx/exceljs/pptxgenjs/jspdf all
 * assume a DOM (Blob, URL.createObjectURL) and are heavy enough that they
 * have no business in the request path that talks to Claude.
 *
 * Parses the draft's markdown into a small block model (heading/paragraph/
 * bullets/table) shared by every export target, so each one just walks the
 * same blocks instead of re-parsing markdown itself.
 */

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

const stripInlineMarkdown = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");

export function parseMarkdownDocument(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    const heading = /^(#{1,2})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2, text: stripInlineMarkdown(heading[2].trim()) });
      i++;
      continue;
    }

    if (/^\|.*\|$/.test(trimmed)) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { tableLines.push(lines[i].trim()); i++; }
      const toCells = (row: string) => row.slice(1, -1).split("|").map((cell) => stripInlineMarkdown(cell.trim()));
      const header = toCells(tableLines[0]);
      const bodyLines = tableLines.slice(1).filter((row) => !/^[\s|:-]+$/.test(row));
      const rows = bodyLines.map(toCells);
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(stripInlineMarkdown(lines[i].trim().replace(/^[-*]\s+/, ""))); i++; }
      blocks.push({ type: "bullets", items });
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,2})\s+/.test(lines[i].trim()) && !/^[-*]\s+/.test(lines[i].trim()) && !/^\|.*\|$/.test(lines[i].trim())) {
      paragraphLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: stripInlineMarkdown(paragraphLines.join(" ")) });
  }
  return blocks;
}

export interface ExportableDraft {
  title: string;
  document: string;
  metrics?: { label: string; value: number | string; unit?: string }[];
}

const slugify = (title: string) => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "aval-draft";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportDocx(draft: ExportableDraft): Promise<void> {
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType } = await import("docx");
  const blocks = parseMarkdownDocument(draft.document);
  const children: InstanceType<typeof Paragraph>[] = [new Paragraph({ text: draft.title, heading: HeadingLevel.TITLE })];

  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ text: block.text, heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2 }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ children: [new TextRun(block.text)] }));
    } else if (block.type === "bullets") {
      for (const item of block.items) children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        ...children,
        ...(draft.metrics?.length
          ? [
              new Paragraph({ text: "Key figures", heading: HeadingLevel.HEADING_2 }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: draft.metrics.map((metric) => new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph(metric.label)] }),
                    new TableCell({ children: [new Paragraph(String(metric.value) + (metric.unit === "percent" ? "%" : ""))] }),
                  ],
                })),
              }),
            ]
          : []),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  triggerBlobDownload(blob, `${slugify(draft.title)}.docx`);
}

export async function exportPptx(draft: ExportableDraft): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  const blocks = parseMarkdownDocument(draft.document);

  const titleSlide = pptx.addSlide();
  titleSlide.addText(draft.title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 32, bold: true, align: "center" });

  let slide: ReturnType<typeof pptx.addSlide> | null = null;
  const flushBullets = (items: string[]) => {
    if (!slide) slide = pptx.addSlide();
    slide.addText(items.map((text) => ({ text, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.2, w: 9, h: 4.5, fontSize: 16 });
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      slide = pptx.addSlide();
      slide.addText(block.text, { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 24, bold: true });
    } else if (block.type === "paragraph") {
      if (!slide) slide = pptx.addSlide();
      slide.addText(block.text, { x: 0.5, y: 1.2, w: 9, h: 4.5, fontSize: 16 });
    } else if (block.type === "bullets") {
      flushBullets(block.items);
    } else if (block.type === "table") {
      if (!slide) slide = pptx.addSlide();
      slide.addTable([block.header, ...block.rows].map((row) => row.map((cell) => ({ text: cell }))), { x: 0.5, y: 1.2, w: 9, fontSize: 12 });
    }
  }

  if (draft.metrics?.length) {
    const metricsSlide = pptx.addSlide();
    metricsSlide.addText("Key figures", { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 24, bold: true });
    metricsSlide.addTable(
      draft.metrics.map((metric) => [{ text: metric.label }, { text: String(metric.value) + (metric.unit === "percent" ? "%" : "") }]),
      { x: 0.5, y: 1.2, w: 9, fontSize: 14 },
    );
  }

  await pptx.writeFile({ fileName: `${slugify(draft.title)}.pptx` });
}

export async function exportXlsx(draft: ExportableDraft): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet("Summary");
  summary.addRow([draft.title]).font = { bold: true, size: 14 };
  summary.addRow([]);
  if (draft.metrics?.length) {
    summary.addRow(["Metric", "Value"]).font = { bold: true };
    for (const metric of draft.metrics) summary.addRow([metric.label, `${metric.value}${metric.unit === "percent" ? "%" : ""}`]);
  }
  summary.columns = [{ width: 32 }, { width: 20 }];

  const blocks = parseMarkdownDocument(draft.document);
  for (const block of blocks.filter((b) => b.type === "table")) {
    if (block.type !== "table") continue;
    const sheet = workbook.addWorksheet(`Table ${workbook.worksheets.length}`);
    sheet.addRow(block.header).font = { bold: true };
    for (const row of block.rows) sheet.addRow(row);
    sheet.columns = block.header.map(() => ({ width: 22 }));
  }

  const detail = workbook.addWorksheet("Draft text");
  for (const block of blocks) {
    if (block.type === "heading") detail.addRow([block.text]).font = { bold: true, size: block.level === 1 ? 13 : 11 };
    else if (block.type === "paragraph") detail.addRow([block.text]);
    else if (block.type === "bullets") block.items.forEach((item) => detail.addRow([`• ${item}`]));
  }
  detail.getColumn(1).width = 100;
  detail.getColumn(1).alignment = { wrapText: true };

  const buffer = await workbook.xlsx.writeBuffer();
  triggerBlobDownload(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${slugify(draft.title)}.xlsx`);
}

export async function exportPdf(draft: ExportableDraft): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 54;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  let y = 60;

  const ensureRoom = (lineHeight: number) => {
    if (y + lineHeight > pageHeight - 50) { doc.addPage(); y = 60; }
  };
  const writeLines = (text: string, size: number, bold: boolean, gapAfter: number) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) { ensureRoom(size + 4); doc.text(line, marginX, y); y += size + 4; }
    y += gapAfter;
  };

  writeLines(draft.title, 20, true, 16);
  for (const block of parseMarkdownDocument(draft.document)) {
    if (block.type === "heading") writeLines(block.text, block.level === 1 ? 15 : 13, true, 8);
    else if (block.type === "paragraph") writeLines(block.text, 11, false, 10);
    else if (block.type === "bullets") block.items.forEach((item) => writeLines(`•  ${item}`, 11, false, 4));
    else if (block.type === "table") { writeLines(block.header.join("  |  "), 11, true, 2); block.rows.forEach((row) => writeLines(row.join("  |  "), 11, false, 2)); }
  }

  if (draft.metrics?.length) {
    writeLines("Key figures", 13, true, 6);
    for (const metric of draft.metrics) writeLines(`${metric.label}: ${metric.value}${metric.unit === "percent" ? "%" : ""}`, 11, false, 2);
  }

  doc.save(`${slugify(draft.title)}.pdf`);
}
