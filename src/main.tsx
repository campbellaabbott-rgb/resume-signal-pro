// FIRST: blocked site storage must not stop the app mounting (S8-104).
import "./lib/storage-guard";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { applyTheme, resolveTheme } from "./lib/theme";
import { captureBakedLanderName } from "./lib/baked-lander-name";
import { mountBesidePrerendered } from "./lib/keep-prerendered-page";

// The theme attribute goes on <html> before anything paints from React, so
// no component renders once in the wrong palette. Dark for everyone unless
// ?theme=light (QA) asked otherwise; see src/lib/theme.ts.
applyTheme(resolveTheme(window.location.search));

// The prerendered company lander carries the employer's name in its <h1>.
// The baked markup leaves when the route renders, so the name is read here,
// before it is gone; the lander shows it while its own data loads instead of
// a name guessed from the board token.
captureBakedLanderName(document, window.location.pathname);

// We deploy many times a day; a tab opened before a deploy can request a
// lazy chunk whose hashed filename no longer exists, which surfaces as the
// "Something went wrong" boundary. Vite emits vite:preloadError for exactly
// this — reload once to pick up the new build (guard against loops).
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const KEY = "rb_chunk_reload_at";
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return; // already tried — don't loop
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* still reload */ }
  window.location.reload();
});

// The prerendered page stays on screen until React has the page: React mounts
// beside the baked markup, which leaves in the same task as the route's first
// commit (SEO-021, src/lib/keep-prerendered-page.ts). An unbaked page mounts
// into #root as before.
createRoot(mountBesidePrerendered(document, document.getElementById("root")!)).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>
);
