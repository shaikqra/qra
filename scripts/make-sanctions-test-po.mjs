// One-off: builds a COMPLETE purchase order PDF whose buyer is a well-known
// OFAC SDN-listed entity (Rosoboronexport), to test that sanctions screening
// freezes the shipment before any document is generated or sent. All required
// fields are present so gap-fill does not trigger — the flow runs straight to
// the screening gate. Output: Downloads\test-po-sanctions.pdf
// Run: node scripts/make-sanctions-test-po.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const pdf = await PDFDocument.create();
const page = pdf.addPage([595.28, 841.89]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const ink = rgb(0.1, 0.1, 0.1);
let y = 790;
const draw = (s, x, size = 11, f = font) => page.drawText(s, { x, y, size, font: f, color: ink });

draw("PURCHASE ORDER", 50, 20, bold); y -= 26;
draw("PO Number: TEST-SANCTIONS-001", 50, 10); y -= 14;
draw("Date: 12 June 2026", 50, 10); y -= 30;

draw("BUYER", 50, 9, bold); y -= 16;
draw("Rosoboronexport", 50, 11, bold); y -= 14;
draw("27 Stromynka Street, Moscow 107076, Russia", 50, 10); y -= 30;

draw("DELIVER TO", 50, 9, bold); y -= 16;
draw("Port of St. Petersburg, Russia", 50, 10); y -= 30;

draw("ORDER DETAILS", 50, 9, bold); y -= 18;
draw("Product: Frozen mixed vegetables, Grade A", 50, 11); y -= 16;
draw("Quantity: 9600 kg", 50, 11); y -= 16;
draw("Total value: USD 14400", 50, 11, bold); y -= 16;
draw("Currency: USD", 50, 11); y -= 16;
draw("Incoterm: CIF St. Petersburg", 50, 11); y -= 16;
draw("Packing: 800 cartons", 50, 11); y -= 16;
draw("Net weight: 9600 kg", 50, 11); y -= 16;
draw("Gross weight: 10080 kg", 50, 11); y -= 16;
draw("Port of loading: Chennai, India", 50, 11); y -= 40;

draw("Authorized by: Procurement Department", 50, 10);

const bytes = await pdf.save();
const out = join(homedir(), "Downloads", "test-po-sanctions.pdf");
writeFileSync(out, bytes);
console.log("written:", out);
