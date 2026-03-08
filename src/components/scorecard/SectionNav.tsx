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

export function SectionNav({ sections, className }: SectionNavProps) {
  const [activeSection, setActiveSection] = useState(sections[0]?.id || "");
  const [isSticky, setIsSticky] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleScroll = () => {
      // Determine sticky state
      if (navRef.current) {
        const rect = navRef.current.getBoundingClientRect();
        setIsSticky(rect.top <= 0);
      }

      // Determine active section based on scroll position
      let current = sections[0]?.id || "";
      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 120) {
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
      const offset = 80;
      const y = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div
      ref={navRef}
      className={cn(
        "sticky top-0 z-30 -mx-1 px-1 transition-all duration-200",
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

