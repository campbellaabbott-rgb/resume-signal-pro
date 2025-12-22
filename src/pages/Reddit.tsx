import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Users, Zap, Shield, MessageSquare, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

// Track Reddit landing
const trackRedditLanding = async () => {
  try {
    const visitorId = localStorage.getItem('funnel_visitor_id') || crypto.randomUUID();
    if (!localStorage.getItem('funnel_visitor_id')) {
      localStorage.setItem('funnel_visitor_id', visitorId);
    }
    
    await supabase.functions.invoke('track-ab-event', {
      body: {
        testName: 'traffic_source',
        variant: 'reddit',
        eventType: 'view',
        visitorId,
        metadata: {
          page: '/reddit',
          referrer: document.referrer,
          timestamp: new Date().toISOString()
        }
      }
    });
  } catch (e) {
    console.debug('Reddit tracking failed:', e);
  }
};

export default function Reddit() {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Track Reddit landing
    trackRedditLanding();
    
    // Store source for conversion attribution
    sessionStorage.setItem('traffic_source', 'reddit');
    localStorage.setItem('last_traffic_source', 'reddit');
  }, []);

  const handleStartScan = () => {
    // Navigate to main page with scroll to uploader
    navigate('/?ref=reddit');
    setTimeout(() => {
      const uploader = document.getElementById('resume-uploader');
      if (uploader) {
        uploader.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const redditTestimonials = [
    {
      username: "u/jobseeker2024",
      subreddit: "r/resumes",
      quote: "Went from 0 callbacks to 3 interviews in a week after fixing the issues this found.",
      upvotes: 847
    },
    {
      username: "u/careerchanger_",
      subreddit: "r/jobs",
      quote: "Finally understood why my resume kept getting rejected. The ATS score was eye-opening.",
      upvotes: 523
    },
    {
      username: "u/newgrad_struggles",
      subreddit: "r/cscareerquestions",
      quote: "Free scan showed me I was missing 12 critical keywords. Fixed them and landed a FAANG interview.",
      upvotes: 1200
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Reddit-style header bar */}
      <div className="bg-[#FF4500] text-white py-2 px-4 text-center text-sm font-medium">
        <span className="opacity-90">👋 Hey Redditor!</span> You found us from a post — here's your <span className="font-bold">100% free</span> resume scan
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FF4500]/10 text-[#FF4500] text-sm font-medium mb-6">
            <MessageSquare className="w-4 h-4" />
            From r/resumes, r/jobs & r/cscareerquestions
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 leading-tight">
            Stop Getting Ghosted by ATS
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            The same resume scanner Redditors have been recommending. 
            <span className="text-foreground font-medium"> 192 scans this week alone.</span>
          </p>

          {/* Trust badges */}
          <div className="flex flex-wrap justify-center gap-4 mb-10 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-success" />
              No signup required
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-warning" />
              Results in 30 seconds
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary" />
              10,000+ resumes scanned
            </div>
          </div>

          {/* CTA Button */}
          <Button
            size="lg"
            onClick={handleStartScan}
            className="bg-[#FF4500] hover:bg-[#FF4500]/90 text-white gap-2 text-lg px-8 py-6 h-auto"
          >
            <Upload className="w-5 h-5" />
            Scan My Resume Free
            <ArrowRight className="w-5 h-5" />
          </Button>
        </div>

        {/* Reddit Testimonials */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">
            What Redditors Are Saying
          </h2>
          
          <div className="grid md:grid-cols-3 gap-4">
            {redditTestimonials.map((testimonial, i) => (
              <div 
                key={i}
                className="rounded-xl border border-border bg-card p-5 hover:border-[#FF4500]/30 transition-colors"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#FF4500]/10 flex items-center justify-center">
                    <span className="text-[#FF4500] text-xs font-bold">
                      {testimonial.username.charAt(2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{testimonial.username}</p>
                    <p className="text-xs text-muted-foreground">{testimonial.subreddit}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  "{testimonial.quote}"
                </p>
                <div className="flex items-center gap-1 text-xs text-[#FF4500]">
                  <ArrowRight className="w-3 h-3 rotate-[-90deg]" />
                  <span>{testimonial.upvotes >= 1000 
                    ? `${(testimonial.upvotes / 1000).toFixed(1)}k` 
                    : testimonial.upvotes} upvotes</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What You Get */}
        <div className="rounded-2xl bg-muted/30 border border-border p-8 mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">
            What Your Free Scan Includes
          </h2>
          
          <div className="grid md:grid-cols-2 gap-4">
            {[
              "AI-ATS compatibility score (0-100)",
              "Missing keywords for your industry",
              "Format issues that break ATS parsing",
              "Action verb & quantification analysis",
              "Red flags recruiters will see",
              "Quick wins to boost your score",
              "Industry benchmark comparison",
              "Personalized improvement checklist"
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                <span className="text-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ for Redditors */}
        <div className="max-w-2xl mx-auto mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">
            Quick FAQ
          </h2>
          
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-5">
              <h3 className="font-semibold mb-2">Is this actually free or is there a catch?</h3>
              <p className="text-sm text-muted-foreground">
                100% free scan with full results. We offer paid upgrades (tailored rewrites, cover letters) 
                but the scan itself shows you everything you need to fix your resume yourself.
              </p>
            </div>
            <div className="rounded-xl border border-border p-5">
              <h3 className="font-semibold mb-2">Do you store my resume?</h3>
              <p className="text-sm text-muted-foreground">
                Your resume text is processed for analysis only. We don't store it permanently or sell your data. 
                You can verify this in our <Link to="/privacy" className="text-primary hover:underline">privacy policy</Link>.
              </p>
            </div>
            <div className="rounded-xl border border-border p-5">
              <h3 className="font-semibold mb-2">How is this different from other ATS checkers?</h3>
              <p className="text-sm text-muted-foreground">
                We use AI to simulate actual ATS systems (Workday, Greenhouse, Taleo, etc.) rather than 
                just checking keyword counts. You get a realistic score and actionable fixes.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center">
          <p className="text-muted-foreground mb-4">
            Ready to see what's holding your resume back?
          </p>
          <Button
            size="lg"
            className="bg-[#FF4500] hover:bg-[#FF4500]/90 text-white gap-2"
            onClick={handleStartScan}
          >
            Scan My Resume Free
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-16">
        <div className="container max-w-5xl mx-auto px-4 text-center text-sm text-muted-foreground">
          <p className="mb-2">
            <Link to="/" className="hover:text-foreground">Home</Link>
            {" · "}
            <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
            {" · "}
            <Link to="/methodology" className="hover:text-foreground">Methodology</Link>
            {" · "}
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          </p>
          <p>© {new Date().getFullYear()} Resume Scanner. Made for job seekers, by job seekers.</p>
        </div>
      </footer>
    </div>
  );
}
