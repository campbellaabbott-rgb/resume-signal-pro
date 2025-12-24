import { useState, useEffect, useRef } from "react";
import { Loader2, Brain, CheckCircle2, Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface StreamingContentDisplayProps {
  content: string;
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
  title?: string;
  subtitle?: string;
  showCopyButton?: boolean;
  className?: string;
}

export function StreamingContentDisplay({
  content,
  isStreaming,
  isComplete,
  error,
  title = "Generating...",
  subtitle = "Watch your content appear in real-time",
  showCopyButton = true,
  className,
}: StreamingContentDisplayProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll as content streams in
  useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast({ title: "Copied!", description: "Content copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const downloadAsText = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generated-content.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-6 text-center">
        <p className="text-destructive font-medium mb-2">Generation Error</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isStreaming ? (
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Brain className="h-5 w-5 text-primary animate-pulse" />
              </div>
            </div>
          ) : isComplete ? (
            <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
            </div>
          )}
          <div>
            <h3 className="font-semibold text-foreground">
              {isComplete ? "Generation Complete" : title}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isStreaming 
                ? `${content.length.toLocaleString()} characters generated...` 
                : isComplete 
                  ? "Your content is ready" 
                  : subtitle}
            </p>
          </div>
        </div>

        {showCopyButton && content && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadAsText}
              disabled={isStreaming}
            >
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyToClipboard}
              disabled={isStreaming}
            >
              {copied ? (
                <Check className="h-4 w-4 mr-1" />
              ) : (
                <Copy className="h-4 w-4 mr-1" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
      </div>

      {/* Content Display */}
      <div
        ref={contentRef}
        className={cn(
          "rounded-xl border bg-card p-6 font-mono text-sm leading-relaxed max-h-[600px] overflow-y-auto",
          isStreaming && "border-primary/50"
        )}
      >
        {content ? (
          <div className="whitespace-pre-wrap">
            {content}
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse" />
            )}
          </div>
        ) : (
          <div className="text-muted-foreground text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Waiting for content...</p>
          </div>
        )}
      </div>

      {/* Progress indicator */}
      {isStreaming && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span>GPT-5 is writing...</span>
        </div>
      )}
    </div>
  );
}
