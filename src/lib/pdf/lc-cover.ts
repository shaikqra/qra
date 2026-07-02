import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { toWinAnsi } from "./text";

// The LC cover letter: the covering letter the exporter (beneficiary) presents to
// the issuing bank, listing the documents tendered for negotiation/payment under a
// Letter of Credit. A DRAFT — the operator confirms every detail (and the number
// of originals/copies of each document) against the LC before presentation. No
// value is invented: any field the LC check didn't capture renders as a fill-in line.
export type LcCoverData = {
  date: string;
  beneficiary: { name: string; address: string };
  reference: string;
  lcNumber: string;
  issuingBank: string;
  applicant: string;
  amountDrawn: string;
  documents: string[];
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;
const BLANK = "____________________";
const COUNT_BLANK = "____________";

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.8, 0.8, 0.8);

export async function buildLcCoverPdf(data: LcCoverData): Promise<Uint8Array> {
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

  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 70) {
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

  // A paragraph of body text, wrapped to the content width.
  const para = (s: string, size = 10, f: PDFFont = font, gapAfter = 8) => {
    const lines = wrap(s, f, size, RIGHT - MARGIN);
    ensure(lines.length * (size + 4) + gapAfter);
    for (const ln of lines) {
      draw(ln, MARGIN, y, size, f);
      y -= size + 4;
    }
    y -= gapAfter;
  };

  // A labelled row: grey label on the left, value (or a fill-in line) right of it.
  const row = (label: string, value: string) => {
    const v = value.trim() || BLANK;
    const lines = wrap(v, font, 10, RIGHT - MARGIN - 150);
    ensure(lines.length * 12 + 6);
    draw(label.toUpperCase(), MARGIN, y, 8, bold, GREY);
    let yy = y;
    for (const ln of lines) {
      draw(ln, MARGIN + 150, yy, 10, font);
      yy -= 12;
    }
    y = Math.min(y - 14, yy - 2);
  };

  // --- header ---------------------------------------------------------------
  draw("LETTER OF CREDIT — DOCUMENTS PRESENTATION", MARGIN, y, 16, bold);
  drawRight(`Date  ${data.date || BLANK}`, RIGHT, y - 2, 9, font, GREY);
  y -= 18;
  draw("DRAFT — verify against the LC before presentation", MARGIN, y, 9, bold, GREY);
  y -= 14;
  rule(y);
  y -= 22;

  // --- addressing -----------------------------------------------------------
  row("To (issuing bank)", data.issuingBank);
  row("Attn.", "The Manager, Documentary Credits Department");
  row("From (beneficiary)", data.beneficiary.name);
  if (data.beneficiary.address.trim()) row("Address", data.beneficiary.address);
  row("LC / credit no.", data.lcNumber);
  row("Applicant", data.applicant);
  row("Amount drawn", data.amountDrawn);
  row("Shipment reference", data.reference);

  y -= 6;
  rule(y);
  y -= 20;

  // --- request wording ------------------------------------------------------
  para("Dear Sir/Madam,", 10, font, 10);
  para(
    "We present the enclosed documents for negotiation / payment / acceptance (as applicable) under the captioned Letter of Credit. Please find the documents tendered listed below, and kindly negotiate the documents / effect payment and remit the proceeds in accordance with the terms of the credit.",
    10,
    font,
    12
  );

  // --- documents presented --------------------------------------------------
  ensure(40);
  draw("DOCUMENTS PRESENTED", MARGIN, y, 9, bold, GREY);
  drawRight("NO. OF ORIGINALS / COPIES", RIGHT, y, 9, bold, GREY);
  y -= 6;
  rule(y);
  y -= 16;

  const docLine = (label: string) => {
    ensure(18);
    const lines = wrap(label, font, 10, RIGHT - MARGIN - 170);
    for (let i = 0; i < lines.length; i++) {
      draw(`${i === 0 ? "-  " : "   "}${lines[i]}`, MARGIN, y, 10, font);
      if (i === 0) drawRight(COUNT_BLANK, RIGHT, y, 10, font, GREY);
      y -= 14;
    }
    y -= 2;
  };

  if (data.documents.length === 0) {
    // No Qra documents generated yet — leave blank rows for the operator to fill.
    for (let i = 0; i < 4; i++) docLine("");
  } else {
    for (const label of data.documents) docLine(label);
    // Spare rows for third-party documents Qra does not issue (bill of lading,
    // insurance certificate, inspection/analysis certificates) — filled by hand.
    docLine("");
    docLine("");
  }

  y -= 4;
  para(
    "Kindly advise us of any discrepancy on receipt. The number of originals and copies of each document above is to be confirmed against the credit at presentation.",
    9,
    font,
    10
  );
  para(
    "Please remit the net proceeds to our account no. ____________ with ____________ Bank (AD code ____________), and advise us on realisation.",
    9,
    font,
    16
  );

  // --- signature ------------------------------------------------------------
  ensure(70);
  para("Yours faithfully,", 10, font, 6);
  draw(`For  ${data.beneficiary.name || BLANK}`, MARGIN, y, 10, font);
  y -= 40;
  draw("_______________________________", MARGIN, y, 10, font);
  y -= 14;
  draw("Authorised Signatory", MARGIN, y, 8, bold, GREY);

  // --- footer ---------------------------------------------------------------
  rule(MARGIN + 40);
  draw(
    "DRAFT prepared by Qra — verify every detail, and the number of originals/copies, against the LC before presentation.",
    MARGIN,
    MARGIN + 26,
    8,
    font,
    GREY
  );

  return pdf.save();
}
