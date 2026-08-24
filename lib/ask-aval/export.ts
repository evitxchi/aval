/**
 * Client-side export of a finished Ask Aval draft into a real file.
 * Runs in the browser, not the Worker: docx/exceljs/pptxgenjs/jspdf all
 * assume a DOM (Blob, URL.createObjectURL, canvas) and are heavy enough
 * that they have no business in the request path that talks to the model.
 *
 * Parses the draft's markdown into a small block model (heading/paragraph/
 * bullets/table) shared by every export target, so each one just walks the
 * same blocks instead of re-parsing markdown itself.
 *
 * Every export follows the Aval house style (see "Aval Document Standard"):
 * a fixed ink/muted/meta/surface/hairline/positive palette, a fixed type
 * scale, an eyebrow/title/standfirst/meta-strip opening, metric tiles,
 * ink-and-hairline table rules, and a plain provenance footer. The header
 * keeps its existing logo + wordmark placement (top right) unchanged.
 * Every field in the meta strip is a real value (the signed-in user, the
 * fact this build only ever reads a sample snapshot, the draft's own send
 * status) or it is left out — nothing here is a placeholder.
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

/** A paragraph the model wrote as "Table N: ..." or "Figure N: ..." right after a table/chart, per the drafting instructions in lib/ask-aval/draft.ts. Rendered as a small caption instead of body text. */
const isCaptionText = (text: string) => /^(Table|Figure)\s+\d+:/i.test(text);

export interface ExportableMetric { label: string; value: number | string; unit?: string; delta?: number }
export interface ExportableChart { metric: string; title: string; points: { x: string; y: number }[] }

export interface ExportableDraft {
  title: string;
  document: string;
  standfirst?: string;
  documentType?: string;
  metrics?: ExportableMetric[];
  chart?: ExportableChart;
  status?: "draft" | "sent";
  sentTo?: string;
}

/* ── brand ───────────────────────────────────────────────────────────────
 * A widely-available font stack that reads as clean and modern without
 * embedding the web app's own licensed display face into a file that
 * leaves this app. Helvetica is jsPDF's built-in name (no embedding at
 * all); Word/PowerPoint/Excel resolve the same family from the reader's
 * own system, falling back to Arial where Helvetica isn't installed.
 *
 * Palette and type scale below are the Aval Document Standard exactly:
 * every generated document should read as the same document, regardless
 * of which of the four formats it left as. */
const BRAND_FONT = "Helvetica";
const COLOR = {
  ink: "191813",
  muted: "6b6862",
  meta: "8c887f",
  surface: "f7f6f3",
  hairline: "e5e3dd",
  positive: "3f6b52",
} as const;
const TYPE = {
  title: 30,
  standfirst: 13,
  heading: 11,
  body: 10.5,
  metricValue: 17,
  micro: 8,
} as const;
const LOGO_PATH = "/brand/aval-logo-v2.png";
const LOGO_ASPECT = 2069 / 760;
const SIGNATURE_LABEL = "Signed by Aval";
const FOOTER_LEFT = "Generated by Aval · property operations";
// True for every document this build can produce today: every deterministic
// tool in lib/ask-aval/tools.ts reads app/data/sample.ts, never a live,
// connected source. Update this the day a real integration backs a tool.
const DATA_SOURCE_LABEL = "Sample snapshot";
const FOOTER_RIGHT = "Sample data, connect a source to see yours";

// Metric labels where a rising value is the bad outcome, so a positive
// delta must not be painted the same "favorable" green as NOI or occupancy
// going up. Matched loosely against the metric's own label text.
const UNFAVORABLE_WHEN_RISING = ["work order", "delinquent", "past due", "vacan", "expense", "cost", "arrears", "urgent"];

// pptxgenjs table cell borders are a fixed [top, right, bottom, left] tuple; this
// builds one with only the bottom edge set, matching the house style's row-hairline
// convention (no vertical rules, no borders above a row).
type PptxCellBorder = { type: "none" | "solid" | "dash"; color?: string; pt?: number };
function bottomBorder(bottom: PptxCellBorder): [PptxCellBorder, PptxCellBorder, PptxCellBorder, PptxCellBorder] {
  const none: PptxCellBorder = { type: "none" };
  return [none, none, bottom, none];
}

function isFavorableDelta(label: string, delta: number): boolean {
  if (delta === 0) return false;
  const lower = label.toLowerCase();
  const risingIsBad = UNFAVORABLE_WHEN_RISING.some((keyword) => lower.includes(keyword));
  return risingIsBad ? delta < 0 : delta > 0;
}

function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
function formatMetricValue(metric: ExportableMetric): string {
  if (typeof metric.value === "string") return metric.value;
  if (metric.unit === "currency") return formatCurrency(metric.value);
  if (metric.unit === "percent") return formatPercent(metric.value);
  if (metric.unit === "days") return `${metric.value.toFixed(1)}d`;
  return formatCount(metric.value);
}
function formatDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

let cachedLogo: Promise<ArrayBuffer> | null = null;
function loadLogoBytes(): Promise<ArrayBuffer> {
  cachedLogo ??= fetch(LOGO_PATH).then((res) => res.arrayBuffer());
  return cachedLogo;
}

interface SessionIdentity { authenticated: boolean; displayName?: string }
let cachedIdentity: Promise<SessionIdentity> | null = null;
/** The real signed-in user, for the meta strip's "Prepared for" field. Never a placeholder: the field is simply left out if this can't be resolved. */
function loadPreparedFor(): Promise<string | undefined> {
  cachedIdentity ??= fetch("/api/auth/session").then((res) => res.json() as Promise<SessionIdentity>).catch(() => ({ authenticated: false }));
  return cachedIdentity.then((identity) => (identity.authenticated ? identity.displayName : undefined));
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  return btoa(binary);
}

/** Draws the draft's chart (only ever real tool-sourced points, see get_metric_series) as a plain line-and-dot series on a canvas, for embedding in formats with no native chart support. */
function renderChartCanvas(chart: ExportableChart): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 380;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const pad = 56;
  const plotWidth = canvas.width - pad * 2;
  const plotHeight = canvas.height - pad * 2;
  const values = chart.points.map((point) => point.y);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const xFor = (index: number) => pad + (chart.points.length > 1 ? (index / (chart.points.length - 1)) * plotWidth : plotWidth / 2);
  const yFor = (value: number) => pad + plotHeight - ((value - minValue) / range) * plotHeight;

  ctx.strokeStyle = `#${COLOR.hairline}`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad, pad + plotHeight);
  ctx.lineTo(pad + plotWidth, pad + plotHeight);
  ctx.stroke();

  ctx.strokeStyle = `#${COLOR.ink}`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  chart.points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.y);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = `#${COLOR.ink}`;
  chart.points.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(xFor(index), yFor(point.y), 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = `#${COLOR.meta}`;
  ctx.font = `11px ${BRAND_FONT}, Arial, sans-serif`;
  ctx.textAlign = "center";
  chart.points.forEach((point, index) => ctx.fillText(point.x, xFor(index), canvas.height - 18));

  return canvas;
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
  const {
    Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, ImageRun, Header, Footer,
    AlignmentType, WidthType, BorderStyle, VerticalAlign,
  } = await import("docx");
  const [logoBytes, preparedFor] = await Promise.all([loadLogoBytes(), loadPreparedFor()]);
  const logoHeight = 22;
  const logoWidth = Math.round(logoHeight * LOGO_ASPECT);
  const pt = (value: number) => Math.round(value * 20);
  const half = (value: number) => Math.round(value * 2);

  const hairline = { style: BorderStyle.SINGLE, size: 4, color: COLOR.hairline };
  const inkRule = { style: BorderStyle.SINGLE, size: 8, color: COLOR.ink };

  const eyebrow = new Paragraph({
    spacing: { after: pt(6) },
    children: [new TextRun({ text: `ASK AVAL · ${(draft.documentType ?? "Draft").toUpperCase()}`, font: BRAND_FONT, size: half(TYPE.micro), color: COLOR.meta, characterSpacing: 20, allCaps: true })],
  });
  const title = new Paragraph({
    spacing: { after: draft.standfirst ? pt(6) : pt(10) },
    children: [new TextRun({ text: draft.title, font: BRAND_FONT, size: half(TYPE.title), bold: true, color: COLOR.ink })],
  });
  const standfirst = draft.standfirst
    ? new Paragraph({ spacing: { after: pt(14) }, children: [new TextRun({ text: draft.standfirst, font: BRAND_FONT, size: half(TYPE.standfirst), color: COLOR.muted })] })
    : null;

  const metaFields: { label: string; value: string }[] = [];
  if (preparedFor) metaFields.push({ label: "Prepared for", value: preparedFor });
  metaFields.push({ label: "Source", value: DATA_SOURCE_LABEL });
  metaFields.push({ label: "Status", value: draft.sentTo ? `Sent to ${draft.sentTo}` : "Draft" });
  const metaStrip = new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.hairline, space: 8 } },
    spacing: { after: pt(24) },
    children: metaFields.flatMap((field, index) => [
      ...(index > 0 ? [new TextRun({ text: "    ", font: BRAND_FONT, size: half(TYPE.body) })] : []),
      new TextRun({ text: `${field.label}  `, font: BRAND_FONT, size: half(9), color: COLOR.meta }),
      new TextRun({ text: field.value, font: BRAND_FONT, size: half(TYPE.body), color: COLOR.ink, bold: true }),
    ]),
  });

  const tileCell = (metric: ExportableMetric) => {
    const deltaFavorable = metric.delta !== undefined ? isFavorableDelta(metric.label, metric.delta) : undefined;
    return new TableCell({
      width: { size: Math.round(100 / (draft.metrics?.length ?? 1)), type: WidthType.PERCENTAGE },
      margins: { top: pt(10), bottom: pt(10), left: pt(10), right: pt(10) },
      borders: { top: hairline, bottom: hairline, left: hairline, right: hairline },
      children: [
        new Paragraph({ spacing: { after: pt(4) }, children: [new TextRun({ text: metric.label, font: BRAND_FONT, size: half(9), color: COLOR.meta })] }),
        new Paragraph({ spacing: { after: metric.delta !== undefined ? pt(3) : 0 }, children: [new TextRun({ text: formatMetricValue(metric), font: BRAND_FONT, size: half(TYPE.metricValue), bold: true, color: COLOR.ink })] }),
        ...(metric.delta !== undefined
          ? [new Paragraph({ children: [new TextRun({ text: formatDelta(metric.delta), font: BRAND_FONT, size: half(9), color: deltaFavorable ? COLOR.positive : COLOR.muted })] })]
          : []),
      ],
    });
  };
  const metricTiles = draft.metrics?.length
    ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: draft.metrics.map(tileCell) })] })
    : null;

  const bodyParagraphs: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  let tableIndex = 0;
  const blocks = parseMarkdownDocument(draft.document);
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    if (block.type === "heading") {
      bodyParagraphs.push(new Paragraph({ spacing: { before: pt(24), after: pt(11) }, children: [new TextRun({ text: block.text, font: BRAND_FONT, size: half(block.level === 1 ? TYPE.heading : TYPE.body), bold: true, color: COLOR.ink })] }));
    } else if (block.type === "paragraph") {
      const caption = isCaptionText(block.text);
      bodyParagraphs.push(new Paragraph({
        spacing: { after: pt(8), line: caption ? undefined : 389, lineRule: caption ? undefined : "auto" },
        children: [new TextRun({ text: block.text, font: BRAND_FONT, size: half(caption ? TYPE.micro : TYPE.body), color: caption ? COLOR.meta : COLOR.ink, italics: caption })],
      }));
    } else if (block.type === "bullets") {
      for (const item of block.items) bodyParagraphs.push(new Paragraph({ spacing: { after: pt(4), line: 389, lineRule: "auto" }, bullet: { level: 0 }, children: [new TextRun({ text: item, font: BRAND_FONT, size: half(TYPE.body), color: COLOR.ink })] }));
    } else if (block.type === "table") {
      tableIndex += 1;
      const lastRow = block.rows[block.rows.length - 1];
      const hasTotal = lastRow && lastRow[0]?.trim().toLowerCase() === "total";
      const rows = [
        new TableRow({
          children: block.header.map((cell, columnIndex) => new TableCell({
            borders: { bottom: inkRule },
            margins: { top: pt(4), bottom: pt(6), left: pt(4), right: pt(4) },
            children: [new Paragraph({ alignment: columnIndex === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: cell, font: BRAND_FONT, size: half(TYPE.body), bold: true, color: COLOR.ink })] })],
          })),
        }),
        ...block.rows.map((row, rowIndex) => {
          const isTotalRow = hasTotal && rowIndex === block.rows.length - 1;
          return new TableRow({
            children: row.map((cell, columnIndex) => new TableCell({
              borders: isTotalRow ? { top: inkRule } : { bottom: hairline },
              margins: { top: pt(5), bottom: pt(5), left: pt(4), right: pt(4) },
              children: [new Paragraph({ alignment: columnIndex === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: cell, font: BRAND_FONT, size: half(TYPE.body), bold: isTotalRow, color: COLOR.ink })] })],
            })),
          });
        }),
      ];
      bodyParagraphs.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
      const nextBlock = blocks[blockIndex + 1];
      const hasOwnCaption = nextBlock?.type === "paragraph" && isCaptionText(nextBlock.text);
      if (!hasOwnCaption) {
        bodyParagraphs.push(new Paragraph({ spacing: { before: pt(6), after: pt(10) }, children: [new TextRun({ text: `Table ${tableIndex}`, font: BRAND_FONT, size: half(TYPE.micro), color: COLOR.meta, italics: true })] }));
      }
    }
  }

  let chartImage: InstanceType<typeof Paragraph> | null = null;
  if (draft.chart?.points.length) {
    const canvas = renderChartCanvas(draft.chart);
    const dataUrl = canvas.toDataURL("image/png");
    const chartBytes = await fetch(dataUrl).then((res) => res.arrayBuffer());
    const chartWidth = 460;
    const chartHeight = Math.round(chartWidth * (canvas.height / canvas.width));
    chartImage = new Paragraph({
      spacing: { before: pt(24), after: pt(4) },
      children: [new ImageRun({ data: chartBytes, transformation: { width: chartWidth, height: chartHeight }, type: "png" })],
    });
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: BRAND_FONT, size: half(TYPE.body), color: COLOR.ink } } } },
    sections: [{
      properties: {},
      headers: {
        default: new Header({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ data: logoBytes, transformation: { width: logoWidth, height: logoHeight }, type: "png" })] })],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
              rows: [new TableRow({
                children: [
                  new TableCell({ verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [new TextRun({ text: FOOTER_LEFT, font: BRAND_FONT, size: half(TYPE.micro), color: COLOR.muted })] })] }),
                  new TableCell({ verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: FOOTER_RIGHT, font: BRAND_FONT, size: half(TYPE.micro), color: COLOR.muted })] })] }),
                ],
              })],
            }),
          ],
        }),
      },
      children: [
        eyebrow,
        title,
        ...(standfirst ? [standfirst] : []),
        metaStrip,
        ...(metricTiles ? [new Paragraph({ spacing: { after: pt(24) }, children: [] }), metricTiles] : []),
        ...bodyParagraphs,
        ...(chartImage
          ? [chartImage, new Paragraph({ spacing: { after: pt(4) }, children: [new TextRun({ text: `Figure: ${draft.chart!.title}`, font: BRAND_FONT, size: half(TYPE.micro), color: COLOR.meta, italics: true })] })]
          : []),
        new Paragraph({ spacing: { before: pt(16) }, children: [new TextRun({ text: SIGNATURE_LABEL, font: BRAND_FONT, size: half(9), color: COLOR.muted, italics: true })] }),
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

  const [logoBytes, preparedFor] = await Promise.all([loadLogoBytes(), loadPreparedFor()]);
  const logoData = `data:image/png;base64,${bytesToBase64(logoBytes)}`;
  const logoHeight = 0.28;
  const logoWidth = logoHeight * LOGO_ASPECT;
  const ink = COLOR.ink, muted = COLOR.muted, meta = COLOR.meta, hairline = COLOR.hairline;

  const brandSlide = (slide: ReturnType<typeof pptx.addSlide>) => {
    slide.background = { color: "FFFFFF" };
    slide.addImage({ data: logoData, x: 10 - logoWidth - 0.3, y: 0.22, w: logoWidth, h: logoHeight });
    slide.addText(FOOTER_LEFT, { x: 0.3, y: 5.625 - 0.32, w: 5, h: 0.25, fontSize: 7.5, color: muted, fontFace: BRAND_FONT });
    slide.addText(FOOTER_RIGHT, { x: 5, y: 5.625 - 0.32, w: 4.7, h: 0.25, fontSize: 7.5, color: muted, fontFace: BRAND_FONT, align: "right" });
  };

  const titleSlide = pptx.addSlide();
  brandSlide(titleSlide);
  titleSlide.addText(`ASK AVAL · ${(draft.documentType ?? "DRAFT").toUpperCase()}`, { x: 0.5, y: 1.5, w: 9, h: 0.3, fontSize: 8, color: meta, fontFace: BRAND_FONT, charSpacing: 1, align: "center" });
  titleSlide.addText(draft.title, { x: 0.5, y: 1.85, w: 9, h: 1.1, fontSize: 28, bold: true, align: "center", fontFace: BRAND_FONT, color: ink });
  if (draft.standfirst) titleSlide.addText(draft.standfirst, { x: 1, y: 2.95, w: 8, h: 0.6, fontSize: 12, align: "center", fontFace: BRAND_FONT, color: muted });
  const metaLine = [preparedFor ? `Prepared for ${preparedFor}` : null, `Source ${DATA_SOURCE_LABEL}`, `Status ${draft.sentTo ? `Sent to ${draft.sentTo}` : "Draft"}`].filter(Boolean).join("   ·   ");
  titleSlide.addText(metaLine, { x: 0.5, y: 3.7, w: 9, h: 0.3, fontSize: 9, align: "center", fontFace: BRAND_FONT, color: meta });

  if (draft.metrics?.length) {
    const metricsSlide = pptx.addSlide();
    brandSlide(metricsSlide);
    metricsSlide.addText("Headline numbers", { x: 0.5, y: 0.4, w: 8, h: 0.5, fontSize: TYPE.heading * 1.4, bold: true, fontFace: BRAND_FONT, color: ink });
    const tileWidth = 8.8 / draft.metrics.length;
    draft.metrics.forEach((metric, index) => {
      const x = 0.6 + index * tileWidth;
      const favorable = metric.delta !== undefined && isFavorableDelta(metric.label, metric.delta);
      metricsSlide.addShape(pptx.ShapeType.roundRect, { x, y: 1.3, w: tileWidth - 0.15, h: 1.5, fill: { color: "FFFFFF" }, line: { color: hairline, width: 0.75 }, rectRadius: 0.06 });
      metricsSlide.addText(metric.label, { x: x + 0.1, y: 1.42, w: tileWidth - 0.35, h: 0.4, fontSize: 9, color: meta, fontFace: BRAND_FONT });
      metricsSlide.addText(formatMetricValue(metric), { x: x + 0.1, y: 1.7, w: tileWidth - 0.35, h: 0.55, fontSize: 17, bold: true, color: ink, fontFace: BRAND_FONT });
      if (metric.delta !== undefined) metricsSlide.addText(formatDelta(metric.delta), { x: x + 0.1, y: 2.35, w: tileWidth - 0.35, h: 0.3, fontSize: 9, color: favorable ? COLOR.positive : muted, fontFace: BRAND_FONT });
    });
  }

  let slide: ReturnType<typeof pptx.addSlide> | null = null;
  const flushBullets = (items: string[]) => {
    if (!slide) { slide = pptx.addSlide(); brandSlide(slide); }
    slide.addText(items.map((text) => ({ text, options: { bullet: true, breakLine: true, fontFace: BRAND_FONT, color: ink } })), { x: 0.5, y: 1.2, w: 9, h: 4, fontSize: 15 });
  };

  const blocks = parseMarkdownDocument(draft.document);
  for (const block of blocks) {
    if (block.type === "heading") {
      slide = pptx.addSlide();
      brandSlide(slide);
      slide.addText(block.text, { x: 0.5, y: 0.4, w: 8, h: 0.7, fontSize: TYPE.heading * 2, bold: true, fontFace: BRAND_FONT, color: ink });
    } else if (block.type === "paragraph") {
      if (!slide) { slide = pptx.addSlide(); brandSlide(slide); }
      const caption = isCaptionText(block.text);
      slide.addText(block.text, { x: 0.5, y: 1.2, w: 9, h: 4, fontSize: caption ? 10 : 15, italic: caption, fontFace: BRAND_FONT, color: caption ? meta : ink });
    } else if (block.type === "bullets") {
      flushBullets(block.items);
    } else if (block.type === "table") {
      if (!slide) { slide = pptx.addSlide(); brandSlide(slide); }
      const headerBorder = bottomBorder({ type: "solid", color: ink, pt: 1.5 });
      const rowBorder = bottomBorder({ type: "solid", color: hairline, pt: 0.75 });
      slide.addTable(
        [
          block.header.map((cell, columnIndex) => ({ text: cell, options: { fontFace: BRAND_FONT, bold: true, color: ink, align: columnIndex === 0 ? "left" as const : "right" as const, border: headerBorder } })),
          ...block.rows.map((row) => row.map((cell, columnIndex) => ({ text: cell, options: { fontFace: BRAND_FONT, color: ink, align: columnIndex === 0 ? "left" as const : "right" as const, border: rowBorder } }))),
        ],
        { x: 0.5, y: 1.2, w: 9, fontSize: 11 },
      );
    }
  }

  if (draft.chart?.points.length) {
    const chartSlide = pptx.addSlide();
    brandSlide(chartSlide);
    chartSlide.addText(draft.chart.title, { x: 0.5, y: 0.4, w: 8, h: 0.5, fontSize: TYPE.heading * 1.4, bold: true, fontFace: BRAND_FONT, color: ink });
    chartSlide.addChart(pptx.ChartType.line, [{ name: draft.chart.metric, labels: draft.chart.points.map((point) => point.x), values: draft.chart.points.map((point) => point.y) }], {
      x: 0.6, y: 1.1, w: 8.8, h: 3.9, chartColors: [ink], lineSize: 2, lineDataSymbol: "circle", showLegend: false, catAxisLabelColor: meta, valAxisLabelColor: meta,
    });
  }

  await pptx.writeFile({ fileName: `${slugify(draft.title)}.pptx` });
}

export async function exportXlsx(draft: ExportableDraft): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const [logoBytes, preparedFor] = await Promise.all([loadLogoBytes(), loadPreparedFor()]);
  const logoImageId = workbook.addImage({ buffer: logoBytes as Parameters<typeof workbook.addImage>[0] extends { buffer: infer B } ? B : never, extension: "png" });
  const ink = { argb: `FF${COLOR.ink}` };
  const muted = { argb: `FF${COLOR.muted}` };
  const meta = { argb: `FF${COLOR.meta}` };
  const hairline: Partial<import("exceljs").Borders> = { bottom: { style: "hair", color: { argb: `FF${COLOR.hairline}` } } };
  const inkRule: Partial<import("exceljs").Borders> = { bottom: { style: "thin", color: { argb: `FF${COLOR.ink}` } } };

  const brandSheet = (sheet: ReturnType<typeof workbook.addWorksheet>, logoColOffset: number) => {
    sheet.addImage(logoImageId, { tl: { col: logoColOffset, row: 0 }, ext: { width: 96, height: 96 / LOGO_ASPECT } });
  };

  const summary = workbook.addWorksheet("Summary");
  summary.addRow([`ASK AVAL · ${(draft.documentType ?? "Draft").toUpperCase()}`]).font = { size: 8, color: meta, name: BRAND_FONT, bold: true };
  summary.addRow([draft.title]).font = { bold: true, size: 16, name: BRAND_FONT, color: ink };
  if (draft.standfirst) summary.addRow([draft.standfirst]).font = { italic: true, size: 11, name: BRAND_FONT, color: muted };
  summary.addRow([]);
  const metaRows: [string, string][] = [];
  if (preparedFor) metaRows.push(["Prepared for", preparedFor]);
  metaRows.push(["Source", DATA_SOURCE_LABEL]);
  metaRows.push(["Status", draft.sentTo ? `Sent to ${draft.sentTo}` : "Draft"]);
  for (const [label, value] of metaRows) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { size: 9, color: meta, name: BRAND_FONT };
    row.getCell(2).font = { size: 10, color: ink, name: BRAND_FONT, bold: true };
  }
  summary.addRow([]);
  if (draft.metrics?.length) {
    const header = summary.addRow(["Metric", "Value", "Change"]);
    header.font = { bold: true, name: BRAND_FONT, color: ink };
    header.eachCell((cell) => { cell.border = inkRule; });
    for (const metric of draft.metrics) {
      const row = summary.addRow([metric.label, formatMetricValue(metric), metric.delta !== undefined ? formatDelta(metric.delta) : ""]);
      row.font = { name: BRAND_FONT, color: ink };
      row.getCell(2).font = { name: BRAND_FONT, color: ink, bold: true };
      row.getCell(2).alignment = { horizontal: "right" };
      row.getCell(3).alignment = { horizontal: "right" };
      if (metric.delta !== undefined) row.getCell(3).font = { name: BRAND_FONT, color: isFavorableDelta(metric.label, metric.delta) ? { argb: `FF${COLOR.positive}` } : muted };
      row.eachCell((cell) => { cell.border = hairline; });
    }
  }
  summary.addRow([]);
  summary.addRow([SIGNATURE_LABEL]).font = { italic: true, size: 9, color: muted, name: BRAND_FONT };
  summary.addRow([FOOTER_LEFT]).font = { size: 8, color: muted, name: BRAND_FONT };
  summary.columns = [{ width: 34 }, { width: 24 }, { width: 14 }];
  brandSheet(summary, 4);

  const blocks = parseMarkdownDocument(draft.document);
  let tableIndex = 0;
  for (const block of blocks.filter((b) => b.type === "table")) {
    if (block.type !== "table") continue;
    tableIndex += 1;
    const sheet = workbook.addWorksheet(`Table ${tableIndex}`);
    const header = sheet.addRow(block.header);
    header.font = { bold: true, name: BRAND_FONT, color: ink };
    header.eachCell((cell, columnNumber) => { cell.border = inkRule; if (columnNumber > 1) cell.alignment = { horizontal: "right" }; });
    const lastRow = block.rows[block.rows.length - 1];
    const hasTotal = lastRow && lastRow[0]?.trim().toLowerCase() === "total";
    block.rows.forEach((rowValues, index) => {
      const isTotalRow = hasTotal && index === block.rows.length - 1;
      const row = sheet.addRow(rowValues);
      row.font = { name: BRAND_FONT, color: ink, bold: isTotalRow };
      row.eachCell((cell, columnNumber) => { cell.border = isTotalRow ? inkRule : hairline; if (columnNumber > 1) cell.alignment = { horizontal: "right" }; });
    });
    sheet.columns = block.header.map(() => ({ width: 22 }));
    brandSheet(sheet, block.header.length + 1);
  }

  if (draft.chart?.points.length) {
    const chartSheet = workbook.addWorksheet("Chart data");
    chartSheet.addRow([draft.chart.title]).font = { bold: true, name: BRAND_FONT, color: ink };
    const header = chartSheet.addRow([draft.chart.metric, "Value"]);
    header.font = { bold: true, name: BRAND_FONT, color: ink };
    header.eachCell((cell) => { cell.border = inkRule; });
    for (const point of draft.chart.points) {
      const row = chartSheet.addRow([point.x, point.y]);
      row.font = { name: BRAND_FONT, color: ink };
      row.eachCell((cell) => { cell.border = hairline; });
    }
    chartSheet.columns = [{ width: 24 }, { width: 16 }];
    brandSheet(chartSheet, 3);
  }

  const detail = workbook.addWorksheet("Draft text");
  for (const block of blocks) {
    if (block.type === "heading") detail.addRow([block.text]).font = { bold: true, size: block.level === 1 ? 13 : 11, name: BRAND_FONT, color: ink };
    else if (block.type === "paragraph") { const caption = isCaptionText(block.text); detail.addRow([block.text]).font = { name: BRAND_FONT, color: caption ? meta : ink, italic: caption, size: caption ? 9 : 11 }; }
    else if (block.type === "bullets") block.items.forEach((item) => detail.addRow([`• ${item}`]).font = { name: BRAND_FONT, color: ink });
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
  const [logoBytes, preparedFor] = await Promise.all([loadLogoBytes(), loadPreparedFor()]);
  const logoData = `data:image/png;base64,${bytesToBase64(logoBytes)}`;
  const marginX = 54;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  const logoHeight = 16;
  const logoWidth = logoHeight * LOGO_ASPECT;
  let y = 60;

  const ink = `#${COLOR.ink}`, muted = `#${COLOR.muted}`, meta = `#${COLOR.meta}`, hairline = `#${COLOR.hairline}`, positive = `#${COLOR.positive}`;

  const paintLetterhead = () => {
    // alias + compression: without both, jsPDF embeds the source PNG (a large,
    // high-res brand asset) as a fresh uncompressed raster on every page, which
    // is what was ballooning a two-page report to several megabytes.
    doc.addImage(logoData, "PNG", pageWidth - marginX - logoWidth, 28, logoWidth, logoHeight, "aval-logo", "MEDIUM");
    doc.setDrawColor(hairline);
    doc.line(marginX, 52, pageWidth - marginX, 52);
  };
  const paintFooter = () => {
    doc.setFont(BRAND_FONT, "normal");
    doc.setFontSize(TYPE.micro);
    doc.setTextColor(muted);
    doc.text(FOOTER_LEFT, marginX, pageHeight - 30);
    doc.text(FOOTER_RIGHT, pageWidth - marginX, pageHeight - 30, { align: "right" });
    doc.setTextColor(ink);
  };
  const addPage = () => { paintFooter(); doc.addPage(); y = 60; paintLetterhead(); };
  paintLetterhead();

  const ensureRoom = (height: number) => { if (y + height > pageHeight - 56) addPage(); };
  // Advances y by the line's own height before drawing, then draws at that new
  // baseline: jsPDF positions text BY its baseline, so a line's height has to
  // account for its own ascent before it's placed, not the previous (possibly
  // much smaller) line's height, or a big line right after a small one (the
  // eyebrow into the title, for one) draws with its top overlapping the line above it.
  const writeLines = (text: string, size: number, opts: { bold?: boolean; italic?: boolean; color?: string; gapAfter?: number; lineHeight?: number } = {}) => {
    doc.setFont(BRAND_FONT, opts.bold ? "bold" : opts.italic ? "italic" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(opts.color ?? ink);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    const lineHeight = opts.lineHeight ?? size * 1.3;
    for (const line of lines) { ensureRoom(lineHeight); y += lineHeight; doc.text(line, marginX, y); }
    y += opts.gapAfter ?? 0;
    doc.setTextColor(ink);
  };

  writeLines(`ASK AVAL · ${(draft.documentType ?? "Draft").toUpperCase()}`, TYPE.micro, { color: meta, gapAfter: 6 });
  writeLines(draft.title, TYPE.title, { bold: true, gapAfter: draft.standfirst ? 6 : 10 });
  if (draft.standfirst) writeLines(draft.standfirst, TYPE.standfirst, { color: muted, gapAfter: 12 });

  const metaFields: [string, string][] = [];
  if (preparedFor) metaFields.push(["Prepared for", preparedFor]);
  metaFields.push(["Source", DATA_SOURCE_LABEL]);
  metaFields.push(["Status", draft.sentTo ? `Sent to ${draft.sentTo}` : "Draft"]);
  ensureRoom(20);
  let metaX = marginX;
  doc.setFontSize(9);
  for (const [label, value] of metaFields) {
    doc.setFont(BRAND_FONT, "normal");
    doc.setTextColor(meta);
    doc.text(`${label}  `, metaX, y);
    metaX += doc.getTextWidth(`${label}  `);
    doc.setFont(BRAND_FONT, "bold");
    doc.setTextColor(ink);
    doc.text(value, metaX, y);
    metaX += doc.getTextWidth(value) + 24;
  }
  y += 14;
  doc.setDrawColor(hairline);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 24;

  if (draft.metrics?.length) {
    ensureRoom(70);
    const tileGap = 10;
    const tileWidth = (maxWidth - tileGap * (draft.metrics.length - 1)) / draft.metrics.length;
    const tileHeight = 62;
    doc.setDrawColor(hairline);
    doc.setLineWidth(0.75);
    draft.metrics.forEach((metric, index) => {
      const x = marginX + index * (tileWidth + tileGap);
      doc.roundedRect(x, y, tileWidth, tileHeight, 6, 6, "S");
      doc.setFont(BRAND_FONT, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(meta);
      doc.text(metric.label, x + 10, y + 18, { maxWidth: tileWidth - 20 });
      doc.setFont(BRAND_FONT, "bold");
      doc.setFontSize(TYPE.metricValue);
      doc.setTextColor(ink);
      doc.text(formatMetricValue(metric), x + 10, y + 40);
      if (metric.delta !== undefined) {
        doc.setFont(BRAND_FONT, "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(isFavorableDelta(metric.label, metric.delta) ? positive : muted);
        doc.text(formatDelta(metric.delta), x + 10, y + 54);
      }
    });
    y += tileHeight + 26;
    doc.setTextColor(ink);
  }

  for (const block of parseMarkdownDocument(draft.document)) {
    if (block.type === "heading") writeLines(block.text, TYPE.heading, { bold: true, gapAfter: 10 });
    else if (block.type === "paragraph") {
      const caption = isCaptionText(block.text);
      writeLines(block.text, caption ? TYPE.micro : TYPE.body, { color: caption ? meta : ink, italic: caption, gapAfter: caption ? 12 : 10, lineHeight: caption ? TYPE.micro + 3 : (TYPE.body * 1.62) });
    } else if (block.type === "bullets") {
      block.items.forEach((item) => writeLines(`•  ${item}`, TYPE.body, { gapAfter: 4 }));
    } else if (block.type === "table") {
      ensureRoom(30);
      const lastRow = block.rows[block.rows.length - 1];
      const hasTotal = lastRow && lastRow[0]?.trim().toLowerCase() === "total";
      const colWidth = maxWidth / block.header.length;
      const rowHeight = 18;
      doc.setFont(BRAND_FONT, "bold");
      doc.setFontSize(TYPE.body);
      doc.setTextColor(ink);
      block.header.forEach((cell, columnIndex) => {
        const x = marginX + columnIndex * colWidth;
        if (columnIndex === 0) doc.text(cell, x, y);
        else doc.text(cell, x + colWidth, y, { align: "right" });
      });
      y += 6;
      doc.setDrawColor(ink);
      doc.setLineWidth(1);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += rowHeight - 8;
      block.rows.forEach((row, rowIndex) => {
        ensureRoom(rowHeight);
        const isTotalRow = hasTotal && rowIndex === block.rows.length - 1;
        if (isTotalRow) { doc.setDrawColor(ink); doc.setLineWidth(1); doc.line(marginX, y - 12, pageWidth - marginX, y - 12); }
        doc.setFont(BRAND_FONT, isTotalRow ? "bold" : "normal");
        doc.setFontSize(TYPE.body);
        row.forEach((cell, columnIndex) => {
          const x = marginX + columnIndex * colWidth;
          if (columnIndex === 0) doc.text(cell, x, y);
          else doc.text(cell, x + colWidth, y, { align: "right" });
        });
        if (!isTotalRow) {
          doc.setDrawColor(hairline);
          doc.setLineWidth(0.5);
          doc.line(marginX, y + 6, pageWidth - marginX, y + 6);
        }
        y += rowHeight;
      });
      y += 8;
      doc.setTextColor(ink);
    }
  }

  if (draft.chart?.points.length) {
    ensureRoom(220);
    y += 6;
    const canvas = renderChartCanvas(draft.chart);
    const chartWidth = maxWidth;
    const chartHeight = chartWidth * (canvas.height / canvas.width);
    // JPEG, not PNG: jsPDF re-encodes canvas PNGs without the source's own
    // compression, which balloons a simple line chart to several megabytes.
    // The chart is flat color on a white background, so JPEG's quality loss
    // is invisible while the embedded stream stays under a few hundred KB.
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", marginX, y, chartWidth, chartHeight);
    y += chartHeight + 8;
    writeLines(`Figure: ${draft.chart.title}`, TYPE.micro, { color: meta, italic: true, gapAfter: 10 });
  }

  ensureRoom(20);
  y += 6;
  doc.setFont(BRAND_FONT, "italic");
  doc.setFontSize(9);
  doc.setTextColor(muted);
  doc.text(SIGNATURE_LABEL, marginX, y);
  paintFooter();

  doc.save(`${slugify(draft.title)}.pdf`);
}
