import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/utils";
import { changelog, ChangelogTag } from "@/data/changelog";
import { Sparkles, TrendingUp, Wrench } from "lucide-react";

const tagConfig: Record<ChangelogTag, { label: string; icon: typeof Sparkles; className: string }> = {
  new: { label: "New", icon: Sparkles, className: "bg-primary/10 text-primary border-primary/20" },
  improved: { label: "Improved", icon: TrendingUp, className: "bg-success/10 text-success border-success/20" },
  fixed: { label: "Fixed", icon: Wrench, className: "bg-warning/10 text-warning border-warning/20" },
};

function formatEntryDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function Changelog() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-28 pb-20">
        <div className="container max-w-2xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-3">What's New</h1>
            <p className="text-muted-foreground">
              We ship improvements constantly. Here's what's recently changed.
            </p>
          </div>

          <div className="relative">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />
            <div className="space-y-10">
              {changelog.map((entry, i) => (
                <div key={i} className="relative pl-8">
                  <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-background ring-2 ring-primary/20" aria-hidden="true" />
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">{formatEntryDate(entry.date)}</p>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h2 className="text-lg font-bold text-foreground">{entry.title}</h2>
                    {entry.tags.map((tag) => {
                      const { label, icon: Icon, className } = tagConfig[tag];
                      return (
                        <span
                          key={tag}
                          className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border", className)}
                        >
                          <Icon className="w-3 h-3" />
                          {label}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{entry.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
