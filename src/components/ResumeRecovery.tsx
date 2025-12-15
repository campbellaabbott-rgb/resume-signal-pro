import { useCallback, useState } from "react";
import { Upload, FileText, X, Loader2 } from "lucide-react";
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
    <div className="rounded-xl bg-card border border-border p-6 md:p-8 text-left">
      <div className="space-y-2 mb-6">
        <h2 className="text-xl font-semibold">Resume not found in this tab</h2>
        <p className="text-sm text-muted-foreground">
          Your payment went through, but your resume text didnt carry over. Re-upload the file or paste the text to generate your results.
        </p>
      </div>

      <div className="flex justify-center mb-6">
        <div className="inline-flex rounded-lg bg-muted/30 border border-border p-1">
          <button
            onClick={() => setMode("upload")}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              mode === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            type="button"
          >
            Upload File
          </button>
          <button
            onClick={() => setMode("paste")}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              mode === "paste" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            type="button"
          >
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
            "rounded-xl bg-muted/20 border-2 border-dashed border-border p-10 text-center",
            dragOver && "border-primary",
          )}
        >
          {selectedFile ? (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-3 px-4 py-3 rounded-lg bg-secondary">
                <FileText className="w-6 h-6 text-primary" />
                <span className="text-sm font-medium">{selectedFile.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="p-1 hover:bg-muted rounded-full transition-colors"
                  type="button"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {isExtracting ? "Extracting text..." : extractedText ? "Text extracted. Ready to analyze." : ""}
              </p>
            </div>
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-6">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <p className="text-base font-medium mb-2">Drop your resume here</p>
              <p className="text-sm text-muted-foreground mb-6">PDF, DOCX, or TXT</p>
              <label>
                <input
                  type="file"
                  accept=".pdf,.txt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button variant="outline" asChild>
                  <span>Browse files</span>
                </Button>
              </label>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Paste your resume content here..."
            className="w-full h-56 p-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground text-center">{textInput.length} characters</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-center">
        <Button
          variant="hero"
          size="xl"
          disabled={disabled || isExtracting || !canAnalyze}
          onClick={() => onResumeTextReady(mode === "paste" ? textInput.trim() : extractedText.trim())}
        >
          {isExtracting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Extracting...
            </>
          ) : (
            "Analyze Now"
          )}
        </Button>
      </div>
    </div>
  );
}
