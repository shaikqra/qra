import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { toWinAnsi } from "./text";

// The Shipping Bill data sheet: every field the CHA needs to file the shipping
// bill on ICEGATE, pre-validated and in one place. Qra never files — this is
// preparation data for the licensed broker, and says so on its face.
export type ShippingBillPackData = {
  reference: string;
  date: string;
  invoiceRef: string;
  exporter: {
    name: string;
    address: string;
    iec: string;
    gstin: string;
    adCode?: string;
  };
  buyer: { name: string; address: string };
  consignee?: string;
  notifyParty?: string;
  destinationCountry: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  incoterm: string;
  hsCode: string;
  productDescription: string;
  quantity: string;
  quantityUnit: string;
  numberOfPackages: string;
  packageType: string;
  netWeight: string;
  grossWeight: string;
  weightUnit: string;
  invoiceValue: string;
  currency: string;
  rodtepIntent: boolean;
  hsCodeDrafted?: boolean;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);

export async function buildShippingBillPackPdf(
  data: ShippingBillPackData
): Promise<Uint8Array> {
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

  // Start a fresh page when running low — long addresses/descriptions must
  // never draw over the footer on a filing document.
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 80) {
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
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  // A labelled row: grey label on the left, value (or a fill-in line) right of it.
  const row = (label: string, value: string) => {
    const v = value.trim() || "____________________";
    const lines = wrap(v, font, 10, RIGHT - MARGIN - 170);
    ensure(lines.length * 12 + 8);
    draw(label.toUpperCase(), MARGIN, y, 8, bold, GREY);
    let yy = y;
    for (const ln of lines) {
      draw(ln, MARGIN + 170, yy, 10, font);
      yy -= 12;
    }
    y = Math.min(y - 16, yy - 4);
  };

  const section = (titleText: string) => {
    ensure(50);
    y -= 6;
    rule(y + 14);
    draw(titleText.toUpperCase(), MARGIN, y, 9, bold, GREY);
    y -= 18;
  };

  // --- header ---------------------------------------------------------------
  draw("SHIPPING BILL DATA SHEET", MARGIN, y, 18, bold);
  drawRight(`Ref.  ${data.reference}`, RIGHT, y, 10, bold);
  drawRight(`Date  ${data.date}`, RIGHT, y - 14, 9, font, GREY);
  y -= 20;
  draw("PREPARATION DATA FOR THE CHA — NOT A SHIPPING BILL. CHA verifies and files on ICEGATE.", MARGIN, y, 9, bold, GREY);
  y -= 14;
  rule(y);
  y -= 22;

  // --- exporter ---------------------------------------------------------------
  section("Exporter");
  row("Legal name", data.exporter.name);
  row("Address", data.exporter.address);
  row("IEC", data.exporter.iec);
  row("GSTIN", data.exporter.gstin);
  row("AD code", data.exporter.adCode ?? "");

  // --- parties ----------------------------------------------------------------
  section("Buyer & parties");
  row("Buyer", `${data.buyer.name} — ${data.buyer.address}`.trim());
  row("Consignee", data.consignee ?? "");
  row("Notify party", data.notifyParty ?? "");

  // --- shipment ---------------------------------------------------------------
  section("Shipment");
  row("Invoice no.", data.invoiceRef);
  row("Destination country", data.destinationCountry);
  row("Port of loading", data.portOfLoading ?? "");
  row("Port of discharge", data.portOfDischarge ?? "");
  row("Incoterm", data.incoterm);

  // --- goods ------------------------------------------------------------------
  section("Goods");
  row("HS code", data.hsCodeDrafted ? `${data.hsCode}  (Qra draft — CHA to confirm)` : data.hsCode);
  row("Description", data.productDescription);
  row("Quantity", `${data.quantity} ${data.quantityUnit}`.trim());
  row("Packages", `${data.numberOfPackages} ${data.packageType}`.trim());
  row("Net weight", `${data.netWeight} ${data.weightUnit}`.trim());
  row("Gross weight", `${data.grossWeight} ${data.weightUnit}`.trim());
  row("Invoice value", `${data.currency} ${data.invoiceValue}`.trim());

  // --- schemes ----------------------------------------------------------------
  section("Scheme intents");
  // RoDTEP rates are HS-line-specific, so when the HS itself is a Qra draft the
  // claim can't be asserted as a flat YES — bind it to the CHA confirming the code.
  row(
    "RoDTEP",
    !data.rodtepIntent
      ? "Not indicated"
      : data.hsCodeDrafted
        ? "Exporter intends to claim RoDTEP. Rate is HS-specific and the HS code above is a Qra draft — CHA to confirm the code and the applicable RoDTEP rate/eligibility before filing."
        : "YES — exporter intends to claim RoDTEP"
  );
  row("Drawback", "");

  // --- footer -----------------------------------------------------------------
  rule(MARGIN + 58);
  draw(
    "Blank lines are for the CHA to complete or confirm. All values trace to the approved document set.",
    MARGIN,
    MARGIN + 42,
    8,
    font,
    GREY
  );
  drawRight("Prepared by Qra — draft data for the licensed broker", RIGHT, MARGIN + 42, 8, font, GREY);

  return pdf.save();
}
