import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";
import { SocialProof } from "@/components/SocialProof";
import { Footer } from "@/components/Footer";
import { FAQ } from "@/components/FAQ";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [resumeText, setResumeText] = useState<string>("");
  const [linkedInText, setLinkedInText] = useState<string>("");
  const [isScrapingLinkedIn, setIsScrapingLinkedIn] = useState(false);
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
      return;
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
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
      return;
    }

    if (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.toLowerCase().endsWith(".docx")
    ) {
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

  const handleScrapeLinkedIn = async (url: string) => {
    setIsScrapingLinkedIn(true);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-linkedin", {
        body: { url },
      });

      if (error) throw error;

      if (data?.success && data?.text) {
        setLinkedInText(data.text);
        toast({
          title: "LinkedIn profile fetched",
          description: "Your profile content has been extracted successfully.",
        });
      } else {
        throw new Error(data?.error || "Failed to fetch LinkedIn profile");
      }
    } catch (error: any) {
      console.error("LinkedIn scraping error:", error);
      toast({
        title: "Could not fetch profile",
        description: error?.message || "Please try pasting your profile content instead.",
        variant: "destructive",
      });
    } finally {
      setIsScrapingLinkedIn(false);
    }
  };

  const handleTextSubmit = (text: string, linkedIn?: string) => {
    setResumeText(text);
    if (linkedIn) setLinkedInText(linkedIn);
    handleCheckout(text, linkedIn);
  };

  const handleCheckout = async (text?: string, linkedIn?: string) => {
    const contentToAnalyze = text || resumeText;
    const linkedInContent = linkedIn || linkedInText;
    
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
      // Store resume text and LinkedIn text in localStorage for use after payment
      localStorage.setItem('resumeText', contentToAnalyze);
      if (linkedInContent) {
        localStorage.setItem('linkedInText', linkedInContent);
      } else {
        localStorage.removeItem('linkedInText');
      }

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { 
          resumeData: contentToAnalyze,
          hasLinkedIn: !!linkedInContent
        },
      });

      if (error) throw error;

      if (data?.url) {
        // Tie the data to this specific checkout session
        if (data?.sessionId) {
          localStorage.setItem(`resumeText:${data.sessionId}`, contentToAnalyze);
          if (linkedInContent) {
            localStorage.setItem(`linkedInText:${data.sessionId}`, linkedInContent);
          }
        }

        // In the embedded preview, navigation to Stripe can be blocked.
        const inIframe = window.self !== window.top;
        if (inIframe) {
          const win = window.open(data.url, "_blank", "noopener,noreferrer");
          if (!win) {
            toast({
              title: "Popup blocked",
              description: "Allow popups for this site to open Stripe Checkout.",
              variant: "destructive",
            });
          }
          return;
        }

        // Navigate in the same tab
        window.location.assign(data.url);
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      localStorage.removeItem('resumeText');
      localStorage.removeItem('linkedInText');
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
          onCheckout={(linkedIn) => handleCheckout(undefined, linkedIn)}
          isLoading={isLoading}
          hasContent={!!resumeText || !!selectedFile}
          linkedInText={linkedInText}
          onLinkedInTextChange={setLinkedInText}
          isScrapingLinkedIn={isScrapingLinkedIn}
          onScrapeLinkedIn={handleScrapeLinkedIn}
        />
        
        <SocialProof />
        
        <FAQ />
      </main>
      
      <Footer />
    </div>
  );
};

export default Index;
