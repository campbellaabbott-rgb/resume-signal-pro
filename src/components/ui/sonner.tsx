import { useEffect, useState } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { currentTheme, type Theme } from "@/lib/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Follows the document's data-theme (src/lib/theme.ts), not next-themes, which this app never mounted. */
function useDocumentTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => (typeof document === "undefined" ? "dark" : currentTheme()));
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useDocumentTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // Above the header (40) and any sheet (50): the toast layer is 60.
      style={{ zIndex: 60 }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border group-[.toaster]:border-border-strong group-[.toaster]:shadow-overlay group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
