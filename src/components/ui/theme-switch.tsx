import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { currentTheme, setTheme, themeQaActive, type Theme } from "@/lib/theme";

/**
 * The light/dark switch. BUILT, NOT PUBLIC: it renders only behind the QA
 * flag (a ?theme= address, or a remembered light pass), because dark stays
 * the served default until the owner flips it (design spec 2.6). A toggle
 * button whose pressed state is "light theme on".
 */
export function ThemeSwitch({ className, force = false }: { className?: string; force?: boolean }) {
  const { t } = useTranslation();
  const [theme, setLocal] = useState<Theme>(() => (typeof document === "undefined" ? "dark" : currentTheme()));
  if (!force && !themeQaActive()) return null;
  const light = theme === "light";
  return (
    <button
      type="button"
      aria-pressed={light}
      onClick={() => {
        const next: Theme = light ? "dark" : "light";
        setTheme(next);
        setLocal(next);
      }}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-card px-3 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11",
        className,
      )}
    >
      {light ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
      {t("ds.lightTheme", "Light theme")}
    </button>
  );
}
