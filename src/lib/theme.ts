/**
 * THE THEME IS ONE ATTRIBUTE ON <html>: data-theme="dark" | "light".
 *
 * Dark is the served default for every visitor in this release. The light
 * palette exists, is measured (src/test/design-tokens-contrast.test.ts), and
 * is reachable only for QA through ?theme=light, which is remembered in this
 * browser so a QA pass can click through the site. ?theme=dark forgets it.
 *
 * The public switch and following the system preference are an owner
 * decision that waits on the raw-palette ratchet reaching zero, so
 * SYSTEM_DEFAULT_ENABLED stays false here and nothing reads
 * prefers-color-scheme to pick the served theme.
 *
 * Storage is wrapped: a browser that blocks site storage still renders, dark.
 */
export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "rb_theme";
export const THEME_QUERY_PARAM = "theme";
/** Flip only by owner decision (design spec 2.6, section 11). */
export const SYSTEM_DEFAULT_ENABLED = false;

const isTheme = (v: unknown): v is Theme => v === "dark" || v === "light";

export function readStoredTheme(storage: Pick<Storage, "getItem"> | null | undefined = safeLocalStorage()): Theme | null {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme: Theme | null, storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined = safeLocalStorage()): void {
  try {
    if (!storage) return;
    if (theme === null) storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* blocked storage: the choice lasts for this page only */
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Which theme this page load serves.
 *
 * ?theme=light|dark wins and is remembered (dark clears the memory, because
 * dark is the default). Otherwise a remembered QA choice. Otherwise dark.
 */
export function resolveTheme(search: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined = safeLocalStorage()): Theme {
  let asked: string | null = null;
  try {
    asked = new URLSearchParams(search).get(THEME_QUERY_PARAM);
  } catch {
    asked = null;
  }
  if (isTheme(asked)) {
    writeStoredTheme(asked === "dark" ? null : asked, storage);
    return asked;
  }
  return readStoredTheme(storage) ?? "dark";
}

/** Write the attribute. Called by main.tsx before React mounts. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
}

export function currentTheme(doc: Document = document): Theme {
  const v = doc.documentElement.dataset.theme;
  return isTheme(v) ? v : "dark";
}

/**
 * The QA flag: true when this browser asked for a theme by address
 * (?theme=light|dark) or remembers a light-theme QA pass. The ThemeSwitch
 * mounts only then; no visitor who never asked sees it.
 */
export function themeQaActive(
  search: string = typeof window !== "undefined" ? window.location.search : "",
  storage: Pick<Storage, "getItem"> | null | undefined = safeLocalStorage(),
): boolean {
  try {
    if (new URLSearchParams(search).has(THEME_QUERY_PARAM)) return true;
  } catch {
    /* fall through */
  }
  return readStoredTheme(storage) !== null;
}

/** Switch at runtime (the QA ThemeSwitch). Remembers light, forgets dark. */
export function setTheme(theme: Theme, doc: Document = document): void {
  applyTheme(theme, doc);
  writeStoredTheme(theme === "dark" ? null : theme);
}
