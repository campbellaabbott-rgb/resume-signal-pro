// Resume X-Ray — the user's ACTUAL resume text, line by line, with inline
// annotations: weak bullets underlined in red (reason on hover), power words
// highlighted green, unquantified bullets flagged amber. The report stops
// feeling like advice and starts feeling like an X-ray of their document.

import { useMemo, useState } from "react";
import { ScanSearch, ChevronDown, ChevronUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ResumeXRayProps {
  resumeText: string;
  weakBullets?: { text: string; reason: string }[];
  unquantifiedBullets?: { text: string }[];
  powerWords?: Array<string | { word: string; why: string }>;
  className?: string;
}

type LineFlag =
  | { kind: "weak"; reason: string }
  | { kind: "unquantified" }
  | null;

// Loose containment match: annotation snippets come back from the AI and may
// differ from the raw line in whitespace/punctuation.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

function lineMatches(line: string, snippet: string): boolean {
  const nl = normalize(line);
  const ns = normalize(snippet);
  if (!nl || !ns || ns.length < 12) return false;
  return nl.includes(ns) || ns.includes(nl);
}

export function ResumeXRay({ resumeText, weakBullets = [], unquantifiedBullets = [], powerWords = [], className }: ResumeXRayProps) {
  const [expanded, setExpanded] = useState(false);

  const powerWordList = useMemo(
    () => powerWords.map(p => (typeof p === "string" ? p : p.word)).filter(w => w && w.length > 2),
    [powerWords],
  );

  const lines = useMemo(() => {
    return resumeText.split("\n").map((raw) => {
      const line = raw.trimEnd();
      let flag: LineFlag = null;
      const weak = weakBullets.find(w => lineMatches(line, w.text));
      if (weak) flag = { kind: "weak", reason: weak.reason };
      else if (unquantifiedBullets.some(u => lineMatches(line, u.text))) flag = { kind: "unquantified" };
      return { line, flag };
    });
  }, [resumeText, weakBullets, unquantifiedBullets]);

  const flaggedCount = lines.filter(l => l.flag).length;
  if (!resumeText.trim()) return null;

  const visibleLines = expanded ? lines : lines.slice(0, 28);

  // Highlight power words within a line (case-insensitive, first occurrence each)
  const renderLine = (line: string) => {
    if (!line.trim()) return <span>&nbsp;</span>;
    let parts: Array<{ text: string; power: boolean }> = [{ text: line, power: false }];
    for (const word of powerWordList) {
      const next: typeof parts = [];
      for (const part of parts) {
        if (part.power) { next.push(part); continue; }
        const idx = part.text.toLowerCase().indexOf(word.toLowerCase());
        if (idx === -1) { next.push(part); continue; }
        if (idx > 0) next.push({ text: part.text.slice(0, idx), power: false });
        next.push({ text: part.text.slice(idx, idx + word.length), power: true });
        if (idx + word.length < part.text.length) next.push({ text: part.text.slice(idx + word.length), power: false });
      }
      parts = next;
    }
    return (
      <>
        {parts.map((p, i) =>
          p.power
            ? <mark key={i} className="bg-success/20 text-success rounded px-0.5">{p.text}</mark>
            : <span key={i}>{p.text}</span>
        )}
      </>
    );
  };

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5", className)}>
      <div className="flex items-center gap-2 mb-1">
        <ScanSearch className="w-4 h-4 text-primary" />
        <h4 className="font-semibold text-foreground text-sm">Resume X-Ray</h4>
        {flaggedCount > 0 && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-semibold">
            {flaggedCount} line{flaggedCount !== 1 ? "s" : ""} flagged
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Your actual resume, annotated. <span className="text-destructive">Red underline</span> = weak bullet (hover for why) ·{" "}
        <span className="text-warning">amber</span> = no numbers ·{" "}
        <span className="text-success">green</span> = power word.
      </p>

      <div className="rounded-lg bg-muted/20 border border-border/50 p-3 font-mono text-xs leading-relaxed overflow-x-auto">
        {visibleLines.map(({ line, flag }, i) => {
          const content = renderLine(line);
          if (flag?.kind === "weak") {
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <div className="whitespace-pre-wrap cursor-help underline decoration-destructive decoration-wavy underline-offset-4 text-foreground/90">
                    {content}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs">{flag.reason}</p>
                </TooltipContent>
              </Tooltip>
            );
          }
          if (flag?.kind === "unquantified") {
            return (
              <div key={i} className="whitespace-pre-wrap border-l-2 border-warning/70 pl-1.5 -ml-2 text-foreground/90">
                {content}
              </div>
            );
          }
          return <div key={i} className="whitespace-pre-wrap text-muted-foreground">{content}</div>;
        })}
      </div>

      {lines.length > 28 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {expanded ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all {lines.length} lines</>}
        </button>
      )}
    </div>
  );
}
