import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MarketingKit } from "@/components/affiliate/MarketingKit";

/**
 * THE AFFILIATE BANNERS ARE THE SIZE THEIR LABELS SAY, AND THE KIT PROMISES
 * ONLY WHAT THE SCAN SHOWS (S14X-213).
 *
 * WHAT WAS WRONG: the Marketing Kit offered three banners labelled 728 x 90,
 * 300 x 250 and 160 x 600. The files were AI-generated images of 1456 x 512,
 * 512 x 512 and 512 x 1024 (JPEG bytes under .png names, so every download
 * was a JPEG called .png), and their lettering was garbled (the leaderboard
 * read "Scan Hr resume Free", the square "Geat foy ATS Score"). The 300 x 250
 * banner was previewed in a 1:1 frame. The HTML embed pointed at the bundle's
 * content-hashed /assets/ address, which disappears whenever the file
 * changes, so a banner an affiliate placed on a site broke on a later build.
 * The newsletter template said the scan analyses a resume against vendors'
 * algorithms and finds formatting that causes rejection; the scan does
 * neither. It shows how the file parses and the keywords it is missing.
 *
 * What holds now, read from the rendered kit and from the files' own bytes:
 * - every banner the kit shows is a file in public/affiliate/ whose real
 *   width and height (an SVG's root attributes and viewBox, a PNG's IHDR) are
 *   the ones its label prints, and the preview carries that width and height;
 * - the embed code names the file by its fixed public address, absolute,
 *   with the file's width and height, and marks the affiliate link sponsored;
 * - each download fetches a file from that fixed address and saves it under
 *   its own extension (a 404 is refused, never saved as an image);
 * - the SVGs are real lettering (the words sit in text elements) and carry
 *   no script, no event handler and no outside reference;
 * - every file in public/affiliate/ is one the kit offers;
 * - no template promises the analysis or the rejection the scan never makes,
 *   and the newsletter names what the scan does show.
 */

const ROOT = resolve(__dirname, "../..");
const PUBLIC = resolve(ROOT, "public");
const REF_LINK = "https://resumebooster.work?ref=0123456789ab";
const REF_CODE = "0123456789ab";

type Size = { width: number; height: number };

/** A served path ("/affiliate/x.png") or a Vite asset path ("/src/...") to the file on disk. */
function fileFor(src: string): string {
  const path = src.startsWith(window.location.origin) ? src.slice(window.location.origin.length) : src;
  return path.startsWith("/src/") ? resolve(ROOT, path.slice(1)) : resolve(PUBLIC, path.replace(/^\//, ""));
}

/** What the file's bytes are, whatever its name says. */
function formatOf(file: string): "png" | "jpeg" | "svg" | "other" {
  const buf = readFileSync(file);
  if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "png";
  if (buf.subarray(0, 3).toString("hex") === "ffd8ff") return "jpeg";
  return /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(buf.toString("utf8")) ? "svg" : "other";
}

/** The pixel size the file's own bytes declare, or null when they declare none. */
function sizeOf(file: string): Size | null {
  const buf = readFileSync(file);
  if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && buf.subarray(12, 16).toString("latin1") === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.subarray(0, 2).toString("hex") === "ffd8") {
    // A JPEG's size sits in its start-of-frame segment (SOF0-SOF15 but DHT, JPG and DAC).
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  const svg = new DOMParser().parseFromString(buf.toString("utf8"), "image/svg+xml").documentElement;
  if (svg.nodeName !== "svg") return null;
  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));
  const box = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (!(width > 0 && height > 0)) return null;
  if (box.length !== 4 || box[0] !== 0 || box[1] !== 0 || box[2] !== width || box[3] !== height) return null;
  return { width, height };
}

const LABEL = /^\s*(\d+)\s*[×x]\s*(\d+)\s*$/;

/** Each banner card the kit draws: its printed size and its preview image. */
function bannerCards(): { label: Size; img: HTMLImageElement; card: HTMLElement }[] {
  const labels = screen.getAllByText((_, el) => !!el && el.children.length === 0 && LABEL.test(el.textContent ?? ""));
  return labels.map((el) => {
    const m = LABEL.exec(el.textContent ?? "")!;
    let card: HTMLElement | null = el.parentElement;
    while (card && !card.querySelector("img")) card = card.parentElement;
    if (!card) throw new Error(`no preview image near the label ${el.textContent}`);
    return { label: { width: Number(m[1]), height: Number(m[2]) }, img: card.querySelector("img")!, card };
  });
}

let clipboard: string[] = [];
let fetched: string[] = [];
let saved: string[] = [];

beforeEach(() => {
  clipboard = [];
  fetched = [];
  saved = [];
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async (s: string) => { clipboard.push(s); }) },
    configurable: true,
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(String(url)); return new Response(new Blob(["x"])); }));
  URL.createObjectURL = vi.fn(() => "blob:banner");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the affiliate marketing kit's banners", () => {
  it("draws three banners, and each file is the width and height its label prints", () => {
    render(<MarketingKit referralLink={REF_LINK} referralCode={REF_CODE} />);
    const cards = bannerCards();
    expect(cards.map((c) => `${c.label.width}x${c.label.height}`).sort()).toEqual(["160x600", "300x250", "728x90"]);
    for (const { label, img } of cards) {
      const src = img.getAttribute("src") ?? "";
      const file = fileFor(src);
      expect(existsSync(file), `${src} is not a file in the repo`).toBe(true);
      expect(sizeOf(file), `${src} is labelled ${label.width} x ${label.height}`).toEqual(label);
      expect(formatOf(file), `${src} holds bytes of another format than its name`).toBe(src.endsWith(".svg") ? "svg" : "png");
      expect({ width: Number(img.getAttribute("width")), height: Number(img.getAttribute("height")) }, `the preview of ${src}`).toEqual(label);
    }
  });

  it("hands out an embed that names the file by its fixed public address, at its size, as a sponsored link", () => {
    render(<MarketingKit referralLink={REF_LINK} referralCode={REF_CODE} />);
    for (const { label, card } of bannerCards()) {
      clipboard = [];
      fireEvent.click(within(card).getByRole("button", { name: /html/i }));
      expect(clipboard, `the HTML button of the ${label.width} x ${label.height} banner`).toHaveLength(1);
      const doc = new DOMParser().parseFromString(clipboard[0], "text/html");
      const a = doc.querySelector("a");
      const img = doc.querySelector("a > img");
      expect(a?.getAttribute("href")).toBe(REF_LINK);
      expect((a?.getAttribute("rel") ?? "").split(/\s+/)).toEqual(expect.arrayContaining(["sponsored", "noopener"]));
      const src = img?.getAttribute("src") ?? "";
      expect(src.startsWith(`${window.location.origin}/affiliate/`), `${src} is not a fixed /affiliate/ address`).toBe(true);
      expect(existsSync(fileFor(src)), `${src} is not in public/`).toBe(true);
      expect(sizeOf(fileFor(src))).toEqual(label);
      expect({ width: Number(img?.getAttribute("width")), height: Number(img?.getAttribute("height")) }).toEqual(label);
      expect(img?.getAttribute("alt") ?? "").not.toBe("");
    }
  });

  it("saves each download from a fixed /affiliate/ file, under that file's own extension", async () => {
    render(<MarketingKit referralLink={REF_LINK} referralCode={REF_CODE} />);
    for (const { card } of bannerCards()) {
      const buttons = within(card).getAllByRole("button").filter((b) => !/html/i.test(b.textContent ?? ""));
      expect(buttons.length, "a banner offers at least one download").toBeGreaterThan(0);
      for (const b of buttons) {
        fetched = [];
        saved = [];
        fireEvent.click(b);
        await vi.waitFor(() => expect(saved).toHaveLength(1));
        expect(fetched).toHaveLength(1);
        const path = fetched[0].replace(window.location.origin, "");
        expect(path.startsWith("/affiliate/"), `${b.textContent} fetched ${path}`).toBe(true);
        const ext = path.slice(path.lastIndexOf("."));
        expect(saved[0].endsWith(ext), `${b.textContent} saved ${saved[0]} from ${path}`).toBe(true);
        expect(saved[0]).toContain(REF_CODE);
      }
    }
  });

  it("saves nothing when the file does not answer, rather than a page called .png", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(String(url));
      return new Response("<!doctype html><title>Not found</title>", { status: 404, headers: { "content-type": "text/html" } });
    }));
    render(<MarketingKit referralLink={REF_LINK} referralCode={REF_CODE} />);
    const [{ card }] = bannerCards();
    const download = within(card).getAllByRole("button").find((b) => !/html/i.test(b.textContent ?? ""))!;
    fireEvent.click(download);
    await vi.waitFor(() => expect(fetched).toHaveLength(1));
    // The handler's remaining steps are microtasks: one macrotask later they have all run.
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toEqual([]);
  });
});

describe("the banner files", () => {
  const dir = resolve(PUBLIC, "affiliate");
  const files = existsSync(dir) ? readdirSync(dir).sort() : [];

  it("are each a file the kit offers, one PNG and one SVG per size", () => {
    expect(files).toEqual([
      "banner-160x600.png", "banner-160x600.svg",
      "banner-300x250.png", "banner-300x250.svg",
      "banner-728x90.png", "banner-728x90.svg",
    ]);
    for (const f of files) {
      const m = /^banner-(\d+)x(\d+)\.(png|svg)$/.exec(f)!;
      expect(formatOf(resolve(dir, f)), f).toBe(m[3]);
      expect(sizeOf(resolve(dir, f)), f).toEqual({ width: Number(m[1]), height: Number(m[2]) });
    }
  });

  it("letter the SVGs as text, with no script, no handler and no outside reference", () => {
    const svgs = files.filter((f) => f.endsWith(".svg"));
    expect(svgs).toHaveLength(3);
    for (const f of svgs) {
      const src = readFileSync(resolve(dir, f), "utf8");
      const doc = new DOMParser().parseFromString(src, "image/svg+xml");
      expect(doc.querySelector("parsererror"), f).toBeNull();
      const words = Array.from(doc.querySelectorAll("text")).map((t) => t.textContent ?? "").join(" ").replace(/\s+/g, " ");
      expect(words, f).toMatch(/Resume Booster/i);
      expect(words, f).toMatch(/Scan my resume free/i);
      expect(words, f).toMatch(/keywords/i);
      expect(doc.querySelector("title")?.textContent ?? "", `${f} has no accessible title`).not.toBe("");
      expect(doc.querySelectorAll("script, foreignObject, image, use[href^='http'], a")).toHaveLength(0);
      for (const el of Array.from(doc.querySelectorAll("*"))) {
        for (const attr of Array.from(el.attributes)) {
          expect(/^on/i.test(attr.name), `${f} <${el.nodeName} ${attr.name}>`).toBe(false);
          if (/href$/i.test(attr.name)) expect(attr.value.startsWith("#"), `${f} <${el.nodeName} ${attr.name}="${attr.value}">`).toBe(true);
          expect(/url\(\s*['"]?(?!#)/i.test(attr.value), `${f} <${el.nodeName} ${attr.name}="${attr.value}">`).toBe(false);
        }
      }
      expect(src).not.toMatch(/@import|<style[^>]*>[^<]*url\(\s*['"]?(?!#)/i);
    }
  });
});

describe("the kit's copy templates", () => {
  it("promise no vendor-algorithm analysis and no rejection, and the newsletter names what the scan shows", () => {
    render(<MarketingKit referralLink={REF_LINK} referralCode={REF_CODE} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /email templates/i }), { button: 0 });
    const bodies = Array.from(document.querySelectorAll("pre")).map((p) => p.textContent ?? "");
    expect(bodies.length, "the email templates tab drew no template").toBeGreaterThanOrEqual(5);
    for (const body of bodies) {
      expect(body).not.toMatch(/ATS algorithms/i);
      expect(body).not.toMatch(/cause rejection/i);
    }
    const newsletter = bodies.find((b) => /Tool of the Week/i.test(b));
    expect(newsletter, "the newsletter template is gone").toBeDefined();
    expect(newsletter).toMatch(/how your file parses/i);
    expect(newsletter).toMatch(/keywords your resume is missing/i);
  });
});
