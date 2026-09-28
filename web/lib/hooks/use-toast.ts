"use client";

import { useCallback, useState } from "react";

export interface ToastItem {
  id: number;
  message: string;
}

let nextId = 1;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, ms = 2600) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  return { toasts, toast };
}
