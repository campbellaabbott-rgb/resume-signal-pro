import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";
import { Footer } from "@/components/Footer";
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
    
    // Read file content if it's a text file
    if (file.type === "text/plain") {
      const text = await file.text();
      setResumeText(text);
    } else {
      // For PDF, we'll handle this on the backend
      setResumeText(`[PDF: ${file.name}]`);
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
      // Store resume text in sessionStorage for use after payment
      sessionStorage.setItem('resumeText', contentToAnalyze);

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { resumeData: contentToAnalyze },
      });

      if (error) throw error;

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      sessionStorage.removeItem('resumeText'); // Clean up on error
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
      </main>
      
      <Footer />
    </div>
  );
};

export default Index;
