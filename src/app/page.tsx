import Link from "next/link";

// Where the "Request access" buttons point. Change this to whichever inbox you
// want enquiries to land in (a hello@theqra.com address would need email
// receiving set up first; a personal inbox works immediately).
const CONTACT_EMAIL = "abdulalis@gmail.com";
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Qra — early access")}`;

const STEPS = [
  {
    n: "1",
    title: "Send your PO on WhatsApp",
    body: "Forward the purchase order your buyer sent you — a PDF, a photo, even a typed message. No app to install, no portal to learn.",
  },
  {
    n: "2",
    title: "Qra reads it and fills the gaps",
    body: "It extracts every detail, and if something's missing it asks you for it right there in the chat — then double-checks the numbers.",
  },
  {
    n: "3",
    title: "It screens and prepares your documents",
    body: "Every buyer is checked against US, UN and EU sanctions lists, and your commercial invoice, packing list and certificate of origin are drafted automatically.",
  },
  {
    n: "4",
    title: "You approve — it sends to your broker",
    body: "Review the documents on WhatsApp and reply APPROVE. Qra locks them and emails the set to your customs broker. Days of paperwork, done in minutes.",
  },
];

const FEATURES = [
  {
    title: "On WhatsApp",
    body: "Your exporters already live on WhatsApp. Qra meets them there — nothing new to learn.",
  },
  {
    title: "Minutes, not days",
    body: "A purchase order becomes a finished, checked document set in the time it takes to read this page.",
  },
  {
    title: "Sanctions-screened",
    body: "Every buyer is screened against US, UN and EU denied-party lists before a single document is created.",
  },
  {
    title: "A human always approves",
    body: "Nothing reaches your customs broker until you've reviewed it and approved. Accuracy is the whole point.",
  },
  {
    title: "Fully audited",
    body: "Every document carries an immutable record — what was made, from what data, screened against what, approved by whom.",
  },
  {
    title: "Any product, any destination",
    body: "From agri commodities to engineering goods, EU to the Gulf — the core works for every export lane.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white text-zinc-900">
      {/* Header */}
      <header className="border-b border-zinc-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">Qra</span>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#how" className="text-zinc-600 hover:text-zinc-900 hidden sm:inline">
              How it works
            </a>
            <a
              href={MAILTO}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Request access
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 sm:pt-28">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 mb-6">
            WhatsApp-native AI for Indian exporters
          </div>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05]">
            Export paperwork that takes days,
            <span className="text-emerald-600"> done in minutes.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-zinc-600 leading-relaxed">
            Qra is an AI assistant that turns your purchase order into compliant export
            documents — sanctions-screened, checked, and ready for your customs broker.
            You just send the PO on WhatsApp and reply APPROVE.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={MAILTO}
              className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Request early access
            </a>
            <a
              href="#how"
              className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-zinc-100 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            From purchase order to filed documents
          </h2>
          <p className="mt-3 text-zinc-600 max-w-2xl">
            One conversation. Qra does the work; you approve at the gate.
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
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Built for accuracy, because a wrong document is a customs penalty
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-200 p-6">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust band */}
      <section className="border-t border-zinc-100 bg-zinc-900 text-zinc-100">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight max-w-3xl">
            The AI proposes. Rules check. A human approves.
          </h2>
          <p className="mt-4 text-zinc-300 max-w-2xl leading-relaxed">
            Qra is an assistant, not an autopilot. Every number it reads is validated against
            hard rules, every buyer is screened against three sanctions authorities, and
            nothing is filed or sent without your approval — recorded, hashed, and kept for years.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Want to try Qra on a real shipment?
        </h2>
        <p className="mt-4 text-zinc-600 max-w-xl mx-auto">
          We&apos;re working with a small group of exporters to refine Qra. If you ship from
          India and lose hours to documentation, we&apos;d love to show you.
        </p>
        <div className="mt-8">
          <a
            href={MAILTO}
            className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Request early access
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <span className="font-semibold text-zinc-700">Qra</span>
          <span>Export documentation, automated. Built in India.</span>
          <a href={MAILTO} className="hover:text-zinc-900">
            {CONTACT_EMAIL}
          </a>
        </div>
      </footer>
    </div>
  );
}
