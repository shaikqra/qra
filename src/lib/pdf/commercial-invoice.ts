import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import { toWinAnsi } from "./text";

export type Party = { name: string; address: string };

export type CommercialInvoiceData = {
  invoiceNumber: string;
  invoiceDate: string;
  contractRef?: string;

  seller: {
    name: string;
    address: string;
    factoryAddress?: string;
    iec?: string;
    gstin?: string;
    cin?: string;
    organicCode?: string;
  };
  buyer: Party; // consignee
  soldTo?: Party;
  notify?: Party;

  destinationCountry: string;
  incoterm: string;
  currency: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  vessel?: string;
  containerNo?: string;
  sealNo?: string;

  hsCode: string;
  productDescription: string;
  quantity: string;
  unit: string;
  totalAmount: string;
  batchCode?: string;
  lotCode?: string;
  netWeight?: string;
  grossWeight?: string;
  numberOfPackages?: string;

  bank?: {
    name?: string;
    branch?: string;
    swift?: string;
    account?: string;
    beneficiary?: string;
  };
  declarations?: { lut?: string; rodtep?: string; origin?: string };
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);

// --- amount in words -------------------------------------------------------
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigits(n: number): string {
  let s = "";
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) s += " ";
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)];
    n %= 10;
    if (n) s += ` ${ONES[n]}`;
  } else if (n > 0) {
    s += ONES[n];
  }
  return s;
}

function amountToWords(amountStr: string, currency: string): string {
  const n = Math.floor(parseFloat(String(amountStr).replace(/[^0-9.]/g, "")) || 0);
  if (!n) return "";
  const scales: [string, number][] = [["Billion", 1e9], ["Million", 1e6], ["Thousand", 1e3]];
  let rem = n;
  const parts: string[] = [];
  for (const [name, val] of scales) {
    if (rem >= val) {
      parts.push(`${threeDigits(Math.floor(rem / val))} ${name}`);
      rem %= val;
    }
  }
  if (rem > 0) parts.push(threeDigits(rem));
  return `${currency} ${parts.join(" ")} Only`.replace(/\s+/g, " ").trim();
}

export async function buildCommercialInvoicePdf(data: CommercialInvoiceData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const state = { page: pdf.addPage([PAGE_W, PAGE_H]) as PDFPage };
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    state.page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const ensure = (need: number) => {
    if (y - need < MARGIN + 18) newPage();
  };

  const text = (s: string, x: number, yy: number, size = 10, f = font, color = INK) =>
    state.page.drawText(toWinAnsi(s), { x, y: yy, size, font: f, color });
  const textRight = (s: string, xRight: number, yy: number, size = 10, f = font, color = INK) => {
    const t = toWinAnsi(s);
    text(t, xRight - f.widthOfTextAtSize(t, size), yy, size, f, color);
  };
  const rule = (yy: number) =>
    state.page.drawLine({ start: { x: MARGIN, y: yy }, end: { x: RIGHT, y: yy }, thickness: 0.75, color: LINE });

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

  // A flowing paragraph: wraps, advances y, breaks to a new page if needed.
  const para = (s: string, x: number, maxW: number, size = 9, f = font, color = GREY, lh = 11) => {
    for (const ln of wrap(s, f, size, maxW)) {
      ensure(lh);
      text(ln, x, y, size, f, color);
      y -= lh;
    }
  };

  // A party block drawn at a fixed (x, startY); returns the y where it ends.
  const partyBlock = (label: string, p: Party, x: number, startY: number, width: number, extra: string[] = []): number => {
    let by = startY;
    text(label, x, by, 8, bold, GREY);
    by -= 13;
    for (const ln of wrap(p.name, bold, 10, width)) {
      text(ln, x, by, 10, bold);
      by -= 13;
    }
    for (const ln of wrap(p.address, font, 9, width)) {
      text(ln, x, by, 9, font, GREY);
      by -= 11;
    }
    for (const e of extra.filter(Boolean)) {
      for (const ln of wrap(e, font, 8, width)) {
        text(ln, x, by, 8, font, GREY);
        by -= 10;
      }
    }
    return by;
  };

  // --- header ---------------------------------------------------------------
  text("COMMERCIAL INVOICE", MARGIN, y, 18, bold);
  textRight(`Invoice No.  ${data.invoiceNumber}`, RIGHT, y, 10, bold);
  textRight(`Date  ${data.invoiceDate}`, RIGHT, y - 14, 9, font, GREY);
  if (data.contractRef) textRight(`Contract  ${data.contractRef}`, RIGHT, y - 26, 8, font, GREY);
  y -= 32;
  rule(y);
  y -= 22;

  // --- parties (two columns) ------------------------------------------------
  const COL_R = 310;
  const W_L = 240;
  const W_R = 235;
  const identity = [
    data.seller.iec ? `IEC: ${data.seller.iec}` : "",
    data.seller.gstin ? `GSTIN: ${data.seller.gstin}` : "",
    data.seller.cin ? `CIN: ${data.seller.cin}` : "",
    data.seller.organicCode ? `Organic: ${data.seller.organicCode}` : "",
  ].filter(Boolean);

  ensure(140);
  const leftEnd = partyBlock("EXPORTER", { name: data.seller.name, address: data.seller.address }, MARGIN, y, W_L, identity);
  const rightEnd = partyBlock("CONSIGNEE (BUYER)", data.buyer, COL_R, y, W_R);
  y = Math.min(leftEnd, rightEnd) - 6;

  if (data.soldTo || data.notify) {
    ensure(90);
    const lE = data.soldTo ? partyBlock("SOLD TO", data.soldTo, MARGIN, y, W_L) : y;
    const rE = data.notify ? partyBlock("NOTIFY PARTY", data.notify, COL_R, y, W_R) : y;
    y = Math.min(lE, rE) - 6;
  }
  if (data.seller.factoryAddress) {
    ensure(40);
    text("FACTORY", MARGIN, y, 8, bold, GREY);
    y -= 12;
    para(data.seller.factoryAddress, MARGIN, RIGHT - MARGIN, 8, font, GREY, 10);
  }
  y -= 6;
  rule(y);
  y -= 18;

  // --- shipment terms (grid) ------------------------------------------------
  const cell = (label: string, value: string, x: number) => {
    text(label, x, y, 8, bold, GREY);
    text(value || "-", x, y - 13, 10, font);
  };
  const C1 = MARGIN, C2 = MARGIN + 180, C3 = MARGIN + 330;
  ensure(30);
  cell("DESTINATION", data.destinationCountry, C1);
  cell("INCOTERM", data.incoterm, C2);
  cell("CURRENCY", data.currency, C3);
  y -= 30;
  if (data.portOfLoading || data.portOfDischarge || data.vessel) {
    ensure(30);
    cell("PORT OF LOADING", data.portOfLoading ?? "", C1);
    cell("PORT OF DISCHARGE", data.portOfDischarge ?? "", C2);
    cell("VESSEL", data.vessel ?? "", C3);
    y -= 30;
  }
  if (data.containerNo || data.sealNo) {
    ensure(30);
    cell("CONTAINER NO", data.containerNo ?? "", C1);
    cell("SEAL NO", data.sealNo ?? "", C2);
    y -= 30;
  }
  y -= 2;

  // --- line-item table ------------------------------------------------------
  const COL_DESC = MARGIN, COL_HS = 300, COL_QTY = 380;
  ensure(60);
  text("DESCRIPTION OF GOODS", COL_DESC, y, 8, bold, GREY);
  text("HS CODE", COL_HS, y, 8, bold, GREY);
  text("QTY", COL_QTY, y, 8, bold, GREY);
  textRight("AMOUNT", RIGHT, y, 8, bold, GREY);
  y -= 8;
  rule(y);
  y -= 16;

  const descLines = wrap(data.productDescription, font, 10, COL_HS - COL_DESC - 12);
  text(descLines[0] ?? "-", COL_DESC, y, 10, font);
  text(data.hsCode || "-", COL_HS, y, 10, font);
  text(`${data.quantity} ${data.unit}`.trim(), COL_QTY, y, 10, font);
  textRight(`${data.currency} ${data.totalAmount}`.trim(), RIGHT, y, 10, font);
  for (let i = 1; i < descLines.length; i++) {
    y -= 12;
    text(descLines[i], COL_DESC, y, 10, font);
  }
  const codes = [
    data.batchCode ? `Batch: ${data.batchCode}` : "",
    data.lotCode ? `Lot: ${data.lotCode}` : "",
  ].filter(Boolean).join("   ");
  if (codes) {
    y -= 12;
    text(codes, COL_DESC, y, 8, font, GREY);
  }
  const weights = [
    data.netWeight ? `Net ${data.netWeight}` : "",
    data.grossWeight ? `Gross ${data.grossWeight}` : "",
    data.numberOfPackages ? `${data.numberOfPackages} packages` : "",
  ].filter(Boolean).join("   ");
  if (weights) {
    y -= 12;
    text(weights, COL_DESC, y, 8, font, GREY);
  }
  y -= 14;
  rule(y);
  y -= 20;

  // --- total + amount in words ----------------------------------------------
  ensure(36);
  textRight("TOTAL", COL_QTY + 30, y, 9, bold, GREY);
  textRight(`${data.currency} ${data.totalAmount}`.trim(), RIGHT, y, 12, bold);
  y -= 14;
  const words = amountToWords(data.totalAmount, data.currency);
  if (words) {
    para(words, MARGIN, RIGHT - MARGIN, 9, font, GREY, 11);
  }
  y -= 4;

  // --- declarations ---------------------------------------------------------
  const decl: [string, string | undefined][] = [
    ["Statement on Origin", data.declarations?.origin],
    ["Declaration — LUT", data.declarations?.lut],
    ["Declaration — RoDTEP", data.declarations?.rodtep],
  ];
  for (const [label, body] of decl) {
    if (!body) continue;
    ensure(28);
    rule(y);
    y -= 12;
    text(label, MARGIN, y, 8, bold, GREY);
    y -= 11;
    para(body, MARGIN, RIGHT - MARGIN, 8, font, GREY, 9.5);
    y -= 3;
  }

  // --- bank -----------------------------------------------------------------
  if (data.bank && (data.bank.name || data.bank.account)) {
    ensure(60);
    rule(y);
    y -= 14;
    text("BANK DETAILS", MARGIN, y, 8, bold, GREY);
    y -= 12;
    const bankLines = [
      [data.bank.name, data.bank.branch].filter(Boolean).join(", "),
      [data.bank.swift ? `SWIFT: ${data.bank.swift}` : "", data.bank.account ? `A/C: ${data.bank.account}` : ""]
        .filter(Boolean).join("   "),
      data.bank.beneficiary ? `Beneficiary: ${data.bank.beneficiary}` : "",
    ].filter(Boolean);
    for (const ln of bankLines) {
      ensure(11);
      text(ln, MARGIN, y, 9, font, GREY);
      y -= 11;
    }
  }

  // --- signature ------------------------------------------------------------
  ensure(38);
  y -= 8;
  textRight(`For ${data.seller.name}`, RIGHT, y, 9, bold);
  y -= 22;
  textRight("Authorised Signatory", RIGHT, y, 9, font, GREY);
  text("Generated by Qra", MARGIN, y, 8, font, GREY);

  return pdf.save();
}
