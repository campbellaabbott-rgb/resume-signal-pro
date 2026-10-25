// THE PROFILE READER, LOADED ON DEMAND.
//
// _shared/resume-profile.ts carries fit-score's dictionary (about 83 KB
// minified, 27 KB gzipped), so it is a lazy chunk: preloaded when the drop
// zone renders, awaited when text exists. The target is the strip within
// 150 ms of the text being available, first call included (about 24 ms on a
// Mac, about 100 ms on a 4x-throttled phone). Nothing is sent anywhere here.

type Reader = typeof import("../../../supabase/functions/_shared/resume-profile");

let pending: Promise<Reader> | null = null;

/** Start loading the reader's chunk (call when the drop zone renders). */
export function preloadProfileReader(): Promise<Reader> {
  pending ??= import("../../../supabase/functions/_shared/resume-profile");
  return pending;
}

/** Read a profile from text on this device. */
export async function readProfileOnDevice(text: string, nowYear = new Date().getUTCFullYear()) {
  const m = await preloadProfileReader();
  return m.readProfile(text, { nowYear });
}
