// One-off: builds an intentionally incomplete purchase order PDF for testing
// the WhatsApp gap-fill flow. It includes buyer/product/value but deliberately
// OMITS net weight, gross weight, number of packages and package type, so the
// pipeline must ask for exactly those. Output: Downloads\test-po-gapfill.pdf
// Run: node scripts/make-test-po.mjs
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
draw("PO Number: TEST-GAPFILL-001", 50, 10); y -= 14;
draw("Date: 10 June 2026", 50, 10); y -= 30;

draw("BUYER", 50, 9, bold); y -= 16;
draw("Helsinki Fresh Imports Oy", 50, 11, bold); y -= 14;
draw("Satamakatu 12, 00160 Helsinki, Finland", 50, 10); y -= 30;

draw("DELIVER TO", 50, 9, bold); y -= 16;
draw("Port of Helsinki, Finland", 50, 10); y -= 30;

draw("ORDER DETAILS", 50, 9, bold); y -= 18;
draw("Product: Frozen diced sweet melon, Grade A", 50, 11); y -= 16;
draw("Quantity: 4800 kg", 50, 11); y -= 16;
draw("Unit price: USD 2.10 / kg", 50, 11); y -= 16;
draw("Total value: USD 10080", 50, 11, bold); y -= 16;
draw("Incoterm: CIF Helsinki", 50, 11); y -= 16;
draw("Port of loading: Chennai, India", 50, 11); y -= 30;

draw("Packing and weight details to be confirmed by exporter.", 50, 10); y -= 40;
draw("Authorized by: M. Korhonen, Purchasing Manager", 50, 10);

const bytes = await pdf.save();
const out = join(homedir(), "Downloads", "test-po-gapfill.pdf");
writeFileSync(out, bytes);
console.log("written:", out);
