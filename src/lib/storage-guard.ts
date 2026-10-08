/**
 * A BROWSER THAT BLOCKS SITE STORAGE STILL GETS THE SITE (sweep S8-104).
 *
 * With "Block all cookies", in some in-app browsers and in a sandboxed frame,
 * merely READING window.localStorage throws SecurityError. The generated
 * Supabase client (src/integrations/supabase/client.ts, which Lovable
 * regenerates, so it is not edited) hands `localStorage` to auth while the
 * module graph is being evaluated; the throw failed the whole graph and React
 * never mounted: a blank page.
 *
 * main.tsx imports this module FIRST, so before any other module touches
 * storage, each of localStorage and sessionStorage that cannot be used is
 * replaced on the window with an in-memory Storage for this page's life. The
 * session and every preference then last only until the tab closes, which is
 * what a visitor blocking storage has asked for; nothing else changes.
 */

type StorageName = "localStorage" | "sessionStorage";

function usable(win: Window, name: StorageName): boolean {
  try {
    const s = win[name];
    const probe = "__rb_storage_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** A Storage that lives in memory for this page. */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  };
}

/** Replace each storage the window cannot use; the names replaced. */
export function installStorageFallback(win: Window = window): StorageName[] {
  const replaced: StorageName[] = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (usable(win, name)) continue;
    try {
      Object.defineProperty(win, name, { value: memoryStorage(), configurable: true, enumerable: true });
      replaced.push(name);
    } catch {
      /* a host that refuses the replacement keeps its own behaviour */
    }
  }
  return replaced;
}

if (typeof window !== "undefined") installStorageFallback();
