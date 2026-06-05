import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";

// Everything the PDF needs. The server action fills this from the shipment's
// extracted_data after checking the required fields are present.
export type CommercialInvoiceData = {
  invoiceNumber: string;
  invoiceDate: string;
  seller: { name: string; address: string; iec: string };
  buyer: { name: string; address: string };
  destinationCountry: string;
  incoterm: string;
  currency: string;
  hsCode: string;
  productDescription: string;
  quantity: string;
  unit: string;
  totalAmount: string;
};

// A4 in points (72 pt = 1 inch). pdf-lib's origin is the BOTTOM-left corner,
// so y starts high and we subtract as we move down the page.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);

// The standard PDF font only speaks WinAnsi (Latin-1 / CP1252). Real PO data is
// full of Unicode it can't render — smart quotes, dashes, box-drawing chars from
// copied tables — so map the common ones to plain equivalents and drop the rest.
// Latin-1 accents (ü, é, ñ…) are kept, which covers the EU/CBAM wedge.
const PUNCT_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
  "…": "...", " ": " ", " ": " ", " ": " ",
  "•": "-", "·": "-", "│": "|", "─": "-", "┃": "|",
};

function toWinAnsi(s: string): string {
  if (!s) return "";
  let out = "";
  for (const ch of s) {
    if (PUNCT_MAP[ch]) {
      out += PUNCT_MAP[ch];
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a) out += " ";          // tabs/newlines → space
    else if (code >= 0x20 && code <= 0x7e) out += ch;        // printable ASCII
    else if (code >= 0xa0 && code <= 0xff) out += ch;        // Latin-1 (accents)
    // anything else the font can't render is dropped
  }
  return out;
}

export async function buildCommercialInvoicePdf(
  data: CommercialInvoiceData
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_H - MARGIN;

  // --- small drawing helpers -------------------------------------------------
  const draw = (s: string, x: number, yy: number, size = 10, f = font, color = INK) =>
    page.drawText(toWinAnsi(s), { x, y: yy, size, font: f, color });

  const drawRight = (s: string, xRight: number, yy: number, size = 10, f = font, color = INK) => {
    const t = toWinAnsi(s);
    draw(t, xRight - f.widthOfTextAtSize(t, size), yy, size, f, color);
  };

  const rule = (yy: number) =>
    page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: RIGHT, y: yy }, thickness: 0.75, color: LINE });

  // Wrap text to a max width, returning the lines.
  const wrap = (s: string, f: PDFFont, size: number, maxWidth: number): string[] => {
    const words = toWinAnsi(s).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  // Draw a labelled block (e.g. "EXPORTER" + name + wrapped address). Returns
  // the y position after the block so the next block stacks below it.
  const block = (label: string, name: string, address: string, yy: number): number => {
    draw(label, MARGIN, yy, 8, bold, GREY);
    yy -= 14;
    draw(name, MARGIN, yy, 11, bold);
    yy -= 14;
    for (const ln of wrap(address, font, 9, 250)) {
      draw(ln, MARGIN, yy, 9, font, GREY);
      yy -= 12;
    }
    return yy;
  };

  // --- header ---------------------------------------------------------------
  draw("COMMERCIAL INVOICE", MARGIN, y, 18, bold);
  drawRight(`Invoice No.  ${data.invoiceNumber}`, RIGHT, y, 10, bold);
  drawRight(`Date  ${data.invoiceDate}`, RIGHT, y - 14, 9, font, GREY);
  y -= 30;
  rule(y);
  y -= 24;

  // --- exporter / consignee -------------------------------------------------
  let yLeft = block("EXPORTER", data.seller.name, data.seller.address, y);
  if (data.seller.iec) {
    draw(`IEC: ${data.seller.iec}`, MARGIN, yLeft, 9, font, GREY);
    yLeft -= 12;
  }
  yLeft -= 10;
  yLeft = block("CONSIGNEE (BUYER)", data.buyer.name, data.buyer.address, yLeft);

  y = yLeft - 16;
  rule(y);
  y -= 20;

  // --- shipment terms -------------------------------------------------------
  draw("DESTINATION", MARGIN, y, 8, bold, GREY);
  draw(data.destinationCountry || "—", MARGIN, y - 14, 10, font);
  draw("INCOTERM", MARGIN + 180, y, 8, bold, GREY);
  draw(data.incoterm || "—", MARGIN + 180, y - 14, 10, font);
  draw("CURRENCY", MARGIN + 320, y, 8, bold, GREY);
  draw(data.currency || "—", MARGIN + 320, y - 14, 10, font);
  y -= 40;

  // --- line-item table ------------------------------------------------------
  const COL_DESC = MARGIN;
  const COL_HS = 300;
  const COL_QTY = 380;
  const COL_AMT_RIGHT = RIGHT; // amount column is right-aligned

  draw("DESCRIPTION OF GOODS", COL_DESC, y, 8, bold, GREY);
  draw("HS CODE", COL_HS, y, 8, bold, GREY);
  draw("QTY", COL_QTY, y, 8, bold, GREY);
  drawRight("AMOUNT", COL_AMT_RIGHT, y, 8, bold, GREY);
  y -= 8;
  rule(y);
  y -= 18;

  const descLines = wrap(data.productDescription, font, 10, COL_HS - COL_DESC - 12);
  draw(descLines[0] ?? "—", COL_DESC, y, 10, font);
  draw(data.hsCode || "—", COL_HS, y, 10, font);
  draw(`${data.quantity} ${data.unit}`.trim(), COL_QTY, y, 10, font);
  drawRight(`${data.currency} ${data.totalAmount}`.trim(), COL_AMT_RIGHT, y, 10, font);
  // overflow lines of the description, if any
  for (let i = 1; i < descLines.length; i++) {
    y -= 12;
    draw(descLines[i], COL_DESC, y, 10, font);
  }
  y -= 16;
  rule(y);
  y -= 22;

  // --- total ----------------------------------------------------------------
  drawRight("TOTAL", COL_QTY + 30, y, 9, bold, GREY);
  drawRight(`${data.currency} ${data.totalAmount}`.trim(), COL_AMT_RIGHT, y, 12, bold);

  // --- declaration + footer (anchored near the bottom) ----------------------
  let yFoot = MARGIN + 60;
  rule(yFoot + 18);
  for (const ln of wrap(
    "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
    font,
    8,
    RIGHT - MARGIN
  )) {
    draw(ln, MARGIN, yFoot, 8, font, GREY);
    yFoot -= 11;
  }
  drawRight("Generated by Qra", RIGHT, MARGIN + 60, 8, font, GREY);
  drawRight("Signature: ____________________", RIGHT, MARGIN + 30, 9, font, GREY);

  return pdf.save();
}
