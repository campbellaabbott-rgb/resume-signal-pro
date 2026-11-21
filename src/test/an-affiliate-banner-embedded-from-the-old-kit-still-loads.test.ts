// @vitest-environment node
/**
 * AN AFFILIATE BANNER EMBEDDED FROM THE OLD KIT STILL LOADS (S14X-213, the
 * review of part B, 2026-11-17).
 *
 * WHAT WAS WRONG. The Marketing Kit's "Copy HTML embed" wrote the banner's
 * address as the page's origin plus Vite's hashed address of a file under
 * src/assets/banners/, so every banner an affiliate pasted onto a page points
 * at one of three names: /assets/banner-leaderboard-7wRFqWjL.png,
 * /assets/banner-square-Cs_OOO75.png and /assets/banner-skyscraper-CCTK8RI-.png
 * (each answered 200 image/png on 2026-11-17, JPEG bytes at 1456x512, 512x512
 * and 512x1024). S14X-213 moved the banners to /affiliate/ and deleted those
 * sources, so no build emits the three names again, and a publish stops
 * serving an earlier build's hashed files (an earlier Changelog chunk answered
 * 404 the same day). Once part B published, every embedded banner would have
 * shown a broken image; the referral link itself kept working.
 *
 * WHAT HOLDS NOW. public/assets/ carries the three names, so every build
 * copies them to the same addresses. Each is the corrected banner of the size
 * its old label named (728 x 90, 300 x 250, 160 x 600), byte for byte the
 * PNG the kit now offers under /affiliate/, so an old embed shows the right
 * banner and the two copies cannot drift apart. The old embed set no width or
 * height, so the banner shows at its own size. The kit itself never names the
 * old addresses again.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const PUBLIC = resolve(ROOT, "public");

/** The addresses the old kit's embed code wrote, with the size each banner's label named. */
const OLD_EMBEDS: Array<[string, number, number]> = [
  ["/assets/banner-leaderboard-7wRFqWjL.png", 728, 90],
  ["/assets/banner-square-Cs_OOO75.png", 300, 250],
  ["/assets/banner-skyscraper-CCTK8RI-.png", 160, 600],
];

/** A PNG's width and height from its IHDR chunk, or null when the bytes are not a PNG. */
function pngSize(bytes: Buffer): [number, number] | null {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("each address the old kit wrote into an embed still serves a banner", () => {
  for (const [path, w, h] of OLD_EMBEDS) {
    it(`${path} is a file the build copies to that address`, () => {
      expect(existsSync(resolve(PUBLIC, `.${path}`)), `public${path} is missing, so the next publish answers 404 there`).toBe(true);
    });

    it(`${path} is a PNG at ${w}x${h}, the size its label named`, () => {
      expect(pngSize(readFileSync(resolve(PUBLIC, `.${path}`)))).toEqual([w, h]);
    });

    it(`${path} is byte for byte the banner the kit now offers at /affiliate/banner-${w}x${h}.png`, () => {
      const kept = readFileSync(resolve(PUBLIC, `.${path}`));
      const offered = readFileSync(resolve(PUBLIC, `affiliate/banner-${w}x${h}.png`));
      expect(kept.equals(offered)).toBe(true);
    });
  }

  it("the kit no longer names an old address: they are kept only for embeds already pasted", () => {
    const kit = readFileSync(resolve(ROOT, "src/components/affiliate/MarketingKit.tsx"), "utf8");
    for (const [path] of OLD_EMBEDS) expect(kit).not.toContain(path.replace("/assets/", ""));
  });
});
