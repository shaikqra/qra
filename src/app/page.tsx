import Link from "next/link";

// Where the email link points. Change to whichever inbox you want enquiries in.
const CONTACT_EMAIL = "abdulalis@gmail.com";
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Qra — early access")}`;

// "Start on WhatsApp" opens a chat to Qra with the sandbox join code pre-filled.
// IMPORTANT: set WHATSAPP_JOIN to your sandbox's EXACT join phrase from the
// Twilio console (Messaging → Try it out → Send a WhatsApp message), e.g.
// "join brave-tiger". Swap WHATSAPP_NUMBER when you get a production number.
const WHATSAPP_NUMBER = "14155238886";
const WHATSAPP_JOIN = "join solve-scale";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_JOIN)}`;

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
    title: "On WhatsApp",
    body: "Your team already lives on WhatsApp. Qra meets them there — nothing new to learn, nobody to train.",
  },
  {
    icon: "⚡",
    title: "Minutes, not days",
    body: "A purchase order becomes a finished, checked document set in the time it takes to make chai.",
  },
  {
    icon: "🛡️",
    title: "Sanctions-screened",
    body: "Buyer, consignee and notify party screened against US, UN and EU denied-party lists — over 27,000 names — before a single document exists.",
  },
  {
    icon: "✅",
    title: "A human always approves",
    body: "Qra is an assistant, not an autopilot. Nothing reaches your customs broker until you've reviewed and approved it.",
  },
  {
    icon: "📜",
    title: "Fully audited",
    body: "Every document carries an immutable record — what was made, from which data, screened against what, approved by whom, when.",
  },
  {
    icon: "🌍",
    title: "Any product, any destination",
    body: "Agri to engineering goods, EU to the Gulf — the core flow works for every export lane from India.",
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

function WhatsAppMock() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-[#e5ddd5] p-4 shadow-xl w-full max-w-sm mx-auto">
      <div className="flex items-center gap-3 rounded-t-xl bg-[#075e54] px-4 py-3 -m-4 mb-3">
        <div className="h-9 w-9 rounded-full bg-emerald-500 flex items-center justify-center text-white font-semibold">
          Q
        </div>
        <div>
          <div className="text-white text-sm font-medium leading-tight">Qra</div>
          <div className="text-emerald-100 text-[11px] leading-tight">online</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-[13px] leading-snug">
        <div className="self-end max-w-[85%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 shadow-sm">
          <span className="block">📎 PO_MangoConcentrate.pdf</span>
          <span className="block text-[10px] text-zinc-500 text-right mt-1">1:55 pm ✓✓</span>
        </div>
        <div className="self-start max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          Got your PO! Reference: SHP-7F2A. Reading it now — your draft documents will be
          ready in about a minute.
          <span className="block text-[10px] text-zinc-400 text-right mt-1">1:55 pm</span>
        </div>
        <div className="self-start max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          I still need: • Gross weight • No. of packages. Just reply here.
          <span className="block text-[10px] text-zinc-400 text-right mt-1">1:55 pm</span>
        </div>
        <div className="self-end max-w-[85%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 shadow-sm">
          480 cartons, gross 5040 kg
          <span className="block text-[10px] text-zinc-500 text-right mt-1">1:56 pm ✓✓</span>
        </div>
        <div className="self-start max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          ✅ That&apos;s everything — buyer screened, documents on their way.
          <span className="block text-[10px] text-zinc-400 text-right mt-1">1:56 pm</span>
        </div>
        <div className="self-start max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          <span className="block">📄 Commercial Invoice — SHP-7F2A.pdf</span>
          <span className="block">📄 Packing List — SHP-7F2A.pdf</span>
          <span className="block mt-1">Reply APPROVE to approve them all.</span>
          <span className="block text-[10px] text-zinc-400 text-right mt-1">1:57 pm</span>
        </div>
        <div className="self-end max-w-[85%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 shadow-sm">
          APPROVE
          <span className="block text-[10px] text-zinc-500 text-right mt-1">1:58 pm ✓✓</span>
        </div>
        <div className="self-start max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
          ✅ Approved & locked. Sending the set to your customs broker now.
          <span className="block text-[10px] text-zinc-400 text-right mt-1">1:58 pm</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white text-zinc-900">
      {/* Header */}
      <header className="border-b border-zinc-100 sticky top-0 bg-white/90 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">Qra</span>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#how" className="text-zinc-600 hover:text-zinc-900 hidden sm:inline">
              How it works
            </a>
            <a href="#docs" className="text-zinc-600 hover:text-zinc-900 hidden sm:inline">
              Documents
            </a>
            <a href="#faq" className="text-zinc-600 hover:text-zinc-900 hidden sm:inline">
              FAQ
            </a>
            <Link href="/cha/login" className="text-zinc-600 hover:text-zinc-900">
              CHA login
            </Link>
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Start on WhatsApp
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 sm:pt-24 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 mb-6">
            WhatsApp-native AI for Indian exporters
          </div>
          <h1 className="text-4xl sm:text-5xl xl:text-6xl font-semibold tracking-tight leading-[1.05]">
            Export paperwork that takes days,
            <span className="text-emerald-600"> done in minutes.</span>
          </h1>
          <p className="mt-6 text-lg text-zinc-600 leading-relaxed">
            Qra turns your buyer&apos;s purchase order into compliant export documents —
            sanctions-screened, rule-checked, and emailed to your customs broker. You just
            send the PO on WhatsApp and reply APPROVE.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Start on WhatsApp
            </a>
            <a
              href="#how"
              className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              See how it works
            </a>
          </div>
          <p className="mt-6 text-sm text-zinc-500">
            No new software for your team. No change to your customs broker. Or{" "}
            <a href={MAILTO} className="underline hover:text-zinc-700">
              email us
            </a>
            .
          </p>
        </div>
        <WhatsAppMock />
      </section>

      {/* Before / after strip */}
      <section className="border-y border-zinc-100 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-6 py-12 grid sm:grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Documentation today
            </div>
            <ul className="mt-3 space-y-2 text-sm text-zinc-600">
              <li>• Hours of skilled staff time, retyping the same details by hand</li>
              <li>• The same details keyed across invoice, packing list and certificates</li>
              <li>• Sanctions checks done rarely, manually, or not at all</li>
              <li>• One typo caught late — discrepancy fees at the bank, demurrage at the port</li>
            </ul>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              With Qra
            </div>
            <ul className="mt-3 space-y-2 text-sm text-emerald-900">
              <li>• Minutes from PO to a finished, consistent document set</li>
              <li>• Every value entered once, checked by rules, used everywhere</li>
              <li>• Every buyer screened against US + UN + EU lists, every time</li>
              <li>• You approve on WhatsApp; your broker gets a clean set</li>
            </ul>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          From purchase order to your broker&apos;s inbox
        </h2>
        <p className="mt-3 text-zinc-600 max-w-2xl">
          One WhatsApp conversation. Qra does the work; you approve at the gate.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-xl border border-zinc-200 bg-white p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
                {s.n}
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Documents you get */}
      <section id="docs" className="border-t border-zinc-100 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            The documents, done properly
          </h2>
          <p className="mt-3 text-zinc-600 max-w-2xl">
            Generated from one set of checked data, so they always agree with each other.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {DOCS.map((d) => (
              <div key={d.title} className="rounded-xl border border-zinc-200 bg-white p-6">
                <div className="text-2xl">📄</div>
                <h3 className="mt-3 font-semibold">{d.title}</h3>
                <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-zinc-500">
            Plus conversational gap-fill, computed totals you confirm with one word, and a
            complete audit record on every document.
          </p>
        </div>
      </section>

      {/* Watch it work — activity feed */}
      <section className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Watch the agent work — every decision, on the record
          </h2>
          <p className="mt-4 text-zinc-600 leading-relaxed">
            Qra isn&apos;t a black box. Every shipment shows a live activity feed of exactly
            what the AI did and why: what it read, what it asked, who it screened, what it
            generated, and who approved. The same record is kept immutably for audits —
            for years.
          </p>
          <p className="mt-4 text-zinc-600 leading-relaxed font-medium">
            The AI proposes. Rules check. A human approves. The workflow remembers.
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl divide-y divide-zinc-100">
          {ACTIVITY.map((a) => (
            <div key={a.text} className="flex items-center gap-3 px-5 py-3">
              <span className="text-base">{a.icon}</span>
              <span className="flex-1 text-sm text-zinc-700">{a.text}</span>
              <span className="text-xs text-zinc-400">{a.time}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-zinc-100 bg-zinc-900 text-zinc-100">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight max-w-3xl">
            Built for accuracy, because a wrong document is a customs penalty
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-6">
                <div className="text-xl">{f.icon}</div>
                <h3 className="mt-3 font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-300 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-20 w-full">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Questions, answered</h2>
        <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer items-center justify-between text-left font-medium text-zinc-900 list-none">
                {f.q}
                <span className="ml-4 text-zinc-400 group-open:rotate-45 transition-transform">＋</span>
              </summary>
              <p className="mt-3 text-sm text-zinc-600 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-zinc-100 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Try Qra on one real shipment
          </h2>
          <p className="mt-4 text-zinc-600 max-w-xl mx-auto">
            We&apos;re working with a small group of Indian exporters to refine Qra. If your
            team loses hours to documentation, message us on WhatsApp — we&apos;ll run your
            next shipment through it together.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Start on WhatsApp
            </a>
            <a
              href={MAILTO}
              className="rounded-full border border-zinc-300 px-8 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Email us instead
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <span className="font-semibold text-zinc-700">Qra</span>
          <span>Export documentation, automated. Built in India. 🇮🇳</span>
          <div className="flex items-center gap-4">
            <a href={MAILTO} className="hover:text-zinc-900">
              {CONTACT_EMAIL}
            </a>
            <Link href="/cha/login" className="text-zinc-400 hover:text-zinc-700 text-xs">
              CHA sign-in
            </Link>
            <Link href="/internal/login" className="text-zinc-300 hover:text-zinc-500 text-xs">
              Team login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
