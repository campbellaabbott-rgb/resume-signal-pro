import { useState, useCallback } from "react";
import { Upload, FileText, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ResumeUploaderProps {
  onFileSelect: (file: File) => void;
  onTextSubmit: (text: string) => void;
  onCheckout: () => void;
  isLoading?: boolean;
  hasContent?: boolean;
}

export function ResumeUploader({ 
  onFileSelect, 
  onTextSubmit, 
  onCheckout,
  isLoading,
  hasContent 
}: ResumeUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState("");
  const [mode, setMode] = useState<"upload" | "paste">("upload");

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "application/pdf" || file.type === "text/plain")) {
      setSelectedFile(file);
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const clearFile = () => {
    setSelectedFile(null);
  };

  const handleTextPaste = () => {
    if (textInput.trim()) {
      onTextSubmit(textInput.trim());
    }
  };

  const canProceed = mode === "upload" ? !!selectedFile : !!textInput.trim();

  return (
    <section className="py-16">
      <div className="container">
        <div className="max-w-2xl mx-auto">
          {/* Mode Toggle */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex rounded-lg bg-card border border-border p-1">
              <button
                onClick={() => setMode("upload")}
                className={cn(
                  "px-4 py-2 rounded-md text-sm font-medium transition-all",
                  mode === "upload"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Upload File
              </button>
              <button
                onClick={() => setMode("paste")}
                className={cn(
                  "px-4 py-2 rounded-md text-sm font-medium transition-all",
                  mode === "paste"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Paste Text
              </button>
            </div>
          </div>

          {mode === "upload" ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "upload-zone gradient-border rounded-xl bg-card p-12 text-center cursor-pointer border-2 border-dashed border-border",
                dragOver && "dragover border-primary"
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
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Ready to analyze. Click the button below to proceed to payment.
                  </p>
                </div>
              ) : (
                <>
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-6">
                    <Upload className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-lg font-medium mb-2">
                    Drop your resume here
                  </p>
                  <p className="text-sm text-muted-foreground mb-6">
                    PDF or TXT files up to 5MB
                  </p>
                  <label>
                    <input
                      type="file"
                      accept=".pdf,.txt"
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
            <div className="space-y-4">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Paste your resume content here..."
                className="w-full h-64 p-4 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground text-center">
                {textInput.length} characters
              </p>
            </div>
          )}

          {/* Submit Button */}
          <div className="mt-8 text-center">
            <Button
              variant="hero"
              size="xl"
              disabled={isLoading || !canProceed}
              onClick={mode === "paste" ? handleTextPaste : onCheckout}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Pay $25 & Analyze
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              Secure payment via Stripe • Instant results
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
