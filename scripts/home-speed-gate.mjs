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
 * One row per measured case: the two medians, the two printed seconds and
 * the verdict. `runs` is the baseline's shape, { profile: { case: { old:
 * { lcpMs }, switchOver: { lcpMs } } } }. A gated case one build did not
 * measure throws: a gate that compares nothing passes against anything.
 */
export function judge(runs) {
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
      const oldMs = median(a), newMs = median(b);
      const oldS = tenths(oldMs), newS = tenths(newMs);
      rows.push({ profile, case: c, gated, oldMs, newMs, oldS, newS, pass: newS <= oldS });
    }
  }
  for (const p of GATED_PROFILES) if (!rows.some((r) => r.profile === p)) throw new Error(`${p}: no case was measured`);
  return rows;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = JSON.parse(readFileSync(resolve(here, "../docs/homepage-pricing/speed-baseline.json"), "utf8"));
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  let runs = baseline.runs;
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
    console.log(`new build: ${newFile}; old build: ${oldFile ?? `the stored runs of ${baseline.builds.old.commit} (${baseline.measured}), measured on another day: read the verdict as indicative`}`);
  } else {
    console.log(`stored runs (${baseline.measured}): old ${baseline.builds.old.commit}, new ${baseline.builds.switchOver.commit}`);
  }
  let rows;
  try { rows = judge(runs); } catch (e) { console.log(`REFUSED  ${e.message}`); process.exit(2); }
  for (const r of rows) {
    const verdict = r.gated ? (r.pass ? "PASS" : "FAIL") : "INFO";
    console.log(`${verdict.padEnd(5)}  ${r.profile.padEnd(17)} ${r.case.padEnd(24)} old ${r.oldS.toFixed(1)} s (median ${r.oldMs} ms)  new ${r.newS.toFixed(1)} s (median ${r.newMs} ms)`);
  }
  process.exit(rows.some((r) => r.gated && !r.pass) ? 1 : 0);
}
