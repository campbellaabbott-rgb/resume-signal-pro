import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { 
  Shield, Lock, Clock, CloudOff, Zap, Users, 
  CheckCircle2, BookOpen, Award, FileCheck, 
  Eye, Server, Globe, Sparkles
} from "lucide-react";
import { Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SocialProof } from "@/components/SocialProof";
import { FAQ } from "@/components/FAQ";
import { ResumeBeforeAfter } from "@/components/ResumeBeforeAfter";

export default function Trust() {
  const { t } = useTranslation();

  const securityFeatures = [
    {
      icon: Lock,
      title: "256-bit SSL Encryption",
      description: "Your resume is protected with bank-level encryption during upload and processing. We use the same security standard as major financial institutions."
    },
    {
      icon: CloudOff,
      title: "Zero Storage Policy",
      description: "We never store your resume on our servers. Your document is processed in memory and immediately discarded after analysis."
    },
    {
      icon: Clock,
      title: "Auto-Delete in 24 Hours",
      description: "Any temporary data created during processing is automatically deleted within 24 hours. Your data, your control."
    },
    {
      icon: Shield,
      title: "GDPR Compliant",
      description: "We follow strict European data protection standards. You can request deletion of any data at any time."
    },
    {
      icon: Server,
      title: "No Third-Party Sharing",
      description: "Your resume content is never shared with recruiters, employers, or any third parties. It's analyzed solely to help you."
    },
    {
      icon: Eye,
      title: "Transparent Processing",
      description: "We show you exactly what our AI analyzes and why. No black boxes—full transparency in our methodology."
    }
  ];

  const trustStats = [
    { value: "10,000+", label: "Resumes Analyzed", icon: FileCheck },
    { value: "89%", label: "Report Better Results", icon: Award },
    { value: "30s", label: "Average Delivery Time", icon: Zap },
    { value: "0", label: "Data Breaches", icon: Shield },
  ];

  const companyLogos = [
    "Google", "Microsoft", "Amazon", "Meta", "Apple", "Netflix"
  ];

  return (
    <>
      
      <SEO title="Trust & Security — Resume Booster" description="256-bit encryption, no permanent resume storage, GDPR-aligned data handling. See how we keep your data safe." path="/trust" />
      <Header />
      
      <main className="min-h-screen pt-28">
        {/* Hero Section */}
        <section className="py-16 md:py-24 bg-gradient-to-b from-primary/5 via-background to-background">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary">Your Privacy Matters</span>
              </div>
              
              <h1 className="text-4xl md:text-5xl font-bold mb-6">
                Your Resume Is <span className="text-primary">Safe With Us</span>
              </h1>
              
              <p className="text-xl text-muted-foreground mb-8">
                We built Resume Booster with security-first principles. Your career documents 
                deserve bank-level protection, and that's exactly what we provide.
              </p>

              <div className="flex flex-wrap justify-center gap-4">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border">
                  <Lock className="w-4 h-4 text-primary" />
                  <span className="text-sm">256-bit SSL</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border">
                  <CloudOff className="w-4 h-4 text-primary" />
                  <span className="text-sm">Zero Storage</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="text-sm">GDPR Compliant</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Stats */}
        <section className="py-12 border-y border-border bg-muted/20">
          <div className="container">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {trustStats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="text-center">
                    <Icon className="w-8 h-8 text-primary mx-auto mb-3" />
                    <div className="text-3xl md:text-4xl font-bold text-foreground mb-1">{stat.value}</div>
                    <div className="text-sm text-muted-foreground">{stat.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Security Features */}
        <section className="py-20">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">How We Protect Your Data</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Every aspect of Resume Booster is designed with your privacy and security in mind.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {securityFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div 
                    key={feature.title}
                    className="p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-colors group"
                  >
                    <div className="p-3 rounded-xl bg-primary/10 w-fit mb-4 group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Methodology Link */}
        <section className="py-12 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <BookOpen className="w-12 h-12 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-4">Transparent AI Scoring</h2>
              <p className="text-muted-foreground mb-6">
                We believe in complete transparency. See exactly how our AI analyzes resumes, 
                what factors we consider, and how scores are calculated.
              </p>
              <Link 
                to="/methodology"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                View Our Methodology
              </Link>
            </div>
          </div>
        </section>

        {/* Resume Transformation Examples */}
        <section className="py-20">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold mb-4">Real Results, Real Improvements</h2>
                <p className="text-muted-foreground">
                  See how our AI transforms vague bullet points into powerful, quantified achievements.
                </p>
              </div>
              
              <ResumeBeforeAfter />
            </div>
          </div>
        </section>

        {/* Trusted By Section */}
        <section className="py-16 border-t border-border">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold mb-4">Trusted by Job Seekers at Top Companies</h2>
              <p className="text-muted-foreground">
                Professionals from leading companies use Resume Booster to land their dream roles.
              </p>
            </div>
            
            <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12 opacity-60">
              {companyLogos.map((company) => (
                <div key={company} className="text-xl font-bold text-muted-foreground">
                  {company}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Social Proof / Testimonials */}
        <SocialProof />

        {/* FAQ */}
        <FAQ />

        {/* Final CTA */}
        <section className="py-20 bg-gradient-to-t from-primary/10 via-background to-background">
          <div className="container">
            <div className="max-w-2xl mx-auto text-center">
              <Sparkles className="w-12 h-12 text-primary mx-auto mb-6" />
              <h2 className="text-3xl font-bold mb-4">Ready to Boost Your Resume?</h2>
              <p className="text-muted-foreground mb-8">
                Join thousands of job seekers who've improved their resumes with our AI-powered analysis.
              </p>
              <Link 
                to="/"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
              >
                <Sparkles className="w-5 h-5" />
                Get Your Free Scan
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
