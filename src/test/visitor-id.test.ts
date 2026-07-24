// The visitor id is the silent single point of failure for ALL analytics:
// track-ab-event rejects a malformed id with a 400 and postTrackEvent swallows
// the failure, so a bad format loses every event with no error anywhere.
// Diagnosed live on 2026-07-24 — the board sent "unknown" and the error hooks
// sent `v_<epoch>_<rand>`; both were rejected and job_board had recorded
// literally zero events. These tests pin the contract.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getVisitorId } from "../lib/track-transport";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's own guard, mirrored: track-ab-event 400s outside this range. */
const serverAccepts = (id: string) => id.length >= 8 && id.length <= 64;

describe("getVisitorId", () => {
  beforeEach(() => {
    // Un-stub BEFORE clearing: the private-mode test replaces localStorage with
    // a throwing stub that has no clear().
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("mints a UUID the analytics endpoint will accept", () => {
    const id = getVisitorId();
    expect(id).toMatch(UUID_RE);
    expect(id).toHaveLength(36);
    expect(serverAccepts(id)).toBe(true);
  });

  it("persists across calls so a visitor stays one visitor", () => {
    const first = getVisitorId();
    expect(getVisitorId()).toBe(first);
    expect(localStorage.getItem("rb_visitor_id")).toBe(first);
  });

  it("self-heals the legacy v_<epoch>_<rand> format that was being rejected", () => {
    localStorage.setItem("rb_visitor_id", "v_1784936171593_d2u1jnsls");
    const id = getVisitorId();
    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem("rb_visitor_id")).toBe(id);
  });

  it('self-heals the literal "unknown" the board used to send', () => {
    localStorage.setItem("rb_visitor_id", "unknown");
    expect(getVisitorId()).toMatch(UUID_RE);
  });

  it("returns a usable id even when localStorage throws (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    });
    const id = getVisitorId();
    expect(id).toMatch(UUID_RE);
    expect(serverAccepts(id)).toBe(true);
  });

  it("every id it can produce clears the server's length guard", () => {
    for (let i = 0; i < 50; i++) {
      localStorage.clear();
      expect(serverAccepts(getVisitorId())).toBe(true);
    }
  });
});
