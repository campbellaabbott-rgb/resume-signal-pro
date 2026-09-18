// Where the tests find the saved samples: the real EDGAR documents, Atom
// pages, submissions JSON and state WARN files the research pass fetched on
// 2026-09-18. They live in the repository under scripts/data/layoff-samples/
// (not under supabase/functions/: the deploy runner moves anything that is
// not TypeScript out of a function directory, which is what happened to the
// classifier's anchors JSON on 2026-09-15). Point LAYOFF_SAMPLES_DIR elsewhere
// to run the same tests against a fresh capture.
const DEFAULT_DIR = new URL("../../../scripts/data/layoff-samples/", import.meta.url).pathname.replace(/\/$/, "");

export function samplesDir(): string {
  const dir = Deno.env.get("LAYOFF_SAMPLES_DIR") ?? DEFAULT_DIR;
  try {
    const st = Deno.statSync(dir);
    if (!st.isDirectory) throw new Error("not a directory");
  } catch {
    throw new Error(`layoff samples not found at ${dir} — set LAYOFF_SAMPLES_DIR to the saved research data`);
  }
  return dir;
}

export function sampleText(name: string): string {
  return Deno.readTextFileSync(`${samplesDir()}/${name}`);
}

export function sampleBytes(name: string): Uint8Array {
  return Deno.readFileSync(`${samplesDir()}/${name}`);
}

export function sampleJson<T = unknown>(name: string): T {
  return JSON.parse(sampleText(name)) as T;
}

export function sampleList(sub: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(`${samplesDir()}/${sub}`)) if (e.isFile && e.name.endsWith(ext)) out.push(e.name);
  return out.sort();
}
