import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const robots = readFileSync("public/robots.txt", "utf8");
const groups = robots.split(/\n(?=User-agent:)/).filter((g) => g.startsWith("User-agent:"));
const group = (ua: string) => groups.find((g) => g.startsWith(`User-agent: ${ua}\n`)) ?? "";

describe("AI may show our jobs in search and answers but not train on them", () => {
  it("Every crawler group says search and AI answers are allowed and training is not", () => {
    expect(groups.length).toBeGreaterThan(10);
    for (const g of groups) expect(g).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
  });
  it("Training-only crawlers may read no page", () => {
    for (const ua of ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Applebot-Extended"]) expect(group(ua)).toMatch(/^Disallow: \/$/m);
  });
  it("Search and answer crawlers can still read the job pages", () => {
    for (const ua of ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot"]) expect(group(ua)).not.toMatch(/^Disallow: \/$/m);
  });
  it("The AI guide points agents to the AI connector as the preferred way in", () => {
    expect(readFileSync("public/llms.txt", "utf8")).toMatch(/Preferred way in:.*\/agents/);
  });
});
