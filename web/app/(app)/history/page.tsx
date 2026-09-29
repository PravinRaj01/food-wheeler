import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserIdOrNull } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listDecisionsForUser } from "@/lib/db/queries";
import { formatDistance } from "@/lib/decide/distance";

function groupByDay(rows: Awaited<ReturnType<typeof listDecisionsForUser>>) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = new Date(row.createdAt).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

export default async function HistoryPage() {
  // Middleware already protects this route (see lib/auth.config.ts), but a
  // server component that touches user data should never trust that alone.
  const userId = await getUserIdOrNull();
  if (!userId) redirect("/login");

  const allRows = await listDecisionsForUser(getDb(), userId);
  // Demo-era rows (source "mock") are stale test data from before location
  // enforcement existed - some sat thousands of km from wherever they were
  // made. They're not a real decision the couple can revisit, so they're
  // hidden here rather than deleted outright.
  const rows = allRows.filter((row) => row.source !== "mock");
  const groups = groupByDay(rows);

  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-cream/50">Past decisions</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-cream">History</h1>

      {rows.length === 0 && (
        <p className="mt-8 text-sm text-cream/50">
          No decisions yet.{" "}
          <Link href="/decide" className="underline">
            Go decide something
          </Link>
          .
        </p>
      )}

      <div className="mt-8 space-y-8">
        {Array.from(groups.entries()).map(([day, dayRows]) => (
          <div key={day}>
            <p className="mb-3 text-xs font-medium tracking-wide text-cream/40 uppercase">{day}</p>
            <div className="space-y-2">
              {dayRows.map((row) => (
                <Link
                  key={row.id}
                  href={`/history/${row.id}`}
                  className="glass block rounded-xl p-4 transition-colors hover:bg-glass-strong"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-cream">{row.winner.name}</p>
                      <p className="mt-0.5 text-xs text-cream/50">
                        {row.winner.cuisine} · {formatDistance(row.winner)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--ember)_18%,transparent)] px-2 py-1 text-[11px] text-ember">
                      {Math.round(row.confidence * 100)}%
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
