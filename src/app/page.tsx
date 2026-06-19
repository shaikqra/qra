import Link from "next/link";
import Image from "next/image";
import { Globe } from "./globe";

// Where the email link points. Change to whichever inbox you want enquiries in.
const CONTACT_EMAIL = "abdulalis@gmail.com";
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Qra — early access")}`;

// "Start on WhatsApp" opens a chat to Qra with the sandbox join code pre-filled.
// IMPORTANT: set WHATSAPP_JOIN to your sandbox's EXACT join phrase from the
// Twilio console. Swap WHATSAPP_NUMBER when you get a production number.
const WHATSAPP_NUMBER = "14155238886";
const WHATSAPP_JOIN = "join solve-scale";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_JOIN)}`;

// Brand colour: cornflower/royal blue from the Qra mark.
const BRAND = "#3f5bd9";
const NAVY = "#0b1e44";
const CHIP_BG = "#eef1fc";
const LIGHT_BLUE = "#8aa0ee";

const STATS = [
  { big: "Minutes", small: "from PO to a finished document set — not days" },
  { big: "6", small: "export documents, all from one checked source" },
  { big: "27,000+", small: "denied-party names screened, every shipment" },
  { big: "100%", small: "human-approved, and fully audited" },
];

const STEPS = [
  {
    n: "1",
    title: "Send your PO on WhatsApp",
    body: "Forward the purchase order your buyer sent — a PDF, a photo, even a typed message. No app to install, no portal to learn.",
  },
  {
    n: "2",
    title: "Qra reads it and fills the gaps",
    body: "It extracts every detail. If something's missing, it asks you right there in the chat — and double-checks every number against hard rules.",
  },
  {
    n: "3",
    title: "It screens, then drafts your documents",
    body: "Every buyer is checked against US, UN and EU sanctions lists before your commercial invoice, packing list and certificate of origin are drafted.",
  },
  {
    n: "4",
    title: "You approve — it goes to your broker",
    body: "Review on WhatsApp, reply APPROVE. Qra locks the documents and emails the set to your customs broker. Days of paperwork, done in minutes.",
  },
];

const FEATURES = [
  {
    icon: "💬",
    title: "On WhatsApp — or email",
    body: "Send the PO on WhatsApp, or forward it to your own Qra inbox. Your team works where it already is — nothing new to install or learn.",
  },
  {
    icon: "📥",
    title: "Reads any PO",
    body: "A PDF, a photo of a printout, or a typed message — Qra pulls every detail into one clean, structured order.",
  },
  {
    icon: "✍️",
    title: "Asks for what's missing",
    body: "Most POs are missing a detail or two. Qra asks in plain language, right in the chat, and slots your reply into the right field.",
  },
  {
    icon: "🏷️",
    title: "Drafts the HS code",
    body: "No tariff code on the PO? Qra suggests one from your goods for you and your CHA to confirm — never guessed silently into a document.",
  },
  {
    icon: "📐",
    title: "Checked against hard rules",
    body: "Every weight, currency, total and incoterm is validated by deterministic checks. Anything it isn't sure of goes to a human, not into a document.",
  },
  {
    icon: "🛡️",
    title: "Sanctions-screened",
    body: "Buyer, consignee and notify party screened against US, UN and EU denied-party lists — over 27,000 names — before a single document exists.",
  },
  {
    icon: "📜",
    title: "Knows the certificates you need",
    body: "Qra flags the certificates your shipment needs for its destination and product, so nothing's missing when it reaches the port.",
  },
  {
    icon: "🗂️",
    title: "The full document set",
    body: "Commercial invoice, packing list, certificate of origin, proforma, shipping-bill checklist and export declaration — all from one checked source.",
  },
  {
    icon: "✋",
    title: "You approve every gate",
    body: "Confirm the order, check flagged details, approve the docs, confirm goods are ready. Qra proposes; you decide, at every step.",
  },
  {
    icon: "🖥️",
    title: "A live console",
    body: "Track every shipment in your console — see which agent is working, what it decided, and clear each gate from a pop-up.",
  },
  {
    icon: "📧",
    title: "Straight to your CHA",
    body: "On your approval, the finished set lands in your customs broker's inbox. Your existing relationships stay exactly as they are.",
  },
  {
    icon: "🔒",
    title: "Immutable audit trail",
    body: "Every document carries a tamper-evident record — what was made, from what data, screened against what, approved by whom and when — kept for years.",
  },
];

const DOCS = [
  {
    title: "Commercial Invoice",
    body: "With your declarations (LUT, RoDTEP, REX statement on origin), bank details and buyer terms — formatted the way customs and banks expect.",
  },
  {
    title: "Packing List",
    body: "Packages, net and gross weights, marks — consistent with the invoice to the last kilogram, because both come from the same checked data.",
  },
  {
    title: "Certificate of Origin (draft)",
    body: "A clean non-preferential draft, cross-referenced to the invoice, ready for your Chamber of Commerce to certify.",
  },
  {
    title: "Proforma Invoice",
    body: "On request — a proforma for advance payment or opening a letter of credit, drawn from the same order so it agrees with the final invoice.",
  },
  {
    title: "Shipping-Bill Checklist",
    body: "The data sheet your CHA needs to file the shipping bill on ICEGATE — assembled and checked, ready to hand straight over.",
  },
  {
    title: "Export Declaration / Annexure",
    body: "The supporting declaration and annexure, generated from the same source, so every value agrees across the whole set.",
  },
];

const ACTIVITY = [
  { icon: "📥", text: "PO received on WhatsApp", time: "1:55 pm" },
  { icon: "🤖", text: "Read the PO and extracted 22 fields", time: "1:55 pm" },
  { icon: "💬", text: "Asked the customer for missing weights", time: "1:55 pm" },
  { icon: "🛡️", text: "Screened the buyer against US + UN + EU lists — clear", time: "1:56 pm" },
  { icon: "📄", text: "Generated invoice, packing list, certificate of origin", time: "1:56 pm" },
  { icon: "📲", text: "Sent documents for approval", time: "1:57 pm" },
  { icon: "✅", text: "Customer approved", time: "1:58 pm" },
  { icon: "📧", text: "Document set emailed to the customs broker", time: "1:59 pm" },
];

const FAQS = [
  {
    q: "Is this safe to use for real customs documents?",
    a: "Qra is built on one rule: the AI proposes, deterministic rules verify, and a human approves. Every number it extracts is validated against hard checks (weights, currencies, incoterms, totals), anything it isn't sure about goes to a human instead of into a document, and nothing is sent anywhere without your explicit approval. Every step is recorded in an immutable audit trail.",
  },
  {
    q: "What about sanctions compliance?",
    a: "Before any document is created, Qra screens the buyer, consignee and notify party against the US Consolidated Screening List (including OFAC SDN), the UN Security Council Consolidated List, and the EU Consolidated Financial Sanctions List. If there's a potential match — or if screening can't complete — everything stops for human review. It fails safe, never silent.",
  },
  {
    q: "Does Qra file with customs?",
    a: "No — and that's deliberate. Your licensed customs broker (CHA) files, exactly as they do today. Qra prepares a perfect, checked document set and emails it to your broker the moment you approve. Your existing relationships stay exactly as they are.",
  },
  {
    q: "What if my buyer's PO is missing details?",
    a: "That's normal — most POs are. Qra asks you for exactly what's missing, in plain language, right in the WhatsApp chat. You reply naturally (\"480 cartons, gross 5040 kg\") and it slots every value into the right field. If a unit price is stated, it even calculates the total and asks you to confirm.",
  },
  {
    q: "What does it cost?",
    a: "We're in early access, working closely with a small group of exporters — pricing is simple and agreed up front with each of them. Get in touch and we'll walk you through it.",
  },
  {
    q: "Who is behind Qra?",
    a: "Qra is built in India, by a team that comes from an exporting family — we've lived the late nights of documentation. We're building the operating system we wished our own export house had.",
  },
];

// The real Qra mark, served from /public/logo.png (white background blends on
// light surfaces; placed on a white tile on dark sections).
function Mark({ className = "" }: { className?: string }) {
  return <Image src="/logo.png" alt="Qra logo" width={64} height={64} className={className} />;
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div
      className="mb-3 text-xs font-semibold uppercase tracking-[0.18em]"
      style={{ color: dark ? LIGHT_BLUE : BRAND }}
    >
      {children}
    </div>
  );
}

function IconChip({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div
      className="flex h-11 w-11 items-center justify-center rounded-xl text-xl"
      style={dark ? { backgroundColor: "rgba(255,255,255,0.08)" } : { backgroundColor: CHIP_BG }}
    >
      {children}
    </div>
  );
}

function WhatsAppMock() {
  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-[#e5ddd5] p-4 shadow-2xl">
      <div className="-m-4 mb-3 flex items-center gap-3 rounded-t-xl bg-[#075e54] px-4 py-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full font-semibold text-white"
          style={{ backgroundColor: BRAND }}
        >
          Q
        </div>
        <div>
          <div className="text-sm font-medium leading-tight text-white">Qra</div>
          <div className="text-[11px] leading-tight text-emerald-100">online</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-[13px] leading-snug">
        <div className="max-w-[85%] self-end rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 shadow-sm">
          <span className="block">📎 PO_MangoConcentrate.pdf</span>
          <span className="mt-1 block text-right text-[10px] text-zinc-500">1:55 pm ✓✓</span>
        </div>
        <div className="max-w-[85%] self-start rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          Got your PO! Reference: SHP-7F2A. Reading it now — your draft documents will be
          ready in about a minute.
          <span className="mt-1 block text-right text-[10px] text-zinc-400">1:55 pm</span>
        </div>
        <div className="max-w-[85%] self-start rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          I still need: • Gross weight • No. of packages. Just reply here.
          <span className="mt-1 block text-right text-[10px] text-zinc-400">1:55 pm</span>
        </div>
        <div className="max-w-[85%] self-end rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 shadow-sm">
          480 cartons, gross 5040 kg
          <span className="mt-1 block text-right text-[10px] text-zinc-500">1:56 pm ✓✓</span>
        </div>
        <div className="max-w-[85%] self-start rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          ✅ That&apos;s everything — buyer screened, documents on their way.
          <span className="mt-1 block text-right text-[10px] text-zinc-400">1:56 pm</span>
        </div>
        <div className="max-w-[85%] self-start rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          <span className="block">📄 Commercial Invoice — SHP-7F2A.pdf</span>
          <span className="block">📄 Packing List — SHP-7F2A.pdf</span>
          <span className="mt-1 block">Reply APPROVE to approve them all.</span>
          <span className="mt-1 block text-right text-[10px] text-zinc-400">1:57 pm</span>
        </div>
        <div className="max-w-[85%] self-end rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 shadow-sm">
          APPROVE
          <span className="mt-1 block text-right text-[10px] text-zinc-500">1:58 pm ✓✓</span>
        </div>
        <div className="max-w-[85%] self-start rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          ✅ Approved &amp; locked. Sending the set to your customs broker now.
          <span className="mt-1 block text-right text-[10px] text-zinc-400">1:58 pm</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="inline-flex items-center gap-2">
            <Mark className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight" style={{ color: NAVY }}>
              Qra
            </span>
          </span>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#how" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
              How it works
            </a>
            <a href="#docs" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
              Documents
            </a>
            <a href="#faq" className="hidden text-slate-600 hover:text-slate-900 sm:inline">
              FAQ
            </a>
            <Link href="/cha/login" className="text-slate-600 hover:text-slate-900">
              CHA login
            </Link>
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noreferrer"
              className="rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors"
              style={{ backgroundColor: BRAND }}
            >
              Start on WhatsApp
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative overflow-hidden text-white"
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 50% -10%, #18386f 0%, #0c2150 45%, #0a1a3d 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 right-[2%] hidden h-[560px] w-[560px] -translate-y-1/2 rounded-full lg:block"
          style={{ background: "radial-gradient(circle, rgba(74,108,224,0.28), transparent 62%)", filter: "blur(24px)" }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute top-1/2 right-[-6%] hidden -translate-y-1/2 opacity-95 lg:block"
          style={{ width: 880, height: 880 }}
          aria-hidden="true"
        >
          <Globe />
        </div>
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-20 sm:pt-24 lg:grid-cols-2">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-[#aab9e0]">
              the export OS · built for Indian exporters
            </div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl xl:text-6xl">
              Export paperwork that takes days,
              <span style={{ color: LIGHT_BLUE }}> done in minutes.</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">
              Qra turns your buyer&apos;s purchase order into compliant export documents —
              sanctions-screened, rule-checked, and emailed to your customs broker. You just
              send the PO on WhatsApp and reply APPROVE.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={WHATSAPP_LINK}
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-6 py-3 text-sm font-medium text-white shadow-lg transition-transform hover:-translate-y-0.5"
                style={{ backgroundColor: BRAND }}
              >
                Start on WhatsApp
              </a>
              <a
                href="#how"
                className="rounded-full border border-white/25 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                See how it works
              </a>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">🛡️ US + UN + EU screened</span>
              <span className="inline-flex items-center gap-1.5">✋ You approve everything</span>
              <span className="inline-flex items-center gap-1.5">🤝 Your CHA, unchanged</span>
            </div>
            <p className="mt-5 text-sm text-slate-400">
              No new software for your team. Or{" "}
              <a href={MAILTO} className="underline hover:text-slate-200">
                email us
              </a>
              .
            </p>
          </div>
          <WhatsAppMock />
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.big}>
              <div className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: BRAND }}>
                {s.big}
              </div>
              <div className="mt-1.5 text-xs leading-snug text-slate-500 sm:text-sm">{s.small}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Before / after */}
      <section className="border-b border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Eyebrow>The difference</Eyebrow>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            From hours of retyping to minutes of review
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Documentation today
              </div>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                <li>• Hours of skilled staff time, retyping the same details by hand</li>
                <li>• The same details keyed across invoice, packing list and certificates</li>
                <li>• Sanctions checks done rarely, manually, or not at all</li>
                <li>• One typo caught late — discrepancy fees at the bank, demurrage at the port</li>
              </ul>
            </div>
            <div className="rounded-2xl border p-6" style={{ backgroundColor: CHIP_BG, borderColor: "#cdd6f7" }}>
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: BRAND }}>
                With Qra
              </div>
              <ul className="mt-3 space-y-2 text-sm" style={{ color: "#28357f" }}>
                <li>• Minutes from PO to a finished, consistent document set</li>
                <li>• Every value entered once, checked by rules, used everywhere</li>
                <li>• Every buyer screened against US + UN + EU lists, every time</li>
                <li>• You approve on WhatsApp; your broker gets a clean set</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Stat callout */}
      <section className="text-white" style={{ backgroundColor: NAVY }}>
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-6 py-16 sm:grid-cols-[auto_1fr]">
          <div className="text-6xl font-bold tracking-tight tabular-nums sm:text-7xl" style={{ color: LIGHT_BLUE }}>
            ~70%
          </div>
          <div>
            <p className="text-xl font-semibold leading-snug">
              of letter-of-credit document sets are rejected on first presentation.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
              Usually for small discrepancies — a detail that doesn&apos;t match across the invoice,
              packing list and transport documents. Each rejection means a bank fee and a wait to get
              paid. Qra builds every document from one checked source, so they agree — cutting the
              discrepancies that send a set back.
            </p>
            <p className="mt-2 text-xs text-slate-500">Source: ICC Banking Commission / trade-finance data.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          From purchase order to your broker&apos;s inbox
        </h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          One WhatsApp conversation. Qra does the work; you approve at the gate.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: BRAND }}
              >
                {s.n}
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Documents */}
      <section id="docs" className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Eyebrow>Documents</Eyebrow>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            The documents, done properly
          </h2>
          <p className="mt-3 max-w-2xl text-slate-600">
            Generated from one set of checked data, so they always agree with each other.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {DOCS.map((d) => (
              <div
                key={d.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <IconChip>📄</IconChip>
                <h3 className="mt-4 font-semibold">{d.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{d.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-slate-500">
            Plus conversational gap-fill, computed totals you confirm with one word, and a
            complete audit record on every document.
          </p>
        </div>
      </section>

      {/* Activity feed */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
        <div>
          <Eyebrow>Transparent by design</Eyebrow>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Watch the agent work — every decision, on the record
          </h2>
          <p className="mt-4 leading-relaxed text-slate-600">
            Qra isn&apos;t a black box. Every shipment shows a live activity feed of exactly
            what the AI did and why: what it read, what it asked, who it screened, what it
            generated, and who approved. The same record is kept immutably for audits — for years.
          </p>
          <p className="mt-4 font-medium leading-relaxed" style={{ color: BRAND }}>
            The AI proposes. Rules check. A human approves. The workflow remembers.
          </p>
        </div>
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-xl">
          {ACTIVITY.map((a) => (
            <div key={a.text} className="flex items-center gap-3 px-5 py-3">
              <span className="text-base">{a.icon}</span>
              <span className="flex-1 text-sm text-slate-700">{a.text}</span>
              <span className="text-xs text-slate-400">{a.time}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-t text-slate-100" style={{ backgroundColor: NAVY, borderColor: "#13275a" }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Eyebrow dark>Why Qra</Eyebrow>
          <h2 className="max-w-3xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Built for accuracy, because a wrong document is a customs penalty
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition hover:bg-white/[0.07]"
              >
                <IconChip dark>{f.icon}</IconChip>
                <h3 className="mt-4 font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto w-full max-w-3xl px-6 py-20">
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Questions, answered</h2>
        <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-left font-medium text-slate-900">
                {f.q}
                <span className="ml-4 transition-transform group-open:rotate-45" style={{ color: BRAND }}>
                  ＋
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden text-white" style={{ backgroundColor: NAVY }}>
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(74,108,224,0.35), transparent 65%)", filter: "blur(30px)" }}
          aria-hidden="true"
        />
        <div className="relative z-10 mx-auto max-w-6xl px-6 py-20 text-center">
          <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
            <Mark className="h-12 w-12" />
          </span>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Try Qra on one real shipment</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">
            We&apos;re working with a small group of Indian exporters to refine Qra. If your
            team loses hours to documentation, message us on WhatsApp — we&apos;ll run your
            next shipment through it together.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noreferrer"
              className="rounded-full px-8 py-3 text-sm font-medium text-white shadow-lg transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: BRAND }}
            >
              Start on WhatsApp
            </a>
            <a
              href={MAILTO}
              className="rounded-full border border-white/25 px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              Email us instead
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-slate-500 sm:flex-row">
          <span className="inline-flex items-center gap-2">
            <Mark className="h-6 w-6" />
            <span className="font-semibold text-slate-700">Qra</span>
            <span className="text-slate-400">· the export OS</span>
          </span>
          <span>Export documentation, automated. Built in India. 🇮🇳</span>
          <div className="flex items-center gap-4">
            <a href={MAILTO} className="hover:text-slate-900">
              {CONTACT_EMAIL}
            </a>
            <Link href="/cha/login" className="text-xs text-slate-400 hover:text-slate-700">
              CHA sign-in
            </Link>
            <Link href="/internal/login" className="text-xs text-slate-300 hover:text-slate-500">
              Team login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
