import { useCallback, useState } from "react";
import { Upload, FileText, X, Loader2, AlertCircle, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ResumeRecoveryProps {
  onResumeTextReady: (text: string) => void;
  disabled?: boolean;
}

export function ResumeRecovery({ onResumeTextReady, disabled }: ResumeRecoveryProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState("");
  const [extractedText, setExtractedText] = useState<string>("");
  const [isExtracting, setIsExtracting] = useState(false);

  const isValidFileType = (file: File) => {
    const validTypes = [
      "application/pdf",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    return validTypes.includes(file.type) || file.name.toLowerCase().endsWith(".docx");
  };

  const clearFile = () => {
    setSelectedFile(null);
    setExtractedText("");
  };

  const extractFromFile = useCallback(
    async (file: File) => {
      setIsExtracting(true);
      setExtractedText("");

      try {
        if (file.type === "text/plain") {
          const text = await file.text();
          setExtractedText(text);
          toast({ title: "Text file loaded", description: "Ready to analyze." });
          return;
        }

        const formData = new FormData();
        formData.append("file", file);

        if (file.type === "application/pdf") {
          const { data, error } = await supabase.functions.invoke("parse-pdf", {
            body: formData,
          });
          if (error) throw error;

          if (data?.success && data?.text) {
            setExtractedText(data.text);
            toast({
              title: "PDF parsed successfully",
              description: `Extracted text from ${data.pages ?? ""} page(s).`,
            });
            return;
          }
          throw new Error(data?.error || "Failed to parse PDF");
        }

        // DOCX
        const { data, error } = await supabase.functions.invoke("parse-docx", {
          body: formData,
        });
        if (error) throw error;

        if (data?.success && data?.text) {
          setExtractedText(data.text);
          toast({ title: "DOCX parsed successfully", description: "Ready to analyze." });
          return;
        }

        throw new Error(data?.error || "Failed to parse DOCX");
      } catch (err) {
        console.error("Resume recovery parsing error:", err);
        toast({
          title: "Could not read your file",
          description: "Please try pasting the resume text instead.",
          variant: "destructive",
        });
        clearFile();
      } finally {
        setIsExtracting(false);
      }
    },
    [toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file && isValidFileType(file)) {
        setSelectedFile(file);
        void extractFromFile(file);
      }
    },
    [extractFromFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && isValidFileType(file)) {
        setSelectedFile(file);
        void extractFromFile(file);
      }
    },
    [extractFromFile],
  );

  const canAnalyze = mode === "paste" ? !!textInput.trim() : !!extractedText.trim();

  return (
    <div className="rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 p-6 md:p-8 text-left max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="p-3 rounded-xl bg-warning/10 border border-warning/20 shrink-0">
          <AlertCircle className="w-6 h-6 text-warning" />
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-1">Resume Not Found</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your payment was successful! We just need your resume again to generate your analysis.
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex rounded-xl bg-muted/30 border border-border p-1.5">
          <button
            onClick={() => setMode("upload")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "upload" 
                ? "bg-primary text-primary-foreground shadow-md" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
            type="button"
          >
            <Upload className="w-4 h-4" />
            Upload File
          </button>
          <button
            onClick={() => setMode("paste")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "paste" 
                ? "bg-primary text-primary-foreground shadow-md" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
            type="button"
          >
            <FileText className="w-4 h-4" />
            Paste Text
          </button>
        </div>
      </div>

      {mode === "upload" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={handleDrop}
          className={cn(
            "rounded-xl bg-muted/20 border-2 border-dashed p-8 text-center transition-all duration-200",
            dragOver 
              ? "border-primary bg-primary/5 scale-[1.02]" 
              : "border-border/50 hover:border-primary/40",
            selectedFile && extractedText && "border-success/50 bg-success/5"
          )}
        >
          {selectedFile ? (
            <div className="space-y-4 animate-scale-in">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-success/10 mb-2">
                {isExtracting ? (
                  <Loader2 className="w-7 h-7 text-primary animate-spin" />
                ) : (
                  <CheckCircle2 className="w-7 h-7 text-success" />
                )}
              </div>
              <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-card border border-border">
                <FileText className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium max-w-[180px] truncate">{selectedFile.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="p-1 hover:bg-muted rounded-lg transition-colors"
                  type="button"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                {isExtracting ? "Extracting text..." : extractedText ? "Ready to analyze!" : ""}
              </p>
            </div>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 mb-4">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <p className="text-lg font-medium mb-1">Drop your resume here</p>
              <p className="text-sm text-muted-foreground mb-5">PDF, DOCX, or TXT files supported</p>
              <label>
                <input
                  type="file"
                  accept=".pdf,.txt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button variant="outline" size="lg" className="gap-2" asChild>
                  <span>
                    <FileText className="w-4 h-4" />
                    Browse Files
                  </span>
                </Button>
              </label>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste your resume content here...&#10;&#10;Include your work experience, skills, and education."
              className="w-full h-56 p-4 rounded-xl bg-background/50 border border-border/50 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none text-sm leading-relaxed transition-all"
            />
            <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-card/80 border border-border text-xs text-muted-foreground">
              {textInput.length.toLocaleString()} chars
            </div>
          </div>
        </div>
      )}

      {/* Submit button */}
      <div className="mt-6 flex flex-col items-center gap-3">
        <Button
          variant="hero"
          size="xl"
          disabled={disabled || isExtracting || !canAnalyze}
          onClick={() => onResumeTextReady(mode === "paste" ? textInput.trim() : extractedText.trim())}
          className="min-w-[200px] gap-2"
        >
          {isExtracting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Extracting...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              Generate Analysis
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your analysis will be ready in seconds
        </p>
      </div>
    </div>
  );
}
