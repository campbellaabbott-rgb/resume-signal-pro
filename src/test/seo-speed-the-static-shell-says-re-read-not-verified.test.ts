import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WHAT WAS WRONG (OBS-3, SEO round of 2026-10-18): index.html is the page the
 * host serves whenever the bake does not run, and the file the bake copies its
 * head from. Its meta description, og:description and twitter:description said
 * the jobs are "re-verified all day". The owner's rule is that no page says
 * "verified": the board re-reads each employer's system, it does not verify a
 * posting. The bake replaces those tags on the pages it writes, so the word
 * reached a reader only when the bake did not run, which is exactly when
 * nothing else would catch it.
 *
 * What holds now: the three descriptions in the static head say the jobs are
 * re-read through the day, and no description, title or alt text in the head
 * uses any form of "verify".
 */
const HTML = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const HEAD = HTML.slice(0, HTML.indexOf("</head>"));

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}
const metas = [...HEAD.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
const meta = (key: string) => metas.find((m) => m.name === key || m.property === key)?.content;

describe("the static shell's descriptions", () => {
  const keys = ["description", "og:description", "twitter:description"];

  it.each(keys)("%s exists and says the jobs are re-read through the day", (key) => {
    const content = meta(key);
    expect(content, `index.html declares ${key}`).toBeTruthy();
    expect(content).toMatch(/re-read through the day/);
  });

  it("no title, description or image alt in the head says verified, verifies or re-verified", () => {
    const texts = [
      /<title>([\s\S]*?)<\/title>/.exec(HEAD)?.[1] ?? "",
      ...metas.filter((m) => /(description|title|image:alt)$/.test(m.name ?? m.property ?? "")).map((m) => m.content ?? ""),
    ];
    expect(texts.length, "the head was read").toBeGreaterThan(5);
    for (const text of texts) expect(text, text).not.toMatch(/verif/i);
  });
});
