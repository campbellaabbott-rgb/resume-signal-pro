/**
 * A BROWSER THAT BLOCKS STORAGE GOT A BLANK PAGE (sweep S8-104).
 *
 * WHAT WAS WRONG. With site storage blocked, reading window.localStorage
 * throws SecurityError. The generated Supabase client hands `localStorage` to
 * auth at module evaluation (previewAuthStorage.ts), so the throw failed the
 * module graph and React never rendered.
 *
 * WHAT HOLDS NOW: the guard main.tsx loads first replaces an unusable storage
 * with an in-memory one, after which the generated storage broker answers and
 * works; a usable storage is left alone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installStorageFallback } from "@/lib/storage-guard";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
const block = () => Object.defineProperty(window, "localStorage", {
  configurable: true,
  get() { throw new DOMException("The operation is insecure.", "SecurityError"); },
});
afterEach(() => { Object.defineProperty(window, "localStorage", original); });

describe("storage blocked by the browser", () => {
  it("the generated client's storage broker throws, which is what blanked the page", () => {
    block();
    expect(() => brokeredPreviewStorage()).toThrow(/insecure/);
  });

  it("after the guard, the broker answers with a storage that works for the page", () => {
    block();
    expect(installStorageFallback()).toContain("localStorage");
    const s = brokeredPreviewStorage() as Storage;
    s.setItem("sb-auth", "token");
    expect(s.getItem("sb-auth")).toBe("token");
  });

  it("a usable storage is left exactly as it is", () => {
    localStorage.setItem("kept", "1");
    expect(installStorageFallback()).toEqual([]);
    expect(localStorage.getItem("kept")).toBe("1");
  });

  it("the guard is the first module the app loads, before anything that reads storage", () => {
    const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    const firstImport = /^import[^\n]*$/m.exec(main)?.[0];
    expect(firstImport).toBe('import "./lib/storage-guard";');
  });
});
