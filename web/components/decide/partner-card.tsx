"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { local } from "@/lib/safe-storage";
import { MicButton } from "@/components/decide/mic-button";
import { useSpeechRecognition, type SpeechErrorCode } from "@/lib/hooks/use-speech-recognition";
import { SEALED_LABEL, NO_PREFERENCE_LABEL } from "@/lib/copy";

/** A suggestion chip: plain text, or a label that inserts different words -
 * "Chicken" adds "must have chicken", which the server reads as a demand. */
export type Chip = string | { label: string; insert: string };

export interface ChipGroup {
  label: string;
  chips: Chip[];
}

// Whether the suggestion chips are unfolded. Remembered across rounds (and
// shared by both partners' cards) so someone who likes them open keeps them
// open, and everyone else gets the shorter panel with Done in easy reach.
const CHIPS_OPEN_KEY = "fw_chips_open";

const SPEECH_ERROR_MESSAGES: Record<SpeechErrorCode, string> = {
  "not-allowed": "Microphone blocked. Allow it in your browser settings.",
  "service-not-allowed": "Microphone blocked. Allow it in your browser settings.",
  "audio-capture": "No microphone found.",
  "no-speech": "Didn't catch that — try again.",
  network: "Voice needs a connection. Try typing instead.",
  other: "Voice input had a problem.",
};

/** A sealed/waiting-to-answer card, shown in the side-by-side grid. Tapping
 * it morphs it into `PartnerCardPanel` below - both share a layoutId per
 * partner number, so Motion animates the shared bounding box between them
 * (and later, on submit, into DecidingSequence's own matching-layoutId
 * pill - see that component). Never shows the sealed text itself; that's
 * the whole point of sealing it. */
export function PartnerCardCollapsed({
  number,
  label,
  sealed,
  hasText,
  disabled,
  accentVar,
  onOpen,
}: {
  number: 1 | 2;
  label: string;
  sealed: boolean;
  hasText: boolean;
  disabled: boolean;
  accentVar: "--p1" | "--p2";
  onOpen: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      layoutId={reduced ? undefined : `partner-${number}`}
      onClick={onOpen}
      disabled={disabled}
      className={cn(
        // w-full/h-full: this sits inside a plain wrapper div now (see
        // decide/page.tsx - each grid slot is a permanently-present box, so
        // the SIBLING card's box never changes when this one opens), and a
        // <button> doesn't stretch to fill its parent the way a direct grid
        // item does automatically - without these two it shrank to its
        // content's width, opening up a gap that wasn't there before.
        "glass flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl p-4 text-center transition-opacity",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold"
        style={{ color: `var(${accentVar})`, borderColor: `var(${accentVar})` }}
      >
        {number}
      </span>
      <p className="truncate text-sm font-medium text-cream">{label}</p>
      <p className="flex items-center gap-1 text-xs text-cream/50">
        {sealed && <Lock className="h-3 w-3" />}
        {sealed ? (hasText ? SEALED_LABEL : NO_PREFERENCE_LABEL) : "Tap to answer"}
      </p>
    </motion.button>
  );
}

/** The morphed-open editing panel - the textarea, mic and chip groups,
 * unchanged from the original single PartnerCard, plus Done/"Anything's
 * fine"/close. Shares its layoutId with the collapsed card it grew from. */
export function PartnerCardPanel({
  number,
  label,
  text,
  sealed,
  onTextChange,
  placeholder,
  chipGroups,
  accentVar,
  onDone,
  onNoPreference,
  onRedo,
  onClose,
  onSpeechError,
}: {
  number: 1 | 2;
  label: string;
  text: string;
  /** Sealed cards render as a blurred peek with a Redo option instead of
   * the editable form - opening one is safe to do (see decide/page.tsx's
   * OPEN_CARD), but must never itself reveal or discard the answer; only
   * tapping Redo does either. */
  sealed: boolean;
  onTextChange: (text: string, mode: "typed" | "voice") => void;
  placeholder: string;
  chipGroups: ChipGroup[];
  accentVar: "--p1" | "--p2";
  onDone: () => void;
  onNoPreference: () => void;
  onRedo: () => void;
  onClose: () => void;
  onSpeechError?: (message: string) => void;
}) {
  const reduced = useReducedMotion();
  const [interim, setInterim] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  // Read once on mount - this panel only ever mounts after a tap, in the
  // browser, so there's no server render for it to disagree with. Closed by
  // default: the suggestions are a shortcut, not the main way in.
  const [chipsOpen, setChipsOpen] = useState(() => local.get(CHIPS_OPEN_KEY, "0") === "1");
  const chipsId = `chips-${number}`;

  function toggleChips() {
    const next = !chipsOpen;
    setChipsOpen(next);
    local.set(CHIPS_OPEN_KEY, next ? "1" : "0");
  }

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

  return (
    <motion.div
      layoutId={reduced ? undefined : `partner-${number}`}
      initial={reduced ? { opacity: 0 } : false}
      animate={reduced ? { opacity: 1 } : undefined}
      exit={reduced ? { opacity: 0 } : undefined}
      // A noticeably more solid background than the shared .glass (6% tint)
      // - this is a modal-weight surface sitting over a now much-darker
      // backdrop, not a card blending into the canvas, and it read as
      // flimsy/see-through at glass's usual opacity.
      className="fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-line p-5 shadow-2xl backdrop-blur-xl md:inset-x-auto md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2"
      style={{ background: "color-mix(in oklab, var(--canvas-fg) 16%, var(--canvas))" }}
    >
      <motion.div layout="position" className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold"
            style={{ color: `var(${accentVar})`, borderColor: `var(${accentVar})` }}
          >
            {number}
          </span>
          <h2 className="text-sm font-medium tracking-wide text-cream/70 uppercase">{label}</h2>
        </div>
        <button type="button" onClick={onClose} className="text-cream/50 hover:text-cream" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </motion.div>

      {sealed ? (
        <>
          <div className="rounded-xl border border-line bg-glass px-4 py-3">
            <p aria-hidden className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-cream/70 blur-sm select-none">
              {text || NO_PREFERENCE_LABEL}
            </p>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-cream/50">
            <Lock className="h-3 w-3" />
            {SEALED_LABEL} — redo to change it
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onRedo}
              className="rounded-full bg-ember px-5 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              Redo
            </button>
          </div>
        </>
      ) : (
        <>
          <motion.div layout="position" className="relative">
            <textarea
              autoFocus
              rows={3}
              maxLength={500}
              value={text}
              onChange={(e) => onTextChange(e.target.value, "typed")}
              placeholder={placeholder}
              className="w-full resize-none rounded-xl border border-line bg-glass px-4 py-3 pr-12 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
            />
            {speech.isSupported && (
              <MicButton listening={speech.isListening} disabled={micBlocked} onClick={speech.toggle} />
            )}
          </motion.div>
          <motion.div layout="position" className="mt-1 min-h-[1rem] text-xs text-cream/40 italic">
            {interim && `"${interim}"`}
          </motion.div>

          <motion.button
            layout="position"
            type="button"
            aria-expanded={chipsOpen}
            aria-controls={chipsId}
            onClick={toggleChips}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-cream/60 transition-colors hover:text-cream"
          >
            Suggestions
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", chipsOpen && "rotate-180")} />
          </motion.button>

          {chipsOpen && (
            <motion.div layout="position" id={chipsId} className="mt-2 space-y-2">
              {chipGroups.map((group) => (
                <div key={group.label}>
                  <p className="mb-1 text-[10px] font-medium tracking-wide text-cream/35 uppercase">{group.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.chips.map((chip) => {
                      const label = typeof chip === "string" ? chip : chip.label;
                      const insert = typeof chip === "string" ? chip : chip.insert;
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            const sep = text && !/[\s,]$/.test(text) ? ", " : "";
                            onTextChange(text + sep + insert, "typed");
                          }}
                          className="rounded-full border border-line bg-glass px-3 py-1.5 text-xs text-cream/70 transition-colors hover:text-cream"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          <motion.div layout="position" className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onNoPreference}
              className="text-xs text-cream/50 underline underline-offset-4 hover:text-cream"
            >
              {NO_PREFERENCE_LABEL}
            </button>
            <button
              type="button"
              onClick={onDone}
              disabled={!text.trim()}
              className="rounded-full bg-ember px-5 py-2 text-sm font-medium text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              Done
            </button>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
