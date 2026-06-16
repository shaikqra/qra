import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { toWinAnsi } from "./text";

// Export Declaration / Annexure. Carries the exporter's self-declarations — the
// standard declaration of truth/correctness plus the exporter's own LUT, RoDTEP
// and (for EU) Statement-on-Origin wording from their profile. A DRAFT the
// exporter signs and the CHA files; Qra signs and files nothing.
export type ExportDeclarationData = {
  reference: string;
  date: string;
  invoiceRef: string;
  exporter: { name: string; address: string; iec: string; gstin: string };
  buyer: { name: string; address: string };
  destinationCountry: string;
  countryOfOrigin: string;
  incoterm: string;
  hsCode: string;
  productDescription: string;
  quantity: string;
  quantityUnit: string;
  value: string;
  currency: string;
  declarations: { lut?: string; rodtep?: string; origin?: string };
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);

export async function buildExportDeclarationPdf(data: ExportDeclarationData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = PAGE_H - MARGIN;

  const draw = (s: string, x: number, yy: number, size = 10, f: PDFFont = font, color = INK) =>
    page.drawText(toWinAnsi(s), { x, y: yy, size, font: f, color });
  const drawRight = (s: string, xRight: number, yy: number, size = 10, f: PDFFont = font, color = INK) => {
    const t = toWinAnsi(s);
    draw(t, xRight - f.widthOfTextAtSize(t, size), yy, size, f, color);
  };
  const rule = (yy: number) =>
    page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: RIGHT, y: yy }, thickness: 0.75, color: LINE });

  const newPageIfNeeded = (need: number) => {
    if (y - need < MARGIN + 70) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const wrap = (s: string, f: PDFFont, size: number, maxWidth: number): string[] => {
    const words = toWinAnsi(s).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };

  const para = (s: string, x: number, maxW: number, size = 9, f = font, color = INK, lh = 12) => {
    for (const ln of wrap(s, f, size, maxW)) {
      newPageIfNeeded(lh);
      draw(ln, x, y, size, f, color);
      y -= lh;
    }
  };

  const row = (label: string, value: string) => {
    const v = value.trim() || "—";
    const lines = wrap(v, font, 10, RIGHT - MARGIN - 150);
    newPageIfNeeded(lines.length * 12 + 6);
    draw(label.toUpperCase(), MARGIN, y, 8, bold, GREY);
    let yy = y;
    for (const ln of lines) {
      draw(ln, MARGIN + 150, yy, 10, font);
      yy -= 12;
    }
    y = Math.min(y - 14, yy - 2);
  };

  const section = (titleText: string) => {
    newPageIfNeeded(40);
    y -= 4;
    rule(y + 12);
    draw(titleText.toUpperCase(), MARGIN, y, 9, bold, GREY);
    y -= 16;
  };

  // --- header ----------------------------------------------------------------
  draw("EXPORT DECLARATION / ANNEXURE", MARGIN, y, 17, bold);
  drawRight(`Ref.  ${data.reference}`, RIGHT, y, 10, bold);
  drawRight(`Date  ${data.date}`, RIGHT, y - 14, 9, font, GREY);
  y -= 22;
  draw("DRAFT — for the exporter to sign and the CHA to file. Qra signs and files nothing.", MARGIN, y, 9, bold, GREY);
  y -= 12;
  para(
    "Qra formats this from data you provided; it does not verify HS classification, origin, valuation or scheme " +
      "eligibility. Review the full document set before signing.",
    MARGIN,
    RIGHT - MARGIN,
    8,
    font,
    GREY,
    10
  );
  y -= 4;
  rule(y);
  y -= 18;

  // --- exporter + shipment ---------------------------------------------------
  section("Exporter");
  row("Legal name", data.exporter.name);
  row("Address", data.exporter.address);
  row("IEC", data.exporter.iec);
  row("GSTIN", data.exporter.gstin);

  section("Shipment");
  row("Invoice no.", data.invoiceRef);
  row("Buyer", `${data.buyer.name}${data.buyer.address ? " — " + data.buyer.address : ""}`.trim());
  row("Destination", data.destinationCountry);
  row("Incoterm", data.incoterm);
  row("HS code", data.hsCode);
  row("Goods", data.productDescription);
  row("Quantity", `${data.quantity} ${data.quantityUnit}`.trim());
  row("Invoice value", `${data.currency} ${data.value}`.trim());

  // --- declarations ----------------------------------------------------------
  section("Declarations");
  let n = 1;
  const decl = (text: string) => {
    newPageIfNeeded(28);
    draw(`${n}.`, MARGIN, y, 9, bold);
    para(text, MARGIN + 16, RIGHT - MARGIN - 16, 9, font, INK, 12);
    y -= 4;
    n += 1;
  };

  // Standard declaration of correctness (always). Origin is its OWN clause below,
  // driven by data — never bundled unconditionally into the truth clause.
  decl(
    "We declare that the particulars given in this declaration and in the accompanying documents are true and correct " +
      "in every respect, and that the value declared is the actual transaction value of the goods. We undertake to abide " +
      "by the provisions of the Customs Act, 1962 and the Foreign Trade (Development & Regulation) Act, 1992 and the rules " +
      "made thereunder."
  );
  decl(`The country of origin of the goods is ${data.countryOfOrigin || "India"}.`);
  if (data.declarations.lut) decl(`LUT — ${data.declarations.lut}`);
  if (data.declarations.rodtep) decl(`RoDTEP — ${data.declarations.rodtep}`);
  if (data.declarations.origin) decl(`Statement on Origin — ${data.declarations.origin}`);

  // --- signature -------------------------------------------------------------
  newPageIfNeeded(60);
  y -= 10;
  rule(y);
  y -= 18;
  draw(`For ${data.exporter.name || "the exporter"}`, MARGIN, y, 10, bold);
  drawRight("Place / Date: ____________________", RIGHT, y, 9, font, GREY);
  y -= 26;
  draw("Authorised Signatory: ____________________", MARGIN, y, 9, font, GREY);
  draw("Generated by Qra — draft, exporter signs", MARGIN, MARGIN + 30, 8, font, GREY);

  return pdf.save();
}
