/**
 * THE HERO DROP ZONE SHOWS FOCUS AND OFFERS ONLY WHAT THE SCANNER READS
 * (S14X-257).
 *
 * The hero's drop zone is a label around a hidden file input. A keyboard user
 * tabbing to it saw no focus ring, and its picker offered ".doc", which the
 * scanner refuses after the pick (only PDF, DOCX and TXT are read). The label
 * now rings while its input has focus, and the picker offers the three types.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: null, error: null })), functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, from: () => ({ select: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) }) }) },
}));

import { Hero } from "@/components/Hero";

afterEach(cleanup);

function dropZone() {
  const { container } = render(<MemoryRouter><Hero onFileSelect={vi.fn()} /></MemoryRouter>);
  const input = container.querySelector('label input[type="file"]') as HTMLInputElement;
  expect(input, "the hero has no drop zone").toBeTruthy();
  return { label: input.closest("label") as HTMLLabelElement, input };
}

describe("the hero drop zone", () => {
  it("rings while its hidden input has keyboard focus", () => {
    const { label } = dropZone();
    expect(label.className.split(/\s+/)).toContain("focus-within:ring-2");
  });

  it("offers PDF, DOCX and TXT, and not the .doc the scanner refuses", () => {
    const { input } = dropZone();
    const tokens = (input.getAttribute("accept") ?? "").split(",").map((s) => s.trim());
    expect(tokens).toEqual(expect.arrayContaining([".pdf", ".docx", ".txt"]));
    expect(tokens).not.toContain(".doc");
    expect(tokens).not.toContain("application/msword");
  });
});
