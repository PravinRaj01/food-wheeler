import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { InstallButton } from "@/components/install-prompt";
import { LiveClock } from "@/components/live-clock";
import { StandaloneRedirect } from "@/components/standalone-redirect";

const STEPS = [
  {
    n: "01",
    title: "Type or talk",
    body: "Each partner says what they want, one after the other, on the same phone.",
  },
  {
    n: "02",
    title: "We ask if it's close",
    body: "A confident pick spins the wheel. A close call gets one quick joint question instead.",
  },
  {
    n: "03",
    title: "The wheel decides",
    body: "It lands on tonight's table, with a map pin and the match score.",
  },
];

const ENGINES = [
  { name: "Laya", by: "ConvAI", note: "Fast, joint-attention model." },
  { name: "GLiNER2.5-Decide", by: "Fastino", note: "CPU-first, honors exclusion rules." },
  { name: "CLM-8B", by: "Stanford/NVIDIA", note: "Dual-encoder, needs a GPU server." },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh text-cream">
      <StandaloneRedirect />

      {/* Header */}
      <header className="safe-top mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <Logo className="h-7 w-7" />
          <span className="font-display text-lg font-semibold tracking-tight">Food Wheeler</span>
        </div>
        <div className="flex items-center gap-3">
          <InstallButton />
          <Link
            href="/decide"
            className="rounded-full bg-cream px-5 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Start deciding
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-6 pt-10 pb-24 md:pt-20">
        <div className="pointer-events-none absolute top-0 right-0 opacity-90 md:right-6">
          <Logo
            className="h-40 w-40 md:h-72 md:w-72"
            style={{ animation: "spin 40s linear infinite" }}
          />
        </div>

        <p className="nav-dot text-sm font-medium tracking-wide text-cream/60">Two partners, one phone</p>

        <h1 className="font-display mt-6 max-w-2xl text-6xl leading-[0.95] font-semibold tracking-tight md:text-8xl">
          <span className="text-peach">Two appetites.</span>
          <br />
          <span className="text-cream">One table.</span>
        </h1>

        <p className="mt-6 max-w-md text-base text-cream/70">
          Say what you each want - type it or say it out loud. An AI decision
          engine picks a restaurant, confidently or by settling one quick
          disagreement together. No accounts required to try it.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/decide"
            className="group inline-flex items-center gap-2 rounded-full border border-line-strong px-6 py-3 text-sm font-medium transition-colors hover:bg-glass"
          >
            Start deciding
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <InstallButton className="text-sm text-cream/60 underline underline-offset-4 hover:text-cream" />
        </div>
      </section>

      {/* How it works */}
      <section className="hairline mx-auto max-w-6xl px-6 py-16">
        <p className="nav-dot text-sm font-medium tracking-wide text-cream/60">How it works</p>
        <div className="mt-8 grid gap-10 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n}>
              <span className="font-display text-sm text-peach">{s.n}</span>
              <h3 className="font-display mt-2 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-cream/60">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Engines */}
      <section className="hairline mx-auto max-w-6xl px-6 py-16">
        <p className="nav-dot text-sm font-medium tracking-wide text-cream/60">Decision engines</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {ENGINES.map((e) => (
            <div key={e.name} className="glass rounded-2xl p-5">
              <p className="font-display text-lg font-semibold">{e.name}</p>
              <p className="text-xs text-cream/50">{e.by}</p>
              <p className="mt-2 text-sm text-cream/70">{e.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-xl text-sm text-cream/50">
          Every engine returns a plain probability, so the confidence rule and
          the mediator question behave the same no matter which one is
          selected.
        </p>
      </section>

      {/* Footer */}
      <footer className="hairline mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-xs text-cream/50 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-6">
          <Link href="/decide" className="nav-dot hover:text-cream/80">
            Decide
          </Link>
          <Link href="/explore" className="nav-dot hover:text-cream/80">
            Explore
          </Link>
          <Link href="/settings" className="nav-dot hover:text-cream/80">
            Settings
          </Link>
        </div>
        <LiveClock />
      </footer>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
