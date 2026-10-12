import { describe, expect, it } from "vitest";
import { applyTheme, currentTheme, readStoredTheme, resolveTheme, SYSTEM_DEFAULT_ENABLED, themeQaActive, THEME_STORAGE_KEY } from "./theme";

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe("the served theme", () => {
  it("is dark for everyone who did not ask", () => {
    expect(resolveTheme("", store())).toBe("dark");
    expect(resolveTheme("?q=nurse", store())).toBe("dark");
    expect(SYSTEM_DEFAULT_ENABLED).toBe(false);
  });

  it("?theme=light is reachable for QA and remembered; ?theme=dark forgets it", () => {
    const s = store();
    expect(resolveTheme("?theme=light", s)).toBe("light");
    expect(s.dump()[THEME_STORAGE_KEY]).toBe("light");
    expect(resolveTheme("", s)).toBe("light");
    expect(resolveTheme("?theme=dark", s)).toBe("dark");
    expect(s.dump()[THEME_STORAGE_KEY]).toBeUndefined();
    expect(resolveTheme("?theme=purple", s)).toBe("dark");
  });

  it("a blocked store serves dark and never throws", () => {
    const blocked = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(resolveTheme("?theme=light", blocked)).toBe("light");
    expect(resolveTheme("", blocked)).toBe("dark");
    expect(readStoredTheme(blocked)).toBeNull();
  });

  it("writes one attribute on <html>", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(currentTheme()).toBe("light");
    applyTheme("dark");
    expect(currentTheme()).toBe("dark");
  });

  it("the QA switch shows only to a browser that asked", () => {
    expect(themeQaActive("", store())).toBe(false);
    expect(themeQaActive("?theme=light", store())).toBe(true);
    expect(themeQaActive("", store({ [THEME_STORAGE_KEY]: "light" }))).toBe(true);
  });
});
