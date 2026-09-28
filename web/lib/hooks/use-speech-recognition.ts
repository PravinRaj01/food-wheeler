"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type SpeechErrorCode = "not-allowed" | "service-not-allowed" | "audio-capture" | "no-speech" | "network" | "other";

interface Options {
  onFinalResult: (text: string) => void;
  onInterimResult?: (text: string) => void;
  onError?: (error: SpeechErrorCode) => void;
  onEnd?: () => void;
}

const ERROR_MAP: Record<string, SpeechErrorCode> = {
  "not-allowed": "not-allowed",
  "service-not-allowed": "service-not-allowed",
  "audio-capture": "audio-capture",
  "no-speech": "no-speech",
  network: "network",
};

// Feature support never changes mid-session, but the server has no
// meaningful answer (no window/navigator) - useSyncExternalStore's
// server-snapshot hand-off avoids a hydration mismatch, same as the
// isIOS check in install-prompt.tsx.
function subscribeNoop() {
  return () => {};
}
function getSupportSnapshot() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition) && window.isSecureContext !== false;
}
function getSupportServerSnapshot() {
  return false;
}

/** One recognizer per hook instance. The Decide flow only ever has one
 * partner card active at a time (the other is locked after handoff), but
 * callers should still call stop() before tearing down / switching cards -
 * matches the "only one mic active" rule from v1. */
export function useSpeechRecognition({ onFinalResult, onInterimResult, onError, onEnd }: Options) {
  const isSupported = useSyncExternalStore(subscribeNoop, getSupportSnapshot, getSupportServerSnapshot);
  const [isListening, setIsListening] = useState(false);
  const recognizerRef = useRef<SpeechRecognition | null>(null);
  const callbacksRef = useRef({ onFinalResult, onInterimResult, onError, onEnd });

  // Keeps the ref pointing at the latest closures. Runs after every render
  // (no deps array) rather than mutating the ref during render itself.
  useEffect(() => {
    callbacksRef.current = { onFinalResult, onInterimResult, onError, onEnd };
  });

  useEffect(() => {
    return () => {
      recognizerRef.current?.stop();
    };
  }, []);

  const stop = useCallback(() => {
    recognizerRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    recognizerRef.current?.stop();

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let finalTranscript = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interim += t;
      }
      if (finalTranscript) callbacksRef.current.onFinalResult(finalTranscript.trim());
      if (interim) callbacksRef.current.onInterimResult?.(interim);
    };
    rec.onerror = (event) => {
      callbacksRef.current.onError?.(ERROR_MAP[event.error] ?? "other");
    };
    rec.onend = () => {
      setIsListening(false);
      recognizerRef.current = null;
      callbacksRef.current.onEnd?.();
    };

    recognizerRef.current = rec;
    setIsListening(true);
    try {
      rec.start();
    } catch {
      setIsListening(false);
      recognizerRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return { isSupported, isListening, start, stop, toggle };
}
