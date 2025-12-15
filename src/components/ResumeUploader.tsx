import { useState, useCallback } from "react";
import { Upload, FileText, X, Loader2, CheckCircle2, Sparkles, CreditCard } from "lucide-react";
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

  const isValidFileType = (file: File) => {
    const validTypes = [
      "application/pdf",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    return validTypes.includes(file.type) || file.name.endsWith(".docx");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file && isValidFileType(file)) {
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
    <section id="upload" className="py-20 relative">
      {/* Section background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />
      
      <div className="container relative">
        <div className="max-w-2xl mx-auto">
          {/* Section header */}
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              Upload Your Resume
            </h2>
            <p className="text-muted-foreground">
              Drop your file or paste your resume text to get started
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex rounded-xl bg-card border border-border p-1.5 shadow-lg shadow-black/5">
              <button
                onClick={() => setMode("upload")}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  mode === "upload"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Upload className="w-4 h-4" />
                Upload File
              </button>
              <button
                onClick={() => setMode("paste")}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  mode === "paste"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <FileText className="w-4 h-4" />
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
                "relative rounded-2xl bg-card/50 backdrop-blur-sm p-10 md:p-14 text-center cursor-pointer border-2 border-dashed transition-all duration-300",
                dragOver 
                  ? "border-primary bg-primary/5 scale-[1.02]" 
                  : "border-border/50 hover:border-primary/40 hover:bg-card/80",
                selectedFile && "border-success/50 bg-success/5"
              )}
            >
              {selectedFile ? (
                <div className="space-y-4 animate-scale-in">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mb-2">
                    <CheckCircle2 className="w-8 h-8 text-success" />
                  </div>
                  <div className="inline-flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium max-w-[200px] truncate">{selectedFile.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFile();
                      }}
                      className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-sm text-success font-medium">
                    Ready to analyze! Click below to proceed.
                  </p>
                </div>
              ) : (
                <>
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 mb-6">
                    <Upload className="w-9 h-9 text-primary" />
                  </div>
                  <p className="text-xl font-semibold mb-2">
                    Drop your resume here
                  </p>
                  <p className="text-sm text-muted-foreground mb-6">
                    Supports PDF, DOCX, and TXT files (max 10MB)
                  </p>
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
                        Browse files
                      </span>
                    </Button>
                  </label>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Paste your resume content here...&#10;&#10;Include your work experience, skills, education, and any other relevant information."
                  className="w-full h-72 p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none text-sm leading-relaxed transition-all"
                />
                <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-lg bg-card/80 border border-border text-xs text-muted-foreground">
                  {textInput.length.toLocaleString()} characters
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="mt-10 text-center space-y-4">
            <Button
              variant="hero"
              size="xl"
              disabled={isLoading || !canProceed}
              onClick={mode === "paste" ? handleTextPaste : onCheckout}
              className="min-w-[280px] h-14 text-base gap-3 shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-shadow"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Analyze My Resume — $25
                </>
              )}
            </Button>
            
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" />
                <span>Secure payment via Stripe</span>
              </div>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
              <span>Results delivered instantly</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
