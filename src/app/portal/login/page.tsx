import Link from "next/link";
import Image from "next/image";
import { PortalLoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exporter login — Qra" };

// Matches the landing page's WhatsApp CTA (sandbox join code pre-filled).
const WHATSAPP_LINK = `https://wa.me/14155238886?text=${encodeURIComponent("join solve-scale")}`;

export default function PortalLoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden">
            <Image src="/logo.png" alt="Qra" width={48} height={48} className="h-full w-full scale-[1.18] object-cover" />
          </span>
          <span className="text-xl font-semibold tracking-tight text-[#0b1e44]">Qra</span>
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Exporter login</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            Enter the WhatsApp number you use with Qra, and we&apos;ll send your secure console
            link straight to it.
          </p>
          <PortalLoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          New to Qra?{" "}
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline"
            style={{ color: "#3f5bd9" }}
          >
            Start on WhatsApp
          </a>
        </p>
        <p className="mt-2 text-center text-xs text-slate-500">
          Are you a customs broker?{" "}
          <Link href="/cha/login" className="underline hover:text-slate-700">
            CHA login
          </Link>
        </p>
      </div>
    </div>
  );
}
