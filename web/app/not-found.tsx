import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center text-cream">
      <Logo className="h-12 w-12 opacity-80" />
      <div>
        <h1 className="font-display text-xl font-semibold">Nothing here</h1>
        <p className="mt-1 text-sm text-cream/60">Even your third wheel can&apos;t find this page.</p>
      </div>
      <Link
        href="/decide"
        className="rounded-xl bg-ember px-6 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
      >
        Back to Decide
      </Link>
    </div>
  );
}
