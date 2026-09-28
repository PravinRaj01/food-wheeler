// Wrapped so a private window or blocked storage never breaks the app -
// same reasoning as v1's safeStorage helper.
function make(kind: "localStorage" | "sessionStorage") {
  return {
    get(key: string, fallback: string): string {
      if (typeof window === "undefined") return fallback; // SSR: no storage to read
      try {
        const v = window[kind].getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key: string, value: string) {
      if (typeof window === "undefined") return;
      try {
        window[kind].setItem(key, value);
      } catch {
        /* ignore */
      }
    },
  };
}

export const local = make("localStorage");
export const session = make("sessionStorage");
