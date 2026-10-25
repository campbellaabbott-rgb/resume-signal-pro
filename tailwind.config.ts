import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  // THE THEME IS AN ATTRIBUTE, NOT A CLASS. `dark:` utilities apply when the
  // document says data-theme="dark", or when nothing says light and the
  // system prefers dark. main.tsx writes the attribute before React mounts,
  // and in this release it writes "dark" for everyone unless ?theme=light.
  darkMode: [
    "variant",
    [
      "@media (prefers-color-scheme: dark) { &:not([data-theme=light] *) }",
      "&:is([data-theme=dark] *)",
    ],
  ],
  // index.html carries the skip link, whose focus: utilities (focus:top-4,
  // focus:z-50, focus:bg-primary...) were never generated while only src/ was
  // scanned: the first Tab stop on every page focused an invisible link under
  // the header (WCAG 2.4.7).
  content: ["./index.html", "./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      // Page gutter 16 / 24 / 32; content never wider than 1280.
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        xl: "1280px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "Inter Fallback", "system-ui", "sans-serif"],
        // Headings moved to Inter 600; the alias stays so no caller breaks.
        display: ["Inter", "Inter Fallback", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      // The scale. 12px is the floor: nothing on a page is smaller.
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        meta: ["0.8125rem", { lineHeight: "1.125rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.625rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.011em" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.011em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em" }],
        "5xl": ["3rem", { lineHeight: "3.25rem", letterSpacing: "-0.02em" }],
      },
      maxWidth: {
        reading: "68ch",
      },
      colors: {
        border: {
          DEFAULT: "hsl(var(--border))",
          strong: "hsl(var(--border-strong))",
        },
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        subtle: {
          foreground: "hsl(var(--subtle-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          tint: "hsl(var(--primary-tint))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          tint: "hsl(var(--destructive-tint))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          tint: "hsl(var(--success-tint))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          tint: "hsl(var(--warning-tint))",
        },
        signal: {
          DEFAULT: "hsl(var(--signal))",
          foreground: "hsl(var(--signal-foreground))",
          tint: "hsl(var(--signal-tint))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        overlay: "var(--shadow-overlay)",
      },
      zIndex: {
        sticky: "30",
        header: "40",
        help: "45",
        overlay: "50",
        toast: "60",
      },
      transitionDuration: {
        fast: "120ms",
        DEFAULT: "180ms",
        base: "180ms",
        slow: "240ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        DEFAULT: "cubic-bezier(0.2, 0, 0, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "collapsible-down": {
          from: { height: "0" },
          to: { height: "var(--radix-collapsible-content-height)" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)" },
          to: { height: "0" },
        },
        // Opacity only: nothing slides or bounces into place.
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 180ms cubic-bezier(0.2, 0, 0, 1)",
        "accordion-up": "accordion-up 180ms cubic-bezier(0.2, 0, 0, 1)",
        "collapsible-down": "collapsible-down 180ms cubic-bezier(0.2, 0, 0, 1)",
        "collapsible-up": "collapsible-up 180ms cubic-bezier(0.2, 0, 0, 1)",
        "fade-in": "fade-in 180ms cubic-bezier(0.2, 0, 0, 1) both",
        "slide-up": "slide-up 240ms cubic-bezier(0.2, 0, 0, 1) both",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // `coarse:` — a finger, not a mouse: the 44px target rule.
    plugin(({ addVariant }) => {
      addVariant("coarse", "@media (pointer: coarse)");
    }),
  ],
} satisfies Config;
