import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Navigation } from "lucide-react";
import { getUserIdOrNull } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getDecisionForUser } from "@/lib/db/queries";
import { HistoryMap } from "@/components/history/history-map";

export default async function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdOrNull();
  if (!userId) redirect("/login");

  const row = await getDecisionForUser(getDb(), userId, id);
  if (!row) notFound();

  const w = row.winner;
  const pct = Math.round(row.confidence * 100);
  const directionsHref = `https://www.openstreetmap.org/directions?from=${w.lat}%2C${w.lng}&to=${w.lat}%2C${w.lng}`;

  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      <Link href="/history" className="mb-6 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-cream">
        <ArrowLeft className="h-4 w-4" /> History
      </Link>

      <p className="text-[11px] tracking-[0.15em] text-cream/40 uppercase">
        {new Date(row.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <div className="mb-1 flex items-start justify-between gap-3">
        <h1 className="font-display text-2xl text-cream">{w.name}</h1>
        <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--ember)_18%,transparent)] px-2.5 py-1 text-[11px] text-ember">
          {pct}% match · {row.engine}
        </span>
      </div>
      <p className="mb-3 text-sm text-cream/60">
        {w.cuisine} · {w.price} · {w.distance_km} km
      </p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {w.tags.map((t) => (
          <span key={t} className="rounded-full bg-glass px-2.5 py-1 text-[11px] text-cream/70">
            {t.replace("_", " ")}
          </span>
        ))}
      </div>

      <div className="glass mb-4 space-y-2 rounded-2xl p-4 text-sm">
        <p>
          <span className="text-cream/40">Partner One said:</span> {row.partner1Text || "—"}
        </p>
        <p>
          <span className="text-cream/40">Partner Two said:</span> {row.partner2Text || "—"}
        </p>
        {row.tiebreakers.length > 0 && (
          <p>
            <span className="text-cream/40">Settled on:</span> {row.tiebreakers.map((t) => t.text).join(" · ")}
          </p>
        )}
      </div>

      <div className="mb-5">
        <HistoryMap winner={w} matchPercent={pct} />
      </div>

      {row.runnerUps.length > 0 && (
        <p className="mb-5 text-xs text-cream/40">
          Also considered: {row.runnerUps.map((r) => `${r.name} (${Math.round(r.probability * 100)}%)`).join(", ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <a
          href={directionsHref}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-3 text-sm font-medium text-cream transition-colors hover:bg-glass"
        >
          <Navigation className="h-4 w-4" /> Directions
        </a>
        <Link
          href="/decide"
          className="flex items-center justify-center rounded-xl bg-ember py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          Decide again
        </Link>
      </div>
    </div>
  );
}
