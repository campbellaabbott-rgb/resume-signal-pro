import { Header } from "@/components/Header";
import { SEO } from "@/components/seo/SEO";
import { Footer } from "@/components/Footer";
import { Link } from "react-router-dom";
import { 
  FileSearch, 
  Brain, 
  Target, 
  CheckCircle2, 
  ArrowRight, 
  Shield, 
  Zap,
  BarChart3,
  FileText,
  Users,
  Building2,
  Clock,
  Sparkles
} from "lucide-react";

const atsPlaftorms = [
  { name: "Workday", description: "Section header parsing, keyword extraction, date format validation", marketShare: "Major enterprise" },
  { name: "Greenhouse", description: "Skills matching algorithms, experience level scoring, cultural fit indicators", marketShare: "Tech & startups" },
  { name: "Lever", description: "Contact info validation, formatting consistency, section organization", marketShare: "Mid-market" },
  { name: "Taleo", description: "Keyword density analysis, job title matching, qualification scoring", marketShare: "Fortune 500" },
  { name: "iCIMS", description: "Education parsing, certification detection, skills taxonomy matching", marketShare: "Healthcare & retail" },
  { name: "BambooHR", description: "Resume structure analysis, experience timeline validation", marketShare: "SMB" },
  { name: "JazzHR", description: "Keyword optimization, applicant ranking algorithms", marketShare: "Small business" },
  { name: "Jobvite", description: "Social profile integration, referral tracking, skills assessment", marketShare: "Enterprise" },
  { name: "SmartRecruiters", description: "AI-powered matching, diversity indicators, global compliance", marketShare: "Global enterprise" },
  { name: "Bullhorn", description: "Staffing-specific parsing, contractor detection, availability scoring", marketShare: "Staffing agencies" },
];

const analysisSteps = [
  {
    icon: FileSearch,
    title: "Document Parsing",
    description: "We extract text while preserving structure, handling PDFs and DOCX files with the same parsing logic used by major ATS platforms."
  },
  {
    icon: Brain,
    title: "AI Analysis",
    description: "Our AI simulates how each ATS reads your resume, identifying sections, keywords, and formatting that may cause parsing failures."
  },
  {
    icon: Target,
    title: "Keyword Matching",
    description: "We compare your resume against industry-specific keyword databases and job description requirements to identify gaps."
  },
  {
    icon: BarChart3,
    title: "Scoring Algorithm",
    description: "Your ATS score is calculated based on 50+ factors including keyword density, formatting, section completeness, and red flags."
  },
];

const scoringFactors = [
  { factor: "Keyword Optimization", weight: "25%", description: "Industry-relevant keywords and skills mentioned" },
  { factor: "Format Compatibility", weight: "20%", description: "Clean structure that ATS can parse correctly" },
  { factor: "Section Completeness", weight: "15%", description: "All expected sections present and properly labeled" },
  { factor: "Experience Clarity", weight: "15%", description: "Clear job titles, dates, and achievements" },
  { factor: "Action Verb Usage", weight: "10%", description: "Strong action verbs that demonstrate impact" },
  { factor: "Quantified Achievements", weight: "10%", description: "Numbers and metrics that prove results" },
  { factor: "Red Flag Absence", weight: "5%", description: "No formatting issues or content problems" },
];

export default function Methodology() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO title={"Methodology "} description={" How Resume Booster Scores Resumes"} path={"Inside the ATS scoring rubric, recruiter heuristics, and AI pipeline behind every Resume Booster scan.|/methodology"} />
      <Header />
      
      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-16 sm:py-24 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
          </div>
          
          <div className="container relative">
            <div className="max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
                <Shield className="w-4 h-4" />
                <span>Transparent & Research-Based</span>
              </div>
              
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
                Our ATS Analysis{" "}
                <span className="text-primary">Methodology</span>
              </h1>
              
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
                We've reverse-engineered how 50+ Applicant Tracking Systems parse and score resumes. 
                Here's exactly how our analysis works.
              </p>

              <div className="flex flex-wrap justify-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  50+ ATS platforms analyzed
                </span>
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  10,000+ resumes processed
                </span>
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Updated monthly
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* How Analysis Works */}
        <section className="py-16 bg-card/30">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">
                How Our Analysis Works
              </h2>
              
              <div className="grid sm:grid-cols-2 gap-6">
                {analysisSteps.map((step, index) => (
                  <div 
                    key={step.title}
                    className="p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <step.icon className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-primary">STEP {index + 1}</span>
                        </div>
                        <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ATS Platforms */}
        <section className="py-16">
          <div className="container">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold mb-4">
                  ATS Platforms We Analyze Against
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  Our analysis is based on parsing rules and scoring algorithms from these major ATS platforms, 
                  covering over 90% of the job market.
                </p>
              </div>
              
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {atsPlaftorms.map((platform) => (
                  <div 
                    key={platform.name}
                    className="p-4 rounded-xl bg-card/50 border border-border/50 hover:border-primary/20 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold">{platform.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {platform.marketShare}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{platform.description}</p>
                  </div>
                ))}
              </div>
              
              <p className="text-center text-sm text-muted-foreground mt-8">
                + 40 more regional and industry-specific ATS platforms
              </p>
            </div>
          </div>
        </section>

        {/* Scoring Breakdown */}
        <section className="py-16 bg-card/30">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold mb-4">
                  How Your ATS Score Is Calculated
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  Your score is a weighted combination of multiple factors that determine how well 
                  your resume will perform in ATS systems.
                </p>
              </div>
              
              <div className="space-y-4">
                {scoringFactors.map((item) => (
                  <div 
                    key={item.factor}
                    className="p-4 rounded-xl bg-card border border-border"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium">{item.factor}</h3>
                      <span className="text-sm font-bold text-primary">{item.weight}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full"
                          style={{ width: item.weight }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground flex-shrink-0 max-w-[200px]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Research & Updates */}
        <section className="py-16">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <div className="grid md:grid-cols-2 gap-8">
                <div className="p-6 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-4">
                    <Zap className="w-6 h-6 text-success" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Continuous Research</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    We continuously analyze job postings, ATS updates, and hiring trends to keep 
                    our analysis accurate and up-to-date.
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span>Monthly algorithm updates</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span>Industry-specific keyword databases</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <span>Real recruiter feedback integration</span>
                    </li>
                  </ul>
                </div>
                
                <div className="p-6 rounded-2xl bg-card border border-border">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">Validated by Results</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Our methodology is validated by real outcomes from thousands of job seekers 
                    who improved their resumes using our analysis.
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>89% report better interview rates</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>10,000+ resumes analyzed</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>Average 23-point score improvement</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-gradient-to-b from-transparent to-card/50">
          <div className="container">
            <div className="max-w-2xl mx-auto text-center">
              <Sparkles className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">
                Ready to See Your ATS Score?
              </h2>
              <p className="text-muted-foreground mb-8">
                Get a free analysis of your resume using our proven methodology.
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                Analyze My Resume Free
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
}
