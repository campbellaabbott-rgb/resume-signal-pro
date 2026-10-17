import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

/**
 * WHAT WAS WRONG (SEO-024, spec 2026-10-12): wave 3 fixed L4-13 (the share
 * image and the favicon were JPEG bytes served from .png paths) by re-encoding
 * both as real PNGs, and both grew. The favicon became the 512 px app icon
 * (79,965 B) and the share image 477,461 B. The mobile homepage fetched the
 * favicon at High priority, beside the route chunks.
 *
 * What holds now, read from the files' own bytes and not from their names:
 * - every icon the static head, the manifest and the MCP server name exists,
 *   is the format its extension says, and has the pixel size it declares;
 * - the tab icon is at least 48 px (Google's favicon recommendation) and at
 *   most 10 KB; the touch icon is at least iOS's 180 px;
 * - favicon.ico, which browsers and crawlers fetch with no link, carries
 *   16, 32 and 48 px frames and stays small;
 * - the share image is one real PNG of the width and height the head declares,
 *   within 200 KB.
 * The budgets are the spec's bake guard. A .png path holding JPEG bytes fails
 * here, so this fix cannot re-open L4-13.
 */

const ROOT = resolve(__dirname, "../..");
const PUBLIC = resolve(ROOT, "public");
const SITE = "https://resumebooster.work";
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const TAB_ICON_MAX_BYTES = 10 * 1024;
const ICO_MAX_BYTES = 10 * 1024;
const SHARE_IMAGE_MAX_BYTES = 200 * 1024;
const TAB_ICON_MIN_PX = 48;
const TOUCH_ICON_MIN_PX = 180;
const ICO_FRAMES = [16, 32, 48];

const PNG_SIGNATURE = "89504e470d0a1a0a";
const MIME_BY_EXTENSION: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

type Size = { width: number; height: number };

/** Width and height from the PNG's IHDR, or null when the bytes are not a PNG. */
function pngSize(buf: Buffer): Size | null {
  if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) return null;
  if (buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

type IcoFrame = { declared: Size; actual: Size; format: "png" | "bmp" };

/** The ICO directory, each entry checked against the frame it points at. */
function icoFrames(buf: Buffer): IcoFrame[] {
  expect(buf.readUInt16LE(0), "ICO reserved word").toBe(0);
  expect(buf.readUInt16LE(2), "ICO type (1 = icon)").toBe(1);
  const count = buf.readUInt16LE(4);
  const frames: IcoFrame[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const declared = { width: buf[at] || 256, height: buf[at + 1] || 256 };
    const length = buf.readUInt32LE(at + 8);
    const offset = buf.readUInt32LE(at + 12);
    expect(offset + length, `ICO frame ${i} lies inside the file`).toBeLessThanOrEqual(buf.length);
    const frame = buf.subarray(offset, offset + length);
    const png = pngSize(frame);
    if (png) {
      frames.push({ declared, actual: png, format: "png" });
    } else {
      // A BMP frame is a bare DIB: BITMAPINFOHEADER, height doubled for the AND mask.
      expect(frame.readUInt32LE(0), `ICO frame ${i} is a PNG or a DIB`).toBe(40);
      frames.push({ declared, actual: { width: frame.readInt32LE(4), height: frame.readInt32LE(8) / 2 }, format: "bmp" });
    }
  }
  return frames;
}

/** `/x` or `https://resumebooster.work/x` -> the file under public/ that serves it. */
function publicFile(url: string): string {
  const path = url.startsWith(SITE) ? url.slice(SITE.length) : url;
  expect(path.startsWith("/"), `${url} is served from this site`).toBe(true);
  return resolve(PUBLIC, `.${path.split(/[?#]/)[0]}`);
}

/** The file exists and its bytes are the format its extension claims. */
function checkedImage(url: string): { file: string; bytes: Buffer; size: Size | null } {
  const file = publicFile(url);
  expect(existsSync(file), `${url} exists in public/`).toBe(true);
  const bytes = readFileSync(file);
  const ext = extname(file).toLowerCase();
  const size = pngSize(bytes);
  if (ext === ".png") {
    expect(size, `${url} is a real PNG (L4-13: never other bytes at a .png path)`).not.toBeNull();
  } else if (ext === ".ico") {
    expect(bytes.subarray(0, 4).toString("hex"), `${url} is a real ICO`).toBe("00000100");
  } else if (ext === ".svg") {
    expect(/^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(bytes.toString("utf8")), `${url} is an SVG`).toBe(true);
  } else {
    throw new Error(`${url}: no format check for ${ext}; add one before naming this file`);
  }
  return { file, bytes, size };
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

const shell = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
const links = [...shell.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
const metas = [...shell.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
const relHas = (link: Record<string, string>, rel: string) => (link.rel ?? "").toLowerCase().split(/\s+/).includes(rel);
const meta = (key: string) => metas.find((m) => m.property === key || m.name === key)?.content;

/** `sizes="192x192 512x512"` -> the sizes; `any` and absent give none. */
function declaredSizes(sizes: string | undefined): Size[] {
  return (sizes ?? "")
    .split(/\s+/)
    .map((s) => /^(\d+)x(\d+)$/i.exec(s))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
}

function expectDeclaredSize(url: string, size: Size | null, sizes: string | undefined, typeAttr?: string) {
  if (typeAttr === "image/png") expect(size, `${url} is declared image/png`).not.toBeNull();
  const declared = declaredSizes(sizes);
  if (declared.length === 0) return;
  expect(size, `${url} declares ${sizes}, so it must be a raster with an IHDR`).not.toBeNull();
  expect(declared, `${url} declares ${sizes} but is ${size!.width}x${size!.height}`).toContainEqual(size);
}

describe("the static head's icons", () => {
  const icons = links.filter((l) => relHas(l, "icon") || relHas(l, "apple-touch-icon"));

  it("names at least one tab icon and one touch icon (a guard that reads nothing passes against anything)", () => {
    expect(icons.filter((l) => relHas(l, "icon")).length).toBeGreaterThan(0);
    expect(icons.filter((l) => relHas(l, "apple-touch-icon")).length).toBeGreaterThan(0);
  });

  it.each(icons.map((l) => [l.rel, l.href, l] as const))("%s %s exists, is the format it claims, and is square at its declared size", (_rel, href, link) => {
    const { size } = checkedImage(href);
    expectDeclaredSize(href, size, link.sizes, link.type);
    if (size) expect(size.width, `${href} is square`).toBe(size.height);
  });

  it.each(icons.filter((l) => relHas(l, "icon")).map((l) => [l.href] as const))("tab icon %s is at least 48 px and within 10 KB", (href) => {
    const { bytes, size } = checkedImage(href);
    expect(bytes.length, `${href} is ${bytes.length} B`).toBeLessThanOrEqual(TAB_ICON_MAX_BYTES);
    if (size) expect(size.width, `${href} is ${size.width} px wide`).toBeGreaterThanOrEqual(TAB_ICON_MIN_PX);
  });

  it.each(icons.filter((l) => relHas(l, "apple-touch-icon")).map((l) => [l.href] as const))("touch icon %s is at least iOS's 180 px", (href) => {
    const { size } = checkedImage(href);
    expect(size, `${href} is a PNG`).not.toBeNull();
    expect(size!.width, `${href} is ${size!.width} px wide`).toBeGreaterThanOrEqual(TOUCH_ICON_MIN_PX);
    expect(size!.height).toBe(size!.width);
  });

  it("favicon.ico, fetched with no link by browsers and crawlers, carries 16, 32 and 48 px frames and stays within 10 KB", () => {
    const { bytes } = checkedImage("/favicon.ico");
    expect(bytes.length, `favicon.ico is ${bytes.length} B`).toBeLessThanOrEqual(ICO_MAX_BYTES);
    const frames = icoFrames(bytes);
    for (const f of frames) expect(f.actual, `an ICO entry declares ${f.declared.width}x${f.declared.height}`).toEqual(f.declared);
    expect(frames.map((f) => f.actual.width).sort((a, b) => a - b)).toEqual(ICO_FRAMES);
    for (const f of frames) expect(f.actual.height).toBe(f.actual.width);
  });
});

describe("the share image", () => {
  const ogImage = meta("og:image");
  const twitterImage = meta("twitter:image");

  it("og:image and twitter:image name the same file, a real PNG of the declared type, width and height, within 200 KB", () => {
    expect(ogImage, "the head declares og:image").toBeTruthy();
    expect(twitterImage, "twitter:image names the same file").toBe(ogImage);
    const { bytes, size } = checkedImage(ogImage!);
    const ext = extname(publicFile(ogImage!)).toLowerCase();
    const type = meta("og:image:type");
    if (type) expect(type, `og:image:type matches the ${ext} extension`).toBe(MIME_BY_EXTENSION[ext]);
    expect(bytes.length, `the share image is ${bytes.length} B`).toBeLessThanOrEqual(SHARE_IMAGE_MAX_BYTES);
    if (ext === ".png") {
      const width = Number(meta("og:image:width"));
      const height = Number(meta("og:image:height"));
      expect(width > 0 && height > 0, "the head declares og:image:width and og:image:height").toBe(true);
      expect(size).toEqual({ width, height });
    }
  });

  it("the SPA's default share image (SEO.tsx) is the file the static head names", () => {
    const code = codeOf(read("src/components/seo/SEO.tsx"));
    const m = /`\$\{SITE\}(\/[^`$]+)`/.exec(code);
    expect(m, "SEO.tsx builds its default image from SITE").not.toBeNull();
    checkedImage(m![1]);
    expect(`${SITE}${m![1]}`).toBe(ogImage);
  });
});

describe("the manifest's and the MCP server's icons", () => {
  type ManifestIcon = { src: string; sizes?: string; type?: string };
  const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
    icons?: ManifestIcon[];
    shortcuts?: Array<{ icons?: ManifestIcon[] }>;
  };
  const manifestIcons = [...(manifest.icons ?? []), ...(manifest.shortcuts ?? []).flatMap((s) => s.icons ?? [])];
  const headManifest = links.find((l) => relHas(l, "manifest"));

  it("the head links the manifest, which exists and names icons", () => {
    expect(headManifest?.href).toBe("/manifest.webmanifest");
    expect(statSync(publicFile(headManifest!.href)).isFile()).toBe(true);
    expect(manifestIcons.length).toBeGreaterThan(0);
    expect((manifest.icons ?? []).some((i) => declaredSizes(i.sizes).some((s) => s.width >= 512)), "an install-size (512 px) icon is declared").toBe(true);
  });

  it.each(manifestIcons.map((i) => [i.src, i.sizes ?? "(no sizes)", i] as const))("manifest icon %s exists at %s", (src, _sizes, icon) => {
    const { size } = checkedImage(src);
    expectDeclaredSize(src, size, icon.sizes, icon.type);
  });

  it("the MCP server's icons (agent-mcp SERVER_INFO) exist at the size they declare", () => {
    const code = codeOf(read("supabase/functions/agent-mcp/index.ts"));
    const found = [...code.matchAll(/src:\s*"(https:\/\/resumebooster\.work\/[^"]+)"[^}]*?sizes:\s*\[([^\]]*)\]/g)];
    expect(found.length, "agent-mcp declares at least one icon on this site").toBeGreaterThan(0);
    for (const [, src, sizes] of found) {
      const { size } = checkedImage(src);
      expectDeclaredSize(src, size, sizes.replace(/["',]/g, " "), "image/png");
    }
  });
});
