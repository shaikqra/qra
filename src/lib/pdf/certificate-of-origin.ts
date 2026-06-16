import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { toWinAnsi } from "./text";

// A Certificate of Origin states the country where the goods were produced.
// Qra produces a DRAFT — the exporter still has it certified by the issuing
// authority (Chamber of Commerce / DGFT eCoO). It carries no prices.
export type CertificateOfOriginData = {
  reference: string;
  date: string;
  seller: { name: string; address: string; iec: string };
  buyer: { name: string; address: string };
  countryOfOrigin: string;
  destinationCountry: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  vessel?: string;
  hsCode: string;
  hsCodeDrafted?: boolean;
  productDescription: string;
  quantity: string;
  quantityUnit: string;
  numberOfPackages: string;
  packageType: string;
  grossWeight?: string;
  weightUnit?: string;
  invoiceRef?: string;
  originDeclaration?: string;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);

export async function buildCertificateOfOriginPdf(
  data: CertificateOfOriginData
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_H - MARGIN;

  const draw = (s: string, x: number, yy: number, size = 10, f = font, color = INK) =>
    page.drawText(toWinAnsi(s), { x, y: yy, size, font: f, color });

  const drawRight = (s: string, xRight: number, yy: number, size = 10, f = font, color = INK) => {
    const t = toWinAnsi(s);
    draw(t, xRight - f.widthOfTextAtSize(t, size), yy, size, f, color);
  };

  const rule = (yy: number) =>
    page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: RIGHT, y: yy }, thickness: 0.75, color: LINE });

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
  draw("CERTIFICATE OF ORIGIN", MARGIN, y, 18, bold);
  drawRight(`Ref.  ${data.reference}`, RIGHT, y, 10, bold);
  drawRight(`Date  ${data.date}`, RIGHT, y - 14, 9, font, GREY);
  y -= 34;
  draw("NON-PREFERENTIAL DRAFT — NOT AN OFFICIAL CERTIFICATE", MARGIN, y, 9, bold, GREY);
  if (data.invoiceRef) {
    drawRight(`Invoice  ${data.invoiceRef}`, RIGHT, y, 9, font, GREY);
  }
  y -= 16;
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

  // --- origin / destination -------------------------------------------------
  draw("COUNTRY OF ORIGIN", MARGIN, y, 8, bold, GREY);
  draw(data.countryOfOrigin || "—", MARGIN, y - 14, 11, bold);
  draw("COUNTRY OF DESTINATION", MARGIN + 240, y, 8, bold, GREY);
  draw(data.destinationCountry || "—", MARGIN + 240, y - 14, 11, font);
  y -= 38;

  // --- transport (optional) -------------------------------------------------
  const transport = [
    data.portOfLoading && `From ${data.portOfLoading}`,
    data.portOfDischarge && `to ${data.portOfDischarge}`,
    data.vessel && `via ${data.vessel}`,
  ]
    .filter(Boolean)
    .join(" ");
  if (transport) {
    draw("TRANSPORT", MARGIN, y, 8, bold, GREY);
    draw(transport, MARGIN, y - 14, 10, font);
    y -= 38;
  }

  rule(y);
  y -= 20;

  // --- goods table ----------------------------------------------------------
  const COL_DESC = MARGIN;
  const COL_HS = 290;
  const COL_PKG = 380;
  const QTY_RIGHT = RIGHT;

  draw("DESCRIPTION OF GOODS", COL_DESC, y, 8, bold, GREY);
  draw("HS CODE", COL_HS, y, 8, bold, GREY);
  draw("PACKAGES", COL_PKG, y, 8, bold, GREY);
  drawRight("QUANTITY", QTY_RIGHT, y, 8, bold, GREY);
  y -= 8;
  rule(y);
  y -= 18;

  const packages = `${data.numberOfPackages} ${data.packageType}`.trim();
  const qty = `${data.quantity} ${data.quantityUnit}`.trim();

  const descLines = wrap(data.productDescription, font, 10, COL_HS - COL_DESC - 12);
  draw(descLines[0] ?? "—", COL_DESC, y, 10, font);
  draw(data.hsCode || "—", COL_HS, y, 10, font);
  draw(packages || "—", COL_PKG, y, 10, font);
  drawRight(qty || "—", QTY_RIGHT, y, 10, font);
  for (let i = 1; i < descLines.length; i++) {
    y -= 12;
    draw(descLines[i], COL_DESC, y, 10, font);
  }
  if (data.grossWeight) {
    y -= 14;
    draw(`Gross weight: ${data.grossWeight} ${data.weightUnit ?? ""}`.trim(), COL_DESC, y, 9, font, GREY);
  }
  if (data.hsCodeDrafted) {
    y -= 14;
    draw("HS code is a Qra draft — to be confirmed by the CHA / issuing authority.", COL_DESC, y, 8, font, GREY);
  }

  y -= 16;
  rule(y);
  y -= 22;

  // --- declaration of origin ------------------------------------------------
  const declaration =
    data.originDeclaration ||
    `We hereby declare that the goods described above are of ${data.countryOfOrigin} origin.`;
  draw("DECLARATION OF ORIGIN", MARGIN, y, 8, bold, GREY);
  y -= 16;
  for (const ln of wrap(declaration, font, 9, RIGHT - MARGIN)) {
    draw(ln, MARGIN, y, 9, font);
    y -= 12;
  }

  // --- certification + footer ----------------------------------------------
  rule(MARGIN + 98);
  draw(
    "DRAFT — to be certified by the issuing authority (Chamber of Commerce / DGFT eCoO).",
    MARGIN,
    MARGIN + 80,
    8,
    bold,
    GREY
  );
  draw(
    "We declare that the particulars given above are true and correct.",
    MARGIN,
    MARGIN + 60,
    8,
    font,
    GREY
  );
  drawRight("Prepared by Qra — draft, not an issuing authority", RIGHT, MARGIN + 60, 8, font, GREY);
  draw("Exporter signature: ____________________", MARGIN, MARGIN + 30, 9, font, GREY);
  drawRight("Certifying authority: ____________________", RIGHT, MARGIN + 30, 9, font, GREY);

  return pdf.save();
}
