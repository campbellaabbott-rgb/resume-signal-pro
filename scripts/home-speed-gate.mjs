#!/usr/bin/env node
/**
 * THE SWITCH-OVER'S SPEED GATE: THE NEW "/" IS NEVER SLOWER THAN THE OLD ONE
 * (owner decision 2026-10-27; docs/homepage-pricing/README.md, step 15).
 *
 * On the Lighthouse mobile profile and on the unthrottled 4x-CPU profile, for
 * every case measured (viewport, first visit or consent already chosen), the
 * median LCP of the new build, rounded to the 0.1 s Lighthouse prints, is no
 * more than the old build's median rounded the same way. The desktop rows are
 * printed as the record and gate nothing.
 *
 * THE MARGIN (the review of 2026-10-27). Reading tenths makes the verdict
 * depend on where the two medians sit against the rounding edges as much as
 * on how far apart they are: a regression of up to 99 ms inside one tenth
 * passes, and a shift of a few ms across an edge fails. The owner's reading
 * stays the verdict, and every row also prints the unrounded difference, each
 * median's distance from the nearer edge of its tenth, the shift in one median
 * that would flip the verdict, and the runs' own spread (a flip inside that
 * spread is noise-sized). A re-measure takes five runs a case of every build
 * it measures (RE_MEASURE_RUNS), so its medians move less with one slow run;
 * the stored baseline's three runs a case are the record.
 *
 * The baseline is docs/homepage-pricing/speed-baseline.json: the old build
 * (5c74e112) and the switch-over build (8d8113ed), three runs a case each,
 * measured together on one machine on 2026-10-26. Absolute LCP moves with the
 * machine, so a re-measure measures BOTH builds again, the same way, and is
 * judged here; the stored runs are the record and the fallback for the old
 * build when it cannot be rebuilt.
 *
 *   node scripts/home-speed-gate.mjs                    judge the stored runs
 *   node scripts/home-speed-gate.mjs --new a.jsonl[,b.jsonl]   the probe's output for the new build
 *                    [--old c.jsonl[,d.jsonl]]               and for the old one (else the stored old runs)
 *
 * The probe lines are {"cfg": ..., "run": ..., "lcpMs": ...} as the method's
 * tool prints them. Exit 0 when every gated case holds, 1 when one does not,
 * 2 on a case one build did not measure.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATED_PROFILES = ["lighthouseMobile", "unthrottled4xCpu"];

/** Runs a case a re-measure takes of each build it measures. */
export const RE_MEASURE_RUNS = 5;

/** The probe's configuration names, by profile and case. */
const PROBE_CASES = {
  "phone4x-slow4g": ["lighthouseMobile", "375x812 first visit"],
  "phone4x-slow4g+consent": ["lighthouseMobile", "375x812 consent chosen"],
  "phone320-slow4g": ["lighthouseMobile", "320x640 first visit"],
  "phone414-slow4g": ["lighthouseMobile", "414x896 first visit"],
  "phone4x": ["unthrottled4xCpu", "375x812 first visit"],
  "phone4x+consent": ["unthrottled4xCpu", "375x812 consent chosen"],
  "desktop": ["desktop", "1280x800 first visit"],
  "desktop+consent": ["desktop", "1280x800 consent chosen"],
  "desktop1280": ["desktop", "1280x800 first visit"],
  "desktop1280+consent": ["desktop", "1280x800 consent chosen"],
};

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Milliseconds as the seconds Lighthouse prints: one decimal. */
export function tenths(ms) {
  return Math.round(ms / 100) / 10;
}

/** The middle of the tenth a value rounds to, in ms (2,236 -> 2,200). */
const centre = (ms) => Math.round(ms / 100) * 100;

/**
 * How far a median sits from the two edges of its tenth: `belowMs` above the
 * lower edge (falling past it changes the tenth), `aboveMs` under the upper
 * edge (reaching it changes the tenth). 2,236 ms: 86 above 2.15 s, 14 under 2.25 s.
 */
export function edgeOf(ms) {
  const c = centre(ms);
  return { belowMs: round1(ms - (c - 50)), aboveMs: round1(c + 50 - ms), lowerS: (c - 50) / 1000, upperS: (c + 50) / 1000 };
}

const round1 = (x) => Math.round(x * 10) / 10;
const range = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

/**
 * The smallest shift of one median, in ms, that flips the verdict: for a
 * pass, the new median rising to the edge above the old one's tenth or the
 * old median falling below the edge under the new one's; for a fail, the
 * reverse.
 */
export function flipMs(oldMs, newMs) {
  const oc = centre(oldMs), nc = centre(newMs);
  const pass = tenths(newMs) <= tenths(oldMs);
  return round1(pass
    ? Math.min(oc + 50 - newMs, oldMs - (nc - 50) + 1)
    : Math.min(newMs - (oc + 50) + 1, nc - 50 - oldMs));
}

/** The probe's JSON lines as { profile: { case: [lcpMs, ...] } }. */
export function runsFromProbe(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const at = o && PROBE_CASES[o.cfg];
    if (!at || typeof o.lcpMs !== "number") continue;
    const [profile, c] = at;
    ((out[profile] ??= {})[c] ??= []).push(o.lcpMs);
  }
  return out;
}

/**
 * One row per measured case: the two medians, the two printed seconds, the
 * verdict and its margin. `runs` is the baseline's shape, { profile: { case:
 * { old: { lcpMs }, switchOver: { lcpMs } } } }. A gated case one build did
 * not measure throws: a gate that compares nothing passes against anything.
 * `minRuns` ({ old, switchOver }) is the runs a gated case needs from each
 * build: a re-measure asks RE_MEASURE_RUNS of every build it measured.
 */
export function judge(runs, { minRuns } = {}) {
  const rows = [];
  for (const [profile, cases] of Object.entries(runs)) {
    const gated = GATED_PROFILES.includes(profile);
    for (const [c, builds] of Object.entries(cases)) {
      const a = builds?.old?.lcpMs ?? [];
      const b = builds?.switchOver?.lcpMs ?? [];
      if (!a.length || !b.length) {
        if (gated) throw new Error(`${profile} ${c}: ${!a.length ? "the old build" : "the new build"} was not measured`);
        continue;
      }
      if (gated && minRuns) {
        for (const [build, xs] of [["old", a], ["switchOver", b]]) {
          const need = minRuns[build] ?? 0;
          if (xs.length < need) throw new Error(`${profile} ${c}: the ${build === "old" ? "old" : "new"} build has ${xs.length} runs; a re-measure takes ${need === RE_MEASURE_RUNS ? "five runs" : `${need} runs`} a case`);
        }
      }
      const oldMs = median(a), newMs = median(b);
      const oldS = tenths(oldMs), newS = tenths(newMs);
      const flip = flipMs(oldMs, newMs);
      const spreadMs = Math.max(range(a), range(b));
      rows.push({
        profile, case: c, gated, oldMs, newMs, oldS, newS, pass: newS <= oldS,
        deltaMs: round1(newMs - oldMs), oldEdge: edgeOf(oldMs), newEdge: edgeOf(newMs),
        flipMs: flip, spreadMs, nearEdge: flip <= spreadMs,
      });
    }
  }
  for (const p of GATED_PROFILES) if (!rows.some((r) => r.profile === p)) throw new Error(`${p}: no case was measured`);
  return rows;
}

const num = (x) => (Number.isInteger(x) ? x.toLocaleString("en-US") : x.toFixed(1));
const nearer = (e) => (e.belowMs <= e.aboveMs
  ? `${num(e.belowMs)} ms above the ${e.lowerS.toFixed(2)} s edge`
  : `${num(e.aboveMs)} ms below the ${e.upperS.toFixed(2)} s edge`);

/** One printed line: the verdict, both medians with their nearer edge, the difference and the margin. */
export function formatRow(r) {
  const verdict = r.gated ? (r.pass ? "PASS" : "FAIL") : "INFO";
  const sign = r.deltaMs >= 0 ? "+" : "-";
  const margin = r.nearEdge
    ? `inside the runs' own ${num(r.spreadMs)} ms spread`
    : `the runs' own spread is ${num(r.spreadMs)} ms`;
  return `${verdict.padEnd(5)}  ${r.profile.padEnd(17)} ${r.case.padEnd(24)} `
    + `old ${r.oldS.toFixed(1)} s (median ${num(r.oldMs)} ms, ${nearer(r.oldEdge)})  `
    + `new ${r.newS.toFixed(1)} s (median ${num(r.newMs)} ms, ${nearer(r.newEdge)})  `
    + `difference ${sign}${num(Math.abs(r.deltaMs))} ms; the verdict flips with a shift of ${num(r.flipMs)} ms in one median, ${margin}`;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = JSON.parse(readFileSync(resolve(here, "../docs/homepage-pricing/speed-baseline.json"), "utf8"));
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  let runs = baseline.runs;
  let minRuns;
  const newFile = arg("--new"), oldFile = arg("--old");
  if (newFile) {
    const lines = (list) => list.split(",").map((f) => readFileSync(f, "utf8")).join("\n");
    const fresh = runsFromProbe(lines(newFile));
    const old = oldFile ? runsFromProbe(lines(oldFile)) : null;
    runs = {};
    for (const [profile, cases] of Object.entries(baseline.runs)) {
      runs[profile] = {};
      for (const c of Object.keys(cases)) {
        runs[profile][c] = {
          old: { lcpMs: old ? (old[profile]?.[c] ?? []) : cases[c].old.lcpMs },
          switchOver: { lcpMs: fresh[profile]?.[c] ?? [] },
        };
      }
    }
    minRuns = { switchOver: RE_MEASURE_RUNS, old: oldFile ? RE_MEASURE_RUNS : 0 };
    console.log(`new build: ${newFile}; old build: ${oldFile ?? `the stored runs of ${baseline.builds.old.commit} (${baseline.measured}), measured on another day: read the verdict as indicative`}`);
  } else {
    console.log(`stored runs (${baseline.measured}): old ${baseline.builds.old.commit}, new ${baseline.builds.switchOver.commit}`);
  }
  let rows;
  try { rows = judge(runs, { minRuns }); } catch (e) { console.log(`REFUSED  ${e.message}`); process.exit(2); }
  for (const r of rows) console.log(formatRow(r));
  const gated = rows.filter((r) => r.gated);
  const closest = gated.reduce((m, r) => (r.flipMs < m.flipMs ? r : m), gated[0]);
  console.log(`MARGIN the verdict reads tenths of a second: a regression of up to 99 ms inside one tenth passes and a shift of a few ms across an edge fails, so read the difference beside each verdict. Closest gated case: ${closest.profile} ${closest.case}, which flips with a shift of ${num(closest.flipMs)} ms (${closest.nearEdge ? "inside" : "outside"} its runs' ${num(closest.spreadMs)} ms spread).`);
  process.exit(rows.some((r) => r.gated && !r.pass) ? 1 : 0);
}
