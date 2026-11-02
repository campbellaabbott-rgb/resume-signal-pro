import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface NavSection {
  id: string;
  label: string;
  icon?: string;
}

interface SectionNavProps {
  sections: NavSection[];
  className?: string;
}

/**
 * The fixed site header's bottom edge (Header.tsx: fixed, top 0, h-14 /
 * lg:h-16). The nav sticks just below it (S13-056): at top 0 it sat entirely
 * under the header and vanished the moment it stuck.
 */
function headerBottom(): number {
  const header = typeof document !== "undefined" ? document.querySelector<HTMLElement>('header[role="banner"]') : null;
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

export function SectionNav({ sections, className }: SectionNavProps) {
  const [activeSection, setActiveSection] = useState(sections[0]?.id || "");
  const [isSticky, setIsSticky] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleScroll = () => {
      // Stuck once it reaches the header's bottom edge, where it sticks.
      const below = headerBottom();
      const navHeight = navRef.current?.offsetHeight ?? 0;
      if (navRef.current) {
        const rect = navRef.current.getBoundingClientRect();
        setIsSticky(rect.top <= below + 1);
      }

      // Determine active section based on scroll position
      let current = sections[0]?.id || "";
      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= below + navHeight + 16) {
            current = section.id;
          }
        }
      }
      setActiveSection(current);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [sections]);

  // Auto-scroll nav to keep active item visible
  useEffect(() => {
    if (scrollRef.current) {
      const activeEl = scrollRef.current.querySelector(`[data-section="${activeSection}"]`);
      if (activeEl) {
        (activeEl as HTMLElement).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [activeSection]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      // Land the section below the header and the stuck nav, not under them.
      const offset = headerBottom() + (navRef.current?.offsetHeight ?? 0) + 8;
      const y = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div
      ref={navRef}
      className={cn(
        "sticky top-14 lg:top-16 z-30 -mx-1 px-1 transition-all duration-200",
        isSticky && "bg-background/95 backdrop-blur-md border-b border-border/50 shadow-sm",
        className
      )}
    >
      <div
        ref={scrollRef}
        className="flex gap-1 overflow-x-auto scrollbar-hide py-2"
      >
        {sections.map((section) => (
          <button
            key={section.id}
            data-section={section.id}
            onClick={() => scrollToSection(section.id)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap",
              activeSection === section.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {section.icon && <span className="mr-1">{section.icon}</span>}
            {section.label}
          </button>
        ))}
      </div>
    </div>
  );
}

