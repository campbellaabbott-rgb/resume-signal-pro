// Personalization configuration for industry-specific and experience-level advice
//
// Translation note: the bulk of this file (INDUSTRY_CONFIGS, ROLE_CONFIGS) is
// still English-only by design — it's a very large dataset (15 industries,
// 92 roles) and translating it is tracked as a separate, phased effort.
// EXPERIENCE_CONFIGS and the GeographicConfig.name field ARE translated: the
// getExperienceAdvice/getGeographicAdvice getters accept an optional i18next
// `t` function and look up `personalization.experience.<level>.<field>` /
// `personalization.geographic.<region>.name`, falling back to the English
// literal below via `defaultValue` when no `t` is passed or a key is missing.

type TFn = (key: string, options?: Record<string, unknown>) => unknown;

export interface IndustryConfig {
  name: string;
  keywords: string[];
  resumeTips: string[];
  preferredFormat: string;
  atsNotes: string;
  topSkills: string[];
  certifications: string[];
  // Industry-specific insights based on resume data
  commonMistakes: string[];
  strongActionVerbs: string[];
  bulletExamples: { weak: string; strong: string }[];
  keyMetrics: string[];
  industryBenchmarks: { avgScore: number; topScore: number };
}

export interface GeographicConfig {
  region: string;
  name: string;
  documentName: string; // 'Resume' vs 'CV'
  formatPreferences: string[];
  includePhoto: boolean;
  includePersonalInfo: string[];
  excludeInfo: string[];
  lengthGuidelines: string;
  culturalTips: string[];
  commonTerms: { us: string; local: string }[];
}

export interface ExperienceLevelConfig {
  level: 'entry' | 'mid' | 'senior' | 'executive';
  resumeLengthPages: number;
  focusAreas: string[];
  avoidAreas: string[];
  keyMessage: string;
  quantificationTip: string;
}

export interface RoleConfig {
  name: string;
  aliases: string[]; // Alternative names for matching
  keySkills: string[];
  mustHaveKeywords: string[];
  resumeTips: string[];
  bulletExamples: { weak: string; strong: string }[];
  keyMetrics: string[];
  commonMistakes: string[];
  interviewTopics: string[];
  // Competitor benchmarking - what top resumes include
  topResumeElements?: {
    sections: string[]; // Sections top candidates always include
    differentiators: string[]; // What makes top resumes stand out
    avgBulletCount: number; // Average bullet points per role
    certificationRate: number; // % of top resumes that include certs
    portfolioRate: number; // % that include portfolio/GitHub links
    metricsRate: number; // % that quantify achievements
  };
}

// Industry-specific configurations
export const INDUSTRY_CONFIGS: Record<string, IndustryConfig> = {
  technology: {
    name: 'Technology',
    keywords: ['Agile', 'Scrum', 'CI/CD', 'Cloud', 'AWS', 'Azure', 'Kubernetes', 'Docker', 'APIs', 'Microservices', 'DevOps', 'Machine Learning'],
    resumeTips: [
      'Lead with technical skills section near the top',
      'Include GitHub/portfolio links prominently',
      'Quantify impact: users served, latency reduced, uptime achieved',
      'List specific technologies with version numbers when relevant'
    ],
    preferredFormat: 'Skills-first or hybrid format works best',
    atsNotes: 'Tech companies often use Greenhouse, Lever, or Workday. Ensure clean formatting.',
    topSkills: ['Python', 'JavaScript', 'Cloud Architecture', 'System Design', 'Data Structures'],
    certifications: ['AWS Solutions Architect', 'Google Cloud Professional', 'Kubernetes Administrator'],
    commonMistakes: [
      'Listing technologies without showing what you built with them',
      'Missing GitHub/portfolio links when applicable',
      'Using "familiar with" instead of showing hands-on experience',
      'Not quantifying scale: users, requests/second, data volume'
    ],
    strongActionVerbs: ['Architected', 'Deployed', 'Optimized', 'Automated', 'Scaled', 'Integrated', 'Refactored', 'Debugged'],
    bulletExamples: [
      { weak: 'Worked on backend services', strong: 'Architected microservices handling 10M+ daily requests with 99.9% uptime' },
      { weak: 'Used AWS for cloud infrastructure', strong: 'Migrated legacy infrastructure to AWS, reducing costs by 40% and deployment time from 2 hours to 15 minutes' }
    ],
    keyMetrics: ['Users served', 'Latency reduction %', 'Uptime %', 'Cost savings', 'Deployment frequency', 'Code coverage'],
    industryBenchmarks: { avgScore: 68, topScore: 92 }
  },
  healthcare: {
    name: 'Healthcare',
    keywords: ['HIPAA', 'Patient Care', 'EHR', 'EMR', 'Clinical', 'Compliance', 'Quality Assurance', 'Care Coordination', 'Evidence-Based'],
    resumeTips: [
      'REQUIRED: State license number, type, and expiration date (e.g., "RN License #123456, NY, exp. 2026")',
      'Name your EMR/EHR system explicitly — Epic, Cerner, Meditech, Allscripts (ATS filters on this)',
      'Include patient population and specialty: ICU, pediatrics, oncology, ER, med-surg — recruiters filter by unit',
      'Quantify patient load per shift and measurable outcomes (satisfaction scores, readmission rates, error rates)'
    ],
    preferredFormat: 'Reverse chronological with certifications and licensure section at top',
    atsNotes: 'Healthcare ATS (iCIMS, Taleo, Workday) filters by license type, EMR system, and specialty. Missing any of these = automatic screen-out.',
    topSkills: ['Patient Assessment', 'Care Planning', 'Epic/Cerner', 'HIPAA Compliance', 'Clinical Documentation'],
    certifications: ['RN', 'BSN', 'MSN', 'ACLS', 'BLS', 'PALS', 'CNA', 'LPN', 'NPI', 'DEA (if prescriber)'],
    commonMistakes: [
      'Missing license number and expiration date — many ATS systems auto-reject without it',
      'Vague "patient care" bullets without specialty, patient volume, or outcomes',
      'Not naming the specific EMR system used (Epic vs Cerner matters to employers)',
      'Omitting patient population (ICU vs med-surg vs ER changes what recruiters see)'
    ],
    strongActionVerbs: ['Administered', 'Assessed', 'Coordinated', 'Monitored', 'Educated', 'Implemented', 'Documented', 'Triaged'],
    bulletExamples: [
      { weak: 'Provided patient care on medical unit', strong: 'Managed care for 6-8 high-acuity patients per shift, achieving 95% patient satisfaction scores' },
      { weak: 'Used Epic for documentation', strong: 'Documented 40+ patient encounters daily in Epic EHR with 100% compliance on chart completion' }
    ],
    keyMetrics: ['Patient satisfaction %', 'Patients per shift', 'Compliance rate', 'Readmission reduction', 'Error reduction %'],
    industryBenchmarks: { avgScore: 65, topScore: 88 }
  },
  finance: {
    name: 'Finance & Banking',
    keywords: ['Financial Analysis', 'Risk Management', 'Compliance', 'Portfolio', 'Bloomberg', 'Excel Modeling', 'Due Diligence', 'Valuation', 'M&A'],
    resumeTips: [
      'Quantify everything: deal sizes, AUM, revenue impact',
      'Highlight regulatory knowledge (SEC, FINRA, SOX)',
      'Include specific financial software proficiency',
      'Showcase analytical and modeling capabilities'
    ],
    preferredFormat: 'Traditional reverse chronological, conservative formatting',
    atsNotes: 'Finance firms use Workday, Taleo. Avoid creative formatting.',
    topSkills: ['Financial Modeling', 'Risk Analysis', 'Regulatory Compliance', 'Data Analysis'],
    certifications: ['CFA', 'CPA', 'FRM', 'Series 7', 'Series 63'],
    commonMistakes: [
      'Not mentioning specific deal sizes or AUM',
      'Missing regulatory certifications (Series 7, 63, etc.)',
      'Vague descriptions of financial analysis without methodology',
      'Not showing progression in responsibility'
    ],
    strongActionVerbs: ['Analyzed', 'Forecasted', 'Structured', 'Executed', 'Negotiated', 'Valued', 'Modeled', 'Advised'],
    bulletExamples: [
      { weak: 'Performed financial analysis for clients', strong: 'Built DCF and LBO models for $500M+ M&A transactions, supporting 3 successful deal closures' },
      { weak: 'Managed client portfolios', strong: 'Managed $150M AUM across 45 HNW clients, achieving 12% average annual returns vs. 8% benchmark' }
    ],
    keyMetrics: ['AUM managed', 'Deal size', 'Returns vs. benchmark', 'Revenue generated', 'Cost savings identified'],
    industryBenchmarks: { avgScore: 72, topScore: 94 }
  },
  marketing: {
    name: 'Marketing & Advertising',
    keywords: ['SEO', 'SEM', 'Content Strategy', 'Brand', 'Analytics', 'ROI', 'Campaign', 'Conversion', 'A/B Testing', 'Social Media'],
    resumeTips: [
      'Show metrics: CTR, conversion rates, ROAS, engagement',
      'Include links to campaigns or portfolio',
      'Highlight cross-functional collaboration',
      'Demonstrate data-driven decision making'
    ],
    preferredFormat: 'Hybrid format with achievements front and center',
    atsNotes: 'Marketing companies vary widely. Test with Greenhouse and Lever formats.',
    topSkills: ['Google Analytics', 'Marketing Automation', 'Content Marketing', 'Paid Media'],
    certifications: ['Google Ads', 'HubSpot', 'Facebook Blueprint', 'Google Analytics'],
    commonMistakes: [
      'Not including campaign performance metrics',
      'Missing links to portfolio or campaign examples',
      'Vague "brand awareness" claims without data',
      'Not showing ROI or revenue impact'
    ],
    strongActionVerbs: ['Launched', 'Optimized', 'Increased', 'Generated', 'Drove', 'Created', 'Managed', 'Analyzed'],
    bulletExamples: [
      { weak: 'Managed social media accounts', strong: 'Grew Instagram following from 5K to 50K in 8 months, driving 25% increase in web traffic' },
      { weak: 'Created content for marketing campaigns', strong: 'Produced 60+ pieces of content generating 500K+ impressions and 15% conversion rate' }
    ],
    keyMetrics: ['ROAS', 'CTR', 'Conversion rate', 'CAC', 'Follower growth', 'Engagement rate', 'Revenue attributed'],
    industryBenchmarks: { avgScore: 64, topScore: 89 }
  },
  sales: {
    name: 'Sales',
    keywords: ['Revenue', 'Quota', 'Pipeline', 'CRM', 'Salesforce', 'Prospecting', 'Negotiation', 'Account Management', 'B2B', 'B2C'],
    resumeTips: [
      'Lead with numbers: quota attainment %, revenue generated',
      'Show consistent track record of meeting/exceeding targets',
      'Highlight deal sizes and customer retention',
      'Include specific CRM and sales tool experience'
    ],
    preferredFormat: 'Achievement-focused with prominent metrics',
    atsNotes: 'Sales teams love numbers. Include them in every bullet.',
    topSkills: ['Negotiation', 'Relationship Building', 'Pipeline Management', 'Closing'],
    certifications: ['Salesforce Admin', 'HubSpot Sales', 'Challenger Sales'],
    commonMistakes: [
      'Not including quota attainment percentages',
      'Missing specific revenue numbers',
      'Vague "exceeded targets" without specifics',
      'Not mentioning CRM systems used'
    ],
    strongActionVerbs: ['Closed', 'Exceeded', 'Negotiated', 'Generated', 'Prospected', 'Upsold', 'Retained', 'Expanded'],
    bulletExamples: [
      { weak: 'Responsible for sales in territory', strong: 'Closed $2.1M in new business, achieving 145% of quota and ranking #2 of 25 reps' },
      { weak: 'Managed key accounts', strong: 'Grew strategic accounts by 35% YoY, expanding from $500K to $1.2M in annual revenue' }
    ],
    keyMetrics: ['Quota attainment %', 'Revenue closed', 'Deal size', 'Win rate', 'Customer retention', 'Pipeline value'],
    industryBenchmarks: { avgScore: 66, topScore: 90 }
  },
  engineering: {
    name: 'Engineering (Non-Software)',
    keywords: ['CAD', 'AutoCAD', 'SolidWorks', 'Project Management', 'P&ID', 'Lean', 'Six Sigma', 'Quality Control', 'Specifications'],
    resumeTips: [
      'State your PE license status explicitly — if licensed: "PE License #XXXXX, [State]"; if not yet: "EIT (Engineer-in-Training), [State]" — never omit this',
      'Name every CAD/simulation tool explicitly: AutoCAD, SolidWorks, CATIA, ANSYS, Revit — ATS systems filter on exact names',
      'Quantify every project: budget ($), timeline, team size, and one measurable outcome (cost savings, efficiency %, load capacity)',
      'Include discipline and relevant standards: ASME, ASTM, ASCE, NEC, NFPA, ISO — these are ATS keywords in engineering job postings'
    ],
    preferredFormat: 'Reverse chronological with technical skills and licensure section',
    atsNotes: 'Engineering ATS (Taleo, Workday, iCIMS) filters by discipline, license status, and CAD tools. Missing exact tool names causes screen-outs.',
    topSkills: ['AutoCAD/SolidWorks', 'PE License', 'Project Engineering', 'Technical Analysis', 'Quality Control'],
    certifications: ['PE (Professional Engineer)', 'EIT/FE', 'PMP', 'Six Sigma Black Belt', 'LEED AP', 'API', 'NACE'],
    commonMistakes: [
      '"PE license if applicable" is not enough — state your exact license number and state, or explicitly note EIT status',
      'Listing "CAD" without naming the specific tool (AutoCAD vs SolidWorks are different ATS keywords)',
      'Missing project budget and scope — hiring managers filter by project size',
      'Not including relevant standards (ASME, ASTM) which are primary ATS keywords in engineering postings'
    ],
    strongActionVerbs: ['Designed', 'Engineered', 'Tested', 'Analyzed', 'Calculated', 'Specified', 'Inspected', 'Commissioned'],
    bulletExamples: [
      { weak: 'Worked on construction projects', strong: 'Led design of $15M commercial building, delivering 2 weeks ahead of schedule with zero safety incidents' },
      { weak: 'Used AutoCAD for drawings', strong: 'Created 200+ detailed CAD drawings for municipal infrastructure project, reducing RFIs by 40%' }
    ],
    keyMetrics: ['Project budget', 'Schedule variance', 'Safety record', 'Cost savings', 'Efficiency improvements %'],
    industryBenchmarks: { avgScore: 70, topScore: 91 }
  },
  education: {
    name: 'Education',
    keywords: ['Curriculum', 'Assessment', 'Differentiation', 'IEP', 'Classroom Management', 'Student Outcomes', 'Professional Development'],
    resumeTips: [
      'REQUIRED: State certification number, endorsement area, and expiration (e.g., "NY Teaching Certificate #12345, Secondary Mathematics 7-12, exp. 2027") — district ATS auto-filters on this',
      'Include grade level and subject for every role — "7th grade math" beats "middle school" every time',
      'Quantify student outcomes with data: test score improvement %, pass rates vs. national average, attendance improvement',
      'Name the curriculum/program used: Common Core, IB, AP, PBIS, Fundations, Everyday Math — these are ATS keywords'
    ],
    preferredFormat: 'Reverse chronological with state certification prominently in header or top section',
    atsNotes: 'District ATS systems (often Frontline/AppliTrack) scan for exact certification codes, endorsement areas, and grade bands. Missing cert number = auto-reject in many districts.',
    topSkills: ['Differentiated Instruction', 'Data-Driven Instruction', 'IEP Development', 'Classroom Management', 'Curriculum Alignment'],
    certifications: ['State Teaching Certificate (with #)', 'TESOL/TEFL', 'Special Education Endorsement', 'Reading Specialist', 'School Counselor License', 'National Board Certification (NBCT)'],
    commonMistakes: [
      'Missing state certification number and endorsement area — most district ATS will auto-reject without it',
      'Vague grade level ("middle school" instead of "grades 6-8") limits ATS matching',
      'No student outcome data — even one data point (test scores, proficiency %) dramatically improves ATS scoring',
      'Not naming specific programs (Fountas & Pinnell, Saxon Math, etc.) which appear in job postings as keywords'
    ],
    strongActionVerbs: ['Taught', 'Developed', 'Implemented', 'Assessed', 'Differentiated', 'Mentored', 'Collaborated', 'Facilitated'],
    bulletExamples: [
      { weak: 'Taught math to middle school students', strong: 'Increased 7th grade math proficiency by 22% through differentiated instruction for 120+ students' },
      { weak: 'Created lesson plans', strong: 'Developed standards-aligned curriculum for AP Chemistry, resulting in 85% pass rate vs. 60% national average' }
    ],
    keyMetrics: ['Test score improvement %', 'Pass rates', 'Students taught', 'Attendance improvement', 'Parent satisfaction'],
    industryBenchmarks: { avgScore: 62, topScore: 86 }
  },
  hr: {
    name: 'Human Resources',
    keywords: ['HRIS', 'Talent Acquisition', 'Employee Relations', 'Benefits', 'Compliance', 'Onboarding', 'Performance Management', 'SHRM'],
    resumeTips: [
      'Quantify hires made, retention rates, time-to-fill',
      'Highlight HRIS systems experience (Workday, SAP, etc.)',
      'Show knowledge of employment law and compliance',
      'Include DEI initiatives and outcomes'
    ],
    preferredFormat: 'Achievement-focused hybrid format',
    atsNotes: 'HR professionals are ATS experts—format flawlessly!',
    topSkills: ['Talent Acquisition', 'Employee Relations', 'HRIS', 'Compensation & Benefits'],
    certifications: ['SHRM-CP', 'SHRM-SCP', 'PHR', 'SPHR'],
    commonMistakes: [
      'Not quantifying hiring metrics',
      'Missing HRIS system names and versions',
      'Vague "improved culture" claims without data',
      'Not mentioning compliance training or certifications'
    ],
    strongActionVerbs: ['Recruited', 'Onboarded', 'Administered', 'Negotiated', 'Implemented', 'Resolved', 'Streamlined', 'Trained'],
    bulletExamples: [
      { weak: 'Handled recruiting for the company', strong: 'Filled 75+ positions annually, reducing time-to-hire from 45 to 28 days while maintaining 90% 1-year retention' },
      { weak: 'Managed employee benefits', strong: 'Redesigned benefits package for 500+ employees, improving satisfaction by 25% while reducing costs by $200K annually' }
    ],
    keyMetrics: ['Time-to-fill', 'Cost-per-hire', 'Retention rate', 'Employee satisfaction', 'Hires per year'],
    industryBenchmarks: { avgScore: 69, topScore: 90 }
  },
  consulting: {
    name: 'Consulting',
    keywords: ['Client Engagement', 'Stakeholder Management', 'Strategy', 'Analysis', 'Recommendations', 'Implementation', 'Change Management'],
    resumeTips: [
      'Use case study format: situation, action, result',
      'Quantify client impact and business outcomes',
      'Highlight industries and functional areas served',
      'Show progression and increasing responsibility'
    ],
    preferredFormat: 'Achievement-focused with client impact stories',
    atsNotes: 'Consulting firms use varied systems. Focus on impact stories.',
    topSkills: ['Strategic Planning', 'Client Management', 'Data Analysis', 'Presentation'],
    certifications: ['PMP', 'Six Sigma', 'Industry-specific certifications'],
    commonMistakes: [
      'Not using situation-action-result format',
      'Missing client industry and project scope details',
      'Vague "advised clients" without measurable outcomes',
      'Not showing progression across engagements'
    ],
    strongActionVerbs: ['Advised', 'Consulted', 'Recommended', 'Presented', 'Facilitated', 'Transformed', 'Delivered', 'Led'],
    bulletExamples: [
      { weak: 'Consulted with Fortune 500 clients', strong: 'Led 12-week operational transformation for F500 retailer, identifying $15M in annual savings' },
      { weak: 'Analyzed business processes', strong: 'Developed go-to-market strategy for fintech startup, supporting successful $25M Series B raise' }
    ],
    keyMetrics: ['Client savings identified', 'Revenue impact', 'Projects delivered', 'Client satisfaction', 'Utilization rate'],
    industryBenchmarks: { avgScore: 71, topScore: 93 }
  },
  legal: {
    name: 'Legal',
    keywords: ['Litigation', 'Compliance', 'Contract', 'Due Diligence', 'Legal Research', 'Discovery', 'Regulatory', 'Negotiations', 'Corporate Law', 'Intellectual Property'],
    resumeTips: [
      'List bar admissions and jurisdictions prominently',
      'Highlight case outcomes and settlement values',
      'Include specific practice areas and expertise',
      'Mention notable clients or matters (if permitted)'
    ],
    preferredFormat: 'Reverse chronological with education prominent',
    atsNotes: 'Law firms use varied ATS. Include exact practice area keywords.',
    topSkills: ['Legal Research', 'Contract Drafting', 'Litigation', 'Negotiation', 'Regulatory Compliance'],
    certifications: ['Bar Admission', 'JD', 'LLM', 'Certified Compliance Professional'],
    commonMistakes: [
      'Not listing bar admissions and jurisdictions',
      'Missing case outcomes or deal values',
      'Vague "handled legal matters" without specifics',
      'Not mentioning billable hours or client load'
    ],
    strongActionVerbs: ['Litigated', 'Negotiated', 'Drafted', 'Counseled', 'Represented', 'Researched', 'Argued', 'Mediated'],
    bulletExamples: [
      { weak: 'Handled corporate legal matters', strong: 'Led M&A due diligence for $200M acquisition, identifying $5M in liability risks' },
      { weak: 'Worked on litigation cases', strong: 'Successfully defended Fortune 500 client in $15M breach of contract suit, achieving dismissal with prejudice' }
    ],
    keyMetrics: ['Case outcomes', 'Settlement values', 'Billable hours', 'Matters handled', 'Client retention'],
    industryBenchmarks: { avgScore: 70, topScore: 92 }
  },
  retail: {
    name: 'Retail',
    keywords: ['Sales', 'Customer Service', 'Inventory', 'Merchandising', 'POS', 'Loss Prevention', 'Visual Display', 'Upselling', 'Store Operations', 'KPIs'],
    resumeTips: [
      'Quantify sales performance and targets exceeded',
      'Highlight customer satisfaction scores',
      'Include specific POS and inventory systems',
      'Show leadership and team management experience'
    ],
    preferredFormat: 'Achievement-focused with metrics prominent',
    atsNotes: 'Retail uses Workday, iCIMS. Include sales numbers in every bullet.',
    topSkills: ['Customer Service', 'Sales', 'Inventory Management', 'Team Leadership', 'Visual Merchandising'],
    certifications: ['Retail Management Certificate', 'Customer Service Certification', 'Loss Prevention Certified'],
    commonMistakes: [
      'Not including sales numbers and percentages',
      'Missing customer satisfaction metrics',
      'Vague "provided customer service" without outcomes',
      'Not mentioning specific retail systems used'
    ],
    strongActionVerbs: ['Sold', 'Exceeded', 'Merchandised', 'Trained', 'Managed', 'Increased', 'Reduced', 'Upsold'],
    bulletExamples: [
      { weak: 'Worked in retail sales', strong: 'Exceeded monthly sales targets by 25% average, ranking #1 of 15 associates for 6 consecutive months' },
      { weak: 'Helped customers with purchases', strong: 'Achieved 98% customer satisfaction rating while processing 100+ transactions daily with $45 average upsell' }
    ],
    keyMetrics: ['Sales vs target %', 'Average transaction value', 'Customer satisfaction', 'Shrink reduction', 'Units per transaction'],
    industryBenchmarks: { avgScore: 58, topScore: 82 }
  },
  hospitality: {
    name: 'Hospitality',
    keywords: ['Guest Services', 'Hotel Operations', 'F&B', 'Revenue Management', 'Housekeeping', 'Front Desk', 'Reservations', 'Concierge', 'Banquets', 'OPERA'],
    resumeTips: [
      'Highlight guest satisfaction scores and reviews',
      'Include specific property management systems',
      'Quantify revenue impact and occupancy rates',
      'Show multilingual abilities prominently'
    ],
    preferredFormat: 'Reverse chronological with guest service focus',
    atsNotes: 'Hospitality uses varied systems. Emphasize guest experience metrics.',
    topSkills: ['Guest Relations', 'Revenue Management', 'F&B Operations', 'Team Leadership', 'Problem Resolution'],
    certifications: ['CHA', 'CHIA', 'ServSafe', 'TIPS Certified', 'Revenue Management Certificate'],
    commonMistakes: [
      'Not including guest satisfaction scores',
      'Missing property management system experience',
      'Vague "provided excellent service" without metrics',
      'Not mentioning languages spoken'
    ],
    strongActionVerbs: ['Hosted', 'Coordinated', 'Managed', 'Resolved', 'Exceeded', 'Trained', 'Improved', 'Curated'],
    bulletExamples: [
      { weak: 'Worked at front desk', strong: 'Managed front desk operations for 300-room property, achieving 95% guest satisfaction and 15% upsell rate' },
      { weak: 'Helped with events', strong: 'Coordinated 50+ banquet events annually generating $2M revenue with 98% client satisfaction' }
    ],
    keyMetrics: ['Guest satisfaction score', 'RevPAR', 'Occupancy rate', 'Upsell revenue', 'TripAdvisor rating'],
    industryBenchmarks: { avgScore: 56, topScore: 80 }
  },
  manufacturing: {
    name: 'Manufacturing',
    keywords: ['Lean', 'Six Sigma', 'Production', 'Quality Control', 'Supply Chain', 'ERP', 'Continuous Improvement', 'Safety', 'OEE', 'Kaizen'],
    resumeTips: [
      'Quantify production improvements and efficiency gains',
      'Highlight safety records and compliance',
      'Include specific machinery and ERP systems',
      'Show cost reduction and quality improvements'
    ],
    preferredFormat: 'Reverse chronological with technical skills section',
    atsNotes: 'Manufacturing uses SAP, Oracle, Workday. Include exact system names.',
    topSkills: ['Lean Manufacturing', 'Quality Assurance', 'Production Planning', 'Process Improvement', 'Safety Compliance'],
    certifications: ['Six Sigma Black Belt', 'Lean Certification', 'OSHA 30', 'PMP', 'APICS CPIM'],
    commonMistakes: [
      'Not quantifying production improvements',
      'Missing safety record metrics',
      'Vague "improved processes" without percentages',
      'Not mentioning specific ERP/MES systems'
    ],
    strongActionVerbs: ['Optimized', 'Reduced', 'Implemented', 'Streamlined', 'Achieved', 'Eliminated', 'Improved', 'Standardized'],
    bulletExamples: [
      { weak: 'Worked in manufacturing operations', strong: 'Implemented Lean manufacturing principles, reducing waste by 30% and increasing OEE from 72% to 89%' },
      { weak: 'Managed production line', strong: 'Led production team of 25, achieving 99.5% quality rate and 2M+ hours without lost-time injury' }
    ],
    keyMetrics: ['OEE improvement', 'Scrap/waste reduction', 'Safety record', 'Cost savings', 'Cycle time reduction'],
    industryBenchmarks: { avgScore: 64, topScore: 88 }
  },
  government: {
    name: 'Government / Public Sector',
    keywords: ['Policy', 'Compliance', 'Regulations', 'Public Administration', 'Grant Management', 'Stakeholder Engagement', 'Budget', 'Procurement', 'FOIA', 'Federal'],
    resumeTips: [
      'Include GS level or equivalent for federal roles',
      'Highlight security clearances prominently',
      'Use USAJOBS format for federal applications',
      'Quantify budget managed and constituents served'
    ],
    preferredFormat: 'Federal resume format (detailed, 4-6 pages) or standard for state/local',
    atsNotes: 'Federal uses USAJOBS. State/local varies. Match exact job announcement language.',
    topSkills: ['Policy Analysis', 'Budget Management', 'Regulatory Compliance', 'Stakeholder Engagement', 'Grant Writing'],
    certifications: ['Security Clearance', 'PMP', 'CPA (for finance roles)', 'Certified Government Financial Manager'],
    commonMistakes: [
      'Using private sector resume format for federal jobs',
      'Not including security clearance status',
      'Missing hours worked per week (required for federal)',
      'Not using keywords from job announcement'
    ],
    strongActionVerbs: ['Administered', 'Coordinated', 'Implemented', 'Managed', 'Developed', 'Analyzed', 'Oversaw', 'Facilitated'],
    bulletExamples: [
      { weak: 'Worked on government programs', strong: 'Administered $50M federal grant program serving 10,000+ beneficiaries with 100% compliance rate' },
      { weak: 'Helped with policy development', strong: 'Developed regulatory framework adopted by 15 state agencies, impacting 2M+ citizens' }
    ],
    keyMetrics: ['Budget managed', 'Constituents served', 'Compliance rate', 'Program outcomes', 'Cost savings achieved'],
    industryBenchmarks: { avgScore: 62, topScore: 86 }
  },
  product_management: {
    name: 'Product Management',
    keywords: ['Product Roadmap', 'Agile', 'Scrum', 'OKRs', 'User Stories', 'Backlog', 'Go-to-Market', 'Stakeholder Management', 'A/B Testing', 'Product Strategy'],
    resumeTips: [
      'Lead with business outcomes, not features shipped',
      'Quantify impact: revenue, users, engagement, conversion',
      'Show data-driven decision making with A/B tests and OKRs',
      'Highlight cross-functional leadership and technical credibility'
    ],
    preferredFormat: 'Hybrid format with outcomes front and center',
    atsNotes: 'PM roles use Greenhouse, Lever. Include exact PM frameworks (OKR, Agile, etc.).',
    topSkills: ['Product Strategy', 'Roadmap Planning', 'User Research', 'Data Analysis', 'Stakeholder Management'],
    certifications: ['CSPO', 'PSPO', 'CSM', 'PSM', 'PMP', 'Pragmatic Marketing'],
    commonMistakes: [
      'Listing features shipped without business outcomes',
      'Not quantifying user or revenue impact',
      'Focusing on process instead of results',
      'Missing data-driven decision examples'
    ],
    strongActionVerbs: ['Launched', 'Prioritized', 'Defined', 'Shipped', 'Drove', 'Increased', 'Reduced', 'Owned'],
    bulletExamples: [
      { weak: 'Managed product roadmap', strong: 'Owned roadmap for $50M revenue line, launching 12 features that drove 35% increase in engagement and $8M ARR growth' },
      { weak: 'Worked with engineering on features', strong: 'Led cross-functional team of 15 to ship checkout redesign, improving conversion 22% and reducing cart abandonment 40%' }
    ],
    keyMetrics: ['Revenue/ARR impact', 'User growth', 'Engagement improvements', 'Conversion rate changes', 'NPS/satisfaction scores', 'OKR achievement'],
    industryBenchmarks: { avgScore: 70, topScore: 93 }
  },
  creative: {
    name: 'Creative & Design',
    keywords: ['Brand Identity', 'Typography', 'UI/UX', 'Visual Design', 'Figma', 'Adobe Creative Suite', 'Art Direction', 'Wireframing', 'Prototyping', 'Motion Design'],
    resumeTips: [
      'Always include a portfolio link — it is your most important credential',
      'Show measurable impact: conversion uplift, engagement increase, brand metrics',
      'Highlight collaboration with product and engineering teams',
      'Quantify scale: users impacted, designs shipped, campaigns run'
    ],
    preferredFormat: 'Hybrid with prominent portfolio link; clean visual formatting',
    atsNotes: 'Creative roles vary widely. Keep ATS version plain-text; submit PDF portfolio separately.',
    topSkills: ['Figma', 'Adobe Creative Suite', 'Visual Design', 'UX Research', 'Brand Design'],
    certifications: ['Adobe Certified', 'Google UX Design Certificate', 'Interaction Design Foundation'],
    commonMistakes: [
      'Not linking to a portfolio with case studies',
      'Missing measurable impact of design decisions',
      'Focusing on tools used instead of problems solved',
      'Not showing end-to-end design process'
    ],
    strongActionVerbs: ['Designed', 'Conceptualized', 'Illustrated', 'Animated', 'Directed', 'Crafted', 'Produced', 'Launched'],
    bulletExamples: [
      { weak: 'Created marketing materials', strong: 'Designed rebrand system across 200+ assets, increasing brand recognition scores by 34% in post-campaign survey' },
      { weak: 'Made wireframes and prototypes', strong: 'Led UX redesign of checkout flow, reducing cart abandonment by 28% and increasing mobile conversion by 22%' }
    ],
    keyMetrics: ['Conversion improvement', 'User satisfaction (SUS/NPS)', 'Brand metric changes', 'Assets produced', 'Projects shipped', 'Accessibility score'],
    industryBenchmarks: { avgScore: 63, topScore: 88 }
  },
  data_engineering: {
    name: 'Data Engineering',
    keywords: ['ETL', 'Data Pipeline', 'Apache Airflow', 'dbt', 'Apache Spark', 'Apache Kafka', 'Snowflake', 'BigQuery', 'Databricks', 'Data Warehouse', 'Stream Processing', 'Data Modeling'],
    resumeTips: [
      'Name every tool explicitly — "Airflow", "dbt", "Snowflake" score independently in ATS; "ETL tools" scores nothing',
      'Quantify pipeline scale: GB/TB/PB processed, number of DAGs/pipelines, latency SLA, uptime %',
      'State your modeling approach: dimensional modeling, star schema, medallion architecture, data vault',
      'Include data quality and reliability metrics: incident count, SLA adherence, freshness SLA'
    ],
    preferredFormat: 'Reverse chronological with dedicated Technical Skills section listing all tools and platforms',
    atsNotes: 'Data eng roles use Greenhouse and Lever. Tool names are primary ATS filters — Snowflake, dbt, Airflow, Spark are exact-match keywords.',
    topSkills: ['Apache Airflow', 'dbt', 'Apache Spark', 'Snowflake/BigQuery', 'Python', 'SQL', 'Kafka', 'Databricks'],
    certifications: ['Databricks Certified DE Associate', 'Snowflake Core', 'AWS Certified Data Analytics', 'GCP Professional Data Engineer', 'Azure Data Engineer Associate', 'dbt Certified'],
    commonMistakes: [
      '"Built ETL pipelines" without naming the orchestration tool, warehouse, or scale',
      'Missing data volume metrics — recruiters filter by scale (GB vs PB is a different role)',
      'Not mentioning data modeling approach (star schema vs. medallion tells interviewers your design philosophy)',
      'Omitting data quality or reliability work — downtime and SLA adherence are critical hiring signals'
    ],
    strongActionVerbs: ['Architected', 'Engineered', 'Orchestrated', 'Optimized', 'Migrated', 'Modeled', 'Automated', 'Reduced'],
    bulletExamples: [
      { weak: 'Built ETL pipelines for data warehouse', strong: 'Architected Airflow DAGs ingesting 2TB/day from 40+ sources into Snowflake, reducing load time 65% and achieving 99.9% pipeline SLA' },
      { weak: 'Worked on dbt models', strong: 'Built 150+ dbt models in medallion architecture, cutting analyst query time from 45s to 3s and enabling self-serve reporting for 60 stakeholders' }
    ],
    keyMetrics: ['Data volume (GB/TB/PB)', 'Pipeline count', 'Latency SLA', 'Uptime %', 'Query performance improvement', 'Cost reduction'],
    industryBenchmarks: { avgScore: 68, topScore: 91 }
  },

  data_science: {
    name: 'Data Science',
    keywords: ['Statistical Modeling', 'Machine Learning', 'A/B Testing', 'Python', 'SQL', 'Tableau', 'Experimentation', 'Predictive Modeling', 'scikit-learn', 'Data Visualization'],
    resumeTips: [
      'Lead every bullet with a business outcome: revenue lift $, conversion +%, churn -%, cost saved $ — not just "analyzed data"',
      'Name your statistical method and show it was applied rigorously: "Ran 3-week A/B test (n=50K, p<0.05)" not just "A/B tested"',
      'List visualization and BI tools explicitly — Tableau, Power BI, Looker are ATS keywords that analysts filter on',
      'Show stakeholder impact: "Recommendation adopted by CPO" or "Dashboard used by 50 analysts daily" proves real influence'
    ],
    preferredFormat: 'Reverse chronological with Skills section separating Languages, Tools, and Methods',
    atsNotes: 'Data science roles use Greenhouse, Lever, Workday. SQL, Python, and specific BI tools (Tableau/Power BI) are primary ATS filters.',
    topSkills: ['Python', 'SQL', 'Statistical Analysis', 'A/B Testing', 'scikit-learn', 'Tableau/Power BI', 'Machine Learning', 'Data Visualization'],
    certifications: ['Google Data Analytics', 'IBM Data Science', 'Tableau Desktop Specialist', 'AWS ML Specialty', 'Coursera ML (Andrew Ng)', 'DataCamp'],
    commonMistakes: [
      '"Analyzed data to find insights" — zero scoring value without a method and outcome stated',
      'Not quantifying model performance (accuracy, AUC, RMSE) or business lift',
      'Missing BI/visualization tool names — employers filter on Tableau vs Power BI vs Looker',
      'Leaving out experiment design details (sample size, duration, significance) which signal rigor to technical interviewers'
    ],
    strongActionVerbs: ['Modeled', 'Predicted', 'Experimented', 'Quantified', 'Forecasted', 'Identified', 'Reduced', 'Increased'],
    bulletExamples: [
      { weak: 'Built machine learning models for churn prediction', strong: 'Built XGBoost churn model (AUC 0.89) identifying 78% of churners 30 days early, enabling targeted retention that reduced churn 18% ($2.3M ARR saved)' },
      { weak: 'Ran A/B tests on pricing page', strong: 'Designed and analyzed 5 pricing page experiments (avg n=80K/variant, 95% CI) lifting conversion 14% (+$1.8M ARR); presented findings to CEO and VP Product' }
    ],
    keyMetrics: ['Model accuracy/AUC/F1', 'Revenue/cost impact $', 'Conversion lift %', 'Churn reduction %', 'Sample size', 'Statistical significance'],
    industryBenchmarks: { avgScore: 67, topScore: 90 }
  },

  machine_learning: {
    name: 'Machine Learning / AI',
    keywords: ['PyTorch', 'TensorFlow', 'LLM', 'Fine-tuning', 'RAG', 'Model Deployment', 'Inference Optimization', 'Hugging Face', 'MLflow', 'Vector Database', 'LangChain', 'Embeddings'],
    resumeTips: [
      'REQUIRED for senior roles: state that a model is in production with scale (QPS served, users impacted, latency SLA) — "trained a model" without production context scores low',
      'For LLM/GenAI roles: name your stack explicitly (LangChain/LlamaIndex, vector DB, eval framework) — "worked with LLMs" is too vague',
      'Quantify inference efficiency: latency reduction ms, cost per inference $, GPU utilization % — these signal production-grade thinking',
      'Include experiment tracking and MLOps tooling (MLflow, W&B, SageMaker) — they are ATS keywords and signal production maturity'
    ],
    preferredFormat: 'Reverse chronological with Technical Stack section listing frameworks, platforms, and tooling separately',
    atsNotes: 'ML roles use Greenhouse, Lever, internal ATS. PyTorch, TensorFlow, specific LLM frameworks, and MLOps tools are primary filters.',
    topSkills: ['PyTorch', 'TensorFlow', 'Python', 'LLMs/Transformers', 'MLflow/W&B', 'Model Deployment', 'RAG', 'Vector Databases'],
    certifications: ['AWS ML Specialty', 'GCP Professional ML Engineer', 'Azure AI Engineer', 'TensorFlow Developer', 'deeplearning.ai Specializations', 'Fast.ai'],
    commonMistakes: [
      'Missing production deployment — "trained models" without deployment context scores much lower than "deployed to production at X scale"',
      'Not naming the LLM framework for GenAI roles (LangChain, LlamaIndex, DSPy are all distinct ATS keywords)',
      'Omitting inference metrics (latency, cost, throughput) which distinguish ML engineers from data scientists',
      'No MLOps/experiment tracking tool mentioned — signals that experiments were not reproducible'
    ],
    strongActionVerbs: ['Trained', 'Deployed', 'Fine-tuned', 'Optimized', 'Served', 'Distilled', 'Evaluated', 'Scaled'],
    bulletExamples: [
      { weak: 'Built machine learning models using PyTorch', strong: 'Fine-tuned Llama-3 8B on proprietary customer data (LoRA, 4-bit quant), deployed via vLLM serving 2K QPS at <200ms p99, reducing inference cost 60% vs GPT-4' },
      { weak: 'Worked on recommendation system', strong: 'Shipped two-tower retrieval model (PyTorch, 500M+ items) serving 10M daily users, improving CTR 23% and reducing embedding serving latency from 180ms to 40ms' }
    ],
    keyMetrics: ['QPS/RPS served', 'Latency (p50/p99)', 'Model accuracy/AUC', 'Cost per inference', 'GPU utilization %', 'User/business impact'],
    industryBenchmarks: { avgScore: 69, topScore: 92 }
  },

  general: {
    name: 'General / Other',
    keywords: ['Leadership', 'Communication', 'Problem Solving', 'Team Collaboration', 'Project Management', 'Customer Service'],
    resumeTips: [
      'Focus on transferable skills and achievements',
      'Quantify impact wherever possible',
      'Tailor keywords to specific job descriptions',
      'Highlight relevant experience prominently'
    ],
    preferredFormat: 'Reverse chronological for most roles',
    atsNotes: 'Match keywords from the job description closely.',
    topSkills: ['Communication', 'Problem Solving', 'Leadership', 'Teamwork'],
    certifications: ['Varies by field'],
    commonMistakes: [
      'Not tailoring to the specific job posting',
      'Missing quantifiable achievements',
      'Using generic descriptions without impact',
      'Not highlighting transferable skills'
    ],
    strongActionVerbs: ['Achieved', 'Improved', 'Managed', 'Created', 'Developed', 'Led', 'Implemented', 'Increased'],
    bulletExamples: [
      { weak: 'Responsible for team tasks', strong: 'Managed cross-functional team of 8, delivering projects 20% under budget' },
      { weak: 'Helped with customer service', strong: 'Resolved 50+ customer inquiries daily, maintaining 98% satisfaction rating' }
    ],
    keyMetrics: ['Team size managed', 'Budget responsibility', 'Customer satisfaction', 'Process improvements', 'Time/cost savings'],
    industryBenchmarks: { avgScore: 60, topScore: 85 }
  }
};

// Experience level configurations
export const EXPERIENCE_CONFIGS: Record<string, ExperienceLevelConfig> = {
  entry: {
    level: 'entry',
    resumeLengthPages: 1,
    focusAreas: [
      'Education and relevant coursework',
      'Internships and project experience',
      'Transferable skills from any work',
      'Technical skills and tools learned'
    ],
    avoidAreas: [
      'Objective statements (use summary instead)',
      'High school information (unless recent grad)',
      'Unrelated jobs without transferable skills'
    ],
    keyMessage: 'Show potential and eagerness to learn',
    quantificationTip: 'Even entry-level work has numbers: customers served, projects completed, hours volunteered'
  },
  mid: {
    level: 'mid',
    resumeLengthPages: 1,
    focusAreas: [
      'Concrete achievements with metrics',
      'Growing responsibility and leadership',
      'Specialized skills development',
      'Cross-functional collaboration'
    ],
    avoidAreas: [
      'Entry-level tasks (focus on growth)',
      'Too much detail on older roles',
      'Skills that are now expected (basic software)'
    ],
    keyMessage: 'Demonstrate consistent growth and impact',
    quantificationTip: 'Show progression: increased responsibilities, bigger projects, larger budgets'
  },
  senior: {
    level: 'senior',
    resumeLengthPages: 2,
    focusAreas: [
      'Leadership and team development',
      'Strategic initiatives and outcomes',
      'Cross-departmental impact',
      'Mentoring and knowledge transfer'
    ],
    avoidAreas: [
      'Tactical details (focus on strategy)',
      'Roles from 15+ years ago in detail',
      'Skills that should be assumed at your level'
    ],
    keyMessage: 'Show strategic thinking and leadership impact',
    quantificationTip: 'Focus on team size, budget managed, revenue influenced, org-wide impact'
  },
  executive: {
    level: 'executive',
    resumeLengthPages: 2,
    focusAreas: [
      'P&L responsibility and business outcomes',
      'Transformation and change leadership',
      'Board and stakeholder management',
      'Vision setting and culture building'
    ],
    avoidAreas: [
      'Tactical execution details',
      'Skills lists (assumed at C-level)',
      'Early career details beyond titles'
    ],
    keyMessage: 'Show business transformation and vision',
    quantificationTip: 'Revenue, market share, valuation, M&A deals, organizational scale'
  }
};

// Get personalized advice based on industry.
// The AI now returns exact enum keys matching INDUSTRY_CONFIGS keys, so a direct
// lookup is used. The fallback to 'general' handles any legacy free-text values
// still in the database from before the enum was enforced on the AI schema.
export function getIndustryAdvice(industry: string): IndustryConfig {
  const key = industry.toLowerCase().trim();
  return INDUSTRY_CONFIGS[key] ?? INDUSTRY_CONFIGS.general;
}

// Get personalized advice based on experience level
export function getExperienceAdvice(level: string, t?: TFn): ExperienceLevelConfig {
  const normalizedLevel = level.toLowerCase();

  let config: ExperienceLevelConfig;
  if (normalizedLevel.includes('entry') || normalizedLevel.includes('junior') || normalizedLevel.includes('0-2')) {
    config = EXPERIENCE_CONFIGS.entry;
  } else if (normalizedLevel.includes('mid') || normalizedLevel.includes('3-')) {
    config = EXPERIENCE_CONFIGS.mid;
  } else if (normalizedLevel.includes('senior') || normalizedLevel.includes('7-') || normalizedLevel.includes('8-')) {
    config = EXPERIENCE_CONFIGS.senior;
  } else if (normalizedLevel.includes('executive') || normalizedLevel.includes('director') || normalizedLevel.includes('vp') || normalizedLevel.includes('c-level')) {
    config = EXPERIENCE_CONFIGS.executive;
  } else {
    config = EXPERIENCE_CONFIGS.mid; // Default to mid if unclear
  }

  if (!t) return config;

  return {
    ...config,
    focusAreas: t(`personalization.experience.${config.level}.focusAreas`, { returnObjects: true, defaultValue: config.focusAreas }) as string[],
    avoidAreas: t(`personalization.experience.${config.level}.avoidAreas`, { returnObjects: true, defaultValue: config.avoidAreas }) as string[],
    keyMessage: t(`personalization.experience.${config.level}.keyMessage`, { defaultValue: config.keyMessage }) as string,
    quantificationTip: t(`personalization.experience.${config.level}.quantificationTip`, { defaultValue: config.quantificationTip }) as string,
  };
}

// Generate personalized improvement priorities
export function getPersonalizedPriorities(
  industry: string,
  experienceLevel: string,
  atsScore: number,
  hasJobDescription: boolean
): string[] {
  const priorities: string[] = [];
  const industryConfig = getIndustryAdvice(industry);
  const expConfig = getExperienceAdvice(experienceLevel);
  
  // Score-based priorities
  if (atsScore < 50) {
    priorities.push('Critical: Your ATS score is very low. Focus on keyword optimization first.');
  } else if (atsScore < 70) {
    priorities.push('Important: Your score has room to improve. Add more industry keywords.');
  }
  
  // Experience-level specific
  priorities.push(`For ${expConfig.level}-level candidates: ${expConfig.keyMessage}`);
  
  // Industry-specific
  priorities.push(`${industryConfig.name} tip: ${industryConfig.resumeTips[0]}`);
  
  // Job description guidance
  if (hasJobDescription) {
    priorities.push('You have a target job - tailor your resume specifically to match those requirements.');
  } else {
    priorities.push('Add a job description to get job-specific recommendations.');
  }
  
  return priorities.slice(0, 4);
}

// Role-specific configurations
export const ROLE_CONFIGS: Record<string, RoleConfig> = {
  product_manager: {
    name: 'Product Manager',
    aliases: ['pm', 'technical product manager', 'senior product manager', 'group product manager', 'principal pm', 'product owner', 'associate pm', 'apm', 'director of product', 'product lead', 'technical pm'],
    keySkills: ['Product Strategy', 'Roadmap Planning', 'User Research', 'Data Analysis', 'A/B Testing', 'Stakeholder Management', 'Agile/Scrum', 'Go-to-Market', 'Prioritization Frameworks', 'Technical Understanding'],
    mustHaveKeywords: ['product', 'roadmap', 'strategy', 'users', 'features', 'launch', 'metrics', 'stakeholders', 'prioritization', 'growth', 'OKRs', 'cross-functional'],
    resumeTips: [
      'Lead with product outcomes, not just features shipped',
      'Quantify business impact (revenue, users, engagement)',
      'Show data-driven decision making with A/B tests',
      'Highlight cross-functional leadership and technical credibility'
    ],
    bulletExamples: [
      { weak: 'Managed product roadmap', strong: 'Owned product roadmap for $50M revenue line, launching 12 features that drove 35% increase in user engagement and $8M ARR growth' },
      { weak: 'Worked with engineering team on features', strong: 'Led cross-functional team of 15 engineers and designers, shipping checkout redesign that improved conversion by 22% and reduced cart abandonment by 40%' }
    ],
    keyMetrics: ['Revenue/ARR impact', 'User growth', 'Engagement improvements', 'Conversion rate changes', 'NPS/satisfaction scores', 'Features launched', 'OKR achievement'],
    commonMistakes: [
      'Listing features shipped without business outcomes',
      'Not quantifying user or revenue impact',
      'Missing data-driven decision examples',
      'Focusing on process instead of results'
    ],
    interviewTopics: ['Product sense', 'Prioritization frameworks', 'Metrics and analytics', 'Cross-functional leadership', 'Technical trade-offs', 'Customer empathy', 'Go-to-market strategy'],
    topResumeElements: {
      sections: ['Summary', 'Product Experience', 'Key Achievements', 'Skills', 'Education'],
      differentiators: ['Revenue/growth impact', 'High-profile launches', 'Data-driven results', 'Cross-functional leadership', 'Technical credibility'],
      avgBulletCount: 5,
      certificationRate: 30,
      portfolioRate: 45,
      metricsRate: 95
    }
  },
  software_engineer: {
    name: 'Software Engineer',
    aliases: ['developer', 'programmer', 'swe', 'software developer', 'full stack', 'backend engineer', 'frontend engineer', 'senior engineer', 'staff engineer', 'principal engineer'],
    keySkills: ['System Design', 'Data Structures', 'Algorithms', 'Code Review', 'Testing', 'CI/CD', 'Debugging', 'Performance Optimization'],
    mustHaveKeywords: ['developed', 'implemented', 'architected', 'optimized', 'deployed', 'scaled', 'API', 'database'],
    resumeTips: [
      'Lead with impact, not just technologies used',
      'Quantify scale: users, requests/second, data volume',
      'Include GitHub/portfolio links',
      'Show both individual contribution and collaboration'
    ],
    bulletExamples: [
      { weak: 'Built REST APIs using Node.js', strong: 'Architected RESTful microservices handling 50K requests/second with 99.99% uptime' },
      { weak: 'Fixed bugs and improved code', strong: 'Reduced application latency by 60% through query optimization and caching, impacting 2M+ users' }
    ],
    keyMetrics: ['Requests/second', 'Latency reduction', 'Uptime %', 'Code coverage', 'Users impacted', 'Cost savings'],
    commonMistakes: [
      'Listing technologies without showing what you built',
      'Missing scale and performance metrics',
      'No mention of collaboration or code review',
      'Not including links to work samples'
    ],
    interviewTopics: ['System design', 'Coding challenges', 'Behavioral questions', 'Technical deep-dives', 'Architecture decisions'],
    topResumeElements: {
      sections: ['Technical Skills', 'Professional Experience', 'Projects', 'Education', 'Certifications'],
      differentiators: ['GitHub/portfolio links', 'Open source contributions', 'System scale metrics', 'Tech stack depth'],
      avgBulletCount: 4,
      certificationRate: 55,
      portfolioRate: 78,
      metricsRate: 85
    }
  },
  devops_engineer: {
    name: 'DevOps Engineer',
    aliases: ['devops', 'platform engineer', 'infrastructure engineer', 'build engineer', 'release engineer', 'cloud engineer', 'devops specialist', 'ci/cd engineer'],
    keySkills: ['CI/CD Pipelines', 'Infrastructure as Code', 'Kubernetes', 'Docker', 'Terraform', 'AWS/GCP/Azure', 'Monitoring & Observability', 'Scripting (Bash/Python)'],
    mustHaveKeywords: ['CI/CD', 'Kubernetes', 'Docker', 'Terraform', 'AWS', 'automation', 'infrastructure', 'deployment', 'pipeline', 'containerization'],
    resumeTips: [
      'Quantify deployment frequency improvements',
      'Show infrastructure cost optimization results',
      'Include uptime and reliability metrics',
      'Highlight automation impact on team velocity'
    ],
    bulletExamples: [
      { weak: 'Set up CI/CD pipelines', strong: 'Built end-to-end CI/CD pipelines reducing deployment time from 4 hours to 15 minutes, enabling 50+ daily deployments' },
      { weak: 'Managed cloud infrastructure', strong: 'Architected multi-region AWS infrastructure handling 10M+ requests/day with 99.99% uptime and 35% cost reduction' }
    ],
    keyMetrics: ['Deployment frequency', 'Lead time for changes', 'MTTR', 'Uptime %', 'Cost savings', 'Infrastructure scale'],
    commonMistakes: [
      'Not quantifying automation impact',
      'Missing specific tool versions and configurations',
      'Vague "managed infrastructure" without scale',
      'Not showing business impact of reliability improvements'
    ],
    interviewTopics: ['System design for reliability', 'Kubernetes architecture', 'CI/CD best practices', 'Incident management', 'Infrastructure as Code'],
    topResumeElements: {
      sections: ['Technical Skills', 'Experience', 'Certifications', 'Projects', 'Education'],
      differentiators: ['Cloud certifications (AWS/GCP)', 'Open source contributions', 'Cost optimization results', 'Uptime achievements'],
      avgBulletCount: 4,
      certificationRate: 72,
      portfolioRate: 45,
      metricsRate: 82
    }
  },
  site_reliability_engineer: {
    name: 'Site Reliability Engineer',
    aliases: ['sre', 'reliability engineer', 'production engineer', 'systems engineer', 'platform reliability', 'infrastructure sre', 'senior sre'],
    keySkills: ['Incident Management', 'SLOs/SLIs/SLAs', 'Monitoring & Alerting', 'Capacity Planning', 'Automation', 'Distributed Systems', 'Performance Tuning', 'Chaos Engineering'],
    mustHaveKeywords: ['reliability', 'SLO', 'incident', 'on-call', 'monitoring', 'automation', 'scalability', 'observability', 'toil reduction'],
    resumeTips: [
      'Lead with reliability metrics: uptime, MTTR, SLO achievement',
      'Quantify toil reduction and automation wins',
      'Show incident management and postmortem experience',
      'Highlight scalability achievements'
    ],
    bulletExamples: [
      { weak: 'Handled production incidents', strong: 'Reduced MTTR from 45 minutes to 8 minutes through automated runbooks and improved observability, handling 200+ incidents/year' },
      { weak: 'Improved system reliability', strong: 'Achieved 99.99% uptime (up from 99.5%) for payment processing system serving 5M daily transactions' }
    ],
    keyMetrics: ['Uptime/availability %', 'MTTR/MTTD', 'SLO achievement', 'Toil reduction %', 'Incident count reduction', 'On-call burden'],
    commonMistakes: [
      'Not including SLO/SLA metrics',
      'Missing incident volume and resolution stats',
      'Vague reliability improvements without numbers',
      'Not showing proactive vs reactive work balance'
    ],
    interviewTopics: ['Distributed systems', 'Incident response', 'SLO design', 'Capacity planning', 'Automation strategies', 'On-call best practices'],
    topResumeElements: {
      sections: ['Technical Skills', 'Experience', 'Certifications', 'On-Call Experience', 'Education'],
      differentiators: ['SLO achievement records', 'Chaos engineering experience', 'Toil automation projects', 'Post-incident improvement initiatives'],
      avgBulletCount: 4,
      certificationRate: 60,
      portfolioRate: 35,
      metricsRate: 90
    }
  },
  mobile_developer: {
    name: 'Mobile Developer',
    aliases: ['ios developer', 'android developer', 'mobile engineer', 'react native developer', 'flutter developer', 'mobile app developer', 'swift developer', 'kotlin developer'],
    keySkills: ['iOS/Swift', 'Android/Kotlin', 'React Native', 'Flutter', 'Mobile UI/UX', 'App Store Optimization', 'Mobile Testing', 'Performance Optimization'],
    mustHaveKeywords: ['iOS', 'Android', 'Swift', 'Kotlin', 'mobile', 'app', 'UI', 'performance', 'user experience', 'App Store'],
    resumeTips: [
      'Include app download counts and ratings',
      'Show performance optimization results (app size, load time)',
      'Highlight App Store/Play Store achievements',
      'Mention cross-platform experience if applicable'
    ],
    bulletExamples: [
      { weak: 'Developed mobile applications', strong: 'Built iOS app with 500K+ downloads and 4.8★ rating, reducing crash rate from 2% to 0.1%' },
      { weak: 'Worked on Android features', strong: 'Led Android rewrite reducing app size by 40% and cold start time from 4s to 1.2s, improving retention by 25%' }
    ],
    keyMetrics: ['Downloads/installs', 'App Store rating', 'Crash-free rate', 'App size reduction', 'Load time improvement', 'User retention'],
    commonMistakes: [
      'Not including download numbers or ratings',
      'Missing performance metrics (crash rate, load time)',
      'Vague feature descriptions without user impact',
      'Not showing App Store optimization experience'
    ],
    interviewTopics: ['Mobile architecture patterns (MVVM, MVI)', 'Platform-specific APIs', 'Performance optimization', 'App lifecycle', 'Testing strategies'],
    topResumeElements: {
      sections: ['Technical Skills', 'Apps Shipped', 'Experience', 'Education', 'Certifications'],
      differentiators: ['Published apps with high ratings', 'Performance optimization wins', 'Cross-platform experience', 'App Store featured achievements'],
      avgBulletCount: 4,
      certificationRate: 35,
      portfolioRate: 85,
      metricsRate: 80
    }
  },
  cloud_architect: {
    name: 'Cloud Architect',
    aliases: ['solutions architect', 'cloud solutions architect', 'aws architect', 'azure architect', 'gcp architect', 'enterprise architect', 'infrastructure architect', 'cloud consultant'],
    keySkills: ['AWS/Azure/GCP', 'Cloud Architecture', 'Infrastructure Design', 'Cost Optimization', 'Security Architecture', 'Migration Planning', 'Serverless', 'Multi-Cloud Strategy'],
    mustHaveKeywords: ['architecture', 'cloud', 'AWS', 'Azure', 'GCP', 'migration', 'scalability', 'infrastructure', 'design', 'enterprise'],
    resumeTips: [
      'Highlight cloud certifications prominently (AWS SA, Azure Architect)',
      'Quantify cost savings and performance improvements',
      'Show migration scale (workloads, data volume, users)',
      'Include multi-cloud or hybrid cloud experience'
    ],
    bulletExamples: [
      { weak: 'Designed cloud solutions for clients', strong: 'Architected multi-region AWS infrastructure for Fortune 500 client, supporting 50M+ users with 99.99% availability and $2M annual cost savings' },
      { weak: 'Led cloud migration projects', strong: 'Migrated 200+ on-premise applications to Azure, reducing infrastructure costs by 45% and improving deployment velocity by 10x' }
    ],
    keyMetrics: ['Cost savings $', 'Workloads migrated', 'Uptime achieved', 'Performance improvement %', 'Users supported', 'TCO reduction'],
    commonMistakes: [
      'Not including cloud certifications',
      'Missing quantified cost and performance impact',
      'Vague "designed cloud solutions" without scale',
      'Not showing business outcomes of architecture decisions'
    ],
    interviewTopics: ['Well-Architected Framework', 'Cost optimization strategies', 'Security best practices', 'Disaster recovery', 'Migration methodologies'],
    topResumeElements: {
      sections: ['Cloud Certifications', 'Technical Skills', 'Architecture Experience', 'Projects', 'Education'],
      differentiators: ['Multiple cloud certifications', 'Enterprise-scale projects', 'Cost optimization achievements', 'Migration success stories'],
      avgBulletCount: 4,
      certificationRate: 92,
      portfolioRate: 30,
      metricsRate: 85
    }
  },
  machine_learning_engineer: {
    name: 'Machine Learning Engineer',
    aliases: ['ml engineer', 'ai engineer', 'deep learning engineer', 'mlops engineer', 'applied ml engineer', 'ml platform engineer', 'ai/ml engineer', 'nlp engineer', 'computer vision engineer'],
    keySkills: ['PyTorch/TensorFlow', 'MLOps', 'Model Deployment', 'Feature Engineering', 'Model Optimization', 'Distributed Training', 'ML Pipelines', 'Production ML Systems'],
    mustHaveKeywords: ['machine learning', 'model', 'training', 'inference', 'deployment', 'pipeline', 'production', 'accuracy', 'latency', 'scale'],
    resumeTips: [
      'Show models in production, not just experiments',
      'Quantify inference latency and throughput',
      'Include model accuracy improvements and business impact',
      'Highlight MLOps and pipeline automation experience'
    ],
    bulletExamples: [
      { weak: 'Built machine learning models', strong: 'Deployed recommendation system serving 100M+ daily predictions with <50ms latency, increasing engagement by 35%' },
      { weak: 'Improved model performance', strong: 'Reduced model training time from 12 hours to 45 minutes through distributed training, while improving accuracy from 87% to 94%' }
    ],
    keyMetrics: ['Predictions/day', 'Inference latency', 'Model accuracy', 'Training time reduction', 'Business impact (revenue, engagement)', 'Cost per inference'],
    commonMistakes: [
      'Focusing on experiments without production deployment',
      'Missing inference latency and throughput metrics',
      'Not showing business impact of models',
      'Vague ML experience without specific frameworks/tools'
    ],
    interviewTopics: ['ML system design', 'Model optimization', 'Feature stores', 'A/B testing ML models', 'MLOps practices', 'Handling model drift'],
    topResumeElements: {
      sections: ['Technical Skills', 'ML Projects', 'Experience', 'Publications', 'Education'],
      differentiators: ['Production ML systems at scale', 'Latency/throughput achievements', 'Business impact quantification', 'Open source ML contributions'],
      avgBulletCount: 4,
      certificationRate: 45,
      portfolioRate: 70,
      metricsRate: 88
    }
  },
  blockchain_developer: {
    name: 'Blockchain Developer',
    aliases: ['web3 developer', 'smart contract developer', 'solidity developer', 'crypto developer', 'defi developer', 'blockchain engineer', 'ethereum developer', 'dapp developer'],
    keySkills: ['Solidity', 'Web3.js/Ethers.js', 'Smart Contracts', 'DeFi Protocols', 'Security Auditing', 'EVM', 'Hardhat/Truffle', 'Token Standards (ERC-20, ERC-721)'],
    mustHaveKeywords: ['blockchain', 'smart contract', 'Solidity', 'Web3', 'Ethereum', 'DeFi', 'NFT', 'security', 'audit', 'decentralized'],
    resumeTips: [
      'Highlight TVL (Total Value Locked) managed by your contracts',
      'Show security audit results and bug bounty experience',
      'Include gas optimization achievements',
      'Mention mainnet deployments and transaction volumes'
    ],
    bulletExamples: [
      { weak: 'Developed smart contracts', strong: 'Built DeFi protocol smart contracts securing $50M+ TVL with zero security incidents across 2M+ transactions' },
      { weak: 'Worked on NFT projects', strong: 'Architected NFT marketplace handling 100K+ mints, optimizing gas costs by 60% through batched transactions' }
    ],
    keyMetrics: ['TVL secured', 'Transaction volume', 'Gas optimization %', 'Security audit score', 'Users/wallets served', 'Protocol uptime'],
    commonMistakes: [
      'Not mentioning TVL or transaction volumes',
      'Missing security audit experience',
      'Vague smart contract work without outcomes',
      'Not showing gas optimization achievements'
    ],
    interviewTopics: ['Smart contract security', 'Gas optimization', 'DeFi mechanisms', 'Token economics', 'Consensus mechanisms', 'Cross-chain development'],
    topResumeElements: {
      sections: ['Technical Skills', 'Blockchain Projects', 'Experience', 'Security Audits', 'Education'],
      differentiators: ['High TVL protocols', 'Security audit experience', 'Gas optimization wins', 'Open source Web3 contributions'],
      avgBulletCount: 4,
      certificationRate: 25,
      portfolioRate: 90,
      metricsRate: 75
    }
  },
  frontend_engineer: {
    name: 'Frontend Engineer',
    aliases: ['front end developer', 'ui developer', 'ui engineer', 'react developer', 'vue developer', 'angular developer', 'javascript developer', 'web developer', 'frontend developer'],
    keySkills: ['React/Vue/Angular', 'TypeScript', 'CSS/Tailwind', 'Performance Optimization', 'Accessibility (a11y)', 'State Management', 'Testing (Jest/Cypress)', 'Responsive Design'],
    mustHaveKeywords: ['React', 'JavaScript', 'TypeScript', 'CSS', 'UI', 'frontend', 'responsive', 'performance', 'accessibility', 'component'],
    resumeTips: [
      'Show performance metrics (Core Web Vitals, load time)',
      'Highlight accessibility compliance (WCAG)',
      'Include portfolio or live project links',
      'Quantify user experience improvements'
    ],
    bulletExamples: [
      { weak: 'Built React components', strong: 'Architected component library with 50+ reusable components, reducing development time by 40% across 5 product teams' },
      { weak: 'Improved website performance', strong: 'Optimized React app achieving 95+ Lighthouse score, reducing LCP from 4.2s to 1.1s and improving conversion by 25%' }
    ],
    keyMetrics: ['Lighthouse/Core Web Vitals scores', 'Load time reduction', 'Bundle size reduction', 'Accessibility score', 'User engagement improvement', 'Component reuse rate'],
    commonMistakes: [
      'Not including portfolio or live project links',
      'Missing performance optimization metrics',
      'Vague "built UI" without showing impact',
      'Not mentioning accessibility experience'
    ],
    interviewTopics: ['React/framework internals', 'State management patterns', 'Performance optimization', 'CSS architecture', 'Accessibility best practices', 'Testing strategies'],
    topResumeElements: {
      sections: ['Technical Skills', 'Projects/Portfolio', 'Experience', 'Education', 'Certifications'],
      differentiators: ['Portfolio with live demos', 'Performance optimization wins', 'Component library contributions', 'Accessibility expertise'],
      avgBulletCount: 4,
      certificationRate: 30,
      portfolioRate: 92,
      metricsRate: 78
    }
  },
  backend_engineer: {
    name: 'Backend Engineer',
    aliases: ['back end developer', 'server side developer', 'api developer', 'backend developer', 'systems developer', 'platform developer', 'node developer', 'python developer', 'java developer', 'go developer'],
    keySkills: ['API Design', 'Database Design', 'System Architecture', 'Microservices', 'Caching (Redis)', 'Message Queues', 'Security', 'Performance Optimization'],
    mustHaveKeywords: ['API', 'database', 'backend', 'microservices', 'REST', 'GraphQL', 'scalability', 'performance', 'security', 'SQL'],
    resumeTips: [
      'Quantify API performance (requests/sec, latency)',
      'Show system scale (users, data volume)',
      'Highlight reliability metrics (uptime, error rates)',
      'Include database optimization achievements'
    ],
    bulletExamples: [
      { weak: 'Built REST APIs', strong: 'Designed RESTful API serving 100K+ requests/second with p99 latency <50ms, supporting 10M+ daily active users' },
      { weak: 'Optimized database queries', strong: 'Reduced database query time by 85% through indexing and query optimization, handling 500M+ rows with sub-second response' }
    ],
    keyMetrics: ['Requests/second', 'API latency (p50/p99)', 'Uptime %', 'Error rate reduction', 'Database query optimization', 'Users/scale supported'],
    commonMistakes: [
      'Not quantifying API performance and scale',
      'Missing reliability metrics (uptime, error rates)',
      'Vague "built backend" without specifics',
      'Not showing database optimization experience'
    ],
    interviewTopics: ['System design', 'API design best practices', 'Database optimization', 'Caching strategies', 'Security considerations', 'Scalability patterns'],
    topResumeElements: {
      sections: ['Technical Skills', 'Experience', 'System Architecture', 'Projects', 'Education'],
      differentiators: ['High-scale system experience', 'Performance optimization wins', 'Security expertise', 'Database design achievements'],
      avgBulletCount: 4,
      certificationRate: 40,
      portfolioRate: 55,
      metricsRate: 88
    }
  },
  fullstack_engineer: {
    name: 'Full Stack Engineer',
    aliases: ['full stack developer', 'fullstack developer', 'full-stack engineer', 'generalist engineer', 'product engineer', 'web developer', 'software engineer fullstack'],
    keySkills: ['React/Vue/Angular', 'Node.js/Python/Go', 'Database Design', 'API Development', 'DevOps Basics', 'System Design', 'Cloud Services', 'End-to-End Development'],
    mustHaveKeywords: ['full stack', 'frontend', 'backend', 'API', 'database', 'React', 'Node', 'end-to-end', 'full lifecycle', 'deployment'],
    resumeTips: [
      'Show end-to-end ownership of features or products',
      'Balance frontend and backend achievements equally',
      'Highlight ability to work across the entire stack',
      'Include both user-facing and system-level metrics'
    ],
    bulletExamples: [
      { weak: 'Built full stack applications', strong: 'Owned end-to-end development of customer portal serving 50K+ users: React frontend with 95+ Lighthouse score, Node.js API handling 10K req/s' },
      { weak: 'Worked on both frontend and backend', strong: 'Shipped 15+ features from design to production, reducing time-to-market by 40% through full stack ownership and automated CI/CD' }
    ],
    keyMetrics: ['Features shipped end-to-end', 'User-facing performance (load time, Lighthouse)', 'API performance (latency, throughput)', 'Development velocity', 'Code coverage'],
    commonMistakes: [
      'Heavily skewing to only frontend or backend experience',
      'Not showing end-to-end ownership',
      'Missing metrics from both sides of the stack',
      'Not demonstrating breadth across technologies'
    ],
    interviewTopics: ['System design (full stack)', 'Frontend framework deep-dive', 'Backend architecture', 'Database design', 'Deployment and DevOps', 'Trade-off decisions'],
    topResumeElements: {
      sections: ['Technical Skills', 'Full Stack Projects', 'Experience', 'Education', 'Certifications'],
      differentiators: ['End-to-end feature ownership', 'Both frontend and backend metrics', 'Startup or small team experience', 'Rapid prototyping ability'],
      avgBulletCount: 4,
      certificationRate: 35,
      portfolioRate: 80,
      metricsRate: 82
    }
  },
  platform_engineer: {
    name: 'Platform Engineer',
    aliases: ['platform developer', 'developer platform engineer', 'internal tools engineer', 'developer experience engineer', 'dx engineer', 'infrastructure platform engineer', 'platform team lead'],
    keySkills: ['Internal Developer Platforms', 'CI/CD', 'Kubernetes', 'Infrastructure as Code', 'Developer Experience', 'Service Mesh', 'Observability', 'API Gateway'],
    mustHaveKeywords: ['platform', 'developer experience', 'infrastructure', 'CI/CD', 'Kubernetes', 'automation', 'self-service', 'tooling', 'internal', 'productivity'],
    resumeTips: [
      'Quantify developer productivity improvements',
      'Show reduction in deployment friction and time',
      'Highlight adoption rates of platforms you built',
      'Include self-service capabilities enabled'
    ],
    bulletExamples: [
      { weak: 'Built internal developer tools', strong: 'Designed self-service platform adopted by 200+ engineers, reducing new service deployment time from 2 weeks to 30 minutes' },
      { weak: 'Managed Kubernetes infrastructure', strong: 'Built multi-tenant Kubernetes platform supporting 500+ microservices with 99.99% availability, saving $1.5M annually in infrastructure costs' }
    ],
    keyMetrics: ['Developer adoption rate', 'Deployment time reduction', 'Engineer productivity gains', 'Platform uptime', 'Cost savings', 'Services/teams supported'],
    commonMistakes: [
      'Not quantifying developer productivity impact',
      'Missing platform adoption metrics',
      'Vague "built internal tools" without outcomes',
      'Not showing scale of engineers/services supported'
    ],
    interviewTopics: ['Platform architecture', 'Developer experience design', 'Multi-tenancy', 'Self-service automation', 'Observability strategy', 'Cost optimization'],
    topResumeElements: {
      sections: ['Technical Skills', 'Platform Projects', 'Experience', 'Certifications', 'Education'],
      differentiators: ['Developer productivity metrics', 'Large-scale platform experience', 'Self-service automation wins', 'Cost optimization achievements'],
      avgBulletCount: 4,
      certificationRate: 65,
      portfolioRate: 40,
      metricsRate: 88
    }
  },
  staff_engineer: {
    name: 'Staff Engineer',
    aliases: ['staff software engineer', 'principal engineer', 'distinguished engineer', 'senior staff engineer', 'tech lead', 'technical lead', 'architect', 'engineering fellow'],
    keySkills: ['Technical Leadership', 'System Architecture', 'Cross-Team Collaboration', 'Technical Strategy', 'Mentorship', 'Code Review', 'Design Documents', 'Stakeholder Communication'],
    mustHaveKeywords: ['architecture', 'technical leadership', 'cross-functional', 'mentorship', 'strategy', 'design', 'scale', 'influence', 'org-wide', 'senior'],
    resumeTips: [
      'Emphasize org-wide technical impact, not just individual contributions',
      'Show leadership through influence, not just authority',
      'Quantify business outcomes of technical decisions',
      'Highlight mentorship and team growth achievements'
    ],
    bulletExamples: [
      { weak: 'Led technical projects', strong: 'Defined 3-year technical roadmap adopted across 8 engineering teams, enabling 50% faster feature delivery and $5M infrastructure savings' },
      { weak: 'Mentored junior engineers', strong: 'Established engineering mentorship program growing 12 engineers to senior level, improving team retention by 35%' }
    ],
    keyMetrics: ['Org-wide impact (teams influenced)', 'Business outcomes enabled', 'Engineers mentored/promoted', 'Technical debt reduction', 'System reliability improvements', 'Strategic initiatives led'],
    commonMistakes: [
      'Focusing only on individual code contributions',
      'Not showing cross-team influence',
      'Missing business impact of technical decisions',
      'Not highlighting mentorship and leadership'
    ],
    interviewTopics: ['System design at scale', 'Technical leadership philosophy', 'Cross-team collaboration', 'Influencing without authority', 'Technical strategy', 'Handling ambiguity'],
    topResumeElements: {
      sections: ['Summary/Impact Statement', 'Technical Leadership', 'Experience', 'Architecture Projects', 'Education'],
      differentiators: ['Org-wide technical initiatives', 'Mentorship track record', 'Business impact quantification', 'Cross-functional leadership'],
      avgBulletCount: 5,
      certificationRate: 40,
      portfolioRate: 50,
      metricsRate: 90
    }
  },
  technical_program_manager: {
    name: 'Technical Program Manager',
    aliases: ['tpm', 'program manager', 'technical project manager', 'senior tpm', 'staff tpm', 'principal tpm', 'program management', 'tech pm'],
    keySkills: ['Program Management', 'Cross-Functional Leadership', 'Risk Management', 'Stakeholder Communication', 'Roadmap Planning', 'Dependency Management', 'Technical Understanding', 'Process Improvement'],
    mustHaveKeywords: ['program', 'cross-functional', 'stakeholders', 'roadmap', 'delivery', 'dependencies', 'risk', 'milestones', 'launch', 'coordination'],
    resumeTips: [
      'Quantify program scale (teams, engineers, budget)',
      'Show on-time delivery rates and launch success',
      'Highlight cross-functional coordination scope',
      'Include risk mitigation and process improvement wins'
    ],
    bulletExamples: [
      { weak: 'Managed technical programs', strong: 'Led $15M platform migration program across 8 teams and 60+ engineers, delivering 2 weeks early with zero production incidents' },
      { weak: 'Coordinated with stakeholders', strong: 'Orchestrated launch of 3 major product features quarterly, coordinating 12 cross-functional teams and achieving 95% on-time delivery rate' }
    ],
    keyMetrics: ['Programs delivered', 'On-time delivery rate', 'Teams/engineers coordinated', 'Budget managed', 'Risk mitigation success', 'Process efficiency gains'],
    commonMistakes: [
      'Not quantifying program scale and complexity',
      'Missing delivery success rates',
      'Vague "managed programs" without outcomes',
      'Not showing technical depth alongside PM skills'
    ],
    interviewTopics: ['Program scoping and planning', 'Risk identification and mitigation', 'Stakeholder management', 'Handling competing priorities', 'Technical trade-off decisions', 'Launch coordination'],
    topResumeElements: {
      sections: ['Summary', 'Program Experience', 'Technical Skills', 'Certifications', 'Education'],
      differentiators: ['Large-scale program delivery', 'On-time launch track record', 'Cross-org coordination', 'Technical credibility'],
      avgBulletCount: 5,
      certificationRate: 55,
      portfolioRate: 15,
      metricsRate: 92
    }
  },
  engineering_manager: {
    name: 'Engineering Manager',
    aliases: ['em', 'software engineering manager', 'dev manager', 'development manager', 'engineering lead', 'team lead', 'director of engineering', 'vp engineering', 'head of engineering'],
    keySkills: ['Team Leadership', 'Hiring & Retention', 'Performance Management', 'Technical Strategy', 'Agile/Scrum', 'Stakeholder Management', 'Career Development', 'Budget Management'],
    mustHaveKeywords: ['team', 'leadership', 'hiring', 'performance', 'delivery', 'engineers', 'roadmap', 'stakeholders', 'culture', 'growth'],
    resumeTips: [
      'Quantify team size and growth under your leadership',
      'Show delivery outcomes and team velocity improvements',
      'Highlight hiring success and retention rates',
      'Include career development and promotion stats'
    ],
    bulletExamples: [
      { weak: 'Managed engineering team', strong: 'Led team of 12 engineers delivering 40+ features annually, improving sprint velocity by 35% while maintaining 95% retention rate' },
      { weak: 'Hired engineers for the team', strong: 'Scaled team from 5 to 18 engineers in 12 months, building diverse hiring pipeline with 85% offer acceptance and 90% 1-year retention' }
    ],
    keyMetrics: ['Team size/growth', 'Retention rate', 'Engineers promoted', 'Delivery velocity', 'Hiring metrics (time-to-fill, acceptance rate)', 'Team satisfaction scores'],
    commonMistakes: [
      'Focusing only on technical achievements, not leadership',
      'Not quantifying team growth and retention',
      'Missing delivery and velocity metrics',
      'Not showing people development outcomes'
    ],
    interviewTopics: ['Leadership philosophy', 'Handling underperformance', 'Building team culture', 'Balancing tech debt vs features', 'Hiring and interviewing', 'Conflict resolution'],
    topResumeElements: {
      sections: ['Leadership Summary', 'Management Experience', 'Technical Background', 'Education', 'Certifications'],
      differentiators: ['Team growth and retention stats', 'Delivery track record', 'Hiring success metrics', 'Engineer promotion/development'],
      avgBulletCount: 5,
      certificationRate: 35,
      portfolioRate: 20,
      metricsRate: 88
    }
  },
  solutions_engineer: {
    name: 'Solutions Engineer',
    aliases: ['solutions architect', 'sales engineer', 'presales engineer', 'technical solutions engineer', 'customer engineer', 'implementation engineer', 'se', 'field engineer'],
    keySkills: ['Technical Demos', 'Customer Discovery', 'Solution Design', 'POC Development', 'Technical Presentations', 'API Integration', 'Stakeholder Management', 'Technical Writing'],
    mustHaveKeywords: ['solutions', 'customer', 'technical', 'demo', 'POC', 'implementation', 'sales', 'integration', 'requirements', 'enterprise'],
    resumeTips: [
      'Quantify deal sizes influenced and win rates',
      'Show POC success rates and implementation outcomes',
      'Highlight customer-facing presentation experience',
      'Include technical depth alongside sales metrics'
    ],
    bulletExamples: [
      { weak: 'Supported sales team with demos', strong: 'Delivered 150+ technical demos annually, directly influencing $25M in closed deals with 78% win rate on engaged opportunities' },
      { weak: 'Built POCs for customers', strong: 'Designed and delivered 40+ custom POCs for enterprise clients, achieving 85% conversion rate and reducing sales cycle by 30%' }
    ],
    keyMetrics: ['Deal value influenced', 'Win rate', 'POC success rate', 'Demos delivered', 'Customer satisfaction', 'Sales cycle reduction'],
    commonMistakes: [
      'Not quantifying revenue or deal influence',
      'Missing POC/demo success metrics',
      'Focusing only on technical skills, not sales impact',
      'Not showing customer relationship outcomes'
    ],
    interviewTopics: ['Technical discovery process', 'Handling objections', 'Complex demo scenarios', 'Working with sales teams', 'Customer success stories', 'Technical deep-dives'],
    topResumeElements: {
      sections: ['Summary', 'Solutions Experience', 'Technical Skills', 'Sales Impact', 'Education'],
      differentiators: ['Revenue influence metrics', 'POC success rates', 'Enterprise customer logos', 'Technical certifications'],
      avgBulletCount: 5,
      certificationRate: 60,
      portfolioRate: 35,
      metricsRate: 90
    }
  },
  ux_designer: {
    name: 'UX Designer',
    aliases: ['user experience designer', 'ux researcher', 'product designer', 'experience designer', 'interaction designer', 'ux/ui designer', 'senior ux designer', 'lead ux designer', 'ux design lead'],
    keySkills: ['User Research', 'Wireframing', 'Prototyping', 'Usability Testing', 'Information Architecture', 'Journey Mapping', 'Design Thinking', 'Figma/Sketch', 'Accessibility'],
    mustHaveKeywords: ['user research', 'usability', 'wireframes', 'prototypes', 'user testing', 'personas', 'journey map', 'information architecture', 'accessibility', 'design thinking'],
    resumeTips: [
      'Show user research impact on design decisions',
      'Quantify usability improvements (task completion, error reduction)',
      'Include portfolio link with case studies',
      'Highlight accessibility compliance achievements'
    ],
    bulletExamples: [
      { weak: 'Conducted user research', strong: 'Led user research program with 200+ interviews, uncovering insights that drove 45% improvement in task completion rate' },
      { weak: 'Created wireframes and prototypes', strong: 'Designed end-to-end checkout flow reducing cart abandonment by 35% and increasing mobile conversion by 28%' }
    ],
    keyMetrics: ['Task completion rate', 'User satisfaction (SUS/NPS)', 'Error rate reduction', 'Conversion improvement', 'Time-on-task reduction', 'Accessibility score'],
    commonMistakes: [
      'Not linking to portfolio with case studies',
      'Missing quantified usability improvements',
      'Focusing on deliverables instead of outcomes',
      'Not showing research-to-design connection'
    ],
    interviewTopics: ['Design process', 'User research methods', 'Usability testing', 'Stakeholder collaboration', 'Design critique', 'Accessibility best practices'],
    topResumeElements: {
      sections: ['Portfolio Link', 'UX Experience', 'Research Methods', 'Tools', 'Education'],
      differentiators: ['Strong case study portfolio', 'Quantified usability wins', 'Research methodology expertise', 'Accessibility certifications'],
      avgBulletCount: 4,
      certificationRate: 35,
      portfolioRate: 98,
      metricsRate: 75
    }
  },
  ui_designer: {
    name: 'UI Designer',
    aliases: ['visual designer', 'interface designer', 'graphic designer', 'web designer', 'digital designer', 'ui/ux designer', 'senior ui designer', 'brand designer', 'design systems designer'],
    keySkills: ['Visual Design', 'Design Systems', 'Typography', 'Color Theory', 'Figma/Sketch', 'Responsive Design', 'Motion Design', 'Brand Identity', 'Component Libraries'],
    mustHaveKeywords: ['visual design', 'design system', 'UI', 'interface', 'components', 'responsive', 'typography', 'Figma', 'brand', 'style guide'],
    resumeTips: [
      'Include portfolio link showcasing visual work',
      'Highlight design system contributions',
      'Show cross-platform design experience (web, mobile, tablet)',
      'Quantify design efficiency improvements'
    ],
    bulletExamples: [
      { weak: 'Designed UI for mobile app', strong: 'Created award-winning mobile UI adopted by 2M+ users, achieving 4.8★ App Store rating with specific praise for visual design' },
      { weak: 'Built design system components', strong: 'Architected design system with 150+ components used across 8 product teams, reducing design-to-dev handoff time by 60%' }
    ],
    keyMetrics: ['Design system adoption', 'Component reuse rate', 'Design-to-dev efficiency', 'User ratings/feedback', 'Brand consistency score', 'Cross-platform coverage'],
    commonMistakes: [
      'Not including portfolio link',
      'Missing design system experience',
      'Focusing only on aesthetics without outcomes',
      'Not showing collaboration with developers'
    ],
    interviewTopics: ['Visual design principles', 'Design system architecture', 'Developer handoff', 'Brand consistency', 'Responsive design', 'Animation and motion'],
    topResumeElements: {
      sections: ['Portfolio Link', 'Design Experience', 'Design Systems', 'Tools', 'Education'],
      differentiators: ['Award-winning designs', 'Design system leadership', 'Cross-platform expertise', 'Motion design skills'],
      avgBulletCount: 4,
      certificationRate: 25,
      portfolioRate: 99,
      metricsRate: 70
    }
  },
  product_designer: {
    name: 'Product Designer',
    aliases: ['senior product designer', 'lead product designer', 'staff product designer', 'principal designer', 'design lead', 'end-to-end designer', 'full stack designer', 'digital product designer'],
    keySkills: ['End-to-End Design', 'User Research', 'Visual Design', 'Prototyping', 'Design Systems', 'Usability Testing', 'Figma', 'Cross-Functional Collaboration', 'Design Strategy'],
    mustHaveKeywords: ['product design', 'end-to-end', 'user research', 'visual design', 'prototype', 'design system', 'user experience', 'interface', 'collaboration', 'strategy'],
    resumeTips: [
      'Show end-to-end ownership from research to final UI',
      'Quantify both usability AND business metrics',
      'Include portfolio with comprehensive case studies',
      'Highlight strategic design thinking and product impact'
    ],
    bulletExamples: [
      { weak: 'Designed product features', strong: 'Owned end-to-end design for subscription flow: conducted 30+ user interviews, designed UI, and delivered 50% increase in conversion and 4.7★ user ratings' },
      { weak: 'Created design system', strong: 'Built and scaled design system across 6 products, reducing design debt by 70% and accelerating feature delivery by 3x' }
    ],
    keyMetrics: ['Conversion/engagement improvement', 'User satisfaction (NPS/SUS)', 'Design system adoption', 'Feature adoption rate', 'Task success rate', 'Time-to-market reduction'],
    commonMistakes: [
      'Not showing full design process (research to UI)',
      'Missing portfolio with case studies',
      'Separating UX and UI instead of showing integration',
      'Not quantifying business and user impact together'
    ],
    interviewTopics: ['End-to-end design process', 'Portfolio deep-dive', 'Research methods', 'Visual design decisions', 'Design systems', 'Stakeholder collaboration', 'Design strategy'],
    topResumeElements: {
      sections: ['Portfolio Link', 'Product Design Experience', 'Impact Metrics', 'Skills & Tools', 'Education'],
      differentiators: ['End-to-end case studies', 'Combined UX+UI metrics', 'Design system leadership', 'Strategic product thinking'],
      avgBulletCount: 4,
      certificationRate: 30,
      portfolioRate: 99,
      metricsRate: 82
    }
  },
  game_developer: {
    name: 'Game Developer',
    aliases: ['game programmer', 'game engineer', 'unity developer', 'unreal developer', 'gameplay programmer', 'graphics programmer', 'engine programmer', 'game designer', 'technical game designer'],
    keySkills: ['Unity/Unreal Engine', 'C++/C#', 'Graphics Programming', 'Physics Systems', 'AI/Pathfinding', 'Shader Programming', 'Performance Optimization', 'Multiplayer/Networking'],
    mustHaveKeywords: ['game', 'Unity', 'Unreal', 'gameplay', 'graphics', 'engine', 'performance', 'optimization', 'shader', 'multiplayer'],
    resumeTips: [
      'Include shipped titles and platforms',
      'Show performance optimization achievements (FPS, load times)',
      'Highlight player engagement or download metrics',
      'Link to playable demos or portfolio'
    ],
    bulletExamples: [
      { weak: 'Developed game features', strong: 'Led gameplay systems development for AAA title with 5M+ downloads, achieving 60 FPS on target hardware through custom LOD and culling systems' },
      { weak: 'Worked on Unity projects', strong: 'Built procedural generation system creating 10K+ unique levels, increasing player retention by 40% and session length by 25%' }
    ],
    keyMetrics: ['Downloads/sales', 'Player retention', 'FPS/performance targets', 'Load time reduction', 'Memory optimization', 'Metacritic/review scores'],
    commonMistakes: [
      'Not listing shipped titles and platforms',
      'Missing performance optimization metrics',
      'Vague "worked on game" without specific systems',
      'Not including portfolio or playable demos'
    ],
    interviewTopics: ['Game engine architecture', 'Performance optimization', 'Graphics pipeline', 'Multiplayer networking', 'Gameplay systems design', 'Platform-specific challenges'],
    topResumeElements: {
      sections: ['Shipped Titles', 'Technical Skills', 'Experience', 'Portfolio/Demos', 'Education'],
      differentiators: ['AAA or successful indie titles', 'Performance optimization wins', 'Specialized systems (AI, graphics, networking)', 'Playable portfolio'],
      avgBulletCount: 4,
      certificationRate: 20,
      portfolioRate: 92,
      metricsRate: 75
    }
  },
  embedded_systems_engineer: {
    name: 'Embedded Systems Engineer',
    aliases: ['embedded software engineer', 'firmware engineer', 'embedded developer', 'hardware engineer', 'iot engineer', 'embedded linux engineer', 'rtos developer', 'microcontroller programmer'],
    keySkills: ['C/C++', 'RTOS', 'Microcontrollers (ARM, AVR)', 'Hardware Interfaces (SPI, I2C, UART)', 'Debugging (JTAG, oscilloscope)', 'Linux Kernel', 'Power Management', 'Embedded Linux'],
    mustHaveKeywords: ['embedded', 'firmware', 'microcontroller', 'RTOS', 'hardware', 'driver', 'low-level', 'power', 'real-time', 'IoT'],
    resumeTips: [
      'Specify microcontrollers and processors worked with',
      'Quantify power consumption and performance improvements',
      'Highlight real-time constraints met',
      'Include hardware/software integration experience'
    ],
    bulletExamples: [
      { weak: 'Developed embedded firmware', strong: 'Designed firmware for IoT sensor platform processing 10K samples/second with 50% power reduction, extending battery life from 6 to 18 months' },
      { weak: 'Worked on microcontroller projects', strong: 'Built RTOS-based motor control system achieving 10μs response time and 99.99% uptime across 50K deployed units' }
    ],
    keyMetrics: ['Power consumption reduction', 'Response time/latency', 'Units deployed', 'Uptime/reliability', 'Memory/flash optimization', 'Real-time deadlines met'],
    commonMistakes: [
      'Not specifying MCU/processor families',
      'Missing power and performance metrics',
      'Vague "embedded development" without constraints',
      'Not showing hardware debugging experience'
    ],
    interviewTopics: ['Memory management', 'RTOS concepts', 'Hardware debugging', 'Power optimization', 'Communication protocols', 'Real-time constraints'],
    topResumeElements: {
      sections: ['Technical Skills', 'Embedded Experience', 'Hardware Platforms', 'Projects', 'Education'],
      differentiators: ['Specific MCU/processor expertise', 'Power optimization achievements', 'Production deployment scale', 'Safety-critical experience'],
      avgBulletCount: 4,
      certificationRate: 35,
      portfolioRate: 45,
      metricsRate: 85
    }
  },
  systems_administrator: {
    name: 'Systems Administrator',
    aliases: ['sysadmin', 'system administrator', 'linux administrator', 'windows administrator', 'it administrator', 'server administrator', 'infrastructure administrator', 'senior sysadmin'],
    keySkills: ['Linux/Windows Server', 'Active Directory', 'Virtualization (VMware, Hyper-V)', 'Scripting (Bash, PowerShell)', 'Backup & Recovery', 'Monitoring', 'Security Hardening', 'Cloud Administration'],
    mustHaveKeywords: ['server', 'Linux', 'Windows', 'administration', 'uptime', 'backup', 'security', 'monitoring', 'virtualization', 'Active Directory'],
    resumeTips: [
      'Quantify infrastructure scale (servers, users supported)',
      'Show uptime and reliability achievements',
      'Highlight automation and efficiency improvements',
      'Include security and compliance experience'
    ],
    bulletExamples: [
      { weak: 'Managed Linux servers', strong: 'Administered 200+ Linux/Windows servers supporting 5K users, achieving 99.99% uptime and reducing incident response time by 60%' },
      { weak: 'Handled backups and security', strong: 'Implemented automated backup system with 100% recovery success rate, reducing RTO from 8 hours to 30 minutes' }
    ],
    keyMetrics: ['Servers/users supported', 'Uptime %', 'Incident response time', 'Recovery time (RTO/RPO)', 'Automation coverage', 'Ticket resolution time'],
    commonMistakes: [
      'Not quantifying infrastructure scale',
      'Missing uptime and reliability metrics',
      'Vague "managed servers" without outcomes',
      'Not showing automation achievements'
    ],
    interviewTopics: ['Troubleshooting scenarios', 'Disaster recovery', 'Security hardening', 'Automation strategies', 'Monitoring and alerting', 'Capacity planning'],
    topResumeElements: {
      sections: ['Technical Skills', 'Infrastructure Experience', 'Certifications', 'Projects', 'Education'],
      differentiators: ['Large-scale infrastructure experience', 'High uptime achievements', 'Automation expertise', 'Security certifications (CISSP, CompTIA)'],
      avgBulletCount: 4,
      certificationRate: 75,
      portfolioRate: 20,
      metricsRate: 85
    }
  },
  network_engineer: {
    name: 'Network Engineer',
    aliases: ['network administrator', 'network architect', 'senior network engineer', 'network specialist', 'infrastructure engineer', 'cisco engineer', 'wan engineer', 'network security engineer'],
    keySkills: ['Cisco/Juniper', 'Routing & Switching', 'Firewalls', 'VPN', 'Network Security', 'SD-WAN', 'Load Balancing', 'Network Monitoring', 'Wireless (WiFi 6)'],
    mustHaveKeywords: ['network', 'routing', 'switching', 'Cisco', 'firewall', 'VPN', 'bandwidth', 'latency', 'security', 'infrastructure'],
    resumeTips: [
      'Include network certifications prominently (CCNA, CCNP)',
      'Quantify network scale (devices, bandwidth, sites)',
      'Show uptime and performance improvements',
      'Highlight security implementations'
    ],
    bulletExamples: [
      { weak: 'Managed network infrastructure', strong: 'Designed and maintained enterprise network spanning 50 sites and 10K+ devices, achieving 99.99% uptime and reducing latency by 40%' },
      { weak: 'Implemented network security', strong: 'Deployed zero-trust network architecture across 5K endpoints, blocking 99.9% of threats and reducing security incidents by 75%' }
    ],
    keyMetrics: ['Network uptime %', 'Devices/sites managed', 'Bandwidth capacity', 'Latency reduction', 'Incident reduction', 'Security threat prevention'],
    commonMistakes: [
      'Not listing network certifications',
      'Missing scale of network managed',
      'Vague "maintained network" without metrics',
      'Not showing security implementation experience'
    ],
    interviewTopics: ['Network troubleshooting', 'Routing protocols', 'Network security', 'Capacity planning', 'Disaster recovery', 'Cloud networking'],
    topResumeElements: {
      sections: ['Certifications', 'Technical Skills', 'Network Experience', 'Projects', 'Education'],
      differentiators: ['CCNP/CCIE certifications', 'Enterprise-scale experience', 'Security implementations', 'Cloud networking expertise'],
      avgBulletCount: 4,
      certificationRate: 85,
      portfolioRate: 15,
      metricsRate: 82
    }
  },
  developer_advocate: {
    name: 'Developer Advocate',
    aliases: ['developer relations', 'devrel', 'developer evangelist', 'technical evangelist', 'community manager', 'developer experience', 'dx advocate', 'api evangelist'],
    keySkills: ['Technical Content Creation', 'Public Speaking', 'Community Building', 'Documentation', 'Open Source', 'Social Media', 'Tutorial Development', 'Developer Experience'],
    mustHaveKeywords: ['developer', 'community', 'content', 'advocacy', 'documentation', 'tutorials', 'speaking', 'open source', 'engagement', 'education'],
    resumeTips: [
      'Quantify community growth and engagement metrics',
      'Show content reach (views, reads, shares)',
      'Highlight speaking engagements and audience sizes',
      'Include developer adoption or product usage impact'
    ],
    bulletExamples: [
      { weak: 'Created developer content', strong: 'Produced 100+ technical tutorials and videos reaching 2M+ developers, driving 40% increase in API adoption' },
      { weak: 'Spoke at conferences', strong: 'Delivered 25+ conference talks and workshops to 10K+ developers, generating 500+ qualified leads and 15% increase in signups' }
    ],
    keyMetrics: ['Content reach (views/reads)', 'Community growth', 'Conference talks delivered', 'Developer adoption increase', 'Engagement rates', 'Lead generation'],
    commonMistakes: [
      'Not quantifying content reach and impact',
      'Missing community growth metrics',
      'Focusing only on content creation, not business outcomes',
      'Not showing developer adoption influence'
    ],
    interviewTopics: ['Content strategy', 'Community building', 'Measuring DevRel success', 'Developer feedback loops', 'Balancing advocacy and product', 'Public speaking experience'],
    topResumeElements: {
      sections: ['Summary', 'DevRel Experience', 'Content & Speaking', 'Technical Skills', 'Community Impact'],
      differentiators: ['Content reach metrics', 'Speaking portfolio', 'Community growth achievements', 'Open source contributions'],
      avgBulletCount: 5,
      certificationRate: 25,
      portfolioRate: 95,
      metricsRate: 80
    }
  },
  data_engineer: {
    name: 'Data Engineer',
    aliases: ['etl developer', 'data pipeline engineer', 'analytics engineer', 'big data engineer', 'data platform engineer', 'data infrastructure engineer', 'spark engineer'],
    keySkills: ['SQL', 'Python', 'Spark/Databricks', 'Airflow', 'Data Warehousing', 'ETL/ELT', 'Kafka', 'dbt', 'Cloud Data Platforms'],
    mustHaveKeywords: ['data pipeline', 'ETL', 'data warehouse', 'SQL', 'Spark', 'Airflow', 'data modeling', 'batch', 'streaming', 'data quality'],
    resumeTips: [
      'Quantify data volume processed (TB/PB, events/day)',
      'Show pipeline reliability and latency improvements',
      'Highlight cost optimization for data infrastructure',
      'Include data quality improvements and SLAs met'
    ],
    bulletExamples: [
      { weak: 'Built data pipelines', strong: 'Designed real-time data pipeline processing 5M+ events/day with 99.9% uptime and <5 minute latency SLA' },
      { weak: 'Managed data warehouse', strong: 'Migrated legacy ETL to dbt + Snowflake, reducing query times by 80% and data freshness from 24 hours to 15 minutes' }
    ],
    keyMetrics: ['Data volume (TB/PB)', 'Events processed/day', 'Pipeline uptime', 'Latency SLA', 'Cost reduction', 'Query performance improvement'],
    commonMistakes: [
      'Not quantifying data volumes and throughput',
      'Missing pipeline reliability metrics',
      'Vague "worked with big data" claims',
      'Not showing cost optimization achievements'
    ],
    interviewTopics: ['Data modeling', 'Pipeline architecture', 'Batch vs streaming', 'Data quality', 'Schema design', 'Performance optimization'],
    topResumeElements: {
      sections: ['Technical Skills', 'Data Projects', 'Experience', 'Certifications', 'Education'],
      differentiators: ['PB-scale data experience', 'Real-time pipeline achievements', 'Cost optimization wins', 'Data quality improvements'],
      avgBulletCount: 4,
      certificationRate: 55,
      portfolioRate: 35,
      metricsRate: 88
    }
  },
  security_engineer: {
    name: 'Security Engineer',
    aliases: ['cybersecurity engineer', 'infosec engineer', 'application security', 'appsec', 'security analyst', 'penetration tester', 'security architect', 'devsecops'],
    keySkills: ['Vulnerability Assessment', 'Penetration Testing', 'SIEM', 'Incident Response', 'Secure Code Review', 'Threat Modeling', 'Compliance (SOC2, ISO)', 'Cloud Security'],
    mustHaveKeywords: ['security', 'vulnerability', 'penetration', 'compliance', 'threat', 'incident', 'SIEM', 'encryption', 'authentication'],
    resumeTips: [
      'Quantify vulnerabilities found and remediated',
      'Show compliance achievements (SOC2, PCI, HIPAA)',
      'Highlight incident response experience',
      'Include security certifications prominently'
    ],
    bulletExamples: [
      { weak: 'Performed security assessments', strong: 'Identified and remediated 150+ vulnerabilities across 20 applications, achieving zero critical findings in SOC2 audit' },
      { weak: 'Managed security incidents', strong: 'Led incident response team handling 50+ security events, reducing mean time to containment from 4 hours to 30 minutes' }
    ],
    keyMetrics: ['Vulnerabilities found/fixed', 'Time to remediation', 'Compliance audit results', 'Incident response time', 'False positive reduction'],
    commonMistakes: [
      'Not quantifying security improvements',
      'Missing specific tools and methodologies used',
      'Vague "improved security" claims',
      'Not highlighting compliance and audit experience'
    ],
    interviewTopics: ['Threat modeling', 'Common vulnerabilities (OWASP)', 'Incident response', 'Security architecture', 'Compliance frameworks'],
    topResumeElements: {
      sections: ['Certifications', 'Technical Skills', 'Experience', 'Security Projects', 'Education'],
      differentiators: ['CISSP/CEH/OSCP certifications', 'Bug bounty achievements', 'Compliance audit leadership', 'Incident response metrics'],
      avgBulletCount: 4,
      certificationRate: 85,
      portfolioRate: 25,
      metricsRate: 78
    }
  },
  qa_engineer: {
    name: 'QA Engineer',
    aliases: ['quality assurance', 'test engineer', 'sdet', 'automation engineer', 'qa analyst', 'quality engineer', 'test automation engineer', 'software tester'],
    keySkills: ['Test Automation', 'Selenium/Cypress', 'API Testing', 'Performance Testing', 'Test Planning', 'CI/CD Integration', 'Bug Tracking', 'Manual Testing'],
    mustHaveKeywords: ['testing', 'automation', 'quality', 'bugs', 'test cases', 'regression', 'CI/CD', 'Selenium', 'coverage'],
    resumeTips: [
      'Quantify test coverage and automation rates',
      'Show bug detection improvements',
      'Highlight CI/CD integration experience',
      'Include specific testing frameworks and tools'
    ],
    bulletExamples: [
      { weak: 'Wrote automated tests', strong: 'Built test automation framework achieving 85% code coverage, reducing regression testing time from 2 days to 4 hours' },
      { weak: 'Found and reported bugs', strong: 'Identified 200+ critical bugs pre-release, reducing production incidents by 60% and customer-reported issues by 45%' }
    ],
    keyMetrics: ['Test coverage %', 'Automation rate', 'Bugs found pre-release', 'Regression time reduction', 'Production incident reduction'],
    commonMistakes: [
      'Not quantifying test coverage improvements',
      'Missing automation framework experience',
      'Vague "tested features" without metrics',
      'Not showing CI/CD integration experience'
    ],
    interviewTopics: ['Test strategy design', 'Automation frameworks', 'API testing', 'Performance testing', 'Bug prioritization'],
    topResumeElements: {
      sections: ['Technical Skills', 'Experience', 'Certifications', 'Tools & Frameworks', 'Education'],
      differentiators: ['High automation coverage achievements', 'Custom framework development', 'Performance testing expertise', 'Shift-left testing initiatives'],
      avgBulletCount: 4,
      certificationRate: 50,
      portfolioRate: 40,
      metricsRate: 82
    }
  },
  data_scientist: {
    name: 'Data Scientist',
    aliases: ['data analyst', 'ml engineer', 'machine learning engineer', 'ai engineer', 'research scientist', 'applied scientist', 'analytics engineer'],
    keySkills: ['Machine Learning', 'Statistical Analysis', 'Python/R', 'SQL', 'Data Visualization', 'A/B Testing', 'Deep Learning', 'Feature Engineering'],
    mustHaveKeywords: ['model', 'analysis', 'prediction', 'accuracy', 'dataset', 'algorithm', 'insights', 'experimentation'],
    resumeTips: [
      'Quantify model performance: accuracy, AUC, lift',
      'Show business impact of your analyses',
      'Include specific tools and frameworks',
      'Mention scale of data worked with'
    ],
    bulletExamples: [
      { weak: 'Built machine learning models', strong: 'Developed churn prediction model (AUC 0.92) reducing customer attrition by 25%, saving $3M annually' },
      { weak: 'Analyzed data for insights', strong: 'Designed A/B testing framework adopted across 50+ experiments, increasing conversion by 18%' }
    ],
    keyMetrics: ['Model accuracy/AUC', 'Revenue impact', 'Cost savings', 'Experiments run', 'Data volume processed'],
    commonMistakes: [
      'Not showing business impact of models',
      'Missing model performance metrics',
      'Vague "analyzed data" without specifics',
      'Not mentioning scale of datasets'
    ],
    interviewTopics: ['ML algorithms', 'Statistics', 'SQL queries', 'A/B testing', 'Case studies', 'Coding in Python/R'],
    topResumeElements: {
      sections: ['Technical Skills', 'Experience', 'Projects', 'Publications', 'Education'],
      differentiators: ['Kaggle/competition rankings', 'Published research', 'Production ML systems', 'Business impact quantification'],
      avgBulletCount: 4,
      certificationRate: 40,
      portfolioRate: 65,
      metricsRate: 88
    }
  },
  nurse: {
    name: 'Registered Nurse',
    aliases: ['rn', 'lpn', 'nurse practitioner', 'np', 'clinical nurse', 'staff nurse', 'charge nurse', 'nurse manager', 'bsn', 'msn'],
    keySkills: ['Patient Assessment', 'Medication Administration', 'Care Planning', 'EHR Documentation', 'Patient Education', 'Emergency Response', 'Team Coordination'],
    mustHaveKeywords: ['patient care', 'assessment', 'HIPAA', 'documentation', 'clinical', 'safety', 'medication', 'outcomes'],
    resumeTips: [
      'Include license numbers and certifications prominently',
      'Quantify patient load and outcomes',
      'Highlight specialized training and unit experience',
      'Show patient satisfaction metrics if available'
    ],
    bulletExamples: [
      { weak: 'Provided patient care in ICU', strong: 'Managed complex care for 4-6 ICU patients per shift, maintaining 98% medication administration accuracy' },
      { weak: 'Trained new nurses', strong: 'Precepted 12 new graduate nurses, with 100% passing NCLEX on first attempt' }
    ],
    keyMetrics: ['Patients per shift', 'Satisfaction scores', 'Medication accuracy', 'Readmission rates', 'Certifications held'],
    commonMistakes: [
      'Not listing license numbers and expirations',
      'Missing specific unit and patient population experience',
      'Vague care descriptions without outcomes',
      'Not mentioning EHR systems used'
    ],
    interviewTopics: ['Clinical scenarios', 'Patient prioritization', 'Conflict resolution', 'HIPAA compliance', 'Emergency protocols'],
    topResumeElements: {
      sections: ['Licenses & Certifications', 'Clinical Experience', 'Education', 'Skills', 'Continuing Education'],
      differentiators: ['Unit specializations', 'Patient outcome metrics', 'Leadership roles', 'Specialty certifications (CCRN, CEN)'],
      avgBulletCount: 4,
      certificationRate: 95,
      portfolioRate: 5,
      metricsRate: 75
    }
  },
  marketing_manager: {
    name: 'Marketing Manager',
    aliases: ['marketing director', 'brand manager', 'digital marketing manager', 'growth marketing', 'demand generation', 'content marketing manager', 'marketing lead'],
    keySkills: ['Campaign Management', 'Analytics', 'Brand Strategy', 'Content Marketing', 'SEO/SEM', 'Marketing Automation', 'Budget Management', 'Team Leadership'],
    mustHaveKeywords: ['campaign', 'ROI', 'brand', 'conversion', 'analytics', 'strategy', 'growth', 'engagement'],
    resumeTips: [
      'Show ROI and revenue attribution for campaigns',
      'Include specific tools and platforms managed',
      'Quantify audience growth and engagement',
      'Highlight budget responsibility'
    ],
    bulletExamples: [
      { weak: 'Managed marketing campaigns', strong: 'Launched integrated campaigns generating $5M pipeline with 4:1 ROI on $1.2M budget' },
      { weak: 'Grew social media presence', strong: 'Scaled Instagram from 10K to 250K followers, driving 35% increase in website traffic' }
    ],
    keyMetrics: ['ROAS/ROI', 'Pipeline generated', 'Conversion rates', 'CAC', 'Audience growth', 'Budget managed'],
    commonMistakes: [
      'Not showing ROI or revenue impact',
      'Missing specific campaign metrics',
      'Vague "increased brand awareness" claims',
      'Not mentioning tools and platforms used'
    ],
    interviewTopics: ['Campaign strategy', 'Analytics interpretation', 'Budget allocation', 'Cross-functional collaboration', 'Brand positioning'],
    topResumeElements: {
      sections: ['Professional Summary', 'Marketing Experience', 'Skills & Tools', 'Education', 'Certifications'],
      differentiators: ['Campaign portfolio links', 'Specific ROI/ROAS numbers', 'Budget managed', 'Before/after metrics'],
      avgBulletCount: 5,
      certificationRate: 60,
      portfolioRate: 55,
      metricsRate: 90
    }
  },
  sales_representative: {
    name: 'Sales Representative',
    aliases: ['account executive', 'sales manager', 'business development', 'bdr', 'sdr', 'account manager', 'sales director', 'regional sales manager'],
    keySkills: ['Prospecting', 'Negotiation', 'CRM Management', 'Pipeline Management', 'Closing', 'Relationship Building', 'Territory Management'],
    mustHaveKeywords: ['quota', 'revenue', 'pipeline', 'closed', 'exceeded', 'accounts', 'deals', 'retention'],
    resumeTips: [
      'Lead every bullet with numbers',
      'Show quota attainment percentages',
      'Include deal sizes and customer counts',
      'Highlight ranking among peers'
    ],
    bulletExamples: [
      { weak: 'Sold software to enterprise clients', strong: 'Closed $4.2M in new business at 135% of quota, ranking #1 of 30 AEs' },
      { weak: 'Managed customer accounts', strong: 'Grew book of business from $2M to $5M ARR, achieving 95% retention rate' }
    ],
    keyMetrics: ['Quota attainment %', 'Revenue closed', 'Average deal size', 'Win rate', 'Retention rate', 'Ranking vs peers'],
    commonMistakes: [
      'Not including specific revenue numbers',
      'Missing quota attainment percentages',
      'Vague "exceeded targets" without data',
      'Not showing competitive ranking'
    ],
    interviewTopics: ['Sales methodology', 'Objection handling', 'Pipeline management', 'Deal qualification', 'Negotiation tactics'],
    topResumeElements: {
      sections: ['Sales Summary', 'Sales Experience', 'Key Achievements', 'Skills', 'Education'],
      differentiators: ['Quota attainment %', 'Revenue numbers', 'Ranking vs peers', 'Presidents Club/awards'],
      avgBulletCount: 5,
      certificationRate: 30,
      portfolioRate: 10,
      metricsRate: 98
    }
  },
  project_manager: {
    name: 'Project Manager',
    aliases: ['program manager', 'technical project manager', 'tpm', 'senior project manager', 'delivery manager', 'scrum master', 'agile coach'],
    keySkills: ['Project Planning', 'Risk Management', 'Stakeholder Management', 'Agile/Scrum', 'Budget Management', 'Resource Allocation', 'Timeline Management'],
    mustHaveKeywords: ['delivered', 'on-time', 'budget', 'stakeholders', 'timeline', 'scope', 'risk', 'cross-functional'],
    resumeTips: [
      'Quantify project budgets and team sizes',
      'Show on-time/on-budget delivery rates',
      'Include specific methodologies used',
      'Highlight stakeholder management scope'
    ],
    bulletExamples: [
      { weak: 'Managed software development projects', strong: 'Delivered $8M ERP implementation 2 weeks early and 10% under budget across 5 business units' },
      { weak: 'Led cross-functional teams', strong: 'Managed portfolio of 12 concurrent projects with 25+ stakeholders, achieving 95% on-time delivery' }
    ],
    keyMetrics: ['Budget managed', 'On-time delivery %', 'Team size', 'Projects delivered', 'Cost savings achieved'],
    commonMistakes: [
      'Not quantifying project budgets',
      'Missing on-time/on-budget metrics',
      'Vague "managed projects" without scope',
      'Not showing stakeholder complexity'
    ],
    interviewTopics: ['Project methodology', 'Risk management', 'Conflict resolution', 'Stakeholder communication', 'Resource planning'],
    topResumeElements: {
      sections: ['Summary', 'Project Experience', 'Skills & Certifications', 'Education'],
      differentiators: ['PMP/Agile certifications', 'Budget size managed', 'On-time delivery rate', 'Team size led'],
      avgBulletCount: 5,
      certificationRate: 72,
      portfolioRate: 15,
      metricsRate: 88
    }
  },
  accountant: {
    name: 'Accountant',
    aliases: ['cpa', 'senior accountant', 'staff accountant', 'controller', 'financial accountant', 'tax accountant', 'audit associate', 'finance manager'],
    keySkills: ['Financial Reporting', 'GAAP', 'Tax Preparation', 'Auditing', 'Budgeting', 'Reconciliation', 'ERP Systems', 'Regulatory Compliance'],
    mustHaveKeywords: ['reconciliation', 'financial statements', 'audit', 'compliance', 'GAAP', 'tax', 'budget', 'reporting'],
    resumeTips: [
      'Include CPA license and certifications',
      'Quantify accounts/transactions managed',
      'Show audit findings and process improvements',
      'Mention specific ERP systems'
    ],
    bulletExamples: [
      { weak: 'Prepared financial statements', strong: 'Prepared monthly financial statements for $50M revenue company, reducing close time from 10 to 5 days' },
      { weak: 'Handled accounts payable', strong: 'Managed $20M AP portfolio, implementing automation that reduced processing time by 60%' }
    ],
    keyMetrics: ['Close time reduction', 'Transactions processed', 'Audit findings', 'Cost savings', 'Accounts managed'],
    commonMistakes: [
      'Not listing CPA or relevant certifications',
      'Missing volume and scale of work',
      'Vague "prepared reports" without impact',
      'Not mentioning specific software/ERP'
    ],
    interviewTopics: ['Technical accounting', 'GAAP knowledge', 'Audit procedures', 'ERP experience', 'Problem-solving scenarios'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Skills', 'Education', 'Certifications'],
      differentiators: ['CPA license', 'Big 4 experience', 'ERP system expertise', 'Process automation achievements'],
      avgBulletCount: 4,
      certificationRate: 85,
      portfolioRate: 5,
      metricsRate: 82
    }
  },
  teacher: {
    name: 'Teacher',
    aliases: ['educator', 'instructor', 'professor', 'lecturer', 'tutor', 'special education teacher', 'curriculum specialist', 'department head'],
    keySkills: ['Curriculum Development', 'Classroom Management', 'Differentiated Instruction', 'Assessment', 'Student Engagement', 'Parent Communication', 'EdTech Integration'],
    mustHaveKeywords: ['curriculum', 'assessment', 'students', 'instruction', 'classroom', 'learning outcomes', 'differentiation', 'engagement'],
    resumeTips: [
      'Include teaching certifications and endorsements',
      'Quantify student outcome improvements',
      'Show specific grade levels and subjects',
      'Highlight technology integration'
    ],
    bulletExamples: [
      { weak: 'Taught high school English', strong: 'Raised AP English pass rate from 65% to 88% for 120+ students through differentiated instruction' },
      { weak: 'Used technology in classroom', strong: 'Implemented blended learning program increasing student engagement by 40% measured by assignment completion' }
    ],
    keyMetrics: ['Test score improvement', 'Pass rates', 'Students taught', 'Attendance improvement', 'Parent satisfaction'],
    commonMistakes: [
      'Not including certification numbers',
      'Missing student outcome data',
      'Vague "taught students" without specifics',
      'Not showing measurable improvements'
    ],
    interviewTopics: ['Classroom scenarios', 'Differentiation strategies', 'Assessment methods', 'Parent communication', 'Classroom management'],
    topResumeElements: {
      sections: ['Certifications', 'Teaching Experience', 'Education', 'Professional Development', 'Skills'],
      differentiators: ['Student outcome improvements', 'Specific certifications/endorsements', 'Technology integration', 'Extracurricular leadership'],
      avgBulletCount: 4,
      certificationRate: 98,
      portfolioRate: 20,
      metricsRate: 65
    }
  },
  hr_manager: {
    name: 'HR Manager',
    aliases: ['human resources manager', 'people manager', 'hr director', 'head of hr', 'hr business partner', 'hrbp', 'people operations', 'talent manager', 'hr lead'],
    keySkills: ['Talent Acquisition', 'Employee Relations', 'Performance Management', 'HRIS', 'Compensation & Benefits', 'Compliance', 'Organizational Development', 'Change Management'],
    mustHaveKeywords: ['talent acquisition', 'employee relations', 'performance management', 'HRIS', 'compliance', 'onboarding', 'retention', 'workforce planning'],
    resumeTips: [
      'Quantify hiring metrics: hires, time-to-fill, cost-per-hire',
      'Show retention improvements and employee satisfaction scores',
      'List specific HRIS systems (Workday, SAP, BambooHR)',
      'Highlight DEI initiatives and measurable outcomes'
    ],
    bulletExamples: [
      { weak: 'Managed HR department', strong: 'Led HR team of 8 supporting 500+ employees, reducing turnover from 25% to 15% through improved onboarding and engagement programs' },
      { weak: 'Handled employee relations', strong: 'Resolved 50+ employee relations cases annually with 95% resolution rate, reducing escalations to legal by 60%' }
    ],
    keyMetrics: ['Turnover reduction %', 'Time-to-fill', 'Cost-per-hire', 'Employee satisfaction score', 'Retention rate', 'Training completion %'],
    commonMistakes: [
      'Not quantifying hiring and retention metrics',
      'Missing specific HRIS systems and tools',
      'Vague "improved culture" without measurable outcomes',
      'Not mentioning compliance certifications (SHRM, PHR)'
    ],
    interviewTopics: ['Conflict resolution scenarios', 'DEI initiatives', 'Change management', 'Employment law', 'Performance management systems'],
    topResumeElements: {
      sections: ['Summary', 'HR Experience', 'Certifications', 'Skills', 'Education'],
      differentiators: ['SHRM/PHR certification', 'Turnover reduction metrics', 'DEI program results', 'HRIS implementation experience'],
      avgBulletCount: 5,
      certificationRate: 70,
      portfolioRate: 5,
      metricsRate: 80
    }
  },
  financial_analyst: {
    name: 'Financial Analyst',
    aliases: ['finance analyst', 'fp&a analyst', 'senior financial analyst', 'investment analyst', 'budget analyst', 'business analyst finance', 'corporate finance analyst', 'financial planning analyst'],
    keySkills: ['Financial Modeling', 'Budgeting & Forecasting', 'Data Analysis', 'Excel/VBA', 'SQL', 'ERP Systems', 'Variance Analysis', 'Financial Reporting'],
    mustHaveKeywords: ['financial modeling', 'forecasting', 'variance analysis', 'budgeting', 'P&L', 'Excel', 'reporting', 'ROI'],
    resumeTips: [
      'Highlight advanced Excel skills (VBA, macros, pivot tables)',
      'Quantify budget sizes and forecast accuracy',
      'Show cost savings identified through analysis',
      'List specific ERP and BI tools (SAP, Oracle, Tableau)'
    ],
    bulletExamples: [
      { weak: 'Prepared financial reports', strong: 'Built 3-statement financial model for $50M division, improving forecast accuracy from 85% to 97%' },
      { weak: 'Analyzed budgets', strong: 'Identified $2.5M in cost savings through variance analysis across 12 departments, presented recommendations to C-suite' }
    ],
    keyMetrics: ['Forecast accuracy %', 'Budget managed', 'Cost savings identified', 'Reports delivered', 'Process improvement %'],
    commonMistakes: [
      'Not mentioning specific modeling skills (DCF, LBO, scenario analysis)',
      'Missing budget sizes or scale of analysis',
      'Vague "analyzed financials" without impact',
      'Not listing specific tools (Excel, SQL, Tableau)'
    ],
    interviewTopics: ['Financial modeling tests', 'Excel proficiency', 'Variance analysis scenarios', 'Business case development', 'Stakeholder communication'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Technical Skills', 'Education', 'Certifications'],
      differentiators: ['Advanced Excel/VBA skills', 'Specific modeling experience (DCF, LBO)', 'FP&A certifications', 'Forecast accuracy metrics'],
      avgBulletCount: 4,
      certificationRate: 50,
      portfolioRate: 10,
      metricsRate: 90
    }
  },
  customer_success: {
    name: 'Customer Success Manager',
    aliases: ['csm', 'customer success', 'client success manager', 'customer success specialist', 'account manager', 'client relationship manager', 'customer experience manager', 'cs manager'],
    keySkills: ['Account Management', 'Relationship Building', 'Churn Prevention', 'Upselling', 'Product Adoption', 'Customer Onboarding', 'Data Analysis', 'CRM'],
    mustHaveKeywords: ['retention', 'churn', 'NPS', 'upsell', 'onboarding', 'adoption', 'customer health', 'expansion revenue'],
    resumeTips: [
      'Quantify retention rates and churn reduction',
      'Show expansion/upsell revenue generated',
      'Highlight portfolio size (ARR, number of accounts)',
      'Include NPS or CSAT improvements'
    ],
    bulletExamples: [
      { weak: 'Managed customer accounts', strong: 'Managed $5M ARR portfolio of 50+ enterprise accounts, achieving 95% retention and 120% net revenue retention' },
      { weak: 'Helped customers succeed', strong: 'Reduced churn by 30% through proactive health score monitoring and quarterly business reviews with key stakeholders' }
    ],
    keyMetrics: ['Retention rate %', 'Net revenue retention', 'Churn reduction %', 'NPS improvement', 'Upsell revenue', 'Accounts managed'],
    commonMistakes: [
      'Not including retention or churn metrics',
      'Missing ARR/revenue managed',
      'Vague "built relationships" without outcomes',
      'Not showing impact on expansion revenue'
    ],
    interviewTopics: ['Churn prevention strategies', 'Difficult customer scenarios', 'Upselling techniques', 'QBR preparation', 'Cross-functional collaboration'],
    topResumeElements: {
      sections: ['Summary', 'Customer Success Experience', 'Key Achievements', 'Skills', 'Education'],
      differentiators: ['Net revenue retention metrics', 'Churn reduction achievements', 'ARR portfolio size', 'Customer health scoring experience'],
      avgBulletCount: 5,
      certificationRate: 35,
      portfolioRate: 10,
      metricsRate: 92
    }
  },
  operations_manager: {
    name: 'Operations Manager',
    aliases: ['ops manager', 'director of operations', 'operations director', 'business operations manager', 'general manager', 'plant manager', 'facility manager', 'supply chain manager'],
    keySkills: ['Process Optimization', 'Team Leadership', 'Budget Management', 'Supply Chain', 'Lean/Six Sigma', 'Vendor Management', 'KPI Tracking', 'Strategic Planning'],
    mustHaveKeywords: ['process improvement', 'efficiency', 'cost reduction', 'team management', 'KPIs', 'operations', 'lean', 'supply chain'],
    resumeTips: [
      'Quantify efficiency improvements and cost savings',
      'Show team sizes managed and budget responsibility',
      'Highlight process improvements with measurable outcomes',
      'Include Lean/Six Sigma certifications if applicable'
    ],
    bulletExamples: [
      { weak: 'Managed operations team', strong: 'Led operations team of 25 across 3 locations, reducing operational costs by 18% while improving on-time delivery from 88% to 97%' },
      { weak: 'Improved processes', strong: 'Implemented Lean methodology reducing production cycle time by 35% and eliminating $500K in annual waste' }
    ],
    keyMetrics: ['Cost reduction %', 'Efficiency improvement %', 'Team size', 'Budget managed', 'On-time delivery %', 'Throughput increase'],
    commonMistakes: [
      'Not quantifying cost savings or efficiency gains',
      'Missing team size and budget scope',
      'Vague "improved operations" without metrics',
      'Not mentioning specific methodologies (Lean, Six Sigma, Kaizen)'
    ],
    interviewTopics: ['Process improvement examples', 'Team management challenges', 'Budget optimization', 'Crisis management', 'Cross-departmental coordination'],
    topResumeElements: {
      sections: ['Summary', 'Operations Experience', 'Key Achievements', 'Skills', 'Certifications'],
      differentiators: ['Lean/Six Sigma certification', 'P&L responsibility', 'Cost savings achievements', 'Team size managed'],
      avgBulletCount: 5,
      certificationRate: 55,
      portfolioRate: 5,
      metricsRate: 88
    }
  },
  executive_assistant: {
    name: 'Executive Assistant',
    aliases: ['ea', 'executive admin', 'executive secretary', 'senior executive assistant', 'c-suite assistant', 'administrative assistant', 'chief of staff', 'office manager'],
    keySkills: ['Calendar Management', 'Travel Coordination', 'Meeting Planning', 'Communication', 'Confidentiality', 'Project Coordination', 'Microsoft Office', 'Stakeholder Management'],
    mustHaveKeywords: ['calendar management', 'travel coordination', 'executive support', 'communication', 'scheduling', 'confidential', 'meetings', 'stakeholders'],
    resumeTips: [
      'Highlight executive-level support experience (C-suite, VP, Director)',
      'Quantify meetings coordinated, travel arranged, budgets managed',
      'Show discretion and confidentiality handling',
      'List specific tools (Outlook, Concur, Zoom, Slack)'
    ],
    bulletExamples: [
      { weak: 'Managed executive calendars', strong: 'Managed complex calendars for 3 C-suite executives, coordinating 50+ meetings weekly across 5 time zones' },
      { weak: 'Arranged travel', strong: 'Coordinated $200K+ annual travel budget for 10-person leadership team, reducing costs by 15% through vendor negotiations' }
    ],
    keyMetrics: ['Executives supported', 'Meetings coordinated weekly', 'Travel budget managed', 'Cost savings', 'Events organized'],
    commonMistakes: [
      'Not specifying executive level supported',
      'Missing volume metrics (meetings, travel, events)',
      'Vague "administrative support" without specifics',
      'Not mentioning tools and software proficiency'
    ],
    interviewTopics: ['Prioritization scenarios', 'Confidentiality handling', 'Difficult scheduling situations', 'Stakeholder management', 'Crisis management'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Skills', 'Education'],
      differentiators: ['C-suite support experience', 'Complex calendar management', 'Travel/budget management', 'Event coordination'],
      avgBulletCount: 4,
      certificationRate: 20,
      portfolioRate: 5,
      metricsRate: 70
    }
  },
  business_analyst: {
    name: 'Business Analyst',
    aliases: ['ba', 'senior business analyst', 'it business analyst', 'systems analyst', 'requirements analyst', 'process analyst', 'product analyst', 'data analyst'],
    keySkills: ['Requirements Gathering', 'Process Mapping', 'Stakeholder Management', 'SQL', 'Data Analysis', 'Agile/Scrum', 'JIRA', 'User Stories'],
    mustHaveKeywords: ['requirements', 'stakeholders', 'process improvement', 'analysis', 'documentation', 'agile', 'user stories', 'data'],
    resumeTips: [
      'Quantify project scope and business impact',
      'Show requirements-to-delivery success metrics',
      'Highlight cross-functional collaboration',
      'List specific methodologies and tools (Agile, JIRA, Confluence)'
    ],
    bulletExamples: [
      { weak: 'Gathered requirements for projects', strong: 'Gathered and documented 200+ requirements for $5M ERP implementation, achieving 95% stakeholder approval on first review' },
      { weak: 'Created process documentation', strong: 'Mapped 15 end-to-end business processes, identifying automation opportunities that saved 2,000+ hours annually' }
    ],
    keyMetrics: ['Requirements delivered', 'Project value', 'Process improvements', 'Stakeholder satisfaction', 'Time/cost savings'],
    commonMistakes: [
      'Not quantifying project scope or business value',
      'Missing specific tools and methodologies',
      'Vague "analyzed processes" without outcomes',
      'Not showing stakeholder management skills'
    ],
    interviewTopics: ['Requirements gathering techniques', 'Stakeholder conflict resolution', 'Process mapping examples', 'Agile ceremonies', 'Documentation best practices'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Skills', 'Certifications', 'Education'],
      differentiators: ['CBAP/CCBA certification', 'Large project experience', 'Agile/Scrum expertise', 'SQL/data analysis skills'],
      avgBulletCount: 4,
      certificationRate: 45,
      portfolioRate: 15,
      metricsRate: 75
    }
  },
  recruiter: {
    name: 'Recruiter',
    aliases: ['talent acquisition', 'technical recruiter', 'corporate recruiter', 'sourcer', 'recruiting coordinator', 'talent partner', 'headhunter', 'staffing specialist'],
    keySkills: ['Sourcing', 'Candidate Assessment', 'ATS', 'Interviewing', 'Offer Negotiation', 'Employer Branding', 'LinkedIn Recruiter', 'Relationship Building'],
    mustHaveKeywords: ['sourcing', 'talent acquisition', 'candidates', 'hiring', 'interviews', 'ATS', 'pipeline', 'offer'],
    resumeTips: [
      'Quantify hires made and time-to-fill metrics',
      'Show offer acceptance rates and quality of hire',
      'List specific ATS and sourcing tools',
      'Highlight diversity hiring initiatives'
    ],
    bulletExamples: [
      { weak: 'Recruited for engineering roles', strong: 'Filled 45+ engineering roles annually with 28-day average time-to-fill and 92% offer acceptance rate' },
      { weak: 'Sourced candidates on LinkedIn', strong: 'Built pipeline of 500+ qualified candidates through LinkedIn sourcing, reducing agency spend by $200K' }
    ],
    keyMetrics: ['Hires per year', 'Time-to-fill', 'Offer acceptance rate', 'Cost-per-hire', 'Quality of hire', 'Diversity hiring %'],
    commonMistakes: [
      'Not quantifying hiring metrics',
      'Missing specific ATS and tools used',
      'Vague "filled positions" without numbers',
      'Not showing sourcing strategy results'
    ],
    interviewTopics: ['Sourcing strategies', 'Candidate experience', 'Difficult searches', 'Diversity recruiting', 'Stakeholder management'],
    topResumeElements: {
      sections: ['Summary', 'Recruiting Experience', 'Key Metrics', 'Skills', 'Education'],
      differentiators: ['Time-to-fill metrics', 'Offer acceptance rates', 'Diversity hiring achievements', 'ATS expertise'],
      avgBulletCount: 5,
      certificationRate: 35,
      portfolioRate: 5,
      metricsRate: 95
    }
  },
  content_writer: {
    name: 'Content Writer',
    aliases: ['copywriter', 'content creator', 'content strategist', 'blogger', 'technical writer', 'content marketing manager', 'editor', 'seo writer'],
    keySkills: ['SEO Writing', 'Copywriting', 'Content Strategy', 'Research', 'Editing', 'CMS', 'Analytics', 'Brand Voice'],
    mustHaveKeywords: ['content', 'SEO', 'writing', 'copywriting', 'editorial', 'engagement', 'traffic', 'brand voice'],
    resumeTips: [
      'Include portfolio link with writing samples',
      'Quantify traffic, engagement, and conversion metrics',
      'Show variety of content types (blogs, whitepapers, emails)',
      'Highlight SEO results and rankings achieved'
    ],
    bulletExamples: [
      { weak: 'Wrote blog posts for company website', strong: 'Published 100+ SEO-optimized articles driving 500K monthly organic visits and 25% increase in lead generation' },
      { weak: 'Created marketing content', strong: 'Developed email nurture sequence achieving 35% open rate and 12% CTR, 2x industry average' }
    ],
    keyMetrics: ['Traffic generated', 'Engagement rate', 'Conversion rate', 'SEO rankings', 'Content pieces published', 'Email open/CTR'],
    commonMistakes: [
      'Missing portfolio link',
      'Not showing traffic or engagement metrics',
      'Vague "created content" without results',
      'Not mentioning SEO or analytics experience'
    ],
    interviewTopics: ['Writing process', 'SEO strategy', 'Brand voice development', 'Content performance analysis', 'Deadline management'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Portfolio', 'Skills', 'Education'],
      differentiators: ['Portfolio with writing samples', 'Traffic/engagement metrics', 'SEO results', 'Content variety'],
      avgBulletCount: 4,
      certificationRate: 25,
      portfolioRate: 90,
      metricsRate: 75
    }
  },
  graphic_designer: {
    name: 'Graphic Designer',
    aliases: ['visual designer', 'brand designer', 'creative designer', 'art director', 'digital designer', 'marketing designer', 'junior designer', 'senior designer'],
    keySkills: ['Adobe Creative Suite', 'Figma', 'Brand Identity', 'Typography', 'Layout Design', 'Print Design', 'Digital Design', 'Motion Graphics'],
    mustHaveKeywords: ['design', 'Adobe', 'Figma', 'brand', 'visual', 'creative', 'typography', 'layout'],
    resumeTips: [
      'Include portfolio link prominently',
      'Show variety of work (digital, print, branding)',
      'Quantify project scope and business impact',
      'List specific software proficiency'
    ],
    bulletExamples: [
      { weak: 'Designed marketing materials', strong: 'Designed 200+ marketing assets for product launch driving 40% increase in campaign engagement' },
      { weak: 'Created brand identity', strong: 'Led complete rebrand for $10M company, developing logo, guidelines, and 50+ templates adopted across 5 departments' }
    ],
    keyMetrics: ['Projects completed', 'Campaign performance lift', 'Brand assets created', 'Client satisfaction', 'Turnaround time'],
    commonMistakes: [
      'Missing portfolio link',
      'Not showing business impact of designs',
      'Listing software without showing creative outcomes',
      'Not mentioning collaboration with stakeholders'
    ],
    interviewTopics: ['Portfolio walkthrough', 'Design process', 'Feedback handling', 'Brand consistency', 'Cross-functional collaboration'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Portfolio', 'Skills & Tools', 'Education'],
      differentiators: ['Portfolio link (mandatory)', 'Brand work examples', 'Campaign performance metrics', 'Adobe/Figma proficiency'],
      avgBulletCount: 4,
      certificationRate: 20,
      portfolioRate: 98,
      metricsRate: 65
    }
  },
  pharmacist: {
    name: 'Pharmacist',
    aliases: ['clinical pharmacist', 'retail pharmacist', 'hospital pharmacist', 'pharmacy manager', 'staff pharmacist', 'ambulatory care pharmacist', 'pharm.d'],
    keySkills: ['Medication Dispensing', 'Patient Counseling', 'Drug Interactions', 'Pharmacy Operations', 'Inventory Management', 'Regulatory Compliance', 'Clinical Consultations', 'Immunizations'],
    mustHaveKeywords: ['prescriptions', 'patient counseling', 'medication', 'compliance', 'clinical', 'pharmacy operations', 'drug interactions', 'immunizations'],
    resumeTips: [
      'Include license number and state(s) prominently',
      'Quantify prescriptions filled and patient interactions',
      'Show error prevention and quality metrics',
      'Highlight specializations and certifications'
    ],
    bulletExamples: [
      { weak: 'Dispensed medications to patients', strong: 'Dispensed 300+ prescriptions daily with 99.98% accuracy rate, counseling 100+ patients on medication management' },
      { weak: 'Managed pharmacy operations', strong: 'Led pharmacy team of 8, reducing medication errors by 45% through improved verification protocols and staff training' }
    ],
    keyMetrics: ['Prescriptions filled daily', 'Accuracy rate %', 'Patient counseling volume', 'Error reduction %', 'Immunizations administered'],
    commonMistakes: [
      'Not including license numbers and states',
      'Missing prescription volume and accuracy metrics',
      'Vague "filled prescriptions" without scale',
      'Not highlighting patient safety achievements'
    ],
    interviewTopics: ['Drug interaction scenarios', 'Patient counseling approach', 'Error prevention', 'Regulatory compliance', 'Team management'],
    topResumeElements: {
      sections: ['Licenses', 'Experience', 'Certifications', 'Clinical Skills', 'Education'],
      differentiators: ['License and state(s)', 'Prescription volume', 'Error prevention metrics', 'Specialty certifications'],
      avgBulletCount: 4,
      certificationRate: 95,
      portfolioRate: 5,
      metricsRate: 75
    }
  },
  social_media_manager: {
    name: 'Social Media Manager',
    aliases: ['social media specialist', 'social media coordinator', 'community manager', 'social strategist', 'digital marketing manager', 'social media lead', 'content manager'],
    keySkills: ['Content Creation', 'Analytics', 'Community Management', 'Paid Social', 'Influencer Marketing', 'Brand Voice', 'Social Scheduling Tools', 'Crisis Management'],
    mustHaveKeywords: ['social media', 'engagement', 'followers', 'content', 'community', 'analytics', 'campaigns', 'brand'],
    resumeTips: [
      'Quantify follower growth and engagement rates',
      'Show revenue or lead generation from social',
      'List platforms managed and tools used',
      'Include examples of viral or high-performing content'
    ],
    bulletExamples: [
      { weak: 'Managed company social media accounts', strong: 'Grew Instagram from 10K to 150K followers in 12 months, achieving 8% engagement rate (4x industry average)' },
      { weak: 'Created social media content', strong: 'Developed viral TikTok campaign generating 5M+ views and 25% increase in website traffic' }
    ],
    keyMetrics: ['Follower growth %', 'Engagement rate', 'Reach/impressions', 'Social-driven revenue', 'Content performance'],
    commonMistakes: [
      'Not quantifying follower growth or engagement',
      'Missing revenue or business impact metrics',
      'Vague "managed social media" without results',
      'Not mentioning specific platforms and tools'
    ],
    interviewTopics: ['Content strategy', 'Crisis management', 'Analytics interpretation', 'Platform-specific tactics', 'Influencer partnerships'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Key Achievements', 'Skills', 'Education'],
      differentiators: ['Follower growth metrics', 'Engagement rate achievements', 'Viral content examples', 'Platform-specific expertise'],
      avgBulletCount: 5,
      certificationRate: 30,
      portfolioRate: 70,
      metricsRate: 92
    }
  },
  architect: {
    name: 'Architect',
    aliases: ['licensed architect', 'project architect', 'design architect', 'senior architect', 'architectural designer', 'principal architect', 'aia'],
    keySkills: ['AutoCAD', 'Revit', 'SketchUp', 'Building Codes', 'Project Management', 'Client Relations', 'Sustainable Design', 'Construction Documents'],
    mustHaveKeywords: ['design', 'AutoCAD', 'Revit', 'construction documents', 'building codes', 'LEED', 'project management', 'client'],
    resumeTips: [
      'Include license number and AIA membership',
      'Quantify project budgets and square footage',
      'Show variety of project types (residential, commercial, institutional)',
      'Highlight sustainability certifications (LEED AP)'
    ],
    bulletExamples: [
      { weak: 'Designed commercial buildings', strong: 'Led design of $50M mixed-use development (200K SF), achieving LEED Gold certification and 15% under budget' },
      { weak: 'Created construction documents', strong: 'Produced construction documents for 25+ residential projects totaling $30M, with zero major RFIs during construction' }
    ],
    keyMetrics: ['Project budget', 'Square footage', 'LEED certifications', 'Projects completed', 'Client satisfaction'],
    commonMistakes: [
      'Not including license number or AIA status',
      'Missing project budgets and scale',
      'Vague "designed buildings" without specifics',
      'Not mentioning software proficiency'
    ],
    interviewTopics: ['Portfolio walkthrough', 'Design process', 'Code compliance', 'Client management', 'Sustainable design approach'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Portfolio', 'Licenses', 'Education'],
      differentiators: ['Licensed architect status', 'Project budget scale', 'LEED certifications', 'Notable projects'],
      avgBulletCount: 4,
      certificationRate: 90,
      portfolioRate: 95,
      metricsRate: 70
    }
  },
  physical_therapist: {
    name: 'Physical Therapist',
    aliases: ['pt', 'physiotherapist', 'dpt', 'physical therapy assistant', 'pta', 'rehab therapist', 'outpatient therapist', 'sports physical therapist'],
    keySkills: ['Patient Assessment', 'Treatment Planning', 'Manual Therapy', 'Therapeutic Exercise', 'Documentation', 'Patient Education', 'Outcome Measurement', 'Rehabilitation'],
    mustHaveKeywords: ['patient care', 'rehabilitation', 'treatment plans', 'outcomes', 'manual therapy', 'exercise prescription', 'documentation', 'functional improvement'],
    resumeTips: [
      'Include license number and certifications (DPT, OCS, SCS)',
      'Quantify patient outcomes and caseload',
      'Show specializations and continuing education',
      'Highlight patient satisfaction scores'
    ],
    bulletExamples: [
      { weak: 'Treated patients with injuries', strong: 'Managed caseload of 50+ patients weekly, achieving 92% functional improvement rate and 4.9/5 patient satisfaction' },
      { weak: 'Developed treatment plans', strong: 'Created individualized treatment plans reducing average recovery time by 25% for post-surgical orthopedic patients' }
    ],
    keyMetrics: ['Patient caseload', 'Functional improvement %', 'Patient satisfaction', 'Recovery time reduction', 'Discharge rate'],
    commonMistakes: [
      'Not including license and certifications',
      'Missing patient outcome metrics',
      'Vague "provided physical therapy" without results',
      'Not showing specialization areas'
    ],
    interviewTopics: ['Clinical scenarios', 'Treatment approach', 'Outcome measurement', 'Patient communication', 'Evidence-based practice'],
    topResumeElements: {
      sections: ['Licenses', 'Experience', 'Certifications', 'Specializations', 'Education'],
      differentiators: ['DPT/specialty certifications', 'Patient outcome metrics', 'Caseload volume', 'Evidence-based practice'],
      avgBulletCount: 4,
      certificationRate: 92,
      portfolioRate: 5,
      metricsRate: 78
    }
  },
  supply_chain_manager: {
    name: 'Supply Chain Manager',
    aliases: ['logistics manager', 'procurement manager', 'supply chain analyst', 'inventory manager', 'distribution manager', 'sourcing manager', 'materials manager', 'scm'],
    keySkills: ['Inventory Management', 'Procurement', 'Logistics', 'Vendor Management', 'ERP Systems', 'Demand Planning', 'Cost Optimization', 'Supply Chain Analytics'],
    mustHaveKeywords: ['supply chain', 'inventory', 'procurement', 'logistics', 'vendors', 'cost reduction', 'forecasting', 'ERP'],
    resumeTips: [
      'Quantify cost savings and efficiency improvements',
      'Show inventory optimization results',
      'List specific ERP systems (SAP, Oracle)',
      'Highlight vendor negotiation outcomes'
    ],
    bulletExamples: [
      { weak: 'Managed supply chain operations', strong: 'Optimized supply chain for $100M product line, reducing costs by 18% and improving on-time delivery from 85% to 98%' },
      { weak: 'Negotiated with vendors', strong: 'Renegotiated contracts with 50+ vendors, achieving $2.5M annual savings while maintaining quality standards' }
    ],
    keyMetrics: ['Cost reduction %', 'Inventory turnover', 'On-time delivery %', 'Vendor savings', 'Lead time reduction'],
    commonMistakes: [
      'Not quantifying cost savings',
      'Missing inventory and delivery metrics',
      'Vague "managed supply chain" without scale',
      'Not mentioning specific ERP systems'
    ],
    interviewTopics: ['Supply chain disruption handling', 'Vendor negotiation', 'Demand forecasting', 'Cost optimization strategies', 'ERP implementation'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Key Achievements', 'Skills', 'Certifications'],
      differentiators: ['APICS/CSCP certification', 'Cost savings achievements', 'ERP implementation', 'Vendor negotiation results'],
      avgBulletCount: 5,
      certificationRate: 60,
      portfolioRate: 5,
      metricsRate: 90
    }
  },
  attorney: {
    name: 'Attorney',
    aliases: ['lawyer', 'associate attorney', 'senior associate', 'counsel', 'legal counsel', 'corporate attorney', 'litigator', 'partner', 'jd', 'esquire'],
    keySkills: ['Legal Research', 'Contract Drafting', 'Litigation', 'Negotiation', 'Client Counseling', 'Legal Writing', 'Due Diligence', 'Regulatory Compliance'],
    mustHaveKeywords: ['litigation', 'contracts', 'legal research', 'client counseling', 'negotiations', 'compliance', 'due diligence', 'court'],
    resumeTips: [
      'List bar admissions and jurisdictions prominently',
      'Quantify case outcomes, deal values, and billable hours',
      'Show practice area specializations',
      'Include notable matters (if permitted by confidentiality)'
    ],
    bulletExamples: [
      { weak: 'Handled litigation matters', strong: 'Successfully defended 25+ employment litigation cases with 90% favorable outcomes, saving clients $10M+ in potential liability' },
      { weak: 'Drafted contracts', strong: 'Negotiated and drafted 100+ commercial contracts annually totaling $50M+ in transaction value' }
    ],
    keyMetrics: ['Case outcomes', 'Deal/transaction value', 'Billable hours', 'Matters handled', 'Client retention'],
    commonMistakes: [
      'Not listing bar admissions and jurisdictions',
      'Missing case outcomes or deal values',
      'Vague "handled legal matters" without specifics',
      'Not showing practice area expertise'
    ],
    interviewTopics: ['Case strategy scenarios', 'Ethics and confidentiality', 'Client management', 'Legal research approach', 'Negotiation tactics'],
    topResumeElements: {
      sections: ['Education', 'Bar Admissions', 'Experience', 'Notable Matters', 'Skills'],
      differentiators: ['Bar admissions', 'Deal values/case outcomes', 'Practice area expertise', 'Notable matters'],
      avgBulletCount: 4,
      certificationRate: 100,
      portfolioRate: 5,
      metricsRate: 75
    }
  },
  chef: {
    name: 'Chef',
    aliases: ['executive chef', 'head chef', 'sous chef', 'pastry chef', 'culinary director', 'line cook', 'chef de cuisine', 'kitchen manager'],
    keySkills: ['Menu Development', 'Kitchen Management', 'Food Safety', 'Cost Control', 'Team Leadership', 'Inventory Management', 'Culinary Techniques', 'Vendor Relations'],
    mustHaveKeywords: ['menu development', 'kitchen operations', 'food cost', 'team management', 'culinary', 'food safety', 'inventory', 'HACCP'],
    resumeTips: [
      'Quantify kitchen size, team managed, and covers served',
      'Show food cost control achievements',
      'Highlight cuisine specializations and certifications',
      'Include notable restaurants or awards'
    ],
    bulletExamples: [
      { weak: 'Managed restaurant kitchen', strong: 'Led kitchen team of 15 serving 500+ covers daily, reducing food costs from 32% to 26% while maintaining quality' },
      { weak: 'Created new menu items', strong: 'Developed seasonal menu increasing average check by 18% and earning "Best New Restaurant" recognition' }
    ],
    keyMetrics: ['Covers served daily', 'Food cost %', 'Team size', 'Revenue growth', 'Customer satisfaction'],
    commonMistakes: [
      'Not quantifying kitchen operations scale',
      'Missing food cost and efficiency metrics',
      'Vague "cooked food" without culinary achievements',
      'Not mentioning certifications (ServSafe, culinary degrees)'
    ],
    interviewTopics: ['Menu development process', 'Kitchen management scenarios', 'Food cost control', 'Team leadership', 'Handling high-volume service'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Culinary Skills', 'Education/Training', 'Awards'],
      differentiators: ['Notable restaurant experience', 'Food cost achievements', 'Team size managed', 'Awards/recognition'],
      avgBulletCount: 4,
      certificationRate: 50,
      portfolioRate: 15,
      metricsRate: 75
    }
  },
  real_estate_agent: {
    name: 'Real Estate Agent',
    aliases: ['realtor', 'real estate broker', 'listing agent', 'buyer agent', 'real estate sales', 'property agent', 'real estate associate', 'commercial real estate'],
    keySkills: ['Sales', 'Negotiation', 'Market Analysis', 'Client Relations', 'Property Marketing', 'Contract Management', 'CRM', 'Networking'],
    mustHaveKeywords: ['sales volume', 'transactions', 'listings', 'clients', 'negotiations', 'closings', 'market analysis', 'contracts'],
    resumeTips: [
      'Include license number and certifications (CRS, ABR, GRI)',
      'Quantify sales volume and transaction count',
      'Show average days on market vs. area average',
      'Highlight client satisfaction and referral rate'
    ],
    bulletExamples: [
      { weak: 'Sold residential properties', strong: 'Closed $15M in residential sales (45 transactions) in 2023, ranking in top 5% of agents in metro area' },
      { weak: 'Helped buyers find homes', strong: 'Guided 30+ buyer clients to successful closings with 98% satisfaction rate and 40% referral business' }
    ],
    keyMetrics: ['Sales volume', 'Transactions closed', 'Days on market', 'List-to-sale ratio', 'Client satisfaction', 'Referral rate'],
    commonMistakes: [
      'Not including license and certifications',
      'Missing sales volume and transaction metrics',
      'Vague "sold homes" without numbers',
      'Not showing market performance vs. averages'
    ],
    interviewTopics: ['Sales approach', 'Market knowledge', 'Difficult negotiation scenarios', 'Lead generation strategies', 'Client communication'],
    topResumeElements: {
      sections: ['Summary', 'Sales Experience', 'Key Metrics', 'Licenses', 'Education'],
      differentiators: ['Sales volume metrics', 'Transaction count', 'License and designations', 'Market rankings'],
      avgBulletCount: 5,
      certificationRate: 85,
      portfolioRate: 10,
      metricsRate: 95
    }
  },
  mechanical_engineer: {
    name: 'Mechanical Engineer',
    aliases: ['senior mechanical engineer', 'design engineer', 'manufacturing engineer', 'hvac engineer', 'product engineer', 'mechanical designer', 'pe mechanical'],
    keySkills: ['CAD (SolidWorks, AutoCAD)', 'FEA/CFD Analysis', 'Product Design', 'Manufacturing Processes', 'Project Management', 'Prototyping', 'GD&T', 'Technical Documentation'],
    mustHaveKeywords: ['design', 'CAD', 'analysis', 'manufacturing', 'prototyping', 'specifications', 'testing', 'project management'],
    resumeTips: [
      'Include PE license if applicable',
      'Quantify project budgets, cost savings, and improvements',
      'List specific CAD and analysis software',
      'Show products or systems designed and their impact'
    ],
    bulletExamples: [
      { weak: 'Designed mechanical components', strong: 'Designed $2M automated assembly system reducing production time by 40% and labor costs by $500K annually' },
      { weak: 'Used SolidWorks for CAD', strong: 'Created 500+ detailed CAD models and drawings for medical device, achieving FDA 510(k) clearance on first submission' }
    ],
    keyMetrics: ['Project budget', 'Cost savings', 'Efficiency improvement %', 'Products launched', 'Patents filed'],
    commonMistakes: [
      'Not mentioning PE license or EIT status',
      'Missing project scale and budget details',
      'Vague "designed parts" without outcomes',
      'Not listing specific software and tools'
    ],
    interviewTopics: ['Design process', 'FEA/analysis approach', 'Manufacturing considerations', 'Problem-solving examples', 'Cross-functional collaboration'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Technical Skills', 'Education', 'Certifications'],
      differentiators: ['PE license', 'CAD proficiency (SolidWorks, AutoCAD)', 'Cost savings achievements', 'Patents'],
      avgBulletCount: 4,
      certificationRate: 45,
      portfolioRate: 20,
      metricsRate: 80
    }
  },
  robotics_engineer: {
    name: 'Robotics Engineer',
    aliases: ['robotics software engineer', 'automation engineer', 'controls engineer', 'mechatronics engineer', 'robotics developer', 'robot programmer', 'motion control engineer'],
    keySkills: ['ROS/ROS2', 'Python/C++', 'Motion Planning', 'Computer Vision', 'Sensor Integration', 'PLC Programming', 'Embedded Systems', 'Simulation (Gazebo, MATLAB)'],
    mustHaveKeywords: ['robotics', 'ROS', 'automation', 'motion planning', 'sensors', 'controls', 'computer vision', 'embedded'],
    resumeTips: [
      'Highlight specific robot platforms and systems worked on',
      'Quantify automation improvements and cycle times',
      'Show sensor integration and perception work',
      'Include links to demos, videos, or publications'
    ],
    bulletExamples: [
      { weak: 'Programmed industrial robots', strong: 'Developed ROS2-based pick-and-place system achieving 99.5% accuracy at 60 picks/minute, reducing manual labor by 80%' },
      { weak: 'Worked on autonomous navigation', strong: 'Built SLAM-based navigation stack for warehouse AMR, enabling autonomous operation across 100K sq ft facility' }
    ],
    keyMetrics: ['Cycle time improvement', 'Accuracy %', 'Automation ROI', 'Robots deployed', 'Uptime achieved'],
    commonMistakes: [
      'Not specifying robot platforms and frameworks',
      'Missing quantified automation outcomes',
      'Vague "worked on robots" without technical depth',
      'Not showing end-to-end system contributions'
    ],
    interviewTopics: ['Motion planning algorithms', 'Sensor fusion', 'Real-time systems', 'Safety considerations', 'System integration challenges'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Technical Skills', 'Projects', 'Education'],
      differentiators: ['ROS/ROS2 experience', 'Demo videos/links', 'Production deployment metrics', 'Publications'],
      avgBulletCount: 4,
      certificationRate: 35,
      portfolioRate: 70,
      metricsRate: 82
    }
  },
  ai_ml_engineer: {
    name: 'AI/ML Engineer',
    aliases: ['machine learning engineer', 'deep learning engineer', 'ai engineer', 'ml engineer', 'applied scientist', 'research engineer', 'nlp engineer', 'computer vision engineer'],
    keySkills: ['Python', 'TensorFlow/PyTorch', 'Deep Learning', 'NLP', 'Computer Vision', 'MLOps', 'Data Engineering', 'Model Deployment'],
    mustHaveKeywords: ['machine learning', 'deep learning', 'neural networks', 'model training', 'deployment', 'NLP', 'computer vision', 'MLOps'],
    resumeTips: [
      'Quantify model performance improvements (accuracy, latency, etc.)',
      'Show end-to-end ML pipeline experience',
      'Include publications, patents, or competition rankings',
      'Highlight production deployment scale'
    ],
    bulletExamples: [
      { weak: 'Built machine learning models', strong: 'Developed transformer-based NLP model improving classification accuracy from 78% to 94%, deployed to production serving 10M+ requests/day' },
      { weak: 'Worked on computer vision', strong: 'Built real-time object detection system achieving 95% mAP at 30fps, enabling automated quality inspection saving $2M annually' }
    ],
    keyMetrics: ['Model accuracy/F1', 'Latency reduction', 'Inference scale (requests/day)', 'Cost savings', 'Publications/patents'],
    commonMistakes: [
      'Not quantifying model performance metrics',
      'Missing production deployment experience',
      'Vague "built ML models" without business impact',
      'Not showing end-to-end pipeline work'
    ],
    interviewTopics: ['ML system design', 'Model selection rationale', 'Handling data quality issues', 'MLOps practices', 'Scaling ML systems'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Technical Skills', 'Projects', 'Publications'],
      differentiators: ['Model performance metrics', 'Production deployment scale', 'Publications/patents', 'Open source contributions'],
      avgBulletCount: 4,
      certificationRate: 40,
      portfolioRate: 75,
      metricsRate: 88
    }
  },
  dentist: {
    name: 'Dentist',
    aliases: ['dental surgeon', 'dds', 'dmd', 'general dentist', 'orthodontist', 'periodontist', 'endodontist', 'oral surgeon', 'pediatric dentist'],
    keySkills: ['Patient Care', 'Diagnosis', 'Restorative Procedures', 'Oral Surgery', 'Patient Education', 'Treatment Planning', 'Dental Technology', 'Practice Management'],
    mustHaveKeywords: ['patient care', 'diagnosis', 'treatment planning', 'procedures', 'dental', 'oral health', 'restorative', 'preventive'],
    resumeTips: [
      'Include license number and specializations',
      'Quantify patient volume and treatment outcomes',
      'Show range of procedures performed',
      'Highlight technology adoption (digital X-rays, CAD/CAM)'
    ],
    bulletExamples: [
      { weak: 'Provided dental care to patients', strong: 'Treated 25+ patients daily across restorative, preventive, and cosmetic procedures, achieving 98% patient satisfaction' },
      { weak: 'Performed dental procedures', strong: 'Completed 500+ implant placements with 97% success rate, growing practice revenue by 35%' }
    ],
    keyMetrics: ['Patients treated daily', 'Procedure success rate', 'Patient satisfaction', 'Revenue growth', 'Case acceptance rate'],
    commonMistakes: [
      'Not including license and certifications',
      'Missing patient volume and outcome metrics',
      'Vague "treated patients" without specifics',
      'Not showing technology proficiency'
    ],
    interviewTopics: ['Clinical scenarios', 'Patient communication', 'Treatment planning approach', 'Practice management', 'Continuing education'],
    topResumeElements: {
      sections: ['Licenses', 'Experience', 'Specializations', 'Education', 'Continuing Education'],
      differentiators: ['License and specialties', 'Patient volume metrics', 'Practice growth achievements', 'Advanced certifications'],
      avgBulletCount: 4,
      certificationRate: 98,
      portfolioRate: 5,
      metricsRate: 70
    }
  },
  veterinarian: {
    name: 'Veterinarian',
    aliases: ['vet', 'dvm', 'veterinary surgeon', 'animal doctor', 'veterinary physician', 'emergency vet', 'specialty veterinarian'],
    keySkills: ['Animal Care', 'Diagnosis', 'Surgery', 'Client Communication', 'Pharmacology', 'Radiology', 'Emergency Medicine', 'Preventive Care'],
    mustHaveKeywords: ['patient care', 'diagnosis', 'surgery', 'treatment', 'animal health', 'client education', 'preventive care', 'emergency'],
    resumeTips: [
      'Include DVM license and state(s)',
      'Quantify caseload and surgical volume',
      'Show species specializations',
      'Highlight emergency and specialty experience'
    ],
    bulletExamples: [
      { weak: 'Treated animals at veterinary clinic', strong: 'Managed caseload of 30+ patients daily across companion animals, performing 200+ surgeries annually with 99% success rate' },
      { weak: 'Performed veterinary surgeries', strong: 'Led emergency department handling 50+ critical cases monthly, achieving 92% survival rate for trauma patients' }
    ],
    keyMetrics: ['Daily caseload', 'Surgeries performed', 'Success/survival rate', 'Client satisfaction', 'Revenue generated'],
    commonMistakes: [
      'Not including DVM license and states',
      'Missing caseload and surgical metrics',
      'Vague "treated animals" without volume',
      'Not showing species or specialty focus'
    ],
    interviewTopics: ['Clinical case discussions', 'Difficult client scenarios', 'Emergency protocols', 'Ethical dilemmas', 'Practice management'],
    topResumeElements: {
      sections: ['Licenses', 'Experience', 'Specializations', 'Education', 'Professional Development'],
      differentiators: ['DVM license and states', 'Caseload metrics', 'Surgical volume', 'Species specializations'],
      avgBulletCount: 4,
      certificationRate: 98,
      portfolioRate: 5,
      metricsRate: 72
    }
  },
  civil_engineer: {
    name: 'Civil Engineer',
    aliases: ['structural engineer', 'transportation engineer', 'geotechnical engineer', 'environmental engineer', 'construction engineer', 'pe civil', 'project engineer'],
    keySkills: ['AutoCAD/Civil 3D', 'Structural Analysis', 'Project Management', 'Site Design', 'Surveying', 'Code Compliance', 'Cost Estimation', 'Construction Management'],
    mustHaveKeywords: ['design', 'construction', 'infrastructure', 'project management', 'CAD', 'specifications', 'compliance', 'site'],
    resumeTips: [
      'Include PE license prominently',
      'Quantify project budgets and scale (miles, square footage)',
      'Show variety of project types',
      'Highlight on-time/on-budget delivery'
    ],
    bulletExamples: [
      { weak: 'Designed civil engineering projects', strong: 'Led design of $25M highway interchange project, delivering 3 weeks ahead of schedule with zero change orders' },
      { weak: 'Managed construction projects', strong: 'Managed construction of 50-mile water pipeline ($40M), coordinating 5 contractors and achieving 100% regulatory compliance' }
    ],
    keyMetrics: ['Project budget', 'Schedule performance', 'Infrastructure scale', 'Change order reduction', 'Compliance rate'],
    commonMistakes: [
      'Not including PE license',
      'Missing project scale and budget details',
      'Vague "designed infrastructure" without specifics',
      'Not mentioning software and tools'
    ],
    interviewTopics: ['Technical design challenges', 'Project management approach', 'Regulatory compliance', 'Stakeholder coordination', 'Site problem-solving'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Technical Skills', 'Licenses', 'Education'],
      differentiators: ['PE license', 'Project budget scale', 'Infrastructure scope', 'On-time/on-budget delivery'],
      avgBulletCount: 4,
      certificationRate: 70,
      portfolioRate: 15,
      metricsRate: 82
    }
  },
  security_analyst: {
    name: 'Security Analyst',
    aliases: ['cybersecurity analyst', 'information security analyst', 'soc analyst', 'security engineer', 'penetration tester', 'security consultant', 'threat analyst', 'security operations'],
    keySkills: ['Threat Detection', 'SIEM', 'Incident Response', 'Vulnerability Assessment', 'Network Security', 'Penetration Testing', 'Compliance', 'Security Frameworks'],
    mustHaveKeywords: ['security', 'threat detection', 'incident response', 'vulnerabilities', 'SIEM', 'compliance', 'penetration testing', 'risk assessment'],
    resumeTips: [
      'Include security certifications (CISSP, CEH, CompTIA Security+)',
      'Quantify threats detected and incidents resolved',
      'Show compliance frameworks experience (SOC 2, ISO 27001, NIST)',
      'Highlight tools and technologies used'
    ],
    bulletExamples: [
      { weak: 'Monitored security systems', strong: 'Analyzed 10K+ daily security alerts using Splunk SIEM, identifying and remediating 150+ critical threats with 0 breaches' },
      { weak: 'Performed security assessments', strong: 'Conducted 50+ penetration tests annually, identifying 200+ vulnerabilities and reducing attack surface by 60%' }
    ],
    keyMetrics: ['Threats detected', 'Incidents resolved', 'Mean time to detect/respond', 'Vulnerabilities remediated', 'Compliance audit results'],
    commonMistakes: [
      'Not including security certifications',
      'Missing quantified threat detection metrics',
      'Vague "monitored security" without outcomes',
      'Not mentioning specific tools and frameworks'
    ],
    interviewTopics: ['Incident response scenarios', 'Threat analysis approach', 'Security architecture', 'Compliance requirements', 'Emerging threats'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Certifications', 'Technical Skills', 'Education'],
      differentiators: ['Security certifications (CISSP, CEH)', 'Threat detection metrics', 'Compliance frameworks experience', 'Incident response achievements'],
      avgBulletCount: 4,
      certificationRate: 85,
      portfolioRate: 15,
      metricsRate: 80
    }
  },
  paralegal: {
    name: 'Paralegal',
    aliases: ['legal assistant', 'litigation paralegal', 'corporate paralegal', 'senior paralegal', 'legal secretary', 'legal coordinator', 'law clerk'],
    keySkills: ['Legal Research', 'Document Preparation', 'Case Management', 'E-Discovery', 'Filing', 'Client Communication', 'Legal Databases', 'Compliance'],
    mustHaveKeywords: ['legal research', 'document preparation', 'case management', 'discovery', 'filing', 'litigation support', 'contracts', 'compliance'],
    resumeTips: [
      'Include paralegal certification if applicable',
      'Quantify cases supported and documents prepared',
      'Show practice area specializations',
      'List legal software proficiency (Westlaw, LexisNexis)'
    ],
    bulletExamples: [
      { weak: 'Assisted attorneys with cases', strong: 'Supported 5 attorneys managing 75+ active cases, preparing 500+ legal documents annually with 99% accuracy' },
      { weak: 'Conducted legal research', strong: 'Performed legal research and drafted motions for complex litigation, contributing to 85% favorable case outcomes' }
    ],
    keyMetrics: ['Cases supported', 'Documents prepared', 'Attorneys supported', 'Accuracy rate', 'Filing deadlines met'],
    commonMistakes: [
      'Not including paralegal certification',
      'Missing volume of work handled',
      'Vague "assisted attorneys" without specifics',
      'Not listing legal research tools'
    ],
    interviewTopics: ['Legal research approach', 'Case management systems', 'Deadline management', 'Confidentiality handling', 'Practice area knowledge'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Skills', 'Certifications', 'Education'],
      differentiators: ['Paralegal certification', 'Case volume metrics', 'Practice area expertise', 'Legal software proficiency'],
      avgBulletCount: 4,
      certificationRate: 65,
      portfolioRate: 5,
      metricsRate: 72
    }
  },
  event_planner: {
    name: 'Event Planner',
    aliases: ['event coordinator', 'event manager', 'wedding planner', 'conference planner', 'meeting planner', 'special events coordinator', 'corporate events manager'],
    keySkills: ['Event Planning', 'Vendor Management', 'Budget Management', 'Logistics', 'Client Relations', 'Negotiation', 'Marketing', 'Crisis Management'],
    mustHaveKeywords: ['events', 'planning', 'budget', 'vendors', 'logistics', 'coordination', 'client relations', 'execution'],
    resumeTips: [
      'Quantify events planned and attendees served',
      'Show budget management and cost savings',
      'Highlight variety of event types',
      'Include client satisfaction metrics'
    ],
    bulletExamples: [
      { weak: 'Planned corporate events', strong: 'Planned and executed 50+ corporate events annually for up to 2,000 attendees, managing $1M+ budget with 15% average cost savings' },
      { weak: 'Coordinated with vendors', strong: 'Negotiated contracts with 100+ vendors, reducing costs by 20% while maintaining 98% client satisfaction' }
    ],
    keyMetrics: ['Events planned annually', 'Attendees served', 'Budget managed', 'Cost savings %', 'Client satisfaction'],
    commonMistakes: [
      'Not quantifying event scale and budget',
      'Missing attendee numbers',
      'Vague "planned events" without specifics',
      'Not showing vendor management results'
    ],
    interviewTopics: ['Event logistics scenarios', 'Budget management', 'Crisis handling', 'Vendor negotiation', 'Client communication'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Key Achievements', 'Skills', 'Certifications'],
      differentiators: ['Event scale/budget metrics', 'Attendee numbers', 'Cost savings', 'Client satisfaction rates'],
      avgBulletCount: 5,
      certificationRate: 40,
      portfolioRate: 30,
      metricsRate: 85
    }
  },
  electrician: {
    name: 'Electrician',
    aliases: ['journeyman electrician', 'master electrician', 'electrical technician', 'industrial electrician', 'commercial electrician', 'residential electrician', 'apprentice electrician'],
    keySkills: ['Electrical Installation', 'Troubleshooting', 'Code Compliance', 'Blueprint Reading', 'Safety Protocols', 'PLC Programming', 'Conduit Bending', 'Panel Wiring'],
    mustHaveKeywords: ['electrical', 'installation', 'troubleshooting', 'code compliance', 'safety', 'wiring', 'NEC', 'maintenance'],
    resumeTips: [
      'Include license type and number (Journeyman, Master)',
      'Quantify projects completed and scale',
      'Show safety record and compliance',
      'Highlight specializations (commercial, industrial, residential)'
    ],
    bulletExamples: [
      { weak: 'Performed electrical work', strong: 'Completed 200+ electrical installations in commercial buildings, maintaining 100% code compliance and zero safety incidents' },
      { weak: 'Troubleshot electrical issues', strong: 'Diagnosed and repaired electrical faults reducing downtime by 40% for manufacturing facility with 50+ production lines' }
    ],
    keyMetrics: ['Projects completed', 'Safety record', 'Code compliance %', 'Downtime reduction', 'Customer satisfaction'],
    commonMistakes: [
      'Not including license type and certifications',
      'Missing project volume and scale',
      'Vague "electrical work" without specifics',
      'Not highlighting safety record'
    ],
    interviewTopics: ['Code compliance scenarios', 'Troubleshooting approach', 'Safety protocols', 'Blueprint reading', 'Complex installation projects'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Licenses', 'Skills', 'Safety Training'],
      differentiators: ['Journeyman/Master license', 'Safety record', 'Project volume', 'Specialization areas'],
      avgBulletCount: 4,
      certificationRate: 95,
      portfolioRate: 5,
      metricsRate: 70
    }
  },
  insurance_agent: {
    name: 'Insurance Agent',
    aliases: ['insurance sales agent', 'insurance broker', 'life insurance agent', 'property insurance agent', 'insurance producer', 'licensed agent', 'insurance advisor', 'captive agent'],
    keySkills: ['Sales', 'Client Relations', 'Policy Analysis', 'Underwriting', 'Claims Processing', 'Lead Generation', 'CRM', 'Compliance'],
    mustHaveKeywords: ['policies', 'premiums', 'sales', 'clients', 'underwriting', 'claims', 'retention', 'quotes'],
    resumeTips: [
      'Include license types and states',
      'Quantify policies sold and premium volume',
      'Show retention rates and client satisfaction',
      'Highlight sales rankings and awards'
    ],
    bulletExamples: [
      { weak: 'Sold insurance policies', strong: 'Generated $2M+ in annual premium volume selling 300+ policies, ranking in top 10% of agents nationwide' },
      { weak: 'Managed client relationships', strong: 'Maintained 500+ client portfolio with 95% retention rate and 40% referral-based new business' }
    ],
    keyMetrics: ['Premium volume', 'Policies sold', 'Retention rate %', 'Client portfolio size', 'Sales ranking'],
    commonMistakes: [
      'Not including license types and states',
      'Missing premium and policy volume',
      'Vague "sold insurance" without numbers',
      'Not showing retention and referral metrics'
    ],
    interviewTopics: ['Sales approach', 'Client needs assessment', 'Objection handling', 'Compliance knowledge', 'Cross-selling strategies'],
    topResumeElements: {
      sections: ['Summary', 'Sales Experience', 'Licenses', 'Key Metrics', 'Education'],
      differentiators: ['License types and states', 'Premium volume metrics', 'Retention rates', 'Sales rankings/awards'],
      avgBulletCount: 5,
      certificationRate: 90,
      portfolioRate: 5,
      metricsRate: 92
    }
  },
  physician: {
    name: 'Physician',
    aliases: ['doctor', 'md', 'medical doctor', 'attending physician', 'hospitalist', 'primary care physician', 'specialist', 'surgeon', 'resident physician'],
    keySkills: ['Patient Care', 'Diagnosis', 'Treatment Planning', 'Clinical Documentation', 'Evidence-Based Medicine', 'Patient Education', 'Team Leadership', 'EMR/EHR'],
    mustHaveKeywords: ['patient care', 'diagnosis', 'treatment', 'clinical', 'outcomes', 'evidence-based', 'documentation', 'quality'],
    resumeTips: [
      'Include medical license, board certifications, and DEA',
      'Quantify patient volume and outcomes',
      'Show quality metrics and patient satisfaction',
      'Highlight research, publications, and leadership'
    ],
    bulletExamples: [
      { weak: 'Provided patient care', strong: 'Managed panel of 2,500+ patients, achieving 95th percentile in quality metrics and 4.9/5 patient satisfaction' },
      { weak: 'Treated patients in hospital', strong: 'Led hospitalist team caring for 20+ patients daily, reducing average length of stay by 15% while maintaining readmission rates below national average' }
    ],
    keyMetrics: ['Patient panel size', 'Quality metrics percentile', 'Patient satisfaction', 'Readmission rates', 'Publications'],
    commonMistakes: [
      'Not including licenses, board certifications, and DEA',
      'Missing patient volume and panel size',
      'Vague "treated patients" without outcomes',
      'Not showing quality and satisfaction metrics'
    ],
    interviewTopics: ['Clinical scenarios', 'Quality improvement', 'Difficult patient situations', 'Evidence-based practice', 'Team leadership'],
    topResumeElements: {
      sections: ['Licenses', 'Education', 'Experience', 'Research/Publications', 'Board Certifications'],
      differentiators: ['Board certifications', 'Quality metrics percentile', 'Patient satisfaction', 'Research publications'],
      avgBulletCount: 4,
      certificationRate: 100,
      portfolioRate: 5,
      metricsRate: 78
    }
  },
  flight_attendant: {
    name: 'Flight Attendant',
    aliases: ['cabin crew', 'flight crew', 'cabin attendant', 'senior flight attendant', 'purser', 'inflight crew', 'airline crew'],
    keySkills: ['Customer Service', 'Safety Procedures', 'Emergency Response', 'Conflict Resolution', 'First Aid/CPR', 'Communication', 'Cultural Sensitivity', 'Teamwork'],
    mustHaveKeywords: ['safety', 'customer service', 'passengers', 'emergency procedures', 'inflight', 'FAA', 'service excellence', 'crew'],
    resumeTips: [
      'Include FAA certifications and safety training',
      'Quantify flight hours and passengers served',
      'Show customer satisfaction and commendations',
      'Highlight language skills and international experience'
    ],
    bulletExamples: [
      { weak: 'Served passengers on flights', strong: 'Delivered exceptional service to 200+ passengers per flight across 80+ monthly flight hours, earning 98% positive feedback' },
      { weak: 'Ensured passenger safety', strong: 'Maintained 100% safety compliance across 1,000+ flights, trained 25+ new crew members on emergency procedures' }
    ],
    keyMetrics: ['Flight hours', 'Passengers served', 'Customer satisfaction %', 'Safety compliance', 'Languages spoken'],
    commonMistakes: [
      'Not including FAA certifications',
      'Missing flight hours and experience level',
      'Vague "served passengers" without scale',
      'Not highlighting language skills'
    ],
    interviewTopics: ['Emergency scenarios', 'Difficult passenger situations', 'Teamwork examples', 'Customer service approach', 'Handling delays'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Certifications', 'Languages', 'Education'],
      differentiators: ['FAA certifications', 'Flight hours', 'Language skills', 'Customer satisfaction metrics'],
      avgBulletCount: 4,
      certificationRate: 95,
      portfolioRate: 5,
      metricsRate: 70
    }
  },
  truck_driver: {
    name: 'Truck Driver',
    aliases: ['cdl driver', 'otr driver', 'commercial driver', 'long haul driver', 'delivery driver', 'freight driver', 'owner operator', 'fleet driver'],
    keySkills: ['Commercial Driving', 'DOT Compliance', 'Route Planning', 'Vehicle Inspection', 'Load Securing', 'ELD/Logbook', 'Customer Service', 'Time Management'],
    mustHaveKeywords: ['CDL', 'miles driven', 'safety record', 'on-time delivery', 'DOT compliance', 'freight', 'routes', 'endorsements'],
    resumeTips: [
      'Include CDL class and endorsements (Hazmat, Tanker, Doubles)',
      'Quantify miles driven and safety record',
      'Show on-time delivery performance',
      'Highlight years of accident-free driving'
    ],
    bulletExamples: [
      { weak: 'Drove trucks for deliveries', strong: 'Logged 100,000+ miles annually with 5+ years accident-free record, maintaining 99% on-time delivery rate' },
      { weak: 'Delivered freight', strong: 'Transported $5M+ in freight monthly across 48 states, achieving 100% DOT compliance and zero cargo claims' }
    ],
    keyMetrics: ['Miles driven annually', 'Years accident-free', 'On-time delivery %', 'DOT compliance', 'Cargo claims'],
    commonMistakes: [
      'Not listing CDL class and endorsements',
      'Missing mileage and safety record',
      'Vague "drove trucks" without metrics',
      'Not showing compliance record'
    ],
    interviewTopics: ['Safety record', 'Route planning approach', 'DOT regulations knowledge', 'Handling delays', 'Vehicle maintenance'],
    topResumeElements: {
      sections: ['Summary', 'CDL Information', 'Experience', 'Safety Record', 'Endorsements'],
      differentiators: ['CDL class and endorsements', 'Miles driven', 'Years accident-free', 'On-time delivery rate'],
      avgBulletCount: 4,
      certificationRate: 98,
      portfolioRate: 5,
      metricsRate: 85
    }
  },
  data_analyst: {
    name: 'Data Analyst',
    aliases: ['senior data analyst', 'junior data analyst', 'reporting analyst', 'insights analyst', 'marketing analyst', 'operations analyst', 'product analyst'],
    keySkills: ['SQL', 'Excel', 'Python/R', 'Data Visualization', 'Tableau/Power BI', 'Statistical Analysis', 'Reporting', 'Business Intelligence'],
    mustHaveKeywords: ['data analysis', 'SQL', 'reporting', 'insights', 'dashboards', 'metrics', 'visualization', 'Excel'],
    resumeTips: [
      'Quantify business impact of your analyses',
      'Show proficiency in SQL and visualization tools',
      'Highlight stakeholder presentations and influence',
      'Include specific tools (Tableau, Power BI, Looker)'
    ],
    bulletExamples: [
      { weak: 'Analyzed data for reports', strong: 'Built automated dashboards serving 50+ stakeholders, reducing report generation time by 80% and enabling $2M in cost savings' },
      { weak: 'Created Excel reports', strong: 'Developed predictive churn model identifying at-risk customers, enabling retention campaigns that saved $1.5M annually' }
    ],
    keyMetrics: ['Business impact ($)', 'Stakeholders served', 'Reports automated', 'Time savings', 'Decision influence'],
    commonMistakes: [
      'Not quantifying business impact',
      'Missing specific tools and technologies',
      'Vague "analyzed data" without outcomes',
      'Not showing stakeholder influence'
    ],
    interviewTopics: ['SQL proficiency tests', 'Case study analysis', 'Stakeholder communication', 'Tool expertise', 'Problem-solving approach'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Technical Skills', 'Tools', 'Education'],
      differentiators: ['Business impact metrics', 'Dashboard/report examples', 'SQL proficiency', 'Visualization tool expertise'],
      avgBulletCount: 4,
      certificationRate: 40,
      portfolioRate: 50,
      metricsRate: 85
    }
  },
  bi_analyst: {
    name: 'Business Intelligence Analyst',
    aliases: ['bi developer', 'bi engineer', 'business intelligence developer', 'bi specialist', 'reporting developer', 'analytics developer'],
    keySkills: ['SQL', 'ETL', 'Data Warehousing', 'Tableau/Power BI', 'Data Modeling', 'Dashboard Development', 'Business Analysis', 'Stakeholder Management'],
    mustHaveKeywords: ['business intelligence', 'dashboards', 'data warehouse', 'ETL', 'reporting', 'KPIs', 'visualization', 'data modeling'],
    resumeTips: [
      'Quantify dashboard adoption and user engagement',
      'Show data warehouse and ETL experience',
      'Highlight self-service analytics enablement',
      'Include specific BI platforms and scale'
    ],
    bulletExamples: [
      { weak: 'Created BI dashboards', strong: 'Developed executive dashboard suite used by 200+ users, driving 40% increase in data-driven decisions' },
      { weak: 'Worked on data warehouse', strong: 'Designed dimensional data model supporting $50M revenue tracking, reducing query time by 90%' }
    ],
    keyMetrics: ['Dashboard users', 'Report adoption %', 'Query performance improvement', 'Self-service enablement', 'Business decisions influenced'],
    commonMistakes: [
      'Not showing dashboard adoption metrics',
      'Missing data modeling experience',
      'Vague "built reports" without scale',
      'Not demonstrating stakeholder impact'
    ],
    interviewTopics: ['Data modeling approach', 'Dashboard design principles', 'Stakeholder requirements gathering', 'Performance optimization', 'BI tool expertise'],
    topResumeElements: {
      sections: ['Summary', 'Experience', 'Technical Skills', 'Tools', 'Education'],
      differentiators: ['Dashboard adoption metrics', 'Data warehouse experience', 'BI platform expertise', 'Self-service analytics enablement'],
      avgBulletCount: 4,
      certificationRate: 45,
      portfolioRate: 40,
      metricsRate: 82
    }
  },
  quantitative_analyst: {
    name: 'Quantitative Analyst',
    aliases: ['quant', 'quant developer', 'quantitative researcher', 'quant trader', 'quantitative strategist', 'algorithmic trader', 'risk quant'],
    keySkills: ['Python/R/C++', 'Statistical Modeling', 'Machine Learning', 'Financial Mathematics', 'Time Series Analysis', 'Risk Modeling', 'Algorithm Development', 'Backtesting'],
    mustHaveKeywords: ['quantitative', 'modeling', 'algorithms', 'backtesting', 'risk', 'trading', 'statistical', 'financial'],
    resumeTips: [
      'Highlight model performance and alpha generation',
      'Show programming proficiency (Python, C++, R)',
      'Quantify trading strategy returns or risk reduction',
      'Include academic credentials and publications'
    ],
    bulletExamples: [
      { weak: 'Developed trading models', strong: 'Built equity momentum strategy generating 15% annual alpha with Sharpe ratio of 2.1, deployed with $50M AUM' },
      { weak: 'Analyzed financial data', strong: 'Developed VaR model reducing risk capital requirements by 20% while maintaining 99% confidence coverage' }
    ],
    keyMetrics: ['Alpha generated', 'Sharpe ratio', 'AUM managed', 'Model accuracy', 'Risk reduction %'],
    commonMistakes: [
      'Not quantifying strategy performance',
      'Missing programming languages and tools',
      'Vague "built models" without results',
      'Not showing production deployment'
    ],
    interviewTopics: ['Probability and statistics', 'Coding tests', 'Model validation', 'Risk management', 'Market microstructure'],
    topResumeElements: {
      sections: ['Education', 'Experience', 'Technical Skills', 'Publications', 'Projects'],
      differentiators: ['Strategy performance metrics (alpha, Sharpe)', 'Programming languages', 'Academic credentials', 'Production deployment'],
      avgBulletCount: 4,
      certificationRate: 30,
      portfolioRate: 40,
      metricsRate: 95
    }
  },
  electrical_engineer: {
    name: 'Electrical Engineer',
    aliases: ['ee', 'electronics engineer', 'power engineer', 'hardware engineer', 'embedded systems engineer', 'pcb designer', 'rf engineer', 'signal processing engineer'],
    keySkills: ['Circuit Design', 'PCB Layout', 'Embedded Systems', 'Power Electronics', 'Signal Processing', 'MATLAB/Simulink', 'CAD Tools', 'Testing & Validation'],
    mustHaveKeywords: ['circuit design', 'PCB', 'embedded', 'power systems', 'schematic', 'testing', 'validation', 'firmware'],
    resumeTips: [
      'Include PE license if applicable',
      'Quantify products designed and production volumes',
      'Show testing and validation achievements',
      'List specific tools (Altium, Cadence, SPICE)'
    ],
    bulletExamples: [
      { weak: 'Designed electronic circuits', strong: 'Designed power management system for IoT device, reducing power consumption by 40% and enabling 2-year battery life' },
      { weak: 'Tested electronic products', strong: 'Led EMC/EMI testing and certification for 15+ products, achieving 100% first-pass FCC compliance' }
    ],
    keyMetrics: ['Products designed', 'Production volume', 'Power/efficiency improvement', 'First-pass yield', 'Certification success rate'],
    commonMistakes: [
      'Not mentioning PE license or certifications',
      'Missing production volume and scale',
      'Vague "designed circuits" without outcomes',
      'Not listing specific EDA tools'
    ],
    interviewTopics: ['Circuit analysis', 'Design trade-offs', 'EMC/EMI considerations', 'Debugging approach', 'Tool proficiency'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Technical Skills', 'Education', 'Certifications'], differentiators: ['PE license', 'Products launched', 'EDA tool proficiency', 'Patents'], avgBulletCount: 4, certificationRate: 50, portfolioRate: 25, metricsRate: 78 }
  },
  chemical_engineer: {
    name: 'Chemical Engineer',
    aliases: ['process engineer', 'chemical process engineer', 'senior chemical engineer', 'petrochemical engineer', 'pharmaceutical engineer', 'pe chemical'],
    keySkills: ['Process Design', 'Process Simulation', 'Plant Operations', 'Safety/HAZOP', 'Quality Control', 'Aspen/HYSYS', 'P&ID', 'Scale-up'],
    mustHaveKeywords: ['process design', 'plant operations', 'scale-up', 'safety', 'quality', 'simulation', 'optimization', 'yield'],
    resumeTips: [
      'Include PE license prominently',
      'Quantify yield improvements and cost savings',
      'Show safety record and HAZOP experience',
      'Highlight scale-up from lab to production'
    ],
    bulletExamples: [
      { weak: 'Worked on chemical processes', strong: 'Optimized distillation process increasing yield by 12% and reducing energy costs by $500K annually' },
      { weak: 'Managed plant operations', strong: 'Led scale-up of pharmaceutical API from 1kg to 100kg batches, achieving 98% yield and zero safety incidents' }
    ],
    keyMetrics: ['Yield improvement %', 'Cost savings', 'Production volume', 'Safety record', 'Scale-up success'],
    commonMistakes: [
      'Not including PE license',
      'Missing yield and efficiency metrics',
      'Vague "optimized processes" without numbers',
      'Not highlighting safety achievements'
    ],
    interviewTopics: ['Process troubleshooting', 'Safety and HAZOP', 'Scale-up challenges', 'Simulation tools', 'Regulatory compliance'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Technical Skills', 'Licenses', 'Education'], differentiators: ['PE license', 'Safety record', 'Yield improvements', 'Scale-up experience'], avgBulletCount: 4, certificationRate: 55, portfolioRate: 10, metricsRate: 85 }
  },
  aerospace_engineer: {
    name: 'Aerospace Engineer',
    aliases: ['aeronautical engineer', 'aircraft engineer', 'propulsion engineer', 'flight systems engineer', 'spacecraft engineer', 'avionics engineer', 'structures engineer'],
    keySkills: ['Aerodynamics', 'Structural Analysis', 'Propulsion', 'Flight Systems', 'CAD/CAE', 'MATLAB', 'FEA/CFD', 'Requirements Management'],
    mustHaveKeywords: ['aerospace', 'flight', 'propulsion', 'structures', 'avionics', 'systems', 'testing', 'certification'],
    resumeTips: [
      'Include PE license and security clearance if applicable',
      'Quantify program budgets and aircraft/spacecraft worked on',
      'Show certification and testing achievements',
      'Highlight specific subsystems and contributions'
    ],
    bulletExamples: [
      { weak: 'Designed aerospace components', strong: 'Led structural design of $200M aircraft wing, achieving 15% weight reduction while exceeding FAA certification requirements' },
      { weak: 'Worked on propulsion systems', strong: 'Developed propulsion system for satellite constellation, improving fuel efficiency by 20% and extending mission life by 3 years' }
    ],
    keyMetrics: ['Program budget', 'Weight reduction %', 'Performance improvement', 'Certification success', 'Mission success rate'],
    commonMistakes: [
      'Not mentioning security clearance if applicable',
      'Missing program scale and budget',
      'Vague "aerospace design" without specifics',
      'Not showing certification/testing outcomes'
    ],
    interviewTopics: ['Technical design challenges', 'Systems integration', 'Certification process', 'Trade studies', 'Failure analysis'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Technical Skills', 'Clearance', 'Education'], differentiators: ['Security clearance', 'Program budget scale', 'Certification achievements', 'Notable programs'], avgBulletCount: 4, certificationRate: 45, portfolioRate: 15, metricsRate: 80 }
  },
  biomedical_engineer: {
    name: 'Biomedical Engineer',
    aliases: ['medical device engineer', 'bme', 'clinical engineer', 'regulatory engineer', 'r&d engineer biomedical', 'biomechanical engineer'],
    keySkills: ['Medical Device Design', 'FDA Regulations', 'Quality Systems', 'Clinical Trials', 'Biocompatibility', 'CAD/CAE', 'Risk Analysis', 'V&V Testing'],
    mustHaveKeywords: ['medical device', 'FDA', 'regulatory', 'clinical', 'quality', 'design controls', 'validation', 'biocompatibility'],
    resumeTips: [
      'Highlight FDA clearances (510(k), PMA) achieved',
      'Show design control and quality system experience',
      'Quantify devices launched and patient impact',
      'Include specific device classes and therapeutic areas'
    ],
    bulletExamples: [
      { weak: 'Designed medical devices', strong: 'Led R&D for Class II cardiac monitoring device, achieving FDA 510(k) clearance in 8 months and $10M first-year revenue' },
      { weak: 'Conducted device testing', strong: 'Developed V&V protocol for implantable device, ensuring 100% compliance with ISO 13485 and zero audit findings' }
    ],
    keyMetrics: ['FDA clearances', 'Devices launched', 'Patient lives impacted', 'Audit findings', 'Time to market'],
    commonMistakes: [
      'Not mentioning FDA clearances achieved',
      'Missing device class and therapeutic area',
      'Vague "medical device experience" without outcomes',
      'Not showing regulatory and quality expertise'
    ],
    interviewTopics: ['Design controls', 'Regulatory strategy', 'Risk management', 'Clinical requirements', 'Quality system compliance'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Regulatory Experience', 'Technical Skills', 'Education'], differentiators: ['FDA clearances', 'Device class experience', 'Quality system expertise', 'Clinical trial support'], avgBulletCount: 4, certificationRate: 50, portfolioRate: 15, metricsRate: 82 }
  },
  industrial_engineer: {
    name: 'Industrial Engineer',
    aliases: ['manufacturing engineer', 'process improvement engineer', 'lean engineer', 'continuous improvement engineer', 'ie', 'operations engineer'],
    keySkills: ['Lean Manufacturing', 'Six Sigma', 'Process Optimization', 'Time Studies', 'Facility Layout', 'Capacity Planning', 'Quality Engineering', 'Automation'],
    mustHaveKeywords: ['lean', 'six sigma', 'process improvement', 'efficiency', 'capacity', 'quality', 'automation', 'manufacturing'],
    resumeTips: [
      'Include Six Sigma certification (Green/Black Belt)',
      'Quantify efficiency gains and cost savings',
      'Show before/after metrics for improvements',
      'Highlight team leadership on kaizen events'
    ],
    bulletExamples: [
      { weak: 'Improved manufacturing processes', strong: 'Led kaizen event reducing assembly time by 35% and eliminating $800K in annual labor costs' },
      { weak: 'Analyzed production efficiency', strong: 'Implemented lean cell design increasing throughput by 50% while reducing floor space by 2,000 sq ft' }
    ],
    keyMetrics: ['Efficiency improvement %', 'Cost savings', 'Cycle time reduction', 'Quality improvement', 'Capacity increase'],
    commonMistakes: [
      'Not listing Six Sigma certification level',
      'Missing quantified improvement metrics',
      'Vague "improved efficiency" without numbers',
      'Not showing methodology used (Lean, Six Sigma)'
    ],
    interviewTopics: ['Lean/Six Sigma methodology', 'Process improvement examples', 'Time studies', 'Facility layout', 'Change management'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Certifications', 'Technical Skills', 'Education'], differentiators: ['Six Sigma belt level', 'Cost savings achievements', 'Efficiency improvements', 'Lean implementation'], avgBulletCount: 4, certificationRate: 70, portfolioRate: 10, metricsRate: 92 }
  },
  environmental_engineer: {
    name: 'Environmental Engineer',
    aliases: ['sustainability engineer', 'water resources engineer', 'remediation engineer', 'air quality engineer', 'waste management engineer', 'pe environmental'],
    keySkills: ['Environmental Compliance', 'Remediation', 'Water/Wastewater', 'Air Quality', 'Sustainability', 'Permitting', 'GIS', 'Environmental Impact Assessment'],
    mustHaveKeywords: ['environmental', 'compliance', 'remediation', 'sustainability', 'permitting', 'water quality', 'air quality', 'regulations'],
    resumeTips: [
      'Include PE license prominently',
      'Quantify environmental impact (emissions reduced, sites remediated)',
      'Show regulatory compliance achievements',
      'Highlight sustainability initiatives and metrics'
    ],
    bulletExamples: [
      { weak: 'Worked on environmental projects', strong: 'Designed stormwater management system for 500-acre development, achieving zero discharge violations over 5 years' },
      { weak: 'Conducted site assessments', strong: 'Led $5M brownfield remediation project, achieving regulatory closure 6 months ahead of schedule' }
    ],
    keyMetrics: ['Sites remediated', 'Emissions reduction %', 'Compliance rate', 'Project budget', 'Permit approvals'],
    commonMistakes: [
      'Not including PE license',
      'Missing quantified environmental impact',
      'Vague "environmental compliance" without specifics',
      'Not showing regulatory expertise'
    ],
    interviewTopics: ['Regulatory knowledge', 'Remediation approaches', 'Sustainability strategies', 'Permitting process', 'Stakeholder management'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Licenses', 'Technical Skills', 'Education'], differentiators: ['PE license', 'Environmental impact metrics', 'Regulatory compliance', 'Sustainability achievements'], avgBulletCount: 4, certificationRate: 65, portfolioRate: 10, metricsRate: 80 }
  },
  solutions_architect: {
    name: 'Solutions Architect',
    aliases: ['enterprise architect', 'technical architect', 'aws solutions architect', 'azure solutions architect', 'cloud architect', 'senior architect', 'principal architect'],
    keySkills: ['Cloud Architecture', 'System Design', 'AWS/Azure/GCP', 'Technical Leadership', 'Stakeholder Management', 'Integration Patterns', 'Security Architecture', 'Cost Optimization'],
    mustHaveKeywords: ['architecture', 'cloud', 'design', 'scalability', 'integration', 'enterprise', 'solutions', 'technical leadership'],
    resumeTips: [
      'Include cloud certifications prominently (AWS SAA/SAP, Azure)',
      'Quantify system scale and business impact',
      'Show cross-functional collaboration and leadership',
      'Highlight cost optimization and efficiency gains'
    ],
    bulletExamples: [
      { weak: 'Designed cloud solutions', strong: 'Architected multi-region AWS infrastructure supporting 10M+ users with 99.99% availability and 40% cost reduction' },
      { weak: 'Worked with stakeholders on technical requirements', strong: 'Led technical discovery for $50M digital transformation, defining architecture for 15 microservices adopted across 3 business units' }
    ],
    keyMetrics: ['System scale (users/transactions)', 'Cost savings %', 'Availability %', 'Projects delivered', 'Teams influenced'],
    commonMistakes: [
      'Not including cloud certifications',
      'Missing scale and performance metrics',
      'Vague "designed architecture" without outcomes',
      'Not showing stakeholder influence'
    ],
    interviewTopics: ['System design', 'Cloud services deep-dive', 'Trade-off analysis', 'Cost optimization', 'Technical leadership scenarios'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Certifications', 'Technical Skills', 'Education'], differentiators: ['AWS/Azure/GCP certifications', 'System scale metrics', 'Cost optimization results', 'Architecture diagrams'], avgBulletCount: 4, certificationRate: 85, portfolioRate: 30, metricsRate: 88 }
  },
  cloud_engineer: {
    name: 'Cloud Engineer',
    aliases: ['cloud infrastructure engineer', 'cloud operations engineer', 'aws engineer', 'azure engineer', 'gcp engineer', 'cloud administrator', 'cloud specialist'],
    keySkills: ['AWS/Azure/GCP', 'Terraform/IaC', 'Kubernetes', 'CI/CD', 'Networking', 'Security', 'Monitoring', 'Cost Management'],
    mustHaveKeywords: ['cloud', 'infrastructure', 'terraform', 'kubernetes', 'aws', 'azure', 'automation', 'deployment'],
    resumeTips: [
      'Include cloud certifications (AWS, Azure, GCP)',
      'Quantify infrastructure scale and cost savings',
      'Show automation and IaC achievements',
      'Highlight uptime and reliability metrics'
    ],
    bulletExamples: [
      { weak: 'Managed cloud infrastructure', strong: 'Managed AWS infrastructure with 500+ EC2 instances, achieving 99.99% uptime and reducing monthly costs by $100K through optimization' },
      { weak: 'Used Terraform for infrastructure', strong: 'Implemented Terraform-based IaC for 20+ environments, reducing provisioning time from 2 weeks to 2 hours' }
    ],
    keyMetrics: ['Uptime %', 'Cost savings ($)', 'Infrastructure scale', 'Deployment frequency', 'Provisioning time reduction'],
    commonMistakes: [
      'Not including cloud certifications',
      'Missing infrastructure scale metrics',
      'Vague "managed cloud" without specifics',
      'Not showing automation achievements'
    ],
    interviewTopics: ['Cloud services knowledge', 'IaC best practices', 'Networking and security', 'Cost optimization', 'Troubleshooting scenarios'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Certifications', 'Technical Skills', 'Education'], differentiators: ['Cloud certifications', 'Infrastructure scale', 'Automation achievements', 'Cost savings'], avgBulletCount: 4, certificationRate: 80, portfolioRate: 35, metricsRate: 88 }
  },
  cloud_administrator: {
    name: 'Cloud Administrator',
    aliases: ['cloud admin', 'cloud operations engineer', 'cloud ops', 'aws administrator', 'azure administrator', 'gcp administrator', 'cloud infrastructure admin', 'cloud support engineer'],
    keySkills: ['AWS/Azure/GCP', 'Cloud Security', 'Cost Management', 'IAM', 'Monitoring & Logging', 'Automation', 'Networking', 'Compliance', 'Disaster Recovery'],
    mustHaveKeywords: ['cloud', 'AWS', 'Azure', 'GCP', 'administration', 'security', 'cost', 'IAM', 'monitoring', 'infrastructure'],
    resumeTips: [
      'Include cloud certifications prominently',
      'Quantify cost savings and optimization results',
      'Show security and compliance achievements',
      'Highlight automation and operational efficiency'
    ],
    bulletExamples: [
      { weak: 'Managed cloud infrastructure', strong: 'Administered AWS environment with 500+ EC2 instances across 3 regions, achieving 99.99% uptime and reducing monthly costs by $150K through rightsizing' },
      { weak: 'Handled cloud security', strong: 'Implemented IAM policies and security controls for 200+ users, achieving SOC 2 compliance with zero audit findings' }
    ],
    keyMetrics: ['Cloud spend optimization', 'Uptime %', 'Resources managed', 'Compliance achievements', 'Incident response time', 'Automation coverage'],
    commonMistakes: [
      'Not including cloud certifications',
      'Missing cost optimization metrics',
      'Vague "managed cloud" without scale',
      'Not showing security and compliance experience'
    ],
    interviewTopics: ['Cloud architecture', 'Cost optimization strategies', 'Security best practices', 'IAM design', 'Disaster recovery', 'Monitoring and alerting'],
    topResumeElements: {
      sections: ['Certifications', 'Technical Skills', 'Cloud Experience', 'Projects', 'Education'],
      differentiators: ['Cloud certifications (AWS SAA, Azure Admin)', 'Cost savings achievements', 'Security/compliance expertise', 'Multi-cloud experience'],
      avgBulletCount: 4,
      certificationRate: 85,
      portfolioRate: 25,
      metricsRate: 88
    }
  },
  database_administrator: {
    name: 'Database Administrator',
    aliases: ['dba', 'senior dba', 'database engineer', 'data platform engineer', 'oracle dba', 'sql server dba', 'mysql dba', 'postgres dba'],
    keySkills: ['SQL', 'Database Design', 'Performance Tuning', 'Backup & Recovery', 'High Availability', 'Security', 'Replication', 'Cloud Databases'],
    mustHaveKeywords: ['database', 'sql', 'performance tuning', 'backup', 'recovery', 'replication', 'high availability', 'optimization'],
    resumeTips: [
      'Include database certifications (Oracle, Microsoft, AWS)',
      'Quantify database sizes and performance improvements',
      'Show uptime and disaster recovery achievements',
      'Highlight automation and cost optimization'
    ],
    bulletExamples: [
      { weak: 'Managed company databases', strong: 'Administered 50+ production databases (20TB+) with 99.99% uptime, supporting 5,000+ concurrent users' },
      { weak: 'Optimized database performance', strong: 'Reduced query response times by 80% through index optimization and query tuning, improving application performance for 1M+ users' }
    ],
    keyMetrics: ['Database size (TB)', 'Uptime %', 'Query performance improvement', 'Recovery time (RTO/RPO)', 'Concurrent users supported'],
    commonMistakes: [
      'Not including database certifications',
      'Missing database scale and size metrics',
      'Vague "managed databases" without specifics',
      'Not showing performance tuning results'
    ],
    interviewTopics: ['SQL proficiency', 'Performance tuning techniques', 'Backup/recovery scenarios', 'High availability design', 'Troubleshooting'],
    topResumeElements: { sections: ['Summary', 'Experience', 'Certifications', 'Technical Skills', 'Education'], differentiators: ['Database certifications (Oracle, Microsoft)', 'Database scale', 'Performance improvements', 'Uptime achievements'], avgBulletCount: 4, certificationRate: 70, portfolioRate: 10, metricsRate: 85 }
  },
  technical_writer: {
    name: 'Technical Writer',
    aliases: ['tech writer', 'documentation specialist', 'content developer', 'information developer', 'api writer', 'senior technical writer', 'lead technical writer', 'technical author'],
    keySkills: ['Technical Documentation', 'API Documentation', 'User Guides', 'DITA/Markdown', 'Content Management', 'Information Architecture', 'Developer Docs', 'Style Guides'],
    mustHaveKeywords: ['documentation', 'technical writing', 'user guides', 'API', 'content', 'tutorials', 'knowledge base', 'style guide', 'DITA', 'markdown'],
    resumeTips: [
      'Include links to published documentation samples',
      'Quantify documentation impact (support tickets, user adoption)',
      'Show collaboration with engineering teams',
      'Highlight tools and documentation systems used'
    ],
    bulletExamples: [
      { weak: 'Wrote technical documentation', strong: 'Created API documentation for 200+ endpoints, reducing developer onboarding time by 50% and support tickets by 40%' },
      { weak: 'Maintained user guides', strong: 'Authored 150+ knowledge base articles with 500K+ annual views, achieving 4.5/5 user helpfulness rating' }
    ],
    keyMetrics: ['Documentation coverage', 'Support ticket reduction', 'User satisfaction rating', 'Page views/engagement', 'Onboarding time reduction', 'Articles published'],
    commonMistakes: [
      'Not including writing samples or portfolio',
      'Missing impact metrics on user experience',
      'Vague "wrote documentation" without specifics',
      'Not showing collaboration with SMEs'
    ],
    interviewTopics: ['Documentation process', 'Working with engineers', 'Handling complex technical concepts', 'Tools and workflows', 'Style guide development', 'User feedback incorporation'],
    topResumeElements: {
      sections: ['Writing Samples', 'Technical Writing Experience', 'Tools & Technologies', 'Skills', 'Education'],
      differentiators: ['Published documentation portfolio', 'Measurable user impact', 'API documentation expertise', 'Developer docs experience'],
      avgBulletCount: 4,
      certificationRate: 30,
      portfolioRate: 95,
      metricsRate: 72
    }
  },
  documentation_engineer: {
    name: 'Documentation Engineer',
    aliases: ['docs engineer', 'developer documentation engineer', 'docs as code engineer', 'documentation developer', 'technical documentation engineer', 'docs tooling engineer'],
    keySkills: ['Docs-as-Code', 'Static Site Generators', 'Git/GitHub', 'CI/CD for Docs', 'API Reference Generation', 'Markdown/MDX', 'Documentation Platforms', 'Automation'],
    mustHaveKeywords: ['documentation', 'docs-as-code', 'automation', 'API reference', 'static site', 'CI/CD', 'developer experience', 'tooling', 'Git'],
    resumeTips: [
      'Show docs tooling and automation achievements',
      'Quantify developer experience improvements',
      'Highlight docs platform architecture',
      'Include open source docs contributions'
    ],
    bulletExamples: [
      { weak: 'Built documentation system', strong: 'Architected docs-as-code platform processing 500+ pages with automated API reference generation, reducing docs deployment time from 2 hours to 5 minutes' },
      { weak: 'Automated documentation workflows', strong: 'Built CI/CD pipeline for docs with automated link checking, versioning, and preview environments, eliminating 95% of broken link issues' }
    ],
    keyMetrics: ['Docs build/deploy time', 'Automation coverage', 'Developer adoption', 'Pages/endpoints documented', 'Error reduction', 'Contribution velocity'],
    commonMistakes: [
      'Focusing only on writing, not tooling',
      'Not showing automation achievements',
      'Missing docs platform architecture experience',
      'Not quantifying developer experience improvements'
    ],
    interviewTopics: ['Docs-as-code workflows', 'Static site generators', 'API documentation tools', 'CI/CD for docs', 'Developer experience', 'Documentation architecture'],
    topResumeElements: {
      sections: ['Technical Skills', 'Documentation Engineering Experience', 'Tools & Platforms', 'Projects', 'Education'],
      differentiators: ['Docs platform architecture', 'Automation achievements', 'Open source contributions', 'Developer experience metrics'],
      avgBulletCount: 4,
      certificationRate: 25,
      portfolioRate: 85,
      metricsRate: 80
    }
  },
  it_support_specialist: {
    name: 'IT Support Specialist',
    aliases: ['it support', 'it technician', 'desktop support', 'it specialist', 'technical support specialist', 'it support analyst', 'it support engineer', 'end user support'],
    keySkills: ['Troubleshooting', 'Windows/Mac/Linux', 'Active Directory', 'Ticketing Systems', 'Hardware Support', 'Software Installation', 'Remote Support', 'Customer Service'],
    mustHaveKeywords: ['support', 'troubleshooting', 'tickets', 'resolution', 'hardware', 'software', 'users', 'helpdesk', 'Active Directory', 'technical'],
    resumeTips: [
      'Quantify ticket volume and resolution rates',
      'Show first-call resolution improvements',
      'Include certifications (CompTIA A+, ITIL)',
      'Highlight customer satisfaction scores'
    ],
    bulletExamples: [
      { weak: 'Provided IT support to employees', strong: 'Resolved 50+ tickets daily for 1,500+ users, achieving 95% first-call resolution rate and 4.8/5 satisfaction score' },
      { weak: 'Fixed hardware and software issues', strong: 'Reduced average ticket resolution time from 4 hours to 45 minutes through knowledge base development and process automation' }
    ],
    keyMetrics: ['Tickets resolved/day', 'First-call resolution %', 'Customer satisfaction', 'Average resolution time', 'Users supported', 'SLA compliance'],
    commonMistakes: [
      'Not quantifying ticket volume and resolution',
      'Missing customer satisfaction metrics',
      'Vague "provided support" without specifics',
      'Not including IT certifications'
    ],
    interviewTopics: ['Troubleshooting scenarios', 'Customer service approach', 'Prioritization', 'Technical knowledge', 'Handling difficult users', 'Process improvement'],
    topResumeElements: {
      sections: ['Certifications', 'IT Support Experience', 'Technical Skills', 'Education', 'Achievements'],
      differentiators: ['CompTIA A+/Network+', 'High resolution rates', 'Customer satisfaction scores', 'Process improvements'],
      avgBulletCount: 4,
      certificationRate: 70,
      portfolioRate: 10,
      metricsRate: 85
    }
  },
  help_desk_analyst: {
    name: 'Help Desk Analyst',
    aliases: ['help desk technician', 'help desk specialist', 'service desk analyst', 'tier 1 support', 'tier 2 support', 'help desk support', 'service desk technician', 'it help desk'],
    keySkills: ['Ticket Management', 'Phone Support', 'Remote Troubleshooting', 'ServiceNow/Zendesk', 'Knowledge Base', 'Escalation Procedures', 'SLA Management', 'User Training'],
    mustHaveKeywords: ['help desk', 'service desk', 'tickets', 'support', 'SLA', 'escalation', 'troubleshooting', 'users', 'resolution', 'customer service'],
    resumeTips: [
      'Show ticket metrics and SLA compliance',
      'Quantify call volume and handle time',
      'Highlight knowledge base contributions',
      'Include ITIL or service desk certifications'
    ],
    bulletExamples: [
      { weak: 'Answered help desk calls', strong: 'Handled 80+ calls daily with 3-minute average handle time, maintaining 98% SLA compliance and 92% customer satisfaction' },
      { weak: 'Created documentation', strong: 'Authored 50+ knowledge base articles reducing repeat tickets by 30% and enabling self-service resolution for common issues' }
    ],
    keyMetrics: ['Calls/tickets per day', 'Average handle time', 'SLA compliance %', 'Customer satisfaction', 'First-contact resolution', 'Knowledge articles created'],
    commonMistakes: [
      'Not including SLA and ticket metrics',
      'Missing call volume and handle time',
      'Vague "answered calls" without outcomes',
      'Not showing process improvements'
    ],
    interviewTopics: ['Customer service scenarios', 'Troubleshooting methodology', 'Handling escalations', 'SLA management', 'Prioritization', 'Stress management'],
    topResumeElements: {
      sections: ['IT Experience', 'Technical Skills', 'Certifications', 'Metrics/Achievements', 'Education'],
      differentiators: ['ITIL certification', 'High SLA compliance', 'Call metrics', 'Knowledge base contributions'],
      avgBulletCount: 4,
      certificationRate: 55,
      portfolioRate: 5,
      metricsRate: 90
    }
  },
  business_intelligence_analyst: {
    name: 'Business Intelligence Analyst',
    aliases: ['bi analyst', 'bi developer', 'business analyst', 'data analyst', 'reporting analyst', 'analytics analyst', 'tableau developer', 'power bi developer', 'insights analyst'],
    keySkills: ['SQL', 'Tableau/Power BI', 'Data Visualization', 'ETL', 'Data Modeling', 'Dashboard Development', 'Statistical Analysis', 'Stakeholder Communication', 'Excel'],
    mustHaveKeywords: ['BI', 'dashboard', 'reporting', 'SQL', 'Tableau', 'Power BI', 'analytics', 'insights', 'data visualization', 'KPIs'],
    resumeTips: [
      'Quantify business impact of insights delivered',
      'Show dashboard adoption and usage metrics',
      'Include specific BI tools and data volumes',
      'Highlight stakeholder collaboration and influence'
    ],
    bulletExamples: [
      { weak: 'Created dashboards for stakeholders', strong: 'Built executive dashboard suite used by 150+ stakeholders daily, surfacing insights that drove $5M in cost savings decisions' },
      { weak: 'Analyzed data and created reports', strong: 'Developed automated reporting pipeline processing 10M+ rows, reducing manual reporting time from 40 hours/week to 2 hours' }
    ],
    keyMetrics: ['Business impact ($)', 'Dashboard adoption', 'Reporting time saved', 'Data volume processed', 'Stakeholders served', 'Decision influence'],
    commonMistakes: [
      'Not quantifying business impact of insights',
      'Missing dashboard adoption metrics',
      'Vague "created reports" without outcomes',
      'Not showing stakeholder influence'
    ],
    interviewTopics: ['SQL proficiency', 'Dashboard design principles', 'Data storytelling', 'Stakeholder management', 'ETL processes', 'KPI definition'],
    topResumeElements: {
      sections: ['BI Experience', 'Technical Skills', 'Business Impact', 'Tools', 'Education'],
      differentiators: ['Business impact quantification', 'Dashboard portfolio', 'Stakeholder influence', 'Advanced SQL/data modeling'],
      avgBulletCount: 4,
      certificationRate: 45,
      portfolioRate: 60,
      metricsRate: 88
    }
  },
  research_scientist: {
    name: 'Research Scientist',
    aliases: ['researcher', 'scientist', 'research engineer', 'senior researcher', 'principal researcher', 'staff scientist', 'research associate', 'postdoc', 'postdoctoral researcher'],
    keySkills: ['Research Methodology', 'Data Analysis', 'Statistical Analysis', 'Technical Writing', 'Experimental Design', 'Peer Review', 'Grant Writing', 'Publication', 'Presentation', 'Collaboration'],
    mustHaveKeywords: ['research', 'publications', 'peer-reviewed', 'methodology', 'experiments', 'analysis', 'grants', 'findings', 'citations', 'conferences'],
    resumeTips: [
      'Lead with publication count and citation metrics',
      'Highlight grant funding secured',
      'Quantify research impact and real-world applications',
      'Show collaboration across institutions'
    ],
    bulletExamples: [
      { weak: 'Conducted research and published papers', strong: 'Led research program resulting in 15 peer-reviewed publications (h-index: 12), with findings adopted by 3 Fortune 500 companies' },
      { weak: 'Worked on grant proposals', strong: 'Secured $2.5M in competitive research funding across 4 NIH/NSF grants as PI or co-PI, achieving 40% success rate vs. 15% average' }
    ],
    keyMetrics: ['Publications', 'Citations/h-index', 'Grant funding ($)', 'Patents filed', 'Conference presentations', 'Industry adoptions'],
    commonMistakes: [
      'Not quantifying publication impact',
      'Missing grant funding amounts',
      'Vague research descriptions without outcomes',
      'Not showing real-world impact of research'
    ],
    interviewTopics: ['Research methodology', 'Publication record', 'Grant experience', 'Collaboration style', 'Future research directions', 'Technology transfer'],
    topResumeElements: {
      sections: ['Research Experience', 'Publications', 'Grants & Funding', 'Education', 'Skills', 'Presentations'],
      differentiators: ['High-impact publications', 'Significant grant funding', 'Industry partnerships', 'Patent portfolio'],
      avgBulletCount: 4,
      certificationRate: 20,
      portfolioRate: 30,
      metricsRate: 85
    }
  },
  ai_researcher: {
    name: 'AI Researcher',
    aliases: ['machine learning researcher', 'ml researcher', 'deep learning researcher', 'nlp researcher', 'computer vision researcher', 'ai scientist', 'ml scientist', 'research scientist ai', 'applied ai researcher'],
    keySkills: ['Machine Learning', 'Deep Learning', 'PyTorch/TensorFlow', 'Python', 'Research Methodology', 'Publication', 'Neural Networks', 'NLP', 'Computer Vision', 'Statistical Analysis'],
    mustHaveKeywords: ['AI', 'machine learning', 'deep learning', 'neural networks', 'publications', 'research', 'models', 'training', 'inference', 'benchmarks'],
    resumeTips: [
      'Lead with top-tier venue publications (NeurIPS, ICML, CVPR)',
      'Quantify model performance improvements',
      'Show real-world deployment impact',
      'Highlight novel contributions to the field'
    ],
    bulletExamples: [
      { weak: 'Developed machine learning models', strong: 'Published 8 papers at top-tier venues (NeurIPS, ICML, ICLR) with 500+ citations, introducing novel attention mechanism adopted by 10+ research groups' },
      { weak: 'Improved model performance', strong: 'Developed transformer architecture achieving state-of-the-art on 3 NLP benchmarks, reducing inference latency 40% while improving accuracy 5.2%' }
    ],
    keyMetrics: ['Top-tier publications', 'Citations', 'Model performance (accuracy, F1)', 'Inference speed', 'Training efficiency', 'Benchmark rankings'],
    commonMistakes: [
      'Not highlighting publication venues',
      'Missing quantified model improvements',
      'Vague "worked on AI" without specifics',
      'Not showing novelty of contributions'
    ],
    interviewTopics: ['Research contributions', 'Technical depth', 'Publication record', 'Latest AI trends', 'Model architecture decisions', 'Scaling challenges'],
    topResumeElements: {
      sections: ['Research Experience', 'Publications', 'Technical Skills', 'Education', 'Projects', 'Presentations'],
      differentiators: ['Top-tier publications', 'Novel contributions', 'Industry impact', 'Open-source contributions'],
      avgBulletCount: 4,
      certificationRate: 15,
      portfolioRate: 70,
      metricsRate: 90
    }
  }
};

// Get role-specific advice
export function getRoleAdvice(role: string): RoleConfig | null {
  if (!role) return null;
  const normalizedRole = role.toLowerCase().trim();
  
  // Direct match or alias match
  for (const [key, config] of Object.entries(ROLE_CONFIGS)) {
    if (normalizedRole.includes(config.name.toLowerCase()) || 
        config.aliases.some(alias => normalizedRole.includes(alias.toLowerCase()))) {
      return config;
    }
  }
  
  // Keyword-based matching
  if (normalizedRole.includes('product') && normalizedRole.includes('manager')) return ROLE_CONFIGS.product_manager;
  if (normalizedRole.includes('software') || normalizedRole.includes('developer') || normalizedRole.includes('engineer')) return ROLE_CONFIGS.software_engineer;
  if (normalizedRole.includes('data') && (normalizedRole.includes('scientist') || normalizedRole.includes('analyst'))) return ROLE_CONFIGS.data_scientist;
  if (normalizedRole.includes('nurse') || normalizedRole.includes('rn') || normalizedRole.includes('nursing')) return ROLE_CONFIGS.nurse;
  if (normalizedRole.includes('marketing')) return ROLE_CONFIGS.marketing_manager;
  if (normalizedRole.includes('sales') || normalizedRole.includes('account executive') || normalizedRole.includes('bdr') || normalizedRole.includes('sdr')) return ROLE_CONFIGS.sales_representative;
  if (normalizedRole.includes('project') && normalizedRole.includes('manager')) return ROLE_CONFIGS.project_manager;
  if (normalizedRole.includes('ux') || normalizedRole.includes('ui') || normalizedRole.includes('designer')) return ROLE_CONFIGS.ux_designer;
  if (normalizedRole.includes('accountant') || normalizedRole.includes('cpa') || normalizedRole.includes('controller')) return ROLE_CONFIGS.accountant;
  if (normalizedRole.includes('teacher') || normalizedRole.includes('educator') || normalizedRole.includes('professor')) return ROLE_CONFIGS.teacher;
  if (normalizedRole.includes('hr') || normalizedRole.includes('human resources') || normalizedRole.includes('people operations') || normalizedRole.includes('hrbp')) return ROLE_CONFIGS.hr_manager;
  if (normalizedRole.includes('financial analyst') || normalizedRole.includes('fp&a') || normalizedRole.includes('finance analyst')) return ROLE_CONFIGS.financial_analyst;
  if (normalizedRole.includes('customer success') || normalizedRole.includes('csm') || normalizedRole.includes('client success')) return ROLE_CONFIGS.customer_success;
  if (normalizedRole.includes('operations') && normalizedRole.includes('manager')) return ROLE_CONFIGS.operations_manager;
  if (normalizedRole.includes('executive assistant') || normalizedRole.includes('ea') || normalizedRole.includes('admin assistant')) return ROLE_CONFIGS.executive_assistant;
  if (normalizedRole.includes('business analyst') || normalizedRole.includes('ba') || normalizedRole.includes('requirements analyst')) return ROLE_CONFIGS.business_analyst;
  if (normalizedRole.includes('devops') || normalizedRole.includes('sre') || normalizedRole.includes('site reliability') || normalizedRole.includes('platform engineer')) return ROLE_CONFIGS.devops_engineer;
  if (normalizedRole.includes('qa') || normalizedRole.includes('quality assurance') || normalizedRole.includes('test engineer') || normalizedRole.includes('sdet')) return ROLE_CONFIGS.qa_engineer;
  if (normalizedRole.includes('recruiter') || normalizedRole.includes('talent acquisition') || normalizedRole.includes('sourcer')) return ROLE_CONFIGS.recruiter;
  if (normalizedRole.includes('content writer') || normalizedRole.includes('copywriter') || normalizedRole.includes('content creator') || normalizedRole.includes('technical writer')) return ROLE_CONFIGS.content_writer;
  if (normalizedRole.includes('graphic designer') || normalizedRole.includes('visual designer') || normalizedRole.includes('brand designer')) return ROLE_CONFIGS.graphic_designer;
  if (normalizedRole.includes('pharmacist') || normalizedRole.includes('pharm.d') || normalizedRole.includes('pharmacy')) return ROLE_CONFIGS.pharmacist;
  if (normalizedRole.includes('social media') || normalizedRole.includes('community manager')) return ROLE_CONFIGS.social_media_manager;
  if (normalizedRole.includes('architect') && !normalizedRole.includes('software') && !normalizedRole.includes('solutions')) return ROLE_CONFIGS.architect;
  if (normalizedRole.includes('physical therapist') || normalizedRole.includes('physiotherapist') || normalizedRole.includes('pt') || normalizedRole.includes('dpt')) return ROLE_CONFIGS.physical_therapist;
  if (normalizedRole.includes('supply chain') || normalizedRole.includes('logistics') || normalizedRole.includes('procurement')) return ROLE_CONFIGS.supply_chain_manager;
  if (normalizedRole.includes('attorney') || normalizedRole.includes('lawyer') || normalizedRole.includes('legal counsel') || normalizedRole.includes('litigator')) return ROLE_CONFIGS.attorney;
  if (normalizedRole.includes('chef') || normalizedRole.includes('culinary') || normalizedRole.includes('kitchen')) return ROLE_CONFIGS.chef;
  if (normalizedRole.includes('real estate') || normalizedRole.includes('realtor') || normalizedRole.includes('property agent')) return ROLE_CONFIGS.real_estate_agent;
  if (normalizedRole.includes('mechanical engineer') || normalizedRole.includes('hvac engineer') || normalizedRole.includes('manufacturing engineer')) return ROLE_CONFIGS.mechanical_engineer;
  if (normalizedRole.includes('robotics') || normalizedRole.includes('automation engineer') || normalizedRole.includes('controls engineer') || normalizedRole.includes('mechatronics')) return ROLE_CONFIGS.robotics_engineer;
  if (normalizedRole.includes('machine learning') || normalizedRole.includes('ml engineer') || normalizedRole.includes('ai engineer') || normalizedRole.includes('deep learning') || normalizedRole.includes('nlp engineer')) return ROLE_CONFIGS.ai_ml_engineer;
  if (normalizedRole.includes('dentist') || normalizedRole.includes('dds') || normalizedRole.includes('dmd') || normalizedRole.includes('orthodontist')) return ROLE_CONFIGS.dentist;
  if (normalizedRole.includes('veterinarian') || normalizedRole.includes('vet') || normalizedRole.includes('dvm')) return ROLE_CONFIGS.veterinarian;
  if (normalizedRole.includes('civil engineer') || normalizedRole.includes('structural engineer') || normalizedRole.includes('transportation engineer')) return ROLE_CONFIGS.civil_engineer;
  if (normalizedRole.includes('data engineer') || normalizedRole.includes('etl') || normalizedRole.includes('analytics engineer') || normalizedRole.includes('data platform')) return ROLE_CONFIGS.data_engineer;
  if (normalizedRole.includes('security analyst') || normalizedRole.includes('cybersecurity') || normalizedRole.includes('soc analyst') || normalizedRole.includes('penetration tester')) return ROLE_CONFIGS.security_analyst;
  if (normalizedRole.includes('paralegal') || normalizedRole.includes('legal assistant') || normalizedRole.includes('law clerk')) return ROLE_CONFIGS.paralegal;
  if (normalizedRole.includes('event planner') || normalizedRole.includes('event coordinator') || normalizedRole.includes('wedding planner') || normalizedRole.includes('meeting planner')) return ROLE_CONFIGS.event_planner;
  if (normalizedRole.includes('electrician') || normalizedRole.includes('electrical technician')) return ROLE_CONFIGS.electrician;
  if (normalizedRole.includes('insurance agent') || normalizedRole.includes('insurance broker') || normalizedRole.includes('insurance producer')) return ROLE_CONFIGS.insurance_agent;
  if (normalizedRole.includes('physician') || normalizedRole.includes('doctor') || normalizedRole.includes('md') || normalizedRole.includes('hospitalist')) return ROLE_CONFIGS.physician;
  if (normalizedRole.includes('flight attendant') || normalizedRole.includes('cabin crew') || normalizedRole.includes('inflight')) return ROLE_CONFIGS.flight_attendant;
  if (normalizedRole.includes('truck driver') || normalizedRole.includes('cdl driver') || normalizedRole.includes('commercial driver') || normalizedRole.includes('otr driver')) return ROLE_CONFIGS.truck_driver;
  if (normalizedRole.includes('data analyst') || normalizedRole.includes('reporting analyst') || normalizedRole.includes('insights analyst')) return ROLE_CONFIGS.data_analyst;
  if (normalizedRole.includes('business intelligence') || normalizedRole.includes('bi analyst') || normalizedRole.includes('bi developer')) return ROLE_CONFIGS.bi_analyst;
  if (normalizedRole.includes('quant') || normalizedRole.includes('quantitative analyst') || normalizedRole.includes('algorithmic trader')) return ROLE_CONFIGS.quantitative_analyst;
  if (normalizedRole.includes('electrical engineer') || normalizedRole.includes('electronics engineer') || normalizedRole.includes('hardware engineer') || normalizedRole.includes('pcb')) return ROLE_CONFIGS.electrical_engineer;
  if (normalizedRole.includes('chemical engineer') || normalizedRole.includes('process engineer') || normalizedRole.includes('petrochemical')) return ROLE_CONFIGS.chemical_engineer;
  if (normalizedRole.includes('aerospace') || normalizedRole.includes('aeronautical') || normalizedRole.includes('aircraft engineer') || normalizedRole.includes('avionics')) return ROLE_CONFIGS.aerospace_engineer;
  if (normalizedRole.includes('biomedical') || normalizedRole.includes('medical device') || normalizedRole.includes('clinical engineer')) return ROLE_CONFIGS.biomedical_engineer;
  if (normalizedRole.includes('industrial engineer') || normalizedRole.includes('lean engineer') || normalizedRole.includes('continuous improvement')) return ROLE_CONFIGS.industrial_engineer;
  if (normalizedRole.includes('environmental engineer') || normalizedRole.includes('sustainability engineer') || normalizedRole.includes('remediation')) return ROLE_CONFIGS.environmental_engineer;
  if (normalizedRole.includes('solutions architect') || normalizedRole.includes('enterprise architect') || normalizedRole.includes('technical architect')) return ROLE_CONFIGS.solutions_architect;
  if (normalizedRole.includes('cloud engineer') || normalizedRole.includes('cloud infrastructure') || normalizedRole.includes('cloud operations')) return ROLE_CONFIGS.cloud_engineer;
  if (normalizedRole.includes('network engineer') || normalizedRole.includes('network admin') || normalizedRole.includes('network architect')) return ROLE_CONFIGS.network_engineer;
  if (normalizedRole.includes('dba') || normalizedRole.includes('database admin') || normalizedRole.includes('database engineer')) return ROLE_CONFIGS.database_administrator;
  
  return null;
}

export const GEOGRAPHIC_CONFIGS: Record<string, GeographicConfig> = {
  us: {
    region: 'us',
    name: 'United States',
    documentName: 'Resume',
    formatPreferences: [
      'One page strongly preferred for most roles',
      'No photo required (and often discouraged)',
      'Bullet points with action verbs and metrics',
      'Skills section near top for tech roles'
    ],
    includePhoto: false,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City/State (no full address)'],
    excludeInfo: ['Photo', 'Date of birth', 'Marital status', 'Nationality', 'Full address'],
    lengthGuidelines: '1 page for <10 years experience, 2 pages max for senior roles',
    culturalTips: [
      'Be direct and confident—"I led" not "I helped lead"',
      'Quantify everything possible with specific numbers',
      'Use action verbs at the start of each bullet',
      'Focus on achievements over responsibilities'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Resume' },
      { us: 'GPA', local: 'GPA' },
      { us: 'Cell phone', local: 'Cell phone' }
    ]
  },
  uk: {
    region: 'uk',
    name: 'United Kingdom',
    documentName: 'CV',
    formatPreferences: [
      'Two pages is standard and acceptable',
      'Personal statement/profile at the top',
      'No photo typically required',
      'Education section more prominent'
    ],
    includePhoto: false,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'Town/City'],
    excludeInfo: ['Photo', 'Date of birth', 'Marital status', 'Nationality'],
    lengthGuidelines: '2 pages is standard, can extend to 3 for very senior roles',
    culturalTips: [
      'Include a personal statement/profile summary',
      'Be slightly more modest than US style',
      'Include "References available upon request"',
      'Spell out qualifications in full (e.g., "Bachelor of Arts")'
    ],
    commonTerms: [
      { us: 'Resume', local: 'CV' },
      { us: 'GPA', local: 'Degree classification (First, 2:1, etc.)' },
      { us: 'Cell phone', local: 'Mobile' }
    ]
  },
  eu: {
    region: 'eu',
    name: 'European Union',
    documentName: 'CV',
    formatPreferences: [
      'Europass CV format widely recognized',
      'Photo often expected (especially DE, FR, ES)',
      'Two pages standard',
      'Language skills section important'
    ],
    includePhoto: true,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City', 'Nationality', 'Languages'],
    excludeInfo: ['Marital status', 'Religion'],
    lengthGuidelines: '2 pages standard, Europass format recommended for cross-border applications',
    culturalTips: [
      'Include professional photo (passport-style)',
      'List language proficiencies with CEFR levels (A1-C2)',
      'Mention visa/work authorization status if relevant',
      'Consider Europass format for pan-European applications'
    ],
    commonTerms: [
      { us: 'Resume', local: 'CV / Lebenslauf / Currículum' },
      { us: 'GPA', local: 'Degree grade or ECTS credits' },
      { us: 'Cell phone', local: 'Mobile / Handy / Móvil' }
    ]
  },
  de: {
    region: 'de',
    name: 'Germany',
    documentName: 'Lebenslauf',
    formatPreferences: [
      'Tabular format (tabellarischer Lebenslauf) preferred',
      'Professional photo expected and important',
      'Chronological order (newest first)',
      'Detailed education and certification section'
    ],
    includePhoto: true,
    includePersonalInfo: ['Email', 'Phone', 'Photo', 'City', 'Date of birth', 'Nationality'],
    excludeInfo: ['Marital status', 'Religion', 'Parents\' occupations'],
    lengthGuidelines: '2 pages standard, tabular format preferred',
    culturalTips: [
      'Include a professional Bewerbungsfoto (application photo)',
      'List exact dates (day/month/year) for all positions',
      'Include all education from university onwards',
      'Sign and date your CV at the bottom'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Lebenslauf' },
      { us: 'Cover letter', local: 'Anschreiben' },
      { us: 'References', local: 'Referenzen / Arbeitszeugnisse' }
    ]
  },
  au: {
    region: 'au',
    name: 'Australia',
    documentName: 'Resume/CV',
    formatPreferences: [
      'Two to three pages acceptable',
      'No photo required',
      'Skills-based or chronological format',
      'Include referees section'
    ],
    includePhoto: false,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City/State', 'Visa status if applicable'],
    excludeInfo: ['Photo', 'Date of birth', 'Marital status', 'Religion'],
    lengthGuidelines: '2-3 pages acceptable, 4+ for academic CVs',
    culturalTips: [
      'Include 2-3 referees with contact details',
      'Mention visa/work rights if not a citizen',
      'Key Selection Criteria responses often required for government roles',
      'Balance confidence with humility'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Resume or CV (interchangeable)' },
      { us: 'GPA', local: 'WAM (Weighted Average Mark)' },
      { us: 'Cell phone', local: 'Mobile' }
    ]
  },
  in: {
    region: 'in',
    name: 'India',
    documentName: 'Resume/CV',
    formatPreferences: [
      'Two to three pages common',
      'Photo sometimes included',
      'Detailed education section important',
      'Declaration section at the end'
    ],
    includePhoto: true,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City', 'Date of birth'],
    excludeInfo: ['Marital status', 'Religion', 'Caste'],
    lengthGuidelines: '2-3 pages common, detailed education section expected',
    culturalTips: [
      'Include percentage/CGPA scores for education',
      'List all technical certifications',
      'Add a declaration: "I hereby declare that the above information is true..."',
      'Notice period/expected joining date often included'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Resume / Biodata' },
      { us: 'GPA', local: 'CGPA / Percentage' },
      { us: 'Internship', local: 'Industrial Training / Internship' }
    ]
  },
  ca: {
    region: 'ca',
    name: 'Canada',
    documentName: 'Resume',
    formatPreferences: [
      'Similar to US style, one to two pages',
      'No photo required',
      'Bilingual resumes valued in Quebec',
      'Skills summary section common'
    ],
    includePhoto: false,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City/Province'],
    excludeInfo: ['Photo', 'Date of birth', 'Marital status', 'SIN number'],
    lengthGuidelines: '1-2 pages, similar to US standards',
    culturalTips: [
      'Consider bilingual French/English for Quebec roles',
      'Include Canadian work authorization if applicable',
      'Government roles may require specific formats',
      'List volunteer experience—highly valued in Canada'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Resume (CV in Quebec)' },
      { us: 'GPA', local: 'GPA / CGPA' },
      { us: 'Cell phone', local: 'Cell / Mobile' }
    ]
  },
  latam: {
    region: 'latam',
    name: 'Latin America',
    documentName: 'Currículum Vitae / Currículo',
    formatPreferences: [
      'Two to three pages is standard',
      'Photo often expected (especially AR, MX, BR)',
      'Personal information section common',
      'Chronological format preferred'
    ],
    includePhoto: true,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City', 'Nationality', 'Date of birth'],
    excludeInfo: ['Marital status', 'Religion', 'Political affiliation'],
    lengthGuidelines: '2-3 pages standard, more detailed than US resumes',
    culturalTips: [
      'Include a professional photo (formal attire)',
      'Personal connections and referrals are highly valued',
      'Mention language proficiencies prominently (English is a major asset)',
      'Include nationality and work authorization status'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Currículum Vitae (CV) / Currículo (BR)' },
      { us: 'Cover letter', local: 'Carta de presentación / Carta de apresentação' },
      { us: 'References', local: 'Referencias / Referências' }
    ]
  },
  br: {
    region: 'br',
    name: 'Brazil',
    documentName: 'Currículo',
    formatPreferences: [
      'Two pages is ideal',
      'Photo commonly included',
      'Objective statement at the top',
      'Personal data section standard'
    ],
    includePhoto: true,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City/State', 'CPF (optional)', 'Nationality'],
    excludeInfo: ['Marital status', 'Religion', 'Salary history'],
    lengthGuidelines: '2 pages ideal, focus on recent 10 years of experience',
    culturalTips: [
      'Include "Objetivo Profissional" (professional objective) at the top',
      'English proficiency is a major differentiator—always mention it',
      'List courses and certifications prominently',
      'Personal data section (dados pessoais) is expected'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Currículo' },
      { us: 'Work experience', local: 'Experiência Profissional' },
      { us: 'Education', local: 'Formação Acadêmica' }
    ]
  },
  mx: {
    region: 'mx',
    name: 'Mexico',
    documentName: 'Currículum Vitae',
    formatPreferences: [
      'Two to three pages common',
      'Photo usually expected',
      'Personal information section standard',
      'Chronological format preferred'
    ],
    includePhoto: true,
    includePersonalInfo: ['Email', 'Phone', 'LinkedIn', 'City', 'CURP (optional)', 'Nationality'],
    excludeInfo: ['Marital status', 'Religion'],
    lengthGuidelines: '2-3 pages standard, detailed education section',
    culturalTips: [
      'Include a professional, formal photo',
      'English proficiency is highly valued—always list it',
      'Certifications and courses are important differentiators',
      'Networking and personal referrals are culturally significant'
    ],
    commonTerms: [
      { us: 'Resume', local: 'Currículum Vitae (CV)' },
      { us: 'Work experience', local: 'Experiencia Laboral' },
      { us: 'Skills', local: 'Habilidades / Competencias' }
    ]
  }
};

// Detect user's geographic region from browser/locale
export function detectUserRegion(): string {
  if (typeof navigator === 'undefined') return 'us';
  
  const language = navigator.language || 'en-US';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  
  // Check timezone first for more accuracy
  if (timezone.includes('Europe/London') || timezone.includes('Europe/Dublin')) return 'uk';
  if (timezone.includes('Europe/Berlin') || timezone.includes('Europe/Vienna') || timezone.includes('Europe/Zurich')) return 'de';
  if (timezone.includes('Europe/')) return 'eu';
  if (timezone.includes('Australia/')) return 'au';
  if (timezone.includes('Asia/Kolkata') || timezone.includes('Asia/Calcutta')) return 'in';
  if (timezone.includes('America/Toronto') || timezone.includes('America/Vancouver') || timezone.includes('America/Montreal')) return 'ca';
  // South America / Latin America
  if (timezone.includes('America/Sao_Paulo') || timezone.includes('America/Brasilia') || timezone.includes('America/Fortaleza')) return 'br';
  if (timezone.includes('America/Mexico_City') || timezone.includes('America/Monterrey') || timezone.includes('America/Cancun')) return 'mx';
  if (timezone.includes('America/Buenos_Aires') || timezone.includes('America/Argentina') || 
      timezone.includes('America/Bogota') || timezone.includes('America/Lima') || 
      timezone.includes('America/Santiago') || timezone.includes('America/Montevideo') ||
      timezone.includes('America/Caracas')) return 'latam';
  if (timezone.includes('America/')) return 'us';
  
  // Fallback to language code
  const langCode = language.split('-')[1]?.toUpperCase() || language.split('-')[0]?.toUpperCase();
  if (langCode === 'GB' || langCode === 'UK') return 'uk';
  if (langCode === 'DE' || langCode === 'AT' || langCode === 'CH') return 'de';
  if (['FR', 'IT', 'NL', 'BE', 'PL'].includes(langCode)) return 'eu';
  if (langCode === 'AU') return 'au';
  if (langCode === 'IN') return 'in';
  if (langCode === 'CA') return 'ca';
  if (langCode === 'BR' || langCode === 'PT') return 'br';
  if (langCode === 'MX') return 'mx';
  if (['AR', 'CL', 'CO', 'PE', 'VE', 'UY', 'EC', 'PY', 'BO'].includes(langCode)) return 'latam';
  if (langCode === 'ES') return 'latam'; // Spanish speakers likely LATAM context
  
  return 'us'; // Default to US
}

// Get geographic advice based on region
export function getGeographicAdvice(region?: string, t?: TFn): GeographicConfig {
  const detectedRegion = region || detectUserRegion();
  const config = GEOGRAPHIC_CONFIGS[detectedRegion] || GEOGRAPHIC_CONFIGS.us;

  if (!t) return config;

  return {
    ...config,
    name: t(`personalization.geographic.${config.region}.name`, { defaultValue: config.name }) as string,
  };
}
