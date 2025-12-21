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
    
    // ===== REAL ESTATE =====
    // Real estate skills (critical)
    { pattern: /\b(real estate|property management|leasing|tenant relations|lease administration|rent collection|property maintenance|occupancy|vacancy)\b/gi, category: "hard_skill", importance: "critical" },
    // Real estate transactions
    { pattern: /\b(buying|selling|listings|mls|multiple listing service|closing|escrow|title|appraisal|home inspection|mortgage|financing)\b/gi, category: "hard_skill", importance: "important" },
    // Commercial real estate
    { pattern: /\b(commercial real estate|cre|industrial|retail space|office space|cap rate|noi|net operating income|reit|investment property|asset management)\b/gi, category: "industry_term", importance: "important" },
    // Real estate certifications
    { pattern: /\b(real estate license|broker license|realtor|nar|ccim|cpm|rpa|sior|crrp|leed|leed ap|green building)\b/gi, category: "certification", importance: "critical" },
    // Real estate tools
    { pattern: /\b(yardi|appfolio|buildium|rentmanager|costar|loopnet|zillow|realtor\.com|mls system|property management software)\b/gi, category: "tool", importance: "important" },
    // Construction & development
    { pattern: /\b(construction management|development|entitlements|zoning|permitting|site selection|due diligence|feasibility study|proforma|ground-up)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== HOSPITALITY & TOURISM =====
    // Hotel operations (critical)
    { pattern: /\b(hotel management|front desk|guest services|concierge|housekeeping|room service|bellhop|valet|hospitality|guest experience)\b/gi, category: "hard_skill", importance: "critical" },
    // Revenue & reservations
    { pattern: /\b(revenue management|revpar|adr|occupancy rate|yield management|reservations|booking|ota|online travel agency|gds|central reservations)\b/gi, category: "hard_skill", importance: "critical" },
    // Food & beverage
    { pattern: /\b(food and beverage|f&b|restaurant management|banquet|catering|culinary|chef|kitchen management|menu planning|food cost|beverage cost)\b/gi, category: "hard_skill", importance: "important" },
    // Hospitality systems
    { pattern: /\b(opera|pms|property management system|micros|aloha|toast|opentable|resy|tripleseat|eventbrite|cvent)\b/gi, category: "tool", importance: "important" },
    // Hospitality certifications
    { pattern: /\b(cha|chae|cfbe|cht|crme|servsafe|tips certified|food handler|alcohol server|cmp|meeting planner)\b/gi, category: "certification", importance: "important" },
    // Events & tourism
    { pattern: /\b(event planning|event management|conference|meeting planning|destination|tourism|travel agent|tour operator|group sales|corporate events)\b/gi, category: "industry_term", importance: "important" },
    // Hospitality soft skills
    { pattern: /\b(guest satisfaction|service excellence|complaint resolution|upselling|vip|loyalty program|customer experience|hospitality minded)\b/gi, category: "soft_skill", importance: "important" },
    
    // ===== RETAIL =====
    // Retail operations (critical)
    { pattern: /\b(retail management|store management|store operations|visual merchandising|planogram|inventory control|shrinkage|loss prevention|lp)\b/gi, category: "hard_skill", importance: "critical" },
    // Sales & customer service
    { pattern: /\b(retail sales|sales associate|cashier|customer service|clienteling|personal shopping|fitting room|register|pos|point of sale)\b/gi, category: "hard_skill", importance: "important" },
    // E-commerce retail
    { pattern: /\b(e-commerce|ecommerce|omnichannel|multichannel|buy online pick up|bopis|ship from store|marketplace|amazon|shopify|magento|bigcommerce)\b/gi, category: "hard_skill", importance: "critical" },
    // Retail metrics
    { pattern: /\b(same store sales|comp sales|conversion rate|basket size|aov|average order value|traffic|footfall|units per transaction|upt)\b/gi, category: "industry_term", importance: "important" },
    // Retail systems
    { pattern: /\b(retail pro|lightspeed|square|clover|netsuite retail|oracle retail|sap retail|jda|manhattan associates|blue yonder)\b/gi, category: "tool", importance: "important" },
    // Category & merchandising
    { pattern: /\b(category management|buying|merchandising|assortment planning|allocation|replenishment|markdown|pricing strategy|promotional planning)\b/gi, category: "hard_skill", importance: "important" },
    // Retail leadership
    { pattern: /\b(district manager|regional manager|area manager|store director|general manager|assistant manager|key holder|shift lead|team lead)\b/gi, category: "industry_term", importance: "nice_to_have" },
    
    // ===== MEDIA, ENTERTAINMENT & CREATIVE =====
    // Video production (critical)
    { pattern: /\b(video production|film production|tv production|broadcast|broadcasting|post-production|pre-production|production coordinator|production assistant|line producer)\b/gi, category: "hard_skill", importance: "critical" },
    // Content creation
    { pattern: /\b(content creation|content creator|content strategy|social media content|video content|youtube|tiktok|instagram|podcast|podcasting|streaming|live streaming)\b/gi, category: "hard_skill", importance: "critical" },
    // Creative software (critical)
    { pattern: /\b(adobe creative suite|adobe creative cloud|photoshop|illustrator|indesign|premiere pro|after effects|final cut pro|davinci resolve|avid|pro tools|logic pro)\b/gi, category: "tool", importance: "critical" },
    // Design skills
    { pattern: /\b(graphic design|motion graphics|vfx|visual effects|animation|3d animation|2d animation|character design|storyboarding|concept art|ui design|ux design|brand design)\b/gi, category: "hard_skill", importance: "critical" },
    // Photography & videography
    { pattern: /\b(photography|videography|cinematography|camera operator|dslr|mirrorless|lighting|grip|gaffer|sound design|audio engineering|color grading|color correction)\b/gi, category: "hard_skill", importance: "important" },
    // Publishing & journalism
    { pattern: /\b(journalism|editorial|copywriting|copyeditor|copy editing|proofreading|fact-checking|news writing|feature writing|investigative reporting|press release)\b/gi, category: "hard_skill", importance: "important" },
    // Entertainment industry
    { pattern: /\b(talent management|casting|talent acquisition|entertainment law|royalties|licensing|syndication|distribution|box office|theatrical|network|cable|streaming platform)\b/gi, category: "industry_term", importance: "important" },
    // Advertising & creative agencies
    { pattern: /\b(advertising|ad agency|creative agency|creative director|art director|copywriter|account executive|media buyer|media planning|campaign management|creative brief)\b/gi, category: "hard_skill", importance: "important" },
    // Music & audio
    { pattern: /\b(music production|audio production|mixing|mastering|recording|studio|ableton|fl studio|cubase|sound engineer|music supervisor|composer|songwriter)\b/gi, category: "hard_skill", importance: "important" },
    // Gaming & interactive
    { pattern: /\b(game design|game development|unity|unreal engine|game artist|level design|narrative design|qa testing|esports|gaming|twitch|game producer)\b/gi, category: "hard_skill", importance: "important" },
    // Creative certifications
    { pattern: /\b(adobe certified|aca|ace|avid certified|apple certified|autodesk certified|ux certification|google ux)\b/gi, category: "certification", importance: "important" },
    // Creative soft skills
    { pattern: /\b(creative thinking|visual storytelling|brand identity|creative concept|ideation|brainstorming|art direction|creative vision|aesthetic|portfolio)\b/gi, category: "soft_skill", importance: "nice_to_have" },
    
    // ===== CONSTRUCTION, ARCHITECTURE & TRADES =====
    // Construction management (critical)
    { pattern: /\b(construction management|project management|general contractor|gc|subcontractor|site supervisor|site manager|superintendent|foreman|field engineer)\b/gi, category: "hard_skill", importance: "critical" },
    // Safety & compliance (critical)
    { pattern: /\b(osha|osha 10|osha 30|safety training|site safety|safety compliance|ppe|personal protective equipment|hazmat|fall protection|confined space|lockout tagout|loto)\b/gi, category: "certification", importance: "critical" },
    // Blueprints & technical docs
    { pattern: /\b(blueprints|blueprint reading|construction drawings|architectural drawings|shop drawings|as-builts|rfi|submittal|punch list|specifications|specs)\b/gi, category: "hard_skill", importance: "critical" },
    // Estimating & bidding
    { pattern: /\b(project estimating|cost estimating|quantity takeoff|bid preparation|bidding|proposal|change order|scope of work|sow|bill of quantities|boq)\b/gi, category: "hard_skill", importance: "critical" },
    // Building codes & permits
    { pattern: /\b(building codes|ibc|international building code|nec|national electrical code|fire code|ada compliance|zoning|permitting|building permit|inspection|code compliance)\b/gi, category: "hard_skill", importance: "critical" },
    // Architecture & design
    { pattern: /\b(architecture|architectural design|schematic design|design development|construction documents|cd|aia|revit|autocad|sketchup|rhino|grasshopper|bim|building information modeling)\b/gi, category: "hard_skill", importance: "critical" },
    // Engineering disciplines
    { pattern: /\b(structural engineering|mep|mechanical electrical plumbing|hvac|civil engineering|geotechnical|environmental engineering|landscape architecture)\b/gi, category: "industry_term", importance: "important" },
    // Skilled trades
    { pattern: /\b(electrician|plumber|plumbing|carpentry|carpenter|welding|welder|pipefitter|ironworker|mason|masonry|drywall|roofing|flooring|painting|glazing)\b/gi, category: "hard_skill", importance: "critical" },
    // Construction software
    { pattern: /\b(procore|plangrid|bluebeam|primavera|p6|ms project|buildertrend|coconstruct|sage 300|viewpoint|textura|prolog)\b/gi, category: "tool", importance: "important" },
    // Construction certifications
    { pattern: /\b(pmp|cpm|leed|leed ap|leed ga|ccm|cpc|osha certified|journeyman|master electrician|master plumber|contractor license)\b/gi, category: "certification", importance: "important" },
    // Project delivery
    { pattern: /\b(design-build|design-bid-build|cm at risk|cmar|ipd|integrated project delivery|fast-track|turnkey|phased construction|value engineering)\b/gi, category: "methodology", importance: "important" },
    // Materials & equipment
    { pattern: /\b(concrete|steel|lumber|framing|foundation|excavation|grading|heavy equipment|crane|forklift|bobcat|backhoe|bulldozer|equipment operator)\b/gi, category: "hard_skill", importance: "important" },
    // Sustainability
    { pattern: /\b(green building|sustainable construction|net zero|energy efficiency|solar|renewable energy|water conservation|recycled materials|environmental impact)\b/gi, category: "industry_term", importance: "nice_to_have" },
    
    // ===== TRANSPORTATION, LOGISTICS & AUTOMOTIVE =====
    // Fleet management (critical)
    { pattern: /\b(fleet management|fleet operations|vehicle maintenance|fleet maintenance|dispatch|dispatching|route optimization|routing|driver management|fuel management)\b/gi, category: "hard_skill", importance: "critical" },
    // CDL & licensing
    { pattern: /\b(cdl|commercial driver license|class a|class b|hazmat endorsement|tanker endorsement|passenger endorsement|twic|transportation worker identification)\b/gi, category: "certification", importance: "critical" },
    // DOT & regulations
    { pattern: /\b(dot|department of transportation|dot compliance|fmcsa|eld|electronic logging device|hos|hours of service|csa|driver qualification|drug testing|dot physical)\b/gi, category: "hard_skill", importance: "critical" },
    // Telematics & technology
    { pattern: /\b(telematics|gps tracking|fleet tracking|onboard diagnostics|obd|dash cam|driver behavior|fuel efficiency|idle time|geofencing|route planning software)\b/gi, category: "tool", importance: "important" },
    // Trucking & freight
    { pattern: /\b(trucking|freight|ltl|ftl|truckload|less than truckload|intermodal|drayage|cross-docking|freight broker|freight forwarding|carrier relations)\b/gi, category: "industry_term", importance: "important" },
    // Warehousing & distribution
    { pattern: /\b(warehouse management|wms|distribution center|dc|fulfillment|pick and pack|inventory control|receiving|shipping|loading dock|material handling|forklift operator)\b/gi, category: "hard_skill", importance: "critical" },
    // Automotive manufacturing
    { pattern: /\b(automotive|oem|tier 1|tier 2|automotive supplier|assembly line|production line|quality control|iatf 16949|apqp|ppap|spc|msa)\b/gi, category: "industry_term", importance: "important" },
    // Automotive service
    { pattern: /\b(automotive technician|mechanic|ase certified|ase|diagnostics|brake repair|engine repair|transmission|alignment|tire|oil change|service advisor|service writer)\b/gi, category: "hard_skill", importance: "critical" },
    // Transportation software
    { pattern: /\b(tms|transportation management system|samsara|omnitracs|keeptruckin|motive|geotab|verizon connect|trimble|jj keller|mcleod|tmw)\b/gi, category: "tool", importance: "important" },
    // Shipping & cargo
    { pattern: /\b(shipping|cargo|bill of lading|bol|freight bill|pallet|skid|container|ocean freight|air freight|customs|import|export|incoterms)\b/gi, category: "hard_skill", importance: "important" },
    // Last mile & delivery
    { pattern: /\b(last mile|last-mile delivery|delivery driver|courier|package delivery|route driver|delivery management|proof of delivery|pod|delivery optimization)\b/gi, category: "industry_term", importance: "important" },
    // Rail & aviation
    { pattern: /\b(railroad|rail transport|locomotive|conductor|aviation|airline|aircraft|pilot|flight operations|ground handling|airport operations|tsa)\b/gi, category: "industry_term", importance: "nice_to_have" },
    
    // ===== ENERGY, UTILITIES & RENEWABLE =====
    // Power generation (critical)
    { pattern: /\b(power generation|power plant|generating station|baseload|peaking|combined cycle|simple cycle|cogeneration|chp|combined heat and power|capacity factor)\b/gi, category: "hard_skill", importance: "critical" },
    // Grid operations (critical)
    { pattern: /\b(grid operations|transmission|distribution|substation|switchgear|transformer|voltage|load management|peak demand|demand response|grid stability|blackout|outage management)\b/gi, category: "hard_skill", importance: "critical" },
    // NERC & compliance (critical)
    { pattern: /\b(nerc|nerc compliance|nerc cip|ferc|reliability standards|bulk electric system|bes|critical infrastructure protection|cip|mandatory reliability standards)\b/gi, category: "certification", importance: "critical" },
    // Solar energy
    { pattern: /\b(solar|photovoltaic|pv|solar panel|solar array|solar farm|utility-scale solar|distributed solar|rooftop solar|inverter|net metering|solar installation)\b/gi, category: "hard_skill", importance: "critical" },
    // Wind energy
    { pattern: /\b(wind|wind turbine|wind farm|onshore wind|offshore wind|wind energy|nacelle|rotor|blade|wind resource assessment|capacity factor|curtailment)\b/gi, category: "hard_skill", importance: "critical" },
    // Energy storage
    { pattern: /\b(energy storage|battery storage|lithium-ion|bess|battery energy storage system|pumped hydro|flywheel|grid-scale storage|behind-the-meter|peak shaving)\b/gi, category: "hard_skill", importance: "important" },
    // Traditional generation
    { pattern: /\b(natural gas|coal|nuclear|hydro|hydroelectric|steam turbine|gas turbine|boiler|combustion|emissions|flue gas|scrubber|cooling tower)\b/gi, category: "industry_term", importance: "important" },
    // Utilities operations
    { pattern: /\b(utility|electric utility|gas utility|water utility|wastewater|public utility|iou|investor-owned utility|municipal utility|cooperative|coop|rate case|tariff)\b/gi, category: "industry_term", importance: "important" },
    // Energy markets & trading
    { pattern: /\b(energy trading|power trading|wholesale market|iso|rto|pjm|ercot|caiso|nyiso|miso|spp|day-ahead|real-time market|locational marginal pricing|lmp)\b/gi, category: "hard_skill", importance: "important" },
    // Smart grid & metering
    { pattern: /\b(smart grid|smart meter|ami|advanced metering infrastructure|scada|ems|energy management system|dms|distribution management|outage management system|oms)\b/gi, category: "tool", importance: "important" },
    // Energy efficiency
    { pattern: /\b(energy efficiency|demand side management|dsm|weatherization|energy audit|building performance|energy star|leed|retro-commissioning|measurement and verification|m&v)\b/gi, category: "hard_skill", importance: "important" },
    // Renewable development
    { pattern: /\b(renewable energy|clean energy|green energy|sustainability|decarbonization|carbon neutral|net zero|ppa|power purchase agreement|renewable portfolio standard|rps|rec|renewable energy credit)\b/gi, category: "industry_term", importance: "important" },
    // Electric vehicles & charging
    { pattern: /\b(electric vehicle|ev|evse|charging station|charging infrastructure|dc fast charging|level 2 charging|vehicle to grid|v2g|fleet electrification|ev charging network)\b/gi, category: "hard_skill", importance: "important" },
    // Energy certifications
    { pattern: /\b(pe|professional engineer|eit|nerc certified|system operator certification|nabcep|certified energy manager|cem|cep|certified energy professional|leed ap)\b/gi, category: "certification", importance: "important" },
    // Energy software & tools
    { pattern: /\b(oasis|pi historian|osisoft|powerworld|psse|pscad|etap|easypower|homer|pvsyst|helioscope|aurora solar|energy plus|retscreen)\b/gi, category: "tool", importance: "important" },
    // Oil & gas
    { pattern: /\b(oil and gas|upstream|midstream|downstream|drilling|exploration|production|refinery|refining|pipeline|lng|natural gas liquids|ngl|petrochemical)\b/gi, category: "industry_term", importance: "important" },
    // Utility field work
    { pattern: /\b(lineman|line worker|substation technician|relay technician|meter reader|meter technician|gas technician|water operator|wastewater operator|field service)\b/gi, category: "hard_skill", importance: "critical" },
    // Environmental & safety
    { pattern: /\b(epa|environmental compliance|air quality|water quality|emissions reporting|environmental permit|spcc|hazardous waste|neshap|rcra|cercla)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== TELECOMMUNICATIONS & NETWORKING =====
    // 5G & wireless (critical)
    { pattern: /\b(5g|4g|lte|wireless|cellular|mobile network|ran|radio access network|small cell|macro cell|mmwave|millimeter wave|spectrum|frequency band)\b/gi, category: "hard_skill", importance: "critical" },
    // Fiber optics (critical)
    { pattern: /\b(fiber optic|fiber optics|ftth|fiber to the home|fttp|fiber to the premises|optical fiber|single mode|multi-mode|fiber splicing|otdr|fiber testing|dark fiber)\b/gi, category: "hard_skill", importance: "critical" },
    // Network engineering (critical)
    { pattern: /\b(network engineering|network design|network architecture|lan|wan|sd-wan|mpls|bgp|ospf|eigrp|routing|switching|network security|firewall)\b/gi, category: "hard_skill", importance: "critical" },
    // VoIP & unified communications
    { pattern: /\b(voip|voice over ip|sip|pbx|ip telephony|unified communications|uc|ucaas|webex|zoom|teams|video conferencing|collaboration|contact center)\b/gi, category: "hard_skill", importance: "critical" },
    // RF engineering
    { pattern: /\b(rf engineering|radio frequency|rf design|antenna|propagation|rf optimization|drive testing|rf planning|interference|coverage|capacity planning)\b/gi, category: "hard_skill", importance: "critical" },
    // Network infrastructure
    { pattern: /\b(data center|colo|colocation|rack|cabinet|cable management|structured cabling|cat6|cat6a|patch panel|mdf|idf|network closet)\b/gi, category: "hard_skill", importance: "important" },
    // Telecom equipment
    { pattern: /\b(cisco|juniper|arista|nokia|ericsson|huawei|ciena|adtran|calix|commscope|corning|palo alto|fortinet|checkpoint)\b/gi, category: "tool", importance: "important" },
    // ISP & carrier services
    { pattern: /\b(isp|internet service provider|carrier|telco|telecommunications|broadband|dsl|cable modem|docsis|pon|gpon|epon|fixed wireless)\b/gi, category: "industry_term", importance: "important" },
    // Network protocols & standards
    { pattern: /\b(tcp\/ip|ethernet|vlan|qos|quality of service|dns|dhcp|vpn|ipsec|ssl|tls|snmp|netflow|sflow|ipv4|ipv6)\b/gi, category: "hard_skill", importance: "important" },
    // Telecom certifications
    { pattern: /\b(ccna|ccnp|ccie|jncia|jncis|jncip|comptia network\+|cwna|cwsp|wireshark certified|fiber optic certified|bicsi|rcdd)\b/gi, category: "certification", importance: "important" },
    // Network operations
    { pattern: /\b(noc|network operations center|soc|security operations|monitoring|troubleshooting|incident management|change management|capacity management|performance management)\b/gi, category: "hard_skill", importance: "important" },
    // Cloud networking
    { pattern: /\b(cloud networking|aws networking|azure networking|gcp networking|vpc|virtual private cloud|transit gateway|direct connect|expressroute|cloud interconnect)\b/gi, category: "hard_skill", importance: "important" },
    // Satellite & microwave
    { pattern: /\b(satellite|vsat|microwave|point-to-point|backhaul|fronthaul|wireless backhaul|satellite communications|satcom|leo|geo|meo)\b/gi, category: "industry_term", importance: "nice_to_have" },
    // Telecom software & tools
    { pattern: /\b(solarwinds|nagios|zabbix|prtg|splunk|netbrain|infoblox|bluecat|what's up gold|cacti|grafana|prometheus)\b/gi, category: "tool", importance: "important" },
    
    // ===== CYBERSECURITY & INFORMATION SECURITY =====
    // Penetration testing (critical)
    { pattern: /\b(penetration testing|pen testing|pentest|ethical hacking|red team|blue team|purple team|offensive security|vulnerability assessment|security testing)\b/gi, category: "hard_skill", importance: "critical" },
    // SOC & security operations (critical)
    { pattern: /\b(soc|security operations center|soc analyst|security analyst|threat detection|threat hunting|security monitoring|incident detection|alert triage|tier 1|tier 2|tier 3)\b/gi, category: "hard_skill", importance: "critical" },
    // SIEM & security tools (critical)
    { pattern: /\b(siem|security information|splunk|qradar|sentinel|arcsight|logrhythm|sumo logic|elastic security|chronicle|exabeam|securonix)\b/gi, category: "tool", importance: "critical" },
    // Incident response (critical)
    { pattern: /\b(incident response|ir|incident handling|forensics|digital forensics|malware analysis|threat intelligence|ioc|indicators of compromise|containment|eradication|recovery)\b/gi, category: "hard_skill", importance: "critical" },
    // Compliance frameworks (critical)
    { pattern: /\b(nist|iso 27001|soc 2|soc2|pci dss|pci-dss|hipaa|gdpr|ccpa|fedramp|fisma|cis controls|cobit|hitrust|cmmc)\b/gi, category: "certification", importance: "critical" },
    // Vulnerability management
    { pattern: /\b(vulnerability management|vulnerability scanning|nessus|qualys|rapid7|tenable|nexpose|patch management|remediation|cvss|cve|zero day)\b/gi, category: "hard_skill", importance: "critical" },
    // Identity & access management
    { pattern: /\b(iam|identity access management|sso|single sign-on|mfa|multi-factor|okta|azure ad|ping identity|sailpoint|cyberark|privileged access|pam)\b/gi, category: "hard_skill", importance: "important" },
    // Endpoint security
    { pattern: /\b(edr|endpoint detection|xdr|extended detection|antivirus|endpoint protection|crowdstrike|carbon black|sentinelone|defender|cylance|tanium)\b/gi, category: "tool", importance: "important" },
    // Network security
    { pattern: /\b(firewall|ids|intrusion detection|ips|intrusion prevention|waf|web application firewall|dlp|data loss prevention|proxy|zscaler|netskope)\b/gi, category: "hard_skill", importance: "important" },
    // Cloud security
    { pattern: /\b(cloud security|cspm|cwpp|casb|cloud access security|aws security|azure security|gcp security|container security|kubernetes security|devsecops)\b/gi, category: "hard_skill", importance: "important" },
    // Application security
    { pattern: /\b(application security|appsec|sast|dast|iast|rasp|secure coding|owasp|code review|security architecture|threat modeling|sdlc)\b/gi, category: "hard_skill", importance: "important" },
    // Security certifications
    { pattern: /\b(cissp|cism|cisa|ceh|oscp|gpen|gcih|gsec|gcia|comptia security\+|cysa\+|casp\+|ccsp|sscp|crisc)\b/gi, category: "certification", importance: "critical" },
    // GRC & risk management
    { pattern: /\b(grc|governance risk compliance|risk management|risk assessment|security audit|compliance audit|policy development|security policy|control framework|third-party risk)\b/gi, category: "hard_skill", importance: "important" },
    // Security awareness
    { pattern: /\b(security awareness|phishing simulation|social engineering|user training|security culture|insider threat|data classification|security governance)\b/gi, category: "soft_skill", importance: "nice_to_have" },
    // Cryptography
    { pattern: /\b(cryptography|encryption|pki|public key|certificate|ssl\/tls|hashing|key management|hsm|hardware security module|tokenization)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== AGRICULTURE, FOOD & ENVIRONMENTAL =====
    // Farm operations (critical)
    { pattern: /\b(farm management|agriculture|farming|crop production|livestock|dairy|poultry|horticulture|agronomy|irrigation|harvesting|planting|seeding)\b/gi, category: "hard_skill", importance: "critical" },
    // Agricultural technology
    { pattern: /\b(precision agriculture|agtech|farm equipment|tractor|combine|gps guidance|drone|uav|soil sampling|yield mapping|variable rate|irrigation system)\b/gi, category: "hard_skill", importance: "important" },
    // Food safety & compliance (critical)
    { pattern: /\b(usda|fda food|food safety|haccp|fsma|sqf|brc|gfsi|food handling|sanitation|food inspection|quality control|gmp|good manufacturing)\b/gi, category: "certification", importance: "critical" },
    // Food science & processing
    { pattern: /\b(food science|food technology|food processing|food production|r&d food|formulation|shelf life|packaging|labeling|nutrition|ingredient sourcing)\b/gi, category: "hard_skill", importance: "critical" },
    // Environmental science
    { pattern: /\b(environmental science|ecology|conservation|wildlife|natural resources|forestry|fisheries|marine biology|wetlands|habitat restoration|biodiversity)\b/gi, category: "hard_skill", importance: "important" },
    // Environmental compliance
    { pattern: /\b(environmental compliance|epa|nepa|eia|environmental impact|permitting|remediation|contamination|brownfield|superfund|environmental audit)\b/gi, category: "hard_skill", importance: "critical" },
    // Sustainability
    { pattern: /\b(sustainability|sustainable|carbon footprint|greenhouse gas|ghg|climate change|renewable|recycling|waste management|circular economy|esg)\b/gi, category: "industry_term", importance: "important" },
    // Ag certifications
    { pattern: /\b(certified crop advisor|cca|organic certified|usda organic|gap certified|animal welfare certified|sustainable agriculture)\b/gi, category: "certification", importance: "important" },
    
    // ===== PHARMACEUTICAL & LIFE SCIENCES =====
    // Drug development (critical)
    { pattern: /\b(drug development|pharmaceutical|pharma|drug discovery|formulation|api|active pharmaceutical ingredient|dosage form|clinical development|preclinical)\b/gi, category: "hard_skill", importance: "critical" },
    // Clinical trials (critical)
    { pattern: /\b(clinical trials|clinical research|phase 1|phase 2|phase 3|phase 4|cro|clinical operations|patient recruitment|site management|clinical data)\b/gi, category: "hard_skill", importance: "critical" },
    // Regulatory affairs (critical)
    { pattern: /\b(regulatory affairs|fda submission|nda|anda|bla|ind|510k|pma|ema|regulatory strategy|regulatory compliance|labeling|drug approval)\b/gi, category: "hard_skill", importance: "critical" },
    // Quality & compliance
    { pattern: /\b(gmp|good manufacturing practice|gcp|good clinical practice|glp|good laboratory practice|quality assurance|quality control|batch record|deviation|capa)\b/gi, category: "certification", importance: "critical" },
    // Biotechnology
    { pattern: /\b(biotechnology|biotech|biologics|biosimilars|cell therapy|gene therapy|monoclonal antibody|mab|recombinant|protein expression|cell culture)\b/gi, category: "hard_skill", importance: "critical" },
    // Laboratory skills
    { pattern: /\b(laboratory|lab|hplc|gc|mass spectrometry|pcr|elisa|western blot|flow cytometry|microscopy|spectroscopy|chromatography|assay development)\b/gi, category: "hard_skill", importance: "critical" },
    // Pharma manufacturing
    { pattern: /\b(pharmaceutical manufacturing|sterile manufacturing|aseptic|fill finish|lyophilization|tableting|encapsulation|coating|packaging|serialization)\b/gi, category: "hard_skill", importance: "important" },
    // Pharmacovigilance
    { pattern: /\b(pharmacovigilance|drug safety|adverse event|ae|serious adverse event|sae|safety reporting|signal detection|risk management|rems)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== AEROSPACE & DEFENSE =====
    // Aerospace engineering (critical)
    { pattern: /\b(aerospace|aviation|aircraft|spacecraft|satellite|rocket|propulsion|aerodynamics|avionics|flight systems|uav|unmanned aerial)\b/gi, category: "hard_skill", importance: "critical" },
    // Defense & military
    { pattern: /\b(defense|military|dod|department of defense|army|navy|air force|marines|coast guard|veteran|mil-spec|mil-std|defense contractor)\b/gi, category: "industry_term", importance: "important" },
    // Security clearances (critical)
    { pattern: /\b(security clearance|top secret|ts\/sci|secret|confidential|clearance|polygraph|ssbi|public trust|interim clearance)\b/gi, category: "certification", importance: "critical" },
    // Aerospace systems
    { pattern: /\b(flight control|navigation|guidance|radar|lidar|sensor|payload|ground control|mission control|telemetry|flight test|certification)\b/gi, category: "hard_skill", importance: "important" },
    // Defense software
    { pattern: /\b(embedded systems|real-time|rtos|do-178|do-254|as9100|nadcap|itar|ear|export control|cmmi|model-based|mbse)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== CONSULTING & PROFESSIONAL SERVICES =====
    // Management consulting (critical)
    { pattern: /\b(management consulting|strategy consulting|business consulting|advisory|transformation|change management|process improvement|operational excellence)\b/gi, category: "hard_skill", importance: "critical" },
    // Client engagement
    { pattern: /\b(client engagement|client relationship|account management|business development|proposal|pitch|rfp|rfq|statement of work|sow|deliverable)\b/gi, category: "hard_skill", importance: "critical" },
    // Consulting frameworks
    { pattern: /\b(case study|hypothesis|workstream|sprint|workshop|facilitation|stakeholder|executive presentation|c-suite|board presentation)\b/gi, category: "methodology", importance: "important" },
    // Big 4 & consulting firms
    { pattern: /\b(big 4|deloitte|pwc|ey|kpmg|mckinsey|bain|bcg|accenture|booz allen|boutique firm|consulting firm)\b/gi, category: "industry_term", importance: "nice_to_have" },
    
    // ===== INSURANCE =====
    // Underwriting (critical)
    { pattern: /\b(underwriting|underwriter|risk assessment|policy|premium|coverage|liability|property casualty|p&c|life insurance|health insurance)\b/gi, category: "hard_skill", importance: "critical" },
    // Claims
    { pattern: /\b(claims|claims adjuster|claims examiner|loss adjuster|investigation|settlement|subrogation|litigation|reserve|indemnity)\b/gi, category: "hard_skill", importance: "critical" },
    // Actuarial
    { pattern: /\b(actuarial|actuary|asa|fsa|fcas|acas|loss ratio|combined ratio|reserving|pricing|rate filing|catastrophe modeling)\b/gi, category: "hard_skill", importance: "critical" },
    // Insurance operations
    { pattern: /\b(policy administration|billing|renewal|endorsement|binder|certificate of insurance|reinsurance|treaty|facultative|surplus lines)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== SPORTS, FITNESS & RECREATION =====
    // Fitness & training
    { pattern: /\b(personal training|fitness|strength conditioning|exercise|workout|nutrition|weight loss|athletic training|sports performance|coaching)\b/gi, category: "hard_skill", importance: "critical" },
    // Sports management
    { pattern: /\b(sports management|athletics|team management|player development|scouting|recruiting|sports marketing|sponsorship|ticket sales|fan engagement)\b/gi, category: "hard_skill", importance: "important" },
    // Fitness certifications
    { pattern: /\b(nasm|ace certified|acsm|nsca|cscs|cpt|certified personal trainer|group fitness|yoga certified|pilates certified|crossfit)\b/gi, category: "certification", importance: "critical" },
    // Recreation & parks
    { pattern: /\b(recreation|parks|leisure|community center|aquatics|lifeguard|camp|outdoor recreation|adventure|golf|tennis|ski|resort)\b/gi, category: "industry_term", importance: "important" },
    
    // ===== FASHION, BEAUTY & APPAREL =====
    // Fashion design & production
    { pattern: /\b(fashion|apparel|clothing|garment|textile|fabric|pattern making|sewing|draping|fashion design|collection|lookbook|runway)\b/gi, category: "hard_skill", importance: "critical" },
    // Retail buying & merchandising
    { pattern: /\b(buyer|buying|merchandiser|assortment|sourcing|vendor|wholesale|private label|brand management|trend forecasting|fashion week)\b/gi, category: "hard_skill", importance: "important" },
    // Beauty & cosmetics
    { pattern: /\b(beauty|cosmetics|skincare|makeup|haircare|fragrance|salon|spa|esthetician|cosmetology|nail technician|beauty advisor)\b/gi, category: "hard_skill", importance: "critical" },
    // Beauty certifications
    { pattern: /\b(cosmetology license|esthetician license|nail technician license|barber license|makeup artist|mua|beauty school)\b/gi, category: "certification", importance: "critical" },
    
    // ===== MINING & NATURAL RESOURCES =====
    // Mining operations (critical)
    { pattern: /\b(mining|mine|quarry|extraction|ore|mineral|coal|gold|copper|iron ore|lithium|underground|surface mining|open pit)\b/gi, category: "hard_skill", importance: "critical" },
    // Mining equipment
    { pattern: /\b(drilling|blasting|excavation|haul truck|loader|crusher|conveyor|processing|beneficiation|flotation|leaching|smelting)\b/gi, category: "hard_skill", importance: "important" },
    // Mining safety
    { pattern: /\b(msha|mine safety|ventilation|ground control|rock mechanics|tailings|reclamation|environmental mining|dust control)\b/gi, category: "certification", importance: "critical" },
    // Geology & exploration
    { pattern: /\b(geology|geologist|exploration|prospecting|drilling program|core sampling|assay|resource estimation|reserve|feasibility study)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== MARITIME & SHIPPING =====
    // Maritime operations (critical)
    { pattern: /\b(maritime|shipping|vessel|ship|port|harbor|marine|seafarer|merchant marine|cargo ship|tanker|container ship|bulk carrier)\b/gi, category: "hard_skill", importance: "critical" },
    // Maritime certifications
    { pattern: /\b(uscg|coast guard|stcw|merchant mariner|mmc|captain|master|mate|engineer|able seaman|oiler|wiper|twic)\b/gi, category: "certification", importance: "critical" },
    // Port operations
    { pattern: /\b(port operations|terminal|stevedoring|longshoreman|crane operator|container handling|vessel operations|berth|dock|pier|wharf)\b/gi, category: "hard_skill", importance: "important" },
    // Maritime regulations
    { pattern: /\b(imo|solas|marpol|isc code|classification society|lloyd's|dnv|abs|flag state|port state control|maritime law|jones act)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== VETERINARY & ANIMAL CARE =====
    // Veterinary medicine (critical)
    { pattern: /\b(veterinary|veterinarian|vet|animal hospital|animal clinic|dvm|veterinary technician|vet tech|animal care|animal health)\b/gi, category: "hard_skill", importance: "critical" },
    // Animal specialties
    { pattern: /\b(small animal|large animal|equine|exotic|wildlife|zoo|aquarium|livestock|companion animal|surgery|radiology|dentistry|emergency)\b/gi, category: "industry_term", importance: "important" },
    // Animal care services
    { pattern: /\b(grooming|boarding|kennel|daycare|pet sitting|dog walking|training|behavior|obedience|animal shelter|rescue|adoption)\b/gi, category: "hard_skill", importance: "important" },
    // Vet certifications
    { pattern: /\b(dvm|vmd|lvt|rvt|cvt|veterinary license|avma|specialty board|diplomate|fear free certified)\b/gi, category: "certification", importance: "critical" },
    
    // ===== GAMING & GAMBLING =====
    // Casino operations (critical)
    { pattern: /\b(casino|gaming|gambling|table games|slots|poker|blackjack|dealer|pit boss|cage|count room|surveillance|gaming floor)\b/gi, category: "hard_skill", importance: "critical" },
    // Gaming compliance
    { pattern: /\b(gaming license|gaming commission|gaming control|title 31|aml gaming|responsible gaming|self-exclusion|age verification)\b/gi, category: "certification", importance: "critical" },
    // Gaming technology
    { pattern: /\b(gaming system|slot machine|electronic gaming|sports betting|igaming|online casino|mobile gaming|lottery|keno|bingo)\b/gi, category: "industry_term", importance: "important" },
    // Video game industry
    { pattern: /\b(video game|game developer|game designer|game artist|qa tester|esports|streaming|twitch|game engine|unity|unreal)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== SECURITY & PROTECTIVE SERVICES =====
    // Security operations (critical)
    { pattern: /\b(security officer|security guard|protection|patrol|access control|cctv|surveillance|alarm|intrusion|executive protection|bodyguard)\b/gi, category: "hard_skill", importance: "critical" },
    // Security management
    { pattern: /\b(security manager|security director|loss prevention|asset protection|investigations|security assessment|threat assessment|risk mitigation)\b/gi, category: "hard_skill", importance: "critical" },
    // Security certifications
    { pattern: /\b(cpp|psp|pci|asis|security license|guard card|armed guard|unarmed|firearms|baton|pepper spray|handcuff)\b/gi, category: "certification", importance: "important" },
    // Specialized security
    { pattern: /\b(cybersecurity|physical security|maritime security|aviation security|event security|crowd management|vip protection|dignitary)\b/gi, category: "industry_term", importance: "important" },
    
    // ===== NONPROFIT & SOCIAL SERVICES =====
    // Nonprofit management (critical)
    { pattern: /\b(nonprofit|non-profit|ngo|foundation|charity|501c3|mission-driven|social impact|philanthropy|grantmaking|endowment)\b/gi, category: "industry_term", importance: "critical" },
    // Fundraising
    { pattern: /\b(fundraising|development|donor relations|major gifts|annual fund|capital campaign|planned giving|grant writing|crowdfunding|stewardship)\b/gi, category: "hard_skill", importance: "critical" },
    // Social services
    { pattern: /\b(social work|case management|counseling|crisis intervention|advocacy|community outreach|homeless services|food bank|youth services)\b/gi, category: "hard_skill", importance: "critical" },
    // Social work certifications
    { pattern: /\b(lcsw|lmsw|msw|bsw|licensed clinical|licensed professional|counselor|therapist|case manager certification)\b/gi, category: "certification", importance: "critical" },
    // Program management
    { pattern: /\b(program management|program evaluation|impact measurement|outcomes|logic model|theory of change|beneficiary|stakeholder engagement)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== RESEARCH & ACADEMIA =====
    // Academic research (critical)
    { pattern: /\b(research|researcher|principal investigator|pi|postdoc|postdoctoral|phd|doctoral|dissertation|thesis|peer review|publication)\b/gi, category: "hard_skill", importance: "critical" },
    // Academic positions
    { pattern: /\b(professor|associate professor|assistant professor|lecturer|adjunct|tenure|faculty|department chair|dean|provost|academic)\b/gi, category: "industry_term", importance: "important" },
    // Research funding
    { pattern: /\b(grant|nih|nsf|funding|proposal|r01|r21|foundation grant|corporate sponsor|irb|institutional review|ethics)\b/gi, category: "hard_skill", importance: "important" },
    // Research skills
    { pattern: /\b(statistical analysis|spss|stata|r programming|sas|qualitative|quantitative|mixed methods|survey|interview|focus group|literature review)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== CHILDCARE & EARLY EDUCATION =====
    // Childcare (critical)
    { pattern: /\b(childcare|child care|daycare|day care|preschool|pre-k|kindergarten|early childhood|infant|toddler|nanny|au pair)\b/gi, category: "hard_skill", importance: "critical" },
    // Early childhood education
    { pattern: /\b(early childhood education|ece|child development|developmentally appropriate|play-based|montessori|reggio|waldorf|head start)\b/gi, category: "hard_skill", importance: "critical" },
    // Childcare certifications
    { pattern: /\b(cda|child development associate|cpr|first aid|pediatric first aid|mandated reporter|background check|fingerprinting)\b/gi, category: "certification", importance: "critical" },
    // Youth development
    { pattern: /\b(youth development|after school|youth program|mentoring|tutoring|summer camp|recreation|enrichment|stem education)\b/gi, category: "hard_skill", importance: "important" },
    
    // ===== CLEANING & JANITORIAL =====
    // Cleaning services (critical)
    { pattern: /\b(cleaning|janitorial|custodian|housekeeping|sanitation|disinfection|floor care|carpet cleaning|window cleaning|pressure washing)\b/gi, category: "hard_skill", importance: "critical" },
    // Commercial cleaning
    { pattern: /\b(commercial cleaning|industrial cleaning|office cleaning|medical cleaning|construction cleanup|post-construction|deep cleaning)\b/gi, category: "industry_term", importance: "important" },
    // Cleaning equipment
    { pattern: /\b(floor buffer|scrubber|vacuum|extractor|steam cleaner|chemical handling|msds|sds|green cleaning|eco-friendly)\b/gi, category: "hard_skill", importance: "important" },
    
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
    
    // ===== ACTION VERBS & POWER WORDS BY INDUSTRY =====
    // Leadership & Management Action Verbs (critical)
    { pattern: /\b(spearheaded|orchestrated|championed|pioneered|transformed|revitalized|restructured|overhauled|streamlined|optimized)\b/gi, category: "soft_skill", importance: "critical" },
    { pattern: /\b(directed|supervised|mentored|coached|cultivated|empowered|delegated|mobilized|galvanized|unified)\b/gi, category: "soft_skill", importance: "important" },
    
    // Achievement & Results Action Verbs (critical)
    { pattern: /\b(achieved|exceeded|surpassed|outperformed|delivered|generated|produced|yielded|maximized|accelerated)\b/gi, category: "soft_skill", importance: "critical" },
    { pattern: /\b(boosted|increased|grew|expanded|amplified|elevated|enhanced|improved|strengthened|advanced)\b/gi, category: "soft_skill", importance: "critical" },
    { pattern: /\b(reduced|decreased|minimized|eliminated|cut|saved|conserved|consolidated|downsized|trimmed)\b/gi, category: "soft_skill", importance: "important" },
    
    // Technical & Engineering Action Verbs
    { pattern: /\b(engineered|architected|designed|developed|built|implemented|deployed|integrated|automated|programmed)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(debugged|troubleshot|diagnosed|resolved|patched|refactored|optimized|scaled|migrated|configured)\b/gi, category: "hard_skill", importance: "important" },
    { pattern: /\b(tested|validated|verified|benchmarked|prototyped|modeled|simulated|analyzed|evaluated|assessed)\b/gi, category: "hard_skill", importance: "important" },
    
    // Sales & Business Development Action Verbs
    { pattern: /\b(closed|sold|negotiated|secured|won|acquired|captured|converted|landed|prospected)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(upsold|cross-sold|pitched|presented|demonstrated|persuaded|influenced|cultivated|nurtured|retained)\b/gi, category: "soft_skill", importance: "important" },
    
    // Marketing & Creative Action Verbs
    { pattern: /\b(launched|branded|positioned|promoted|marketed|publicized|campaigned|conceptualized|crafted|curated)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(designed|illustrated|visualized|created|produced|directed|edited|composed|wrote|authored)\b/gi, category: "hard_skill", importance: "important" },
    
    // Finance & Analytics Action Verbs
    { pattern: /\b(forecasted|budgeted|projected|modeled|calculated|quantified|measured|audited|reconciled|balanced)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(analyzed|interpreted|evaluated|assessed|appraised|valued|estimated|computed|derived|extrapolated)\b/gi, category: "hard_skill", importance: "important" },
    
    // Operations & Process Action Verbs
    { pattern: /\b(streamlined|standardized|systematized|centralized|consolidated|coordinated|synchronized|facilitated|expedited|accelerated)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(implemented|executed|administered|managed|operated|maintained|monitored|tracked|controlled|regulated)\b/gi, category: "hard_skill", importance: "important" },
    
    // Healthcare & Clinical Action Verbs
    { pattern: /\b(diagnosed|treated|administered|prescribed|monitored|assessed|evaluated|triaged|stabilized|resuscitated)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(documented|charted|recorded|reported|communicated|educated|counseled|advocated|coordinated|collaborated)\b/gi, category: "soft_skill", importance: "important" },
    
    // Research & Academic Action Verbs
    { pattern: /\b(researched|investigated|discovered|published|presented|hypothesized|theorized|experimented|synthesized|formulated)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(authored|co-authored|peer-reviewed|lectured|taught|instructed|mentored|advised|supervised|guided)\b/gi, category: "soft_skill", importance: "important" },
    
    // Legal & Compliance Action Verbs
    { pattern: /\b(litigated|negotiated|drafted|reviewed|advised|represented|advocated|arbitrated|mediated|adjudicated)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(complied|enforced|regulated|audited|investigated|documented|filed|submitted|petitioned|appealed)\b/gi, category: "hard_skill", importance: "important" },
    
    // HR & People Action Verbs
    { pattern: /\b(recruited|hired|onboarded|trained|developed|coached|mentored|evaluated|promoted|retained)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(engaged|motivated|inspired|recognized|rewarded|counseled|mediated|resolved|facilitated|transitioned)\b/gi, category: "soft_skill", importance: "important" },
    
    // Project Management Action Verbs
    { pattern: /\b(planned|scheduled|prioritized|allocated|resourced|scoped|phased|milestoned|delivered|completed)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(initiated|chartered|kickstarted|launched|rolled out|piloted|scaled|transitioned|closed|retrospected)\b/gi, category: "methodology", importance: "important" },
    
    // Customer Service Action Verbs
    { pattern: /\b(resolved|addressed|handled|assisted|supported|serviced|satisfied|exceeded|delighted|retained)\b/gi, category: "soft_skill", importance: "important" },
    { pattern: /\b(responded|communicated|followed-up|escalated|de-escalated|empathized|listened|clarified|explained|educated)\b/gi, category: "soft_skill", importance: "nice_to_have" },
    
    // Construction & Trades Action Verbs
    { pattern: /\b(constructed|built|fabricated|installed|assembled|erected|renovated|remodeled|repaired|restored)\b/gi, category: "hard_skill", importance: "critical" },
    { pattern: /\b(measured|calculated|estimated|inspected|tested|certified|permitted|supervised|coordinated|scheduled)\b/gi, category: "hard_skill", importance: "important" },
    
    // Power Words & Impact Phrases
    { pattern: /\b(first-ever|award-winning|industry-leading|best-in-class|world-class|cutting-edge|state-of-the-art|groundbreaking|innovative|revolutionary)\b/gi, category: "soft_skill", importance: "nice_to_have" },
    { pattern: /\b(record-breaking|top-performing|high-impact|mission-critical|enterprise-wide|company-wide|cross-functional|multi-million|global|international)\b/gi, category: "soft_skill", importance: "important" },
    
    // Quantifiable Impact Words
    { pattern: /\b(doubled|tripled|quadrupled|10x|100%|million|billion|thousands|hundreds|dozens)\b/gi, category: "industry_term", importance: "critical" },
    { pattern: /\b(year-over-year|yoy|quarter-over-quarter|qoq|month-over-month|mom|consistently|repeatedly|continuously|sustainably)\b/gi, category: "industry_term", importance: "important" },
    
    // ===== REMOTE WORK, HYBRID & GIG ECONOMY =====
    // Remote work arrangements (critical)
    { pattern: /\b(remote|remote work|work from home|wfh|fully remote|remote-first|remote-friendly|telecommute|telecommuting|virtual|work from anywhere)\b/gi, category: "industry_term", importance: "critical" },
    // Hybrid work
    { pattern: /\b(hybrid|hybrid work|flexible work|flex work|in-office|on-site|office-based|co-located|return to office|rto)\b/gi, category: "industry_term", importance: "important" },
    // Distributed teams
    { pattern: /\b(distributed team|distributed workforce|global team|virtual team|remote team|dispersed team|geographically distributed|multi-location|multi-site)\b/gi, category: "soft_skill", importance: "important" },
    // Asynchronous work
    { pattern: /\b(asynchronous|async|async communication|asynchronous communication|async-first|timezone|time zone|flexible hours|flexible schedule|self-directed)\b/gi, category: "soft_skill", importance: "important" },
    // Remote collaboration tools
    { pattern: /\b(zoom|teams|slack|google meet|webex|discord|miro|figma|notion|confluence|loom|calendly|hubspot)\b/gi, category: "tool", importance: "important" },
    // Gig economy & freelance
    { pattern: /\b(freelance|freelancer|independent contractor|1099|contract work|gig economy|gig work|self-employed|solopreneur|consultant)\b/gi, category: "industry_term", importance: "critical" },
    // Contract types
    { pattern: /\b(contractor|subcontractor|temp|temporary|contract-to-hire|c2h|w2|corp-to-corp|c2c|per diem|prn|seasonal|part-time|full-time)\b/gi, category: "industry_term", importance: "important" },
    // Freelance platforms
    { pattern: /\b(upwork|fiverr|toptal|freelancer\.com|99designs|guru|peopleperhour|flexjobs|we work remotely|remote\.co)\b/gi, category: "tool", importance: "nice_to_have" },
    // Remote work skills
    { pattern: /\b(self-motivated|self-starter|autonomous|independent|proactive|disciplined|time management|remote collaboration|virtual collaboration)\b/gi, category: "soft_skill", importance: "important" },
    // Digital nomad & location
    { pattern: /\b(digital nomad|location independent|anywhere|coworking|co-working|home office|remote setup|virtual office)\b/gi, category: "industry_term", importance: "nice_to_have" },
    
    // ===== AI & EMERGING TECHNOLOGY =====
    // Machine Learning & AI (critical)
    { pattern: /\b(machine learning|ml|artificial intelligence|ai|deep learning|neural network|neural net|supervised learning|unsupervised learning|reinforcement learning)\b/gi, category: "hard_skill", importance: "critical" },
    // Generative AI & LLMs (critical)
    { pattern: /\b(generative ai|gen ai|genai|large language model|llm|chatgpt|gpt|gpt-4|gpt-5|claude|gemini|llama|copilot|openai|anthropic)\b/gi, category: "hard_skill", importance: "critical" },
    // Prompt engineering
    { pattern: /\b(prompt engineering|prompt design|prompt optimization|few-shot|zero-shot|chain of thought|cot|rag|retrieval augmented|fine-tuning|fine tuning)\b/gi, category: "hard_skill", importance: "critical" },
    // AI/ML frameworks
    { pattern: /\b(tensorflow|pytorch|keras|scikit-learn|sklearn|hugging face|langchain|llamaindex|openai api|transformers|bert|stable diffusion|midjourney|dall-e)\b/gi, category: "tool", importance: "critical" },
    // Data science
    { pattern: /\b(data science|data scientist|pandas|numpy|jupyter|notebook|feature engineering|model training|model deployment|mlops|ml pipeline|data pipeline)\b/gi, category: "hard_skill", importance: "critical" },
    // Computer vision
    { pattern: /\b(computer vision|cv|image recognition|object detection|image classification|opencv|yolo|cnn|convolutional|image processing|ocr)\b/gi, category: "hard_skill", importance: "important" },
    // NLP
    { pattern: /\b(natural language processing|nlp|text mining|sentiment analysis|named entity|ner|text classification|tokenization|embedding|word2vec|vector database)\b/gi, category: "hard_skill", importance: "important" },
    // Automation & RPA (critical)
    { pattern: /\b(automation|automated|rpa|robotic process automation|uipath|automation anywhere|blue prism|power automate|zapier|make|integromat|workflow automation)\b/gi, category: "hard_skill", importance: "critical" },
    // Low-code/No-code
    { pattern: /\b(low-code|no-code|low code|no code|citizen developer|power platform|appian|outsystems|mendix|bubble|retool|airtable)\b/gi, category: "tool", importance: "important" },
    // Blockchain & Web3
    { pattern: /\b(blockchain|web3|cryptocurrency|crypto|bitcoin|ethereum|solidity|smart contract|defi|nft|token|dao|decentralized|dapp)\b/gi, category: "hard_skill", importance: "important" },
    // IoT & Edge
    { pattern: /\b(iot|internet of things|edge computing|edge ai|embedded ai|raspberry pi|arduino|sensor|connected device|smart device|industrial iot|iiot)\b/gi, category: "hard_skill", importance: "important" },
    // AR/VR/XR
    { pattern: /\b(augmented reality|ar|virtual reality|vr|mixed reality|mr|extended reality|xr|metaverse|spatial computing|3d|immersive|hololens|oculus|vision pro)\b/gi, category: "hard_skill", importance: "important" },
    // Quantum computing
    { pattern: /\b(quantum computing|quantum|qubit|qiskit|cirq|quantum algorithm|quantum machine learning|post-quantum|quantum cryptography)\b/gi, category: "hard_skill", importance: "nice_to_have" },
    // AI ethics & governance
    { pattern: /\b(ai ethics|responsible ai|explainable ai|xai|ai governance|ai safety|bias detection|fairness|model interpretability|ai regulation)\b/gi, category: "soft_skill", importance: "important" },
    // AI certifications
    { pattern: /\b(aws machine learning|azure ai|google cloud ai|tensorflow certified|databricks certified|ai certified|ml certified)\b/gi, category: "certification", importance: "important" },
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
