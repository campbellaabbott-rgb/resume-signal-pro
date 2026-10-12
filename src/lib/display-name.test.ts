import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bakedLanderName,
  cachedLanderName,
  captureBakedLanderName,
  cleanBoardLabel,
  displayBoard,
  displayEmployer,
  isGenericBoardLabel,
  landerDisplayName,
  rememberLanderName,
  resetBakedLanderName,
} from "./display-name";

function store(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe("the names the audit found on live landers", () => {
  it("collapses 'X | X'", () => {
    expect(cleanBoardLabel("Mint Velvet | Mint Velvet")).toBe("Mint Velvet");
    expect(cleanBoardLabel("Acme – acme")).toBe("Acme");
    // Two different halves are a real name.
    expect(cleanBoardLabel("Smith | Jones")).toBe("Smith | Jones");
  });

  it("strips a trailing career-website title", () => {
    expect(cleanBoardLabel("Prosperity Bank's career website")).toBe("Prosperity Bank");
    expect(cleanBoardLabel("Acme Careers Website")).toBe("Acme");
    expect(cleanBoardLabel("Career website")).toBe("Career website");
  });

  it("decodes entities and spaces", () => {
    expect(cleanBoardLabel("  Bob&#39;s Auto &amp; Towing ")).toBe("Bob's Auto & Towing");
  });

  it("marks a board label that names no employer", () => {
    for (const g of ["Corporate", "Open Roles", "Careers", "Jobs", "External", "Experience site", "careers"]) {
      expect(isGenericBoardLabel(g), g).toBe(true);
    }
    for (const n of ["Clear", "Anduril Industries", "Corporate One Federal Credit Union", "Jobs & Talent Ltd"]) {
      expect(isGenericBoardLabel(n), n).toBe(false);
    }
    expect(displayBoard("ukg:MIC1003MEI", "Corporate")).toEqual({ text: "Corporate", generic: true, source: "stored" });
  });

  it("employer and board names pass through the shared overrides", () => {
    expect(displayEmployer("ms~wd5~external", "Ms").text).toBe("Morgan Stanley");
    expect(displayEmployer("x", "").source).toBe("none");
  });
});

describe("a lander's name while its data loads: never built from the token", () => {
  beforeEach(() => resetBakedLanderName());
  afterEach(() => resetBakedLanderName());

  it("takes the baked <h1> the prerendered page carried", () => {
    document.body.innerHTML = '<div id="root"><main><h1>Open roles at Anduril Industries</h1></main></div>';
    captureBakedLanderName(document, "/jobs/company/andurilindustries");
    expect(bakedLanderName("andurilindustries")).toBe("Anduril Industries");
    expect(bakedLanderName("other")).toBeNull();
    const d = landerDisplayName({ token: "andurilindustries", storedName: null, cachedName: null });
    expect(d).toEqual({ text: "Anduril Industries", generic: false, source: "baked" });
  });

  it("records nothing off a company lander or from an unbaked heading", () => {
    document.body.innerHTML = '<div id="root"><h1>Live job board</h1></div>';
    captureBakedLanderName(document, "/jobs/company/acme");
    expect(bakedLanderName("acme")).toBeNull();
    document.body.innerHTML = '<div id="root"><h1>Open roles at Acme</h1></div>';
    captureBakedLanderName(document, "/jobs");
    expect(bakedLanderName("acme")).toBeNull();
  });

  it("prefers the stored name, then baked, then cached, then nothing (a skeleton)", () => {
    const s = store();
    rememberLanderName("andurilindustries", "Anduril Industries", s);
    expect(cachedLanderName("andurilindustries", s)).toBe("Anduril Industries");
    expect(landerDisplayName({ token: "andurilindustries", storedName: "Anduril", bakedName: "Baked", cachedName: "Cached" }).text).toBe("Anduril");
    expect(landerDisplayName({ token: "andurilindustries", storedName: null, bakedName: "Baked", cachedName: "Cached" }).source).toBe("baked");
    expect(landerDisplayName({ token: "andurilindustries", storedName: null, bakedName: null, cachedName: cachedLanderName("andurilindustries", s) }).source).toBe("cached");
    const none = landerDisplayName({ token: "andurilindustries", storedName: null, bakedName: null, cachedName: null });
    expect(none).toEqual({ text: "", generic: false, source: "none" });
    expect(none.text).not.toMatch(/andurilindustries/i);
  });

  it("a blocked store neither throws nor answers", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => rememberLanderName("a", "A", blocked)).not.toThrow();
    expect(cachedLanderName("a", blocked)).toBeNull();
  });
});
