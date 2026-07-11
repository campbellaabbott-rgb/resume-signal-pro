import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>
);
