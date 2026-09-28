import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { InstallButton } from "@/components/install-prompt";
import { LiveClock } from "@/components/live-clock";
import { StandaloneRedirect } from "@/components/standalone-redirect";
import { IdleWheel } from "@/components/decide/wheel";

// In its own voice throughout - the third wheel talking about itself, not a
// feature list.
const HOW_IT_WORKS = [
  {
    n: "01",
    title: "You each tell me what you want",
    body: "Type it or say it out loud, one after the other, on the same phone. Neither of you sees the other's answer first.",
  },
  {
    n: "02",
    title: "I weigh you both",
    body: "If it's close, I ask ONE quick question you answer together instead of guessing.",
  },
  {
    n: "03",
    title: "I spin, and dinner's decided",
    body: "The wheel lands on tonight's table, with a map pin and how sure I was.",
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
    body: `"Not that." "Not that either." I break the loop with one actual answer, not another suggestion to shoot down.`,
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
          <InstallButton className="hidden text-sm text-cream/60 underline underline-offset-4 hover:text-cream sm:inline" />
          <Link
            href="/decide"
            className="rounded-full bg-ember px-5 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Let your third wheel pick
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pt-10 pb-24 md:grid-cols-2 md:pt-20">
        <div>
          <p className="nav-dot text-sm font-medium tracking-wide text-cream/60">Your third wheel for dinner</p>

          <h1 className="font-display mt-6 max-w-xl text-5xl leading-[1.02] font-semibold tracking-tight md:text-6xl">
            Two of you. <span className="text-peach">One third wheel.</span> Dinner, decided.
          </h1>

          <p className="mt-6 max-w-md text-base text-cream/70">
            You each say what you want. I weigh it, ask one question if you&apos;re
            too close, and spin. No group chat, no twenty-minute scroll, no
            accounts required to try it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/decide"
              className="group inline-flex items-center gap-2 rounded-full bg-ember px-6 py-3 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
            >
              Let your third wheel pick
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
            <InstallButton className="text-sm text-cream/60 underline underline-offset-4 hover:text-cream" />
          </div>
        </div>

        {/* A live, idling version of the real wheel instead of a static
            graphic - the same canvas drawing this app actually spins with,
            just turning slowly and going nowhere in particular. */}
        <div className="mx-auto w-full max-w-[320px] md:max-w-[380px]">
          <IdleWheel />
        </div>
      </section>

      {/* How your third wheel works */}
      <section className="hairline mx-auto max-w-6xl px-6 py-16">
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
      <section className="hairline mx-auto max-w-6xl px-6 py-16">
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
      <footer className="hairline mx-auto max-w-6xl px-6 py-8">
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
            Every engine returns a plain probability, so the confidence rule and the mediator question behave the same
            no matter which one is selected.
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
    </div>
  );
}
