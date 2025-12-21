// Personalization configuration for industry-specific and experience-level advice

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
      'Include license numbers and certifications prominently',
      'Emphasize patient outcomes and safety metrics',
      'List specific equipment and systems experience',
      'Highlight continuing education and training'
    ],
    preferredFormat: 'Reverse chronological with certifications section',
    atsNotes: 'Healthcare uses iCIMS, Taleo heavily. Include exact certification names.',
    topSkills: ['Patient Assessment', 'Care Planning', 'Medical Terminology', 'EHR Systems'],
    certifications: ['RN', 'BSN', 'MSN', 'ACLS', 'BLS', 'CNA', 'LPN'],
    commonMistakes: [
      'Not including license numbers and expiration dates',
      'Missing HIPAA compliance mentions',
      'Vague patient care descriptions without outcomes',
      'Forgetting to list specific EHR/EMR systems used'
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
      'Include PE license if applicable',
      'List specific software and tools with versions',
      'Quantify project budgets, timelines, team sizes',
      'Highlight safety records and compliance'
    ],
    preferredFormat: 'Reverse chronological with technical skills section',
    atsNotes: 'Engineering firms use Taleo, Workday. Include exact software names.',
    topSkills: ['CAD Software', 'Project Management', 'Technical Documentation', 'Problem Solving'],
    certifications: ['PE', 'PMP', 'Six Sigma', 'LEED'],
    commonMistakes: [
      'Not mentioning PE license or EIT status',
      'Missing project budget and timeline details',
      'Vague technical descriptions without specifications',
      'Not highlighting safety and compliance achievements'
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
      'Include teaching certifications and endorsements',
      'Show student achievement data and improvements',
      'Highlight specialized training and methodologies',
      'List grade levels and subjects taught'
    ],
    preferredFormat: 'Reverse chronological with certifications prominent',
    atsNotes: 'School districts use varied systems. Keep format simple.',
    topSkills: ['Classroom Management', 'Curriculum Development', 'Assessment', 'Technology Integration'],
    certifications: ['State Teaching License', 'TESOL', 'Special Education Endorsement'],
    commonMistakes: [
      'Not including state certification numbers',
      'Missing student outcome data',
      'Vague classroom descriptions without methodologies',
      'Not mentioning specific curricula or programs used'
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

// Get personalized advice based on industry
export function getIndustryAdvice(industry: string): IndustryConfig {
  const normalizedIndustry = industry.toLowerCase();
  
  // Map common industry names to our configs
  if (normalizedIndustry.includes('tech') || normalizedIndustry.includes('software') || normalizedIndustry.includes('it')) {
    return INDUSTRY_CONFIGS.technology;
  }
  if (normalizedIndustry.includes('health') || normalizedIndustry.includes('medical') || normalizedIndustry.includes('hospital')) {
    return INDUSTRY_CONFIGS.healthcare;
  }
  if (normalizedIndustry.includes('financ') || normalizedIndustry.includes('bank') || normalizedIndustry.includes('investment')) {
    return INDUSTRY_CONFIGS.finance;
  }
  if (normalizedIndustry.includes('market') || normalizedIndustry.includes('advertis') || normalizedIndustry.includes('brand')) {
    return INDUSTRY_CONFIGS.marketing;
  }
  if (normalizedIndustry.includes('sales') || normalizedIndustry.includes('business develop')) {
    return INDUSTRY_CONFIGS.sales;
  }
  if (normalizedIndustry.includes('engineer') && !normalizedIndustry.includes('software')) {
    return INDUSTRY_CONFIGS.engineering;
  }
  if (normalizedIndustry.includes('education') || normalizedIndustry.includes('teaching') || normalizedIndustry.includes('school')) {
    return INDUSTRY_CONFIGS.education;
  }
  if (normalizedIndustry.includes('hr') || normalizedIndustry.includes('human resource') || normalizedIndustry.includes('recruit')) {
    return INDUSTRY_CONFIGS.hr;
  }
  if (normalizedIndustry.includes('consult')) {
    return INDUSTRY_CONFIGS.consulting;
  }
  if (normalizedIndustry.includes('legal') || normalizedIndustry.includes('law') || normalizedIndustry.includes('attorney') || normalizedIndustry.includes('paralegal')) {
    return INDUSTRY_CONFIGS.legal;
  }
  if (normalizedIndustry.includes('retail') || normalizedIndustry.includes('store') || normalizedIndustry.includes('merchandis')) {
    return INDUSTRY_CONFIGS.retail;
  }
  if (normalizedIndustry.includes('hospital') || normalizedIndustry.includes('hotel') || normalizedIndustry.includes('restaurant') || normalizedIndustry.includes('food service') || normalizedIndustry.includes('tourism')) {
    return INDUSTRY_CONFIGS.hospitality;
  }
  if (normalizedIndustry.includes('manufactur') || normalizedIndustry.includes('production') || normalizedIndustry.includes('factory') || normalizedIndustry.includes('industrial')) {
    return INDUSTRY_CONFIGS.manufacturing;
  }
  if (normalizedIndustry.includes('government') || normalizedIndustry.includes('public sector') || normalizedIndustry.includes('federal') || normalizedIndustry.includes('municipal') || normalizedIndustry.includes('civic')) {
    return INDUSTRY_CONFIGS.government;
  }
  
  return INDUSTRY_CONFIGS.general;
}

// Get personalized advice based on experience level
export function getExperienceAdvice(level: string): ExperienceLevelConfig {
  const normalizedLevel = level.toLowerCase();
  
  if (normalizedLevel.includes('entry') || normalizedLevel.includes('junior') || normalizedLevel.includes('0-2')) {
    return EXPERIENCE_CONFIGS.entry;
  }
  if (normalizedLevel.includes('mid') || normalizedLevel.includes('3-')) {
    return EXPERIENCE_CONFIGS.mid;
  }
  if (normalizedLevel.includes('senior') || normalizedLevel.includes('7-') || normalizedLevel.includes('8-')) {
    return EXPERIENCE_CONFIGS.senior;
  }
  if (normalizedLevel.includes('executive') || normalizedLevel.includes('director') || normalizedLevel.includes('vp') || normalizedLevel.includes('c-level')) {
    return EXPERIENCE_CONFIGS.executive;
  }
  
  return EXPERIENCE_CONFIGS.mid; // Default to mid if unclear
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
    aliases: ['pm', 'product owner', 'product lead', 'associate product manager', 'senior product manager', 'group product manager', 'director of product'],
    keySkills: ['Roadmap Development', 'User Research', 'A/B Testing', 'Agile/Scrum', 'Stakeholder Management', 'Data Analysis', 'PRDs', 'Go-to-Market'],
    mustHaveKeywords: ['roadmap', 'user stories', 'backlog', 'prioritization', 'metrics', 'OKRs', 'cross-functional', 'launch'],
    resumeTips: [
      'Lead with product outcomes, not features shipped',
      'Show metrics: adoption rates, revenue impact, user growth',
      'Highlight cross-functional leadership experience',
      'Include specific methodologies (Agile, Lean, Design Thinking)'
    ],
    bulletExamples: [
      { weak: 'Managed product roadmap for mobile app', strong: 'Defined and executed product roadmap driving 40% increase in DAU and $2M incremental revenue' },
      { weak: 'Worked with engineering team on features', strong: 'Led cross-functional team of 12 to deliver 15 features, improving NPS from 32 to 58' }
    ],
    keyMetrics: ['Revenue impact', 'User adoption %', 'NPS improvement', 'Feature adoption rate', 'Time-to-market reduction'],
    commonMistakes: [
      'Listing features instead of outcomes',
      'Not quantifying user or business impact',
      'Missing stakeholder management examples',
      'Not showing data-driven decision making'
    ],
    interviewTopics: ['Product sense', 'Metrics definition', 'Prioritization frameworks', 'Technical communication', 'User empathy']
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
    interviewTopics: ['System design', 'Coding challenges', 'Behavioral questions', 'Technical deep-dives', 'Architecture decisions']
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
    interviewTopics: ['ML algorithms', 'Statistics', 'SQL queries', 'A/B testing', 'Case studies', 'Coding in Python/R']
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
    interviewTopics: ['Clinical scenarios', 'Patient prioritization', 'Conflict resolution', 'HIPAA compliance', 'Emergency protocols']
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
    interviewTopics: ['Campaign strategy', 'Analytics interpretation', 'Budget allocation', 'Cross-functional collaboration', 'Brand positioning']
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
    interviewTopics: ['Sales methodology', 'Objection handling', 'Pipeline management', 'Deal qualification', 'Negotiation tactics']
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
    interviewTopics: ['Project methodology', 'Risk management', 'Conflict resolution', 'Stakeholder communication', 'Resource planning']
  },
  ux_designer: {
    name: 'UX Designer',
    aliases: ['ui designer', 'product designer', 'interaction designer', 'user researcher', 'ux/ui designer', 'senior designer', 'design lead'],
    keySkills: ['User Research', 'Wireframing', 'Prototyping', 'Usability Testing', 'Design Systems', 'Figma/Sketch', 'Information Architecture', 'Accessibility'],
    mustHaveKeywords: ['user research', 'prototype', 'usability', 'design system', 'wireframe', 'user experience', 'accessibility', 'conversion'],
    resumeTips: [
      'Include portfolio link prominently',
      'Quantify impact on user metrics',
      'Show research-to-design process',
      'Highlight collaboration with product/engineering'
    ],
    bulletExamples: [
      { weak: 'Designed mobile app interfaces', strong: 'Redesigned checkout flow increasing conversion by 35% based on 50+ user interviews' },
      { weak: 'Created wireframes and prototypes', strong: 'Built design system adopted across 5 products, reducing design-to-development time by 40%' }
    ],
    keyMetrics: ['Conversion improvement', 'User satisfaction increase', 'Task completion rate', 'Design system adoption', 'Usability test participants'],
    commonMistakes: [
      'Missing portfolio link',
      'Not showing impact on user metrics',
      'Listing tools without showing outcomes',
      'Not mentioning user research methods'
    ],
    interviewTopics: ['Design process', 'Portfolio walkthrough', 'User research methods', 'Design critique', 'Cross-functional collaboration']
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
    interviewTopics: ['Technical accounting', 'GAAP knowledge', 'Audit procedures', 'ERP experience', 'Problem-solving scenarios']
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
    interviewTopics: ['Classroom scenarios', 'Differentiation strategies', 'Assessment methods', 'Parent communication', 'Classroom management']
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
export function getGeographicAdvice(region?: string): GeographicConfig {
  const detectedRegion = region || detectUserRegion();
  return GEOGRAPHIC_CONFIGS[detectedRegion] || GEOGRAPHIC_CONFIGS.us;
}
