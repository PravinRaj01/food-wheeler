"use client";

import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

export function MicButton({
  listening,
  disabled,
  onClick,
}: {
  listening: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening" : "Start voice input"}
      className={cn(
        "absolute bottom-1.5 right-1.5 flex h-11 w-11 items-center justify-center rounded-full transition-all",
        listening ? "bg-ember text-ink" : "text-cream/60 hover:text-cream",
        disabled && "cursor-not-allowed opacity-30",
      )}
      style={listening ? { animation: "mic-pulse 1.6s ease-in-out infinite" } : undefined}
    >
      <Mic className="h-4 w-4" />
      <style>{`
        @keyframes mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(251,146,60,0.5); }
          50% { box-shadow: 0 0 0 10px rgba(251,146,60,0); }
        }
      `}</style>
    </button>
  );
}
