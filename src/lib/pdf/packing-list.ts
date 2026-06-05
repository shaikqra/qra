import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { toWinAnsi } from "./text";

// A packing list mirrors the invoice's header/parties but carries NO prices —
// it describes packages and weights so customs and the carrier can verify the
// physical shipment.
export type PackingListData = {
  reference: string;
  date: string;
  seller: { name: string; address: string; iec: string };
  buyer: { name: string; address: string };
  destinationCountry: string;
  hsCode: string;
  productDescription: string;
  quantity: string;
  quantityUnit: string;
  numberOfPackages: string;
  packageType: string;
  netWeight: string;
  grossWeight: string;
  weightUnit: string;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);

export async function buildPackingListPdf(data: PackingListData): Promise<Uint8Array> {
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
  draw("PACKING LIST", MARGIN, y, 18, bold);
  drawRight(`Ref.  ${data.reference}`, RIGHT, y, 10, bold);
  drawRight(`Date  ${data.date}`, RIGHT, y - 14, 9, font, GREY);
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

  draw("DESTINATION", MARGIN, y, 8, bold, GREY);
  draw(data.destinationCountry || "—", MARGIN, y - 14, 10, font);
  draw("HS CODE", MARGIN + 200, y, 8, bold, GREY);
  draw(data.hsCode || "—", MARGIN + 200, y - 14, 10, font);
  y -= 40;

  // --- packages / weights table ---------------------------------------------
  const COL_DESC = MARGIN;
  const COL_PKG = 270;
  const NET_RIGHT = 460;
  const GROSS_RIGHT = RIGHT;

  draw("DESCRIPTION OF GOODS", COL_DESC, y, 8, bold, GREY);
  draw("PACKAGES", COL_PKG, y, 8, bold, GREY);
  drawRight("NET WT", NET_RIGHT, y, 8, bold, GREY);
  drawRight("GROSS WT", GROSS_RIGHT, y, 8, bold, GREY);
  y -= 8;
  rule(y);
  y -= 18;

  const packages = `${data.numberOfPackages} ${data.packageType}`.trim();
  const net = `${data.netWeight} ${data.weightUnit}`.trim();
  const gross = `${data.grossWeight} ${data.weightUnit}`.trim();

  const descLines = wrap(data.productDescription, font, 10, COL_PKG - COL_DESC - 12);
  draw(descLines[0] ?? "—", COL_DESC, y, 10, font);
  draw(packages, COL_PKG, y, 10, font);
  drawRight(net, NET_RIGHT, y, 10, font);
  drawRight(gross, GROSS_RIGHT, y, 10, font);
  for (let i = 1; i < descLines.length; i++) {
    y -= 12;
    draw(descLines[i], COL_DESC, y, 10, font);
  }
  // quantity line under the description, for context (qty of product)
  y -= 14;
  draw(`Quantity: ${data.quantity} ${data.quantityUnit}`.trim(), COL_DESC, y, 9, font, GREY);

  y -= 14;
  rule(y);
  y -= 22;

  // --- totals ---------------------------------------------------------------
  draw("TOTAL", COL_DESC, y, 9, bold, GREY);
  draw(packages, COL_PKG, y, 11, bold);
  drawRight(net, NET_RIGHT, y, 11, bold);
  drawRight(gross, GROSS_RIGHT, y, 11, bold);

  // --- footer ---------------------------------------------------------------
  rule(MARGIN + 78);
  draw(
    "We declare that the particulars given above are true and correct.",
    MARGIN,
    MARGIN + 60,
    8,
    font,
    GREY
  );
  drawRight("Generated by Qra", RIGHT, MARGIN + 60, 8, font, GREY);
  drawRight("Signature: ____________________", RIGHT, MARGIN + 30, 9, font, GREY);

  return pdf.save();
}
