"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MicButton } from "@/components/decide/mic-button";
import { useSpeechRecognition, type SpeechErrorCode } from "@/lib/hooks/use-speech-recognition";

interface PartnerCardProps {
  number: 1 | 2;
  label: string;
  text: string;
  onTextChange: (text: string, mode: "typed" | "voice") => void;
  placeholder: string;
  chips: string[];
  state: "active" | "waiting" | "locked";
  accentVar: "--p1" | "--p2";
  onSpeechError?: (message: string) => void;
}

const SPEECH_ERROR_MESSAGES: Record<SpeechErrorCode, string> = {
  "not-allowed": "Microphone blocked. Allow it in your browser settings.",
  "service-not-allowed": "Microphone blocked. Allow it in your browser settings.",
  "audio-capture": "No microphone found.",
  "no-speech": "Didn't catch that — try again.",
  network: "Voice needs a connection. Try typing instead.",
  other: "Voice input had a problem.",
};

export function PartnerCard({
  number,
  label,
  text,
  onTextChange,
  placeholder,
  chips,
  state,
  accentVar,
  onSpeechError,
}: PartnerCardProps) {
  const [interim, setInterim] = useState("");
  const [peeking, setPeeking] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);

  // useSpeechRecognition stashes fresh callbacks in a ref on every render
  // (see its implementation), so this closure always sees the `text` value
  // from whichever render was current when speech actually finishes - no
  // extra ref needed here.
  const speech = useSpeechRecognition({
    onFinalResult: (final) => {
      const sep = text && !/\s$/.test(text) ? " " : "";
      onTextChange(text + sep + final, "voice");
      setInterim("");
    },
    onInterimResult: setInterim,
    onError: (err) => {
      onSpeechError?.(SPEECH_ERROR_MESSAGES[err]);
      if (err === "not-allowed" || err === "service-not-allowed") setMicBlocked(true);
    },
    onEnd: () => setInterim(""),
  });

  const isActive = state === "active";
  const isLocked = state === "locked";

  return (
    <div
      className={cn("surface glass rounded-2xl p-5 transition-opacity", !isActive && "opacity-55")}
      style={{ "--surface-tint": `var(${accentVar})` } as React.CSSProperties}
      onClick={() => isLocked && setPeeking((p) => !p)}
      role={isLocked ? "button" : undefined}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold"
            style={{ color: `var(${accentVar})`, borderColor: `var(${accentVar})` }}
          >
            {number}
          </span>
          <h2 className="text-sm font-medium tracking-wide text-cream/70 uppercase">{label}</h2>
        </div>
        <span className="text-[11px]" style={{ color: isActive ? `var(${accentVar})` : "var(--line-strong)" }}>
          {isActive ? "Your turn" : isLocked ? "Locked in" : "Waiting"}
        </span>
      </div>

      <div className="relative">
        <textarea
          rows={3}
          maxLength={500}
          value={text}
          disabled={!isActive}
          onChange={(e) => onTextChange(e.target.value, "typed")}
          placeholder={placeholder}
          className={cn(
            "w-full resize-none rounded-xl border border-line bg-glass px-4 py-3 pr-12 text-sm text-cream placeholder-cream/30 transition-[filter]",
            "outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
            isLocked && !peeking && "blur-md select-none",
          )}
        />
        {isActive && speech.isSupported && (
          <MicButton listening={speech.isListening} disabled={micBlocked} onClick={speech.toggle} />
        )}
      </div>
      <div className="mt-1 min-h-[1rem] text-xs text-cream/40 italic">{interim && `"${interim}"`}</div>

      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={!isActive}
            onClick={() => {
              const sep = text && !/[\s,]$/.test(text) ? ", " : "";
              onTextChange(text + sep + chip, "typed");
            }}
            className="rounded-full border border-line bg-glass px-3 py-1.5 text-xs text-cream/70 transition-colors enabled:hover:text-cream disabled:opacity-40"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
