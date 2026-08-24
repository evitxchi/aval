/**
 * Client-side export of a finished Ask Aval draft into a real file.
 * Runs in the browser, not the Worker: docx/exceljs/pptxgenjs/jspdf all
 * assume a DOM (Blob, URL.createObjectURL) and are heavy enough that they
 * have no business in the request path that talks to the model.
 *
 * Parses the draft's markdown into a small block model (heading/paragraph/
 * bullets/table) shared by every export target, so each one just walks the
 * same blocks instead of re-parsing markdown itself. Every export carries
 * the same Aval letterhead: a wordmark and a "Signed by Aval" line, in the
 * brand's own ink and a widely-available font rather than the web app's
 * licensed display face (not something to redistribute inside a document
 * sent to someone else's inbox).
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

/* ── brand ───────────────────────────────────────────────────────────────
 * A widely-available font stack that reads as clean and modern without
 * embedding the web app's own licensed display face into a file that
 * leaves this app. Helvetica is jsPDF's built-in name (no embedding at
 * all); Word/PowerPoint/Excel resolve the same family from the reader's
 * own system, falling back to Arial where Helvetica isn't installed. */
const BRAND_FONT = "Helvetica";
const BRAND_INK = "0B0B0A";
const BRAND_MUTED = "686762";
const BRAND_LINE = "E7E6E2";
const LOGO_PATH = "/brand/aval-logo-v2.png";
const LOGO_ASPECT = 2069 / 760;
const SIGNATURE_LABEL = "Signed by Aval";

let cachedLogo: Promise<ArrayBuffer> | null = null;
function loadLogoBytes(): Promise<ArrayBuffer> {
  cachedLogo ??= fetch(LOGO_PATH).then((res) => res.arrayBuffer());
  return cachedLogo;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  return btoa(binary);
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
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, ImageRun, Header, Footer, AlignmentType, WidthType, BorderStyle } = await import("docx");
  const logoBytes = await loadLogoBytes();
  const logoHeight = 22;
  const logoWidth = Math.round(logoHeight * LOGO_ASPECT);

  const blocks = parseMarkdownDocument(draft.document);
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: draft.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_LINE } },
      spacing: { after: 240 },
      children: [],
    }),
  ];

  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ text: block.text, heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2 }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ children: [new TextRun({ text: block.text, font: BRAND_FONT })] }));
    } else if (block.type === "bullets") {
      for (const item of block.items) children.push(new Paragraph({ children: [new TextRun({ text: item, font: BRAND_FONT })], bullet: { level: 0 } }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: BRAND_FONT } },
        heading1: { run: { font: BRAND_FONT, color: BRAND_INK } },
        heading2: { run: { font: BRAND_FONT, color: BRAND_INK } },
        title: { run: { font: BRAND_FONT, color: BRAND_INK } },
      },
    },
    sections: [{
      properties: {},
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new ImageRun({ data: logoBytes, transformation: { width: logoWidth, height: logoHeight }, type: "png" })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              children: [new TextRun({ text: SIGNATURE_LABEL, font: BRAND_FONT, color: BRAND_MUTED, size: 16 })],
            }),
          ],
        }),
      },
      children: [
        ...children,
        ...(draft.metrics?.length
          ? [
              new Paragraph({ text: "Key figures", heading: HeadingLevel.HEADING_2 }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: draft.metrics.map((metric) => new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: metric.label, font: BRAND_FONT })] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(metric.value) + (metric.unit === "percent" ? "%" : ""), font: BRAND_FONT })] })] }),
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
  pptx.defineLayout({ name: "ASK_AVAL", width: 10, height: 5.625 });
  pptx.layout = "ASK_AVAL";

  const logoBytes = await loadLogoBytes();
  const logoData = `data:image/png;base64,${bytesToBase64(logoBytes)}`;
  const logoHeight = 0.28;
  const logoWidth = logoHeight * LOGO_ASPECT;

  const brandSlide = (slide: ReturnType<typeof pptx.addSlide>) => {
    slide.addImage({ data: logoData, x: 10 - logoWidth - 0.3, y: 0.22, w: logoWidth, h: logoHeight });
    slide.addText(SIGNATURE_LABEL, { x: 0.3, y: 5.625 - 0.32, w: 4, h: 0.25, fontSize: 8, color: BRAND_MUTED, fontFace: BRAND_FONT });
  };

  const blocks = parseMarkdownDocument(draft.document);

  const titleSlide = pptx.addSlide();
  titleSlide.addText(draft.title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 30, bold: true, align: "center", fontFace: BRAND_FONT, color: BRAND_INK });
  brandSlide(titleSlide);

  let slide: ReturnType<typeof pptx.addSlide> | null = null;
  const flushBullets = (items: string[]) => {
    if (!slide) { slide = pptx.addSlide(); brandSlide(slide); }
    slide.addText(items.map((text) => ({ text, options: { bullet: true, breakLine: true, fontFace: BRAND_FONT, color: BRAND_INK } })), { x: 0.5, y: 1.2, w: 9, h: 4, fontSize: 15 });
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      slide = pptx.addSlide();
      brandSlide(slide);
      slide.addText(block.text, { x: 0.5, y: 0.4, w: 8, h: 0.7, fontSize: 22, bold: true, fontFace: BRAND_FONT, color: BRAND_INK });
    } else if (block.type === "paragraph") {
      if (!slide) { slide = pptx.addSlide(); brandSlide(slide); }
      slide.addText(block.text, { x: 0.5, y: 1.2, w: 9, h: 4, fontSize: 15, fontFace: BRAND_FONT, color: BRAND_INK });
    } else if (block.type === "bullets") {
      flushBullets(block.items);
    } else if (block.type === "table") {
      if (!slide) { slide = pptx.addSlide(); brandSlide(slide); }
      slide.addTable([block.header, ...block.rows].map((row) => row.map((cell) => ({ text: cell, options: { fontFace: BRAND_FONT } }))), { x: 0.5, y: 1.2, w: 9, fontSize: 11 });
    }
  }

  if (draft.metrics?.length) {
    const metricsSlide = pptx.addSlide();
    brandSlide(metricsSlide);
    metricsSlide.addText("Key figures", { x: 0.5, y: 0.4, w: 8, h: 0.7, fontSize: 22, bold: true, fontFace: BRAND_FONT, color: BRAND_INK });
    metricsSlide.addTable(
      draft.metrics.map((metric) => [{ text: metric.label, options: { fontFace: BRAND_FONT } }, { text: String(metric.value) + (metric.unit === "percent" ? "%" : ""), options: { fontFace: BRAND_FONT } }]),
      { x: 0.5, y: 1.2, w: 9, fontSize: 13 },
    );
  }

  await pptx.writeFile({ fileName: `${slugify(draft.title)}.pptx` });
}

export async function exportXlsx(draft: ExportableDraft): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const logoBytes = await loadLogoBytes();
  const logoImageId = workbook.addImage({ buffer: logoBytes as Parameters<typeof workbook.addImage>[0] extends { buffer: infer B } ? B : never, extension: "png" });

  const brandSheet = (sheet: ReturnType<typeof workbook.addWorksheet>, logoColOffset: number) => {
    sheet.addImage(logoImageId, { tl: { col: logoColOffset, row: 0 }, ext: { width: 96, height: 96 / LOGO_ASPECT } });
  };

  const summary = workbook.addWorksheet("Summary");
  summary.addRow([draft.title]).font = { bold: true, size: 14, name: BRAND_FONT, color: { argb: `FF${BRAND_INK}` } };
  summary.addRow([]);
  summary.addRow([]);
  if (draft.metrics?.length) {
    summary.addRow(["Metric", "Value"]).font = { bold: true, name: BRAND_FONT };
    for (const metric of draft.metrics) summary.addRow([metric.label, `${metric.value}${metric.unit === "percent" ? "%" : ""}`]).font = { name: BRAND_FONT };
  }
  summary.addRow([]);
  summary.addRow([SIGNATURE_LABEL]).font = { italic: true, size: 9, color: { argb: `FF${BRAND_MUTED}` }, name: BRAND_FONT };
  summary.columns = [{ width: 32 }, { width: 20 }];
  brandSheet(summary, 3);

  const blocks = parseMarkdownDocument(draft.document);
  for (const block of blocks.filter((b) => b.type === "table")) {
    if (block.type !== "table") continue;
    const sheet = workbook.addWorksheet(`Table ${workbook.worksheets.length}`);
    sheet.addRow(block.header).font = { bold: true, name: BRAND_FONT };
    for (const row of block.rows) sheet.addRow(row).font = { name: BRAND_FONT };
    sheet.columns = block.header.map(() => ({ width: 22 }));
    brandSheet(sheet, block.header.length + 1);
  }

  const detail = workbook.addWorksheet("Draft text");
  for (const block of blocks) {
    if (block.type === "heading") detail.addRow([block.text]).font = { bold: true, size: block.level === 1 ? 13 : 11, name: BRAND_FONT, color: { argb: `FF${BRAND_INK}` } };
    else if (block.type === "paragraph") detail.addRow([block.text]).font = { name: BRAND_FONT };
    else if (block.type === "bullets") block.items.forEach((item) => detail.addRow([`• ${item}`]).font = { name: BRAND_FONT });
  }
  detail.getColumn(1).width = 100;
  detail.getColumn(1).alignment = { wrapText: true };
  brandSheet(detail, 2);

  const buffer = await workbook.xlsx.writeBuffer();
  triggerBlobDownload(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${slugify(draft.title)}.xlsx`);
}

export async function exportPdf(draft: ExportableDraft): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const logoBytes = await loadLogoBytes();
  const logoData = `data:image/png;base64,${bytesToBase64(logoBytes)}`;
  const marginX = 54;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  const logoHeight = 16;
  const logoWidth = logoHeight * LOGO_ASPECT;
  let y = 60;

  const paintLetterhead = () => {
    doc.addImage(logoData, "PNG", pageWidth - marginX - logoWidth, 28, logoWidth, logoHeight);
    doc.setDrawColor(`#${BRAND_LINE}`);
    doc.line(marginX, 52, pageWidth - marginX, 52);
    doc.setFont(BRAND_FONT, "italic");
    doc.setFontSize(8);
    doc.setTextColor(`#${BRAND_MUTED}`);
    doc.text(SIGNATURE_LABEL, marginX, pageHeight - 30);
    doc.setTextColor(`#${BRAND_INK}`);
  };
  const addPage = () => { doc.addPage(); y = 60; paintLetterhead(); };
  paintLetterhead();

  const ensureRoom = (lineHeight: number) => {
    if (y + lineHeight > pageHeight - 50) addPage();
  };
  const writeLines = (text: string, size: number, bold: boolean, gapAfter: number) => {
    doc.setFont(BRAND_FONT, bold ? "bold" : "normal");
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
