import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { InstallButton } from "@/components/install-prompt";
import { LiveClock } from "@/components/live-clock";
import { StandaloneRedirect } from "@/components/standalone-redirect";

// In its own voice throughout - the third wheel talking about itself, not a
// feature list.
const HOW_IT_WORKS = [
  {
    n: "01",
    title: "You each say what you want",
    body: "Type it or say it out loud, one after the other, on the same phone. Neither of you sees the other's answer first.",
  },
  {
    n: "02",
    title: "I rank what fits you both",
    body: "Your top five, best first, kept to the right kind of place for the meal and honouring anything you must have. Too close to call? I can settle it with one question.",
  },
  {
    n: "03",
    title: "You pick, or we spin",
    body: "Tap one to go there, or let the wheel choose: better matches get bigger slices. Either way you get a map pin and directions.",
  },
];

const WHY_COUPLES_USE_IT = [
  {
    title: `"Anything's fine" — it's never fine.`,
    body: "Someone always has an opinion. I get it out of both of you before the debate starts.",
  },
  {
    title: "The five-app scroll that decides nothing.",
    body: "You could open every delivery app in Malaysia and still be here in twenty minutes. I just need one sentence each.",
  },
  {
    title: "The polite veto loop.",
    body: `"Not that." "Not that either." I break the loop with a ranked list, not another suggestion to shoot down.`,
  },
];

const ENGINES = [
  { name: "Laya", by: "ConvAI", note: "Fast, joint-attention model." },
  { name: "GLiNER2.5-Decide", by: "Fastino", note: "CPU-first, honors exclusion rules." },
  { name: "CLM-8B", by: "Stanford/NVIDIA", note: "Dual-encoder, needs a GPU server." },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip text-cream">
      <StandaloneRedirect />

      {/* Header - one row at every width: the name can't wrap and the button
          is short, so a 360px phone never squeezes either. */}
      <header className="safe-top mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 md:px-6 md:py-6">
        <div className="flex items-center gap-2">
          <Logo className="h-7 w-7 shrink-0" />
          <span className="font-display text-lg font-semibold tracking-tight whitespace-nowrap">Food Wheeler</span>
        </div>
        <div className="flex items-center gap-4">
          <InstallButton className="hidden text-sm text-cream/60 underline underline-offset-4 hover:text-cream sm:inline" />
          <Link
            href="/decide"
            className="rounded-full bg-ember px-4 py-2 text-sm font-semibold whitespace-nowrap text-ink transition-opacity hover:opacity-90 md:px-5"
          >
            Start deciding
          </Link>
        </div>
      </header>

      {/* Hero - a big two-line headline, with the logo mark beside the eyebrow.
          On a phone the mark shares the eyebrow's row, so the headline always
          starts below whichever is taller and can't run under it; from md up
          it goes back to being a big mark in the corner. The headline is sized
          from the viewport so "Two appetites." fits on one line on any phone. */}
      <section className="relative mx-auto max-w-6xl px-5 pt-4 pb-16 md:px-6 md:pt-20 md:pb-28">
        <div className="flex items-center justify-between gap-4 md:block">
          <p className="nav-dot text-sm font-medium tracking-wide whitespace-nowrap text-cream/60">
            Two partners, one phone
          </p>
          <div className="pointer-events-none shrink-0 md:absolute md:top-6 md:right-6">
            <Logo className="logo-spin h-[88px] w-[88px] opacity-90 md:h-72 md:w-72" />
          </div>
        </div>

        <h1 className="font-display mt-5 text-[length:min(13vw,3.75rem)] leading-[0.95] font-semibold tracking-tight md:mt-6 md:max-w-2xl md:text-8xl">
          <span className="block text-peach">Two appetites.</span>
          <span className="block text-cream">One table.</span>
        </h1>

        <p className="mt-6 max-w-md text-base text-cream/70">
          Say what you each want, type it or say it out loud. I rank the places that fit you both, then you pick one
          or let the wheel choose. No group chat, no twenty-minute scroll, no account needed to try it.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link
            href="/decide"
            className="group inline-flex items-center gap-2 rounded-full bg-ember px-6 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Start deciding
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <InstallButton className="text-sm text-cream/60 underline underline-offset-4 hover:text-cream" />
        </div>
      </section>

      {/* How your third wheel works */}
      <section className="hairline mx-auto max-w-6xl px-5 py-14 md:px-6 md:py-16">
        <p className="nav-dot text-sm font-medium tracking-wide text-cream/60">How your third wheel works</p>
        <div className="mt-8 grid gap-10 md:grid-cols-3">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.n}>
              <span className="font-display text-sm text-peach">{s.n}</span>
              <h3 className="font-display mt-2 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-cream/60">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why couples use it */}
      <section className="hairline mx-auto max-w-6xl px-5 py-14 md:px-6 md:py-16">
        <p className="nav-dot text-sm font-medium tracking-wide text-cream/60">Why couples use it</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {WHY_COUPLES_USE_IT.map((s) => (
            <div key={s.title} className="glass rounded-2xl p-5">
              <p className="font-display text-lg leading-snug font-semibold">{s.title}</p>
              <p className="mt-2 text-sm text-cream/60">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer, with the engines demoted to a small technical footnote -
          most couples never need to know this exists. */}
      <footer className="hairline mx-auto max-w-6xl px-5 py-8 md:px-6">
        <details className="mb-8 text-xs text-cream/50">
          <summary className="nav-dot cursor-pointer font-medium tracking-wide text-cream/60">Under the hood</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {ENGINES.map((e) => (
              <div key={e.name}>
                <p className="text-sm font-medium text-cream/80">
                  {e.name} <span className="font-normal text-cream/40">· {e.by}</span>
                </p>
                <p className="mt-0.5 text-cream/50">{e.note}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-xl text-cream/40">
            Every engine returns a plain probability, so the ranking and the optional one-question tiebreaker behave the
            same no matter which one is selected.
          </p>
        </details>

        <div className="flex flex-col gap-4 text-xs text-cream/50 md:flex-row md:items-center md:justify-between">
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
        </div>
      </footer>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .logo-spin { animation: spin 40s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .logo-spin { animation: none; } }
      `}</style>
    </div>
  );
}
