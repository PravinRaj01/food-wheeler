export default function HistoryLoading() {
  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-cream/50">Past decisions</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-cream">History</h1>

      <div className="mt-8 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass h-[60px] animate-pulse rounded-xl" />
        ))}
      </div>
    </div>
  );
}
