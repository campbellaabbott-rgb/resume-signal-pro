/**
 * A TOAST ON THE HOMEPAGE DOES NOT SEARCH THE BOARD AGAIN (S11-084).
 *
 * The homepage builds the matches panel's keywords inline from the scan, a
 * new array on every render, and the panel's search depended on that array.
 * So every re-render of the page (a toast, a state change anywhere on it)
 * sent the board the same search again: five renders, five searches. The
 * search now depends on the query it sends, so the same query is one search,
 * and only a different one searches again.
 *
 * The host below renders the panel exactly as the homepage does: the role,
 * and the keywords mapped out of the scan's result on each render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invokeJobBoard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: (...a: unknown[]) => invokeJobBoard(...a) }));

import { AgentMatchesPanel } from "@/components/AgentMatchesPanel";

type Scan = { currentRole?: string; keywords: Array<{ keyword: string }> };

function Host({ scan, tick }: { scan: Scan; tick: number }) {
  return (
    <MemoryRouter>
      <div data-tick={tick}>
        <AgentMatchesPanel currentRole={scan.currentRole} keywords={(scan.keywords ?? []).map((k) => k.keyword)} />
      </div>
    </MemoryRouter>
  );
}

const SCAN: Scan = { keywords: [{ keyword: "python" }, { keyword: "sql" }, { keyword: "airflow" }] };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  invokeJobBoard.mockReset();
  invokeJobBoard.mockResolvedValue({ data: { jobs: [{ id: "1", title: "Data Engineer", company: "Acme" }], total: 1 }, error: null });
});
afterEach(() => cleanup());

describe("the homepage's matches panel", () => {
  it("searches once for five renders of the same scan", async () => {
    const view = render(<Host scan={SCAN} tick={0} />);
    for (let tick = 1; tick < 5; tick++) view.rerender(<Host scan={SCAN} tick={tick} />);
    await settle();
    expect(invokeJobBoard, "each re-render of the page sent the board the same search again").toHaveBeenCalledTimes(1);
    expect(invokeJobBoard.mock.calls[0][0]).toMatchObject({ body: { q: "python sql", limit: 5, page: 1 } });
  });

  it("searches again when the query is a different one", async () => {
    const view = render(<Host scan={SCAN} tick={0} />);
    await settle();
    view.rerender(<Host scan={{ ...SCAN, currentRole: "Analytics Engineer" }} tick={1} />);
    await settle();
    expect(invokeJobBoard).toHaveBeenCalledTimes(2);
    expect(invokeJobBoard.mock.calls[1][0]).toMatchObject({ body: { q: "Analytics Engineer" } });
  });

  it("does not search with too little to search by, however often it renders", async () => {
    const thin: Scan = { keywords: [{ keyword: "r" }] };
    const view = render(<Host scan={thin} tick={0} />);
    for (let tick = 1; tick < 5; tick++) view.rerender(<Host scan={thin} tick={tick} />);
    await settle();
    expect(invokeJobBoard).not.toHaveBeenCalled();
  });
});
