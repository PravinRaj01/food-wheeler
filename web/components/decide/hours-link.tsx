import { ExternalLink } from "lucide-react";
import { placeSearchLink } from "@/lib/decide/nav-links";
import { cn } from "@/lib/utils";

/** Our place data has no opening hours, and a place can match the meal and
 * still be closed - so say so, and make checking one tap. Opens the place's
 * own Google Maps card (see placeSearchLink), which shows its hours. */
export function HoursLink({
  place,
  className,
}: {
  place: { name: string; address?: string; lat: number; lng: number };
  className?: string;
}) {
  return (
    <p className={cn("text-[11px] text-cream/45", className)}>
      Opening hours aren&apos;t in our data —{" "}
      <a
        href={placeSearchLink(place)}
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-cream"
      >
        check them in Maps <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  );
}
