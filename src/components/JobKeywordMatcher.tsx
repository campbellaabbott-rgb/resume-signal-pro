import { useState, useMemo } from "react";
import { 
  Target, CheckCircle2, XCircle, AlertTriangle, Lightbulb, 
  ChevronDown, ChevronUp, Copy, Check, Sparkles, ArrowRight,
  FileText, Briefcase, Star, Zap, TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface KeywordMatch {
  keyword: string;
  foundIn: "resume" | "both" | "job_only";
  importance: "critical" | "important" | "nice_to_have";
  category: "hard_skill" | "soft_skill" | "certification" | "tool" | "methodology" | "industry_term";
  resumeContext?: string; // Where it appears in resume
  jobContext?: string; // How it's mentioned in JD
  fixSuggestion?: string; // How to add if missing
}

interface CategoryGroup {
  category: string;
  label: string;
  icon: React.ElementType;
  matches: KeywordMatch[];
  matchRate: number;
}

interface JobKeywordMatcherProps {
  jobTitle?: string;
  jobCompany?: string;
  resumeText: string;
  jobDescription: string;
  extractedKeywords?: string[];
  missingKeywords?: string[];
  matchScore?: number;
  className?: string;
}

// Extract keywords from job description with context
function extractKeywordsWithContext(jobDescription: string): { keyword: string; context: string; importance: "critical" | "important" | "nice_to_have"; category: KeywordMatch["category"] }[] {
  const jdLower = jobDescription.toLowerCase();
  
  // Common keyword patterns with their categories
  const patterns: { pattern: RegExp; category: KeywordMatch["category"]; importance: "critical" | "important" | "nice_to_have" }[] = [
    // ===== TECHNOLOGY & SOFTWARE =====
    // Programming languages & frameworks (critical)
    { pattern: /\b(python|java|javascript|typescript|react|angular|vue|node\.?js|go|golang|rust|scala|kotlin|swift|ruby|php|c\+\+|c#|\.net)\b/gi, category: "hard_skill", importance: "critical" },
    // Data & AI
    { pattern: /\b(machine learning|deep learning|data science|artificial intelligence|ai|ml|nlp|computer vision|tensorflow|pytorch|keras|scikit-learn)\b/gi, category: "hard_skill", importance: "critical" },
    // Cloud & Infrastructure
    { pattern: /\b(aws|azure|gcp|google cloud|docker|kubernetes|k8s|terraform|ansible|jenkins|ci\/cd|devops|microservices|serverless|lambda)\b/gi, category: "hard_skill", importance: "critical" },
    // Databases
    { pattern: /\b(sql|mysql|postgresql|mongodb|redis|elasticsearch|dynamodb|cassandra|oracle database|sql server|nosql|graphql)\b/gi, category: "hard_skill", importance: "important" },
    // Tech methodologies
    { pattern: /\b(agile|scrum|kanban|devops|ci\/cd|jira|confluence|git|github|gitlab|bitbucket)\b/gi, category: "methodology", importance: "important" },
    
    // ===== HEALTHCARE & MEDICAL =====
    // Clinical skills (critical)
    { pattern: /\b(patient care|clinical assessment|medical records|vital signs|medication administration|wound care|infection control|patient safety)\b/gi, category: "hard_skill", importance: "critical" },
    // Healthcare systems & compliance
    { pattern: /\b(hipaa|ehr|emr|epic|cerner|meditech|athenahealth|allscripts|icd-10|cpt codes|medical coding|medical billing)\b/gi, category: "hard_skill", importance: "critical" },
    // Medical specialties
    { pattern: /\b(cardiology|oncology|pediatrics|geriatrics|orthopedics|neurology|radiology|emergency medicine|icu|or|operating room|nicu|picu)\b/gi, category: "industry_term", importance: "important" },
    // Healthcare certifications
    { pattern: /\b(rn|lpn|cna|np|pa-c|md|do|pharmd|bls|acls|pals|tncc|ccrn|cnor|cen|cms|jcaho|joint commission)\b/gi, category: "certification", importance: "critical" },
    // Healthcare soft skills
    { pattern: /\b(bedside manner|patient education|care coordination|discharge planning|case management|interdisciplinary|multidisciplinary)\b/gi, category: "soft_skill", importance: "important" },
    // Pharma & biotech
    { pattern: /\b(clinical trials|fda|gcp|gmp|regulatory affairs|pharmacovigilance|drug safety|clinical research|cro|irb|protocol development)\b/gi, category: "hard_skill", importance: "critical" },
    
    // ===== FINANCE & BANKING =====
    // Financial skills (critical)
    { pattern: /\b(financial analysis|financial modeling|valuation|dcf|lbo|m&a|mergers and acquisitions|due diligence|investment banking|equity research)\b/gi, category: "hard_skill", importance: "critical" },
    // Accounting
    { pattern: /\b(gaap|ifrs|financial reporting|accounts payable|accounts receivable|general ledger|reconciliation|month-end close|year-end close|audit)\b/gi, category: "hard_skill", importance: "critical" },
    // Banking & trading
    { pattern: /\b(credit analysis|risk assessment|underwriting|portfolio management|asset management|wealth management|private equity|hedge fund|trading|derivatives|fixed income|equities)\b/gi, category: "hard_skill", importance: "critical" },
    // Financial tools
    { pattern: /\b(bloomberg|reuters|factset|capital iq|pitchbook|morningstar|quickbooks|xero|netsuite|sap|hyperion)\b/gi, category: "tool", importance: "important" },
    // Finance certifications
    { pattern: /\b(cpa|cfa|cma|cfp|caia|frm|series 7|series 63|series 65|series 66|finra|chartered accountant)\b/gi, category: "certification", importance: "critical" },
    // Compliance & regulation
    { pattern: /\b(sox|sarbanes-oxley|aml|anti-money laundering|kyc|know your customer|basel|dodd-frank|sec|occ|fdic|finra compliance)\b/gi, category: "hard_skill", importance: "important" },
    // Insurance
    { pattern: /\b(underwriting|claims|actuarial|reinsurance|policy administration|loss ratio|combined ratio|premium|deductible|liability|workers comp)\b/gi, category: "industry_term", importance: "important" },
    
    // ===== LEGAL =====
    // Legal skills (critical)
    { pattern: /\b(legal research|legal writing|contract drafting|contract review|due diligence|litigation|discovery|depositions|trial preparation|motions)\b/gi, category: "hard_skill", importance: "critical" },
    // Practice areas
    { pattern: /\b(corporate law|securities|intellectual property|ip|patent|trademark|copyright|employment law|labor law|real estate law|tax law|bankruptcy|m&a|mergers)\b/gi, category: "industry_term", importance: "important" },
    // Legal tech & tools
    { pattern: /\b(westlaw|lexisnexis|lexis nexis|bloomberg law|clio|relativity|concordance|document review|e-discovery|ediscovery)\b/gi, category: "tool", importance: "important" },
    // Legal certifications & credentials
    { pattern: /\b(jd|juris doctor|bar admission|bar certified|paralegal certified|cp|rp|aba|state bar|law license)\b/gi, category: "certification", importance: "critical" },
    // Compliance & regulatory
    { pattern: /\b(compliance|regulatory|gdpr|ccpa|privacy law|data protection|corporate governance|risk management|internal controls|ethics)\b/gi, category: "hard_skill", importance: "important" },
    // Legal soft skills
    { pattern: /\b(client counseling|negotiation|mediation|arbitration|oral advocacy|legal analysis|case management|matter management)\b/gi, category: "soft_skill", importance: "important" },
    
    // ===== MARKETING & SALES =====
    // Digital marketing
    { pattern: /\b(seo|sem|ppc|google ads|facebook ads|social media marketing|content marketing|email marketing|marketing automation|hubspot|marketo|mailchimp)\b/gi, category: "hard_skill", importance: "critical" },
    // Analytics
    { pattern: /\b(google analytics|adobe analytics|mixpanel|amplitude|a\/b testing|conversion optimization|attribution|funnel analysis|cohort analysis)\b/gi, category: "hard_skill", importance: "important" },
    // Sales
    { pattern: /\b(salesforce|crm|pipeline management|lead generation|cold calling|prospecting|closing|negotiation|quota|revenue|arpu|ltv|cac)\b/gi, category: "hard_skill", importance: "critical" },
    
    // ===== HUMAN RESOURCES =====
    { pattern: /\b(talent acquisition|recruiting|onboarding|employee relations|performance management|compensation|benefits|hris|workday|adp|bamboohr|greenhouse|lever)\b/gi, category: "hard_skill", importance: "important" },
    { pattern: /\b(phr|sphr|shrm-cp|shrm-scp|diversity|inclusion|dei|employee engagement|retention|succession planning|workforce planning)\b/gi, category: "certification", importance: "important" },
    
    // ===== EDUCATION =====
    // Teaching skills (critical)
    { pattern: /\b(curriculum development|lesson planning|classroom management|student assessment|differentiated instruction|pedagogy|instructional design|learning objectives)\b/gi, category: "hard_skill", importance: "critical" },
    // Education technology
    { pattern: /\b(lms|learning management system|canvas|blackboard|moodle|google classroom|schoology|brightspace|d2l|zoom|edtech)\b/gi, category: "tool", importance: "important" },
    // Teaching methods
    { pattern: /\b(remote learning|hybrid learning|blended learning|flipped classroom|project-based learning|stem education|steam|montessori|iep|504 plan|special education|sped)\b/gi, category: "methodology", importance: "important" },
    // Education certifications
    { pattern: /\b(teaching certificate|teaching license|state certification|praxis|edtpa|tesol|tefl|celta|national board certified|nbct|ell|esl|esol)\b/gi, category: "certification", importance: "critical" },
    // Education administration
    { pattern: /\b(principal|superintendent|academic advisor|guidance counselor|school administration|title i|ferpa|accreditation|common core|state standards)\b/gi, category: "industry_term", importance: "important" },
    // Higher education
    { pattern: /\b(tenure|adjunct|professor|lecturer|research|publications|grants|phd|dissertation|peer review|academic writing|higher education|undergraduate|graduate)\b/gi, category: "industry_term", importance: "important" },
    // Education soft skills
    { pattern: /\b(student engagement|parent communication|behavior management|mentoring students|tutoring|academic support|college counseling)\b/gi, category: "soft_skill", importance: "important" },
    
    // ===== MANUFACTURING & ENGINEERING =====
    // Engineering design (critical)
    { pattern: /\b(cad|autocad|solidworks|catia|creo|nx|inventor|fusion 360|onshape|3d modeling|2d drafting|technical drawing|blueprint reading)\b/gi, category: "hard_skill", importance: "critical" },
    // PLM & manufacturing systems
    { pattern: /\b(plm|product lifecycle management|teamcenter|windchill|enovia|arena|pdm|product data management|bom|bill of materials|engineering change)\b/gi, category: "hard_skill", importance: "critical" },
    // Quality control
    { pattern: /\b(quality control|qc|quality assurance|qa|iso 9001|iso 14001|iso 13485|iatf 16949|as9100|inspection|metrology|spc|statistical process control|root cause analysis|8d|fmea|ppap)\b/gi, category: "hard_skill", importance: "critical" },
    // Manufacturing processes
    { pattern: /\b(cnc|machining|milling|turning|injection molding|die casting|stamping|welding|fabrication|assembly|additive manufacturing|3d printing)\b/gi, category: "hard_skill", importance: "critical" },
    // Engineering disciplines
    { pattern: /\b(mechanical engineering|electrical engineering|civil engineering|chemical engineering|industrial engineering|aerospace|automotive|manufacturing engineering)\b/gi, category: "industry_term", importance: "important" },
    // Engineering software
    { pattern: /\b(matlab|simulink|ansys|abaqus|comsol|labview|plc|scada|hmi|allen-bradley|siemens|rockwell|fanuc)\b/gi, category: "tool", importance: "important" },
    // Engineering certifications
    { pattern: /\b(pe|professional engineer|eit|engineer in training|fe exam|cqe|cqa|cmq\/oe|asq|aws cwi|api|osha|safety certified)\b/gi, category: "certification", importance: "important" },
    // Lean & continuous improvement
    { pattern: /\b(lean manufacturing|six sigma|kaizen|5s|tpm|value stream mapping|vsm|gemba|poka-yoke|kanban|continuous improvement|operational excellence)\b/gi, category: "methodology", importance: "important" },
    // R&D and product development
    { pattern: /\b(r&d|research and development|prototyping|testing|validation|verification|design review|dfm|dfa|dfmea|new product development|npd|stage-gate)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== GOVERNMENT & PUBLIC SECTOR =====
    // Security & clearances (critical)
    { pattern: /\b(security clearance|top secret|ts\/sci|secret clearance|confidential clearance|public trust|naci|bi|ssbi|polygraph|clearance holder)\b/gi, category: "certification", importance: "critical" },
    // Government contracting
    { pattern: /\b(government contracting|federal contracting|gsa|far|dfar|sam\.gov|sbir|sttr|idiq|bpa|gwac|8a|hubzone|sdvosb|wosb)\b/gi, category: "hard_skill", importance: "critical" },
    // Federal agencies & systems
    { pattern: /\b(dod|department of defense|dhs|fbi|cia|nsa|nasa|fema|hhs|va|usda|epa|doe|dot|hud|state department|federal agency)\b/gi, category: "industry_term", importance: "important" },
    // Public administration
    { pattern: /\b(public administration|public policy|civil service|government operations|public sector|municipal|county|state government|local government|city government)\b/gi, category: "industry_term", importance: "important" },
    // Government skills
    { pattern: /\b(grant writing|grant management|budget management|appropriations|fiscal year|government accounting|gasb|foia|public records|constituent services)\b/gi, category: "hard_skill", importance: "important" },
    // Government compliance & regulations
    { pattern: /\b(fedramp|fisma|nist|fips|itar|ear|export control|section 508|ada compliance|508 compliance|government audit|gao|ig|inspector general)\b/gi, category: "hard_skill", importance: "important" },
    // Law enforcement & public safety
    { pattern: /\b(law enforcement|police|sheriff|corrections|probation|parole|emergency management|first responder|emt|firefighter|public safety)\b/gi, category: "industry_term", importance: "important" },
    // Military transition
    { pattern: /\b(military experience|veteran|armed forces|army|navy|air force|marines|coast guard|national guard|reserve|military transition|dd-214)\b/gi, category: "industry_term", importance: "nice_to_have" },
    // Government certifications
    { pattern: /\b(dawia|fac-c|fac-p\/pm|fac-cor|cap|cgfm|cdfm|cgap|ccep|capm|pmp|comptia security\+)\b/gi, category: "certification", importance: "important" },
    // Nonprofit & NGO
    { pattern: /\b(nonprofit|non-profit|501c3|foundation|philanthropy|fundraising|donor relations|grant proposal|program management|community outreach|advocacy)\b/gi, category: "industry_term", importance: "important" },
    
    // ===== OPERATIONS & SUPPLY CHAIN =====
    { pattern: /\b(supply chain|logistics|procurement|inventory management|warehouse|distribution|erp|mrp|lean manufacturing|six sigma|kaizen|tps|just-in-time|jit)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(apics|cpim|cscp|cltd|pmp|capm|lean six sigma|green belt|black belt|master black belt)\b/gi, category: "certification", importance: "important" },
    
    // ===== GENERAL TOOLS =====
    { pattern: /\b(excel|powerpoint|tableau|power bi|looker|figma|sketch|adobe|photoshop|illustrator|indesign|after effects)\b/gi, category: "tool", importance: "important" },
    { pattern: /\b(sap|oracle|workday|servicenow|zendesk|slack|teams|asana|monday|trello|notion)\b/gi, category: "tool", importance: "important" },
    
    // ===== GENERAL CERTIFICATIONS =====
    { pattern: /\b(pmp|prince2|aws certified|azure certified|google certified|cisco|ccna|ccnp|cissp|comptia|itil)\b/gi, category: "certification", importance: "important" },
    
    // ===== SOFT SKILLS =====
    { pattern: /\b(leadership|communication|problem.?solving|analytical|strategic|collaborative|teamwork|mentoring|coaching)\b/gi, category: "soft_skill", importance: "nice_to_have" },
    { pattern: /\b(stakeholder management|cross.?functional|project management|time management|prioritization|decision.?making|critical thinking)\b/gi, category: "soft_skill", importance: "important" },
    { pattern: /\b(presentation skills|public speaking|interpersonal|relationship building|client.?facing|customer service)\b/gi, category: "soft_skill", importance: "nice_to_have" },
    
    // ===== INDUSTRY TERMS =====
    { pattern: /\b(b2b|b2c|saas|e-commerce|fintech|healthtech|edtech|insurtech|regtech|proptech|martech|adtech)\b/gi, category: "industry_term", importance: "nice_to_have" },
    { pattern: /\b(roi|kpi|okr|nps|csat|churn|arr|mrr|gross margin|ebitda|p&l|budget|forecast)\b/gi, category: "industry_term", importance: "important" },
  ];
  
  const extracted: Map<string, { keyword: string; context: string; importance: "critical" | "important" | "nice_to_have"; category: KeywordMatch["category"] }> = new Map();
  
  // Extract words that appear multiple times or in key phrases
  const sentences = jobDescription.split(/[.!?]/);
  
  for (const { pattern, category, importance } of patterns) {
    let match;
    while ((match = pattern.exec(jobDescription)) !== null) {
      const keyword = match[0].toLowerCase();
      if (!extracted.has(keyword)) {
        // Find the sentence containing this keyword for context
        const contextSentence = sentences.find(s => s.toLowerCase().includes(keyword))?.trim() || "";
        extracted.set(keyword, {
          keyword: match[0],
          context: contextSentence.substring(0, 100) + (contextSentence.length > 100 ? "..." : ""),
          importance: jdLower.includes("required") && jdLower.indexOf(keyword) < jdLower.indexOf("required") + 200 ? "critical" : importance,
          category
        });
      }
    }
  }
  
  // Also extract capitalized proper nouns and technical terms
  const technicalTerms = jobDescription.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g) || [];
  for (const term of technicalTerms) {
    if (term.length > 2 && !extracted.has(term.toLowerCase()) && !["The", "This", "That", "We", "You", "Our", "Your"].includes(term)) {
      const contextSentence = sentences.find(s => s.includes(term))?.trim() || "";
      extracted.set(term.toLowerCase(), {
        keyword: term,
        context: contextSentence.substring(0, 100) + (contextSentence.length > 100 ? "..." : ""),
        importance: "nice_to_have",
        category: "industry_term"
      });
    }
  }
  
  return Array.from(extracted.values());
}

// Check if keyword exists in resume and get context
function findKeywordInResume(keyword: string, resumeText: string): { found: boolean; context: string } {
  const resumeLower = resumeText.toLowerCase();
  const keywordLower = keyword.toLowerCase();
  
  // Check for exact match or variations
  const variations = [
    keywordLower,
    keywordLower.replace(/\s+/g, ""),
    keywordLower.replace(/-/g, " "),
    keywordLower.replace(/\./g, ""),
  ];
  
  for (const variation of variations) {
    const index = resumeLower.indexOf(variation);
    if (index !== -1) {
      // Extract surrounding context
      const start = Math.max(0, index - 30);
      const end = Math.min(resumeText.length, index + keyword.length + 50);
      const context = resumeText.substring(start, end).trim();
      return { found: true, context: "..." + context + "..." };
    }
  }
  
  return { found: false, context: "" };
}

// Generate fix suggestions for missing keywords
function generateFixSuggestion(keyword: string, category: KeywordMatch["category"], jobContext?: string): string {
  const suggestions: Record<KeywordMatch["category"], string[]> = {
    hard_skill: [
      `Add "${keyword}" to your Skills section`,
      `Mention "${keyword}" in a bullet point describing a relevant project`,
      `Include experience with ${keyword} in your summary/objective`,
    ],
    soft_skill: [
      `Demonstrate "${keyword}" through a specific achievement`,
      `Add a bullet showing how you used ${keyword} to achieve results`,
      `Quantify an instance where ${keyword} led to measurable outcomes`,
    ],
    certification: [
      `Add "${keyword}" to a Certifications section`,
      `If you have ${keyword}, list it prominently near your name`,
      `Consider pursuing ${keyword} certification if not yet obtained`,
    ],
    tool: [
      `Add "${keyword}" to your Technical Skills or Tools section`,
      `Mention using ${keyword} in a specific project bullet`,
      `Include proficiency level with ${keyword}`,
    ],
    methodology: [
      `Add "${keyword}" to your skills or methodology experience`,
      `Describe a project where you applied ${keyword}`,
      `Quantify results achieved using ${keyword}`,
    ],
    industry_term: [
      `Incorporate "${keyword}" naturally in your experience descriptions`,
      `Use "${keyword}" when describing relevant achievements`,
      `Add "${keyword}" context to your professional summary`,
    ],
  };
  
  return suggestions[category][Math.floor(Math.random() * suggestions[category].length)];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted transition-colors"
      title="Copy suggestion"
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

export function JobKeywordMatcher({
  jobTitle,
  jobCompany,
  resumeText,
  jobDescription,
  extractedKeywords = [],
  missingKeywords = [],
  matchScore,
  className
}: JobKeywordMatcherProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["critical"]));
  const [showAllMissing, setShowAllMissing] = useState(false);
  
  // Analyze keywords
  const analysis = useMemo(() => {
    const jdKeywords = extractKeywordsWithContext(jobDescription);
    
    const matches: KeywordMatch[] = jdKeywords.map(jdKw => {
      const resumeMatch = findKeywordInResume(jdKw.keyword, resumeText);
      
      return {
        keyword: jdKw.keyword,
        foundIn: resumeMatch.found ? "both" : "job_only",
        importance: jdKw.importance,
        category: jdKw.category,
        resumeContext: resumeMatch.context || undefined,
        jobContext: jdKw.context,
        fixSuggestion: !resumeMatch.found ? generateFixSuggestion(jdKw.keyword, jdKw.category, jdKw.context) : undefined,
      };
    });
    
    // Add any additional keywords from props
    for (const kw of extractedKeywords) {
      if (!matches.find(m => m.keyword.toLowerCase() === kw.toLowerCase())) {
        const resumeMatch = findKeywordInResume(kw, resumeText);
        matches.push({
          keyword: kw,
          foundIn: resumeMatch.found ? "both" : "job_only",
          importance: "important",
          category: "hard_skill",
          resumeContext: resumeMatch.context || undefined,
          fixSuggestion: !resumeMatch.found ? generateFixSuggestion(kw, "hard_skill") : undefined,
        });
      }
    }
    
    return matches;
  }, [jobDescription, resumeText, extractedKeywords]);
  
  // Group by category
  const categoryGroups = useMemo((): CategoryGroup[] => {
    const groups: Record<string, CategoryGroup> = {
      hard_skill: { category: "hard_skill", label: "Technical Skills", icon: Zap, matches: [], matchRate: 0 },
      soft_skill: { category: "soft_skill", label: "Soft Skills", icon: Star, matches: [], matchRate: 0 },
      certification: { category: "certification", label: "Certifications", icon: FileText, matches: [], matchRate: 0 },
      tool: { category: "tool", label: "Tools & Software", icon: Briefcase, matches: [], matchRate: 0 },
      methodology: { category: "methodology", label: "Methodologies", icon: TrendingUp, matches: [], matchRate: 0 },
      industry_term: { category: "industry_term", label: "Industry Terms", icon: Target, matches: [], matchRate: 0 },
    };
    
    for (const match of analysis) {
      if (groups[match.category]) {
        groups[match.category].matches.push(match);
      }
    }
    
    // Calculate match rates
    for (const group of Object.values(groups)) {
      const matched = group.matches.filter(m => m.foundIn === "both").length;
      group.matchRate = group.matches.length > 0 ? Math.round((matched / group.matches.length) * 100) : 100;
    }
    
    return Object.values(groups).filter(g => g.matches.length > 0).sort((a, b) => a.matchRate - b.matchRate);
  }, [analysis]);
  
  // Critical missing keywords
  const criticalMissing = analysis.filter(m => m.foundIn === "job_only" && m.importance === "critical");
  const importantMissing = analysis.filter(m => m.foundIn === "job_only" && m.importance === "important");
  const matched = analysis.filter(m => m.foundIn === "both");
  
  const overallMatchRate = analysis.length > 0 
    ? Math.round((matched.length / analysis.length) * 100) 
    : matchScore || 0;
  
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };
  
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header with overall score */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              Job Keyword Match Analysis
            </h3>
            {jobTitle && (
              <p className="text-sm text-muted-foreground mt-1">
                Matching against: <span className="font-medium text-foreground">{jobTitle}</span>
                {jobCompany && <span className="text-muted-foreground"> at {jobCompany}</span>}
              </p>
            )}
          </div>
          <div className={cn(
            "px-4 py-2 rounded-xl font-bold text-2xl",
            overallMatchRate >= 70 ? "bg-success/10 text-success" :
            overallMatchRate >= 50 ? "bg-warning/10 text-warning" :
            "bg-destructive/10 text-destructive"
          )}>
            {overallMatchRate}%
          </div>
        </div>
        
        <Progress 
          value={overallMatchRate} 
          className={cn(
            "h-3",
            overallMatchRate >= 70 ? "[&>div]:bg-success" :
            overallMatchRate >= 50 ? "[&>div]:bg-warning" :
            "[&>div]:bg-destructive"
          )}
        />
        
        <div className="flex flex-wrap gap-4 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span><strong>{matched.length}</strong> matched</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-destructive" />
            <span><strong>{criticalMissing.length}</strong> critical gaps</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span><strong>{importantMissing.length}</strong> important gaps</span>
          </div>
        </div>
      </div>
      
      {/* Critical Missing Keywords Alert */}
      {criticalMissing.length > 0 && (
        <div className="p-5 rounded-xl bg-destructive/5 border border-destructive/20">
          <h4 className="font-bold text-destructive flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" />
            Critical Keywords Missing ({criticalMissing.length})
          </h4>
          <p className="text-sm text-muted-foreground mb-4">
            These keywords appear in the job requirements and are likely essential. Add them to significantly improve your match.
          </p>
          <div className="space-y-3">
            {criticalMissing.slice(0, showAllMissing ? undefined : 5).map((kw, i) => (
              <div key={i} className="p-3 rounded-lg bg-background border border-border">
                <div className="flex items-start justify-between mb-2">
                  <span className="font-semibold text-foreground">{kw.keyword}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                    {kw.category.replace("_", " ")}
                  </span>
                </div>
                {kw.jobContext && (
                  <p className="text-xs text-muted-foreground mb-2 italic">
                    "...{kw.jobContext}..."
                  </p>
                )}
                {kw.fixSuggestion && (
                  <div className="flex items-start gap-2 mt-2 p-2 rounded bg-success/5 border border-success/20">
                    <Lightbulb className="w-3 h-3 text-success mt-0.5 shrink-0" />
                    <span className="text-xs text-foreground flex-1">{kw.fixSuggestion}</span>
                    <CopyButton text={kw.fixSuggestion} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {criticalMissing.length > 5 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllMissing(!showAllMissing)}
              className="mt-3 w-full"
            >
              {showAllMissing ? (
                <>Show Less <ChevronUp className="w-4 h-4 ml-1" /></>
              ) : (
                <>Show All {criticalMissing.length} Critical Keywords <ChevronDown className="w-4 h-4 ml-1" /></>
              )}
            </Button>
          )}
        </div>
      )}
      
      {/* Matched Keywords */}
      {matched.length > 0 && (
        <div className="p-5 rounded-xl bg-success/5 border border-success/20">
          <h4 className="font-bold text-success flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4" />
            Keywords You Already Have ({matched.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {matched.map((kw, i) => (
              <span 
                key={i}
                className="px-3 py-1.5 rounded-lg bg-success/10 text-success text-sm font-medium flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3 h-3" />
                {kw.keyword}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {/* Category Breakdown */}
      <div className="space-y-3">
        <h4 className="font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Keyword Analysis by Category
        </h4>
        
        {categoryGroups.map((group) => {
          const Icon = group.icon;
          const isExpanded = expandedCategories.has(group.category);
          const groupMatched = group.matches.filter(m => m.foundIn === "both").length;
          const groupMissing = group.matches.filter(m => m.foundIn === "job_only").length;
          
          return (
            <div key={group.category} className="rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => toggleCategory(group.category)}
                className="w-full p-4 flex items-center justify-between bg-card hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn(
                    "w-4 h-4",
                    group.matchRate >= 70 ? "text-success" :
                    group.matchRate >= 50 ? "text-warning" :
                    "text-destructive"
                  )} />
                  <span className="font-medium">{group.label}</span>
                  <span className="text-xs text-muted-foreground">
                    ({groupMatched}/{group.matches.length} matched)
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "text-sm font-bold",
                    group.matchRate >= 70 ? "text-success" :
                    group.matchRate >= 50 ? "text-warning" :
                    "text-destructive"
                  )}>
                    {group.matchRate}%
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>
              
              {isExpanded && (
                <div className="p-4 pt-0 bg-card space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border">
                    {group.matches.map((match, i) => (
                      <div 
                        key={i}
                        className={cn(
                          "p-2 rounded-lg text-sm flex items-start gap-2",
                          match.foundIn === "both" 
                            ? "bg-success/5 border border-success/20" 
                            : "bg-muted/50 border border-border"
                        )}
                      >
                        {match.foundIn === "both" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className={cn(
                            "font-medium",
                            match.foundIn === "both" ? "text-success" : "text-foreground"
                          )}>
                            {match.keyword}
                          </span>
                          {match.foundIn === "job_only" && match.fixSuggestion && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <ArrowRight className="w-2.5 h-2.5 shrink-0" />
                              {match.fixSuggestion}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Quick Action Summary */}
      <div className="p-5 rounded-xl bg-primary/5 border border-primary/20">
        <h4 className="font-bold text-foreground flex items-center gap-2 mb-3">
          <Lightbulb className="w-4 h-4 text-primary" />
          Top 3 Actions to Improve Your Match
        </h4>
        <ol className="space-y-2">
          {criticalMissing.slice(0, 3).map((kw, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div>
                <span className="font-medium">Add "{kw.keyword}"</span>
                {kw.fixSuggestion && (
                  <span className="text-muted-foreground"> — {kw.fixSuggestion}</span>
                )}
              </div>
            </li>
          ))}
          {criticalMissing.length === 0 && importantMissing.slice(0, 3).map((kw, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div>
                <span className="font-medium">Add "{kw.keyword}"</span>
                {kw.fixSuggestion && (
                  <span className="text-muted-foreground"> — {kw.fixSuggestion}</span>
                )}
              </div>
            </li>
          ))}
          {criticalMissing.length === 0 && importantMissing.length === 0 && (
            <li className="text-success flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Great job! Your resume covers the key requirements.
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
