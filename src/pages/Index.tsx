import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";
import { Footer } from "@/components/Footer";
import { FAQ } from "@/components/FAQ";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [resumeText, setResumeText] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("canceled") === "true") {
      toast({
        title: "Payment canceled",
        description: "Your payment was canceled. You can try again when you're ready.",
        variant: "destructive",
      });
    }
  }, [searchParams, toast]);

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    
    if (file.type === "text/plain") {
      const text = await file.text();
      setResumeText(text);
    } else if (file.type === "application/pdf") {
      // Parse PDF using edge function
      setIsLoading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const { data, error } = await supabase.functions.invoke("parse-pdf", {
          body: formData,
        });

        if (error) throw error;

        if (data?.success && data?.text) {
          setResumeText(data.text);
          toast({
            title: "PDF parsed successfully",
            description: `Extracted text from ${data.pages} page(s).`,
          });
        } else {
          throw new Error(data?.error || "Failed to parse PDF");
        }
      } catch (error) {
        console.error("PDF parsing error:", error);
        toast({
          title: "PDF parsing failed",
          description: "Could not extract text from the PDF. Please try pasting the text manually.",
          variant: "destructive",
        });
        setSelectedFile(null);
      } finally {
        setIsLoading(false);
      }
    } else if (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.endsWith(".docx")
    ) {
      // Parse DOCX using edge function
      setIsLoading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const { data, error } = await supabase.functions.invoke("parse-docx", {
          body: formData,
        });

        if (error) throw error;

        if (data?.success && data?.text) {
          setResumeText(data.text);
          toast({
            title: "Document parsed successfully",
            description: "Text extracted from your Word document.",
          });
        } else {
          throw new Error(data?.error || "Failed to parse DOCX");
        }
      } catch (error) {
        console.error("DOCX parsing error:", error);
        toast({
          title: "Document parsing failed",
          description: "Could not extract text from the DOCX. Please try pasting the text manually.",
          variant: "destructive",
        });
        setSelectedFile(null);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleTextSubmit = (text: string) => {
    setResumeText(text);
    handleCheckout(text);
  };

  const handleCheckout = async (text?: string) => {
    const contentToAnalyze = text || resumeText;
    
    if (!contentToAnalyze && !selectedFile) {
      toast({
        title: "No resume provided",
        description: "Please upload a file or paste your resume text.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Store resume text in localStorage for use after payment (persists across tabs)
      localStorage.setItem('resumeText', contentToAnalyze);

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { resumeData: contentToAnalyze },
      });

      if (error) throw error;

      if (data?.url) {
        // Tie the resume text to this specific checkout session (more reliable than a single global key)
        if (data?.sessionId) {
          localStorage.setItem(`resumeText:${data.sessionId}`, contentToAnalyze);
        }

        // Navigate in the same tab to avoid cross-tab storage issues after returning from Stripe
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      localStorage.removeItem('resumeText'); // Clean up on error
      toast({
        title: "Checkout failed",
        description: "There was an error creating your checkout session. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-16">
        <Hero />
        
        <ResumeUploader
          onFileSelect={handleFileSelect}
          onTextSubmit={handleTextSubmit}
          onCheckout={() => handleCheckout()}
          isLoading={isLoading}
          hasContent={!!resumeText || !!selectedFile}
        />
        
        <FAQ />
      </main>
      
      <Footer />
    </div>
  );
};

export default Index;
