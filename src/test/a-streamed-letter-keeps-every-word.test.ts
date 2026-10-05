// @vitest-environment node
/**
 * A STREAMED LETTER KEEPS EVERY WORD (register L5-04, L5-19).
 *
 * generate-cover-letter-stream decoded each network read on its own and split
 * it on newlines with no carry-over, so an SSE line cut between two reads was
 * dropped whole: a replica delivered 168 of 606 characters at 64-byte reads.
 * generate-premium-package-stream carried the remainder over but put an
 * unparseable COMPLETE line back on its buffer, where the newline loop took it
 * out again: an infinite loop on one malformed line.
 *
 * Both now use createGatewayDeltaReader (_shared/ai-fallback.ts). It is fed
 * the same gateway reply cut at EVERY byte boundary (multibyte characters
 * included) and must deliver the letter exactly; a malformed line must be
 * dropped and reading must go on.
 */
import { describe, expect, it } from "vitest";
import { createGatewayDeltaReader } from "../../supabase/functions/_shared/ai-fallback";

const LETTER = "Dear Hiring Manager,\n\nAt Acme I cut vendor spend by $250,000 — a 12% saving — and led the Zürich rollout. ".repeat(4) + "Best,\nJane";

/** The gateway's SSE reply for `text`, a few characters per delta, with keep-alive comments. */
function sse(text: string): string {
  let out = ": keep-alive\n\n";
  for (let i = 0; i < text.length; i += 7) {
    out += `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 7) } }] })}\n\n`;
  }
  return out + "data: [DONE]\n\n";
}

function relay(chunks: Uint8Array[]): { text: string; done: number; bad: number } {
  let text = "";
  let done = 0;
  let bad = 0;
  const r = createGatewayDeltaReader({ onContent: (c) => { text += c; }, onDone: () => { done++; }, onBadLine: () => { bad++; } });
  for (const c of chunks) r.push(c);
  r.flush();
  return { text, done, bad };
}

const cut = (bytes: Uint8Array, size: number): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
};

describe("the gateway reader", () => {
  const bytes = new TextEncoder().encode(sse(LETTER));

  it("delivers the letter exactly whatever size the network reads are", () => {
    for (const size of [1, 2, 3, 5, 7, 13, 64, 256, 1024, bytes.length]) {
      const { text, done, bad } = relay(cut(bytes, size));
      expect(text, `reads of ${size} bytes`).toBe(LETTER);
      expect(done).toBe(1);
      expect(bad).toBe(0);
    }
  });

  it("drops a malformed complete line and keeps reading (no infinite loop)", () => {
    const broken = new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"Dear "}}]}\n\ndata: {not json at all\n\ndata: {"choices":[{"delta":{"content":"Jane"}}]}\n\n`);
    const { text, bad } = relay(cut(broken, 9));
    expect(text).toBe("Dear Jane");
    expect(bad).toBe(1);
  });

  it("reads a last line that has no trailing newline", () => {
    const tail = new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"end"}}]}`);
    expect(relay([tail]).text).toBe("end");
  });
});
