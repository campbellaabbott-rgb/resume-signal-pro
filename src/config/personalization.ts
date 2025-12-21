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
    interviewTopics: ['Conflict resolution scenarios', 'DEI initiatives', 'Change management', 'Employment law', 'Performance management systems']
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
    interviewTopics: ['Financial modeling tests', 'Excel proficiency', 'Variance analysis scenarios', 'Business case development', 'Stakeholder communication']
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
    interviewTopics: ['Churn prevention strategies', 'Difficult customer scenarios', 'Upselling techniques', 'QBR preparation', 'Cross-functional collaboration']
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
    interviewTopics: ['Process improvement examples', 'Team management challenges', 'Budget optimization', 'Crisis management', 'Cross-departmental coordination']
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
    interviewTopics: ['Prioritization scenarios', 'Confidentiality handling', 'Difficult scheduling situations', 'Stakeholder management', 'Crisis management']
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
    interviewTopics: ['Requirements gathering techniques', 'Stakeholder conflict resolution', 'Process mapping examples', 'Agile ceremonies', 'Documentation best practices']
  },
  devops_engineer: {
    name: 'DevOps Engineer',
    aliases: ['site reliability engineer', 'sre', 'platform engineer', 'infrastructure engineer', 'cloud engineer', 'release engineer', 'build engineer', 'systems engineer'],
    keySkills: ['CI/CD', 'Kubernetes', 'Docker', 'AWS/Azure/GCP', 'Terraform', 'Jenkins', 'Monitoring', 'Linux', 'Scripting', 'Infrastructure as Code'],
    mustHaveKeywords: ['CI/CD', 'kubernetes', 'docker', 'cloud', 'automation', 'infrastructure', 'deployment', 'monitoring', 'terraform'],
    resumeTips: [
      'Quantify reliability improvements (uptime, MTTR, deployment frequency)',
      'List specific cloud platforms and tools with versions',
      'Show infrastructure scale (servers, containers, requests)',
      'Highlight automation and efficiency gains'
    ],
    bulletExamples: [
      { weak: 'Managed CI/CD pipelines', strong: 'Built CI/CD pipelines reducing deployment time from 4 hours to 15 minutes, enabling 50+ daily deployments across 12 microservices' },
      { weak: 'Worked with Kubernetes', strong: 'Migrated 20+ services to Kubernetes, achieving 99.99% uptime and reducing infrastructure costs by 35%' }
    ],
    keyMetrics: ['Uptime %', 'Deployment frequency', 'MTTR reduction', 'Infrastructure cost savings', 'Automation coverage %'],
    commonMistakes: [
      'Not quantifying reliability metrics (uptime, MTTR)',
      'Listing tools without showing outcomes',
      'Missing scale (servers, containers, requests/sec)',
      'Not showing cost optimization achievements'
    ],
    interviewTopics: ['System design', 'Incident response', 'CI/CD architecture', 'Cloud cost optimization', 'Monitoring and alerting strategies']
  },
  qa_engineer: {
    name: 'QA Engineer',
    aliases: ['quality assurance engineer', 'test engineer', 'sdet', 'software test engineer', 'automation engineer', 'quality engineer', 'test analyst', 'qa analyst'],
    keySkills: ['Test Automation', 'Selenium', 'API Testing', 'Performance Testing', 'Test Planning', 'Bug Tracking', 'Agile Testing', 'CI/CD Integration'],
    mustHaveKeywords: ['test automation', 'quality assurance', 'testing', 'bugs', 'selenium', 'api testing', 'test cases', 'regression'],
    resumeTips: [
      'Quantify test coverage and bug detection rates',
      'Show automation framework development',
      'Highlight defect prevention metrics',
      'List specific tools (Selenium, Cypress, Postman, JMeter)'
    ],
    bulletExamples: [
      { weak: 'Wrote automated tests', strong: 'Built Selenium automation framework achieving 85% test coverage, reducing regression testing time from 3 days to 4 hours' },
      { weak: 'Found bugs in software', strong: 'Identified 500+ defects pre-release with 98% accuracy, reducing production bugs by 60% YoY' }
    ],
    keyMetrics: ['Test coverage %', 'Bugs found pre-release', 'Regression time reduction', 'Automation ROI', 'Production bug reduction %'],
    commonMistakes: [
      'Not quantifying test coverage or bug detection',
      'Missing automation framework details',
      'Vague "tested software" without metrics',
      'Not showing CI/CD integration experience'
    ],
    interviewTopics: ['Test strategy design', 'Automation framework architecture', 'Bug prioritization', 'Performance testing approach', 'Shift-left testing']
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
    interviewTopics: ['Sourcing strategies', 'Candidate experience', 'Difficult searches', 'Diversity recruiting', 'Stakeholder management']
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
    interviewTopics: ['Writing process', 'SEO strategy', 'Brand voice development', 'Content performance analysis', 'Deadline management']
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
    interviewTopics: ['Portfolio walkthrough', 'Design process', 'Feedback handling', 'Brand consistency', 'Cross-functional collaboration']
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
    interviewTopics: ['Drug interaction scenarios', 'Patient counseling approach', 'Error prevention', 'Regulatory compliance', 'Team management']
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
    interviewTopics: ['Content strategy', 'Crisis management', 'Analytics interpretation', 'Platform-specific tactics', 'Influencer partnerships']
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
    interviewTopics: ['Portfolio walkthrough', 'Design process', 'Code compliance', 'Client management', 'Sustainable design approach']
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
    interviewTopics: ['Clinical scenarios', 'Treatment approach', 'Outcome measurement', 'Patient communication', 'Evidence-based practice']
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
    interviewTopics: ['Supply chain disruption handling', 'Vendor negotiation', 'Demand forecasting', 'Cost optimization strategies', 'ERP implementation']
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
    interviewTopics: ['Case strategy scenarios', 'Ethics and confidentiality', 'Client management', 'Legal research approach', 'Negotiation tactics']
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
    interviewTopics: ['Menu development process', 'Kitchen management scenarios', 'Food cost control', 'Team leadership', 'Handling high-volume service']
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
    interviewTopics: ['Sales approach', 'Market knowledge', 'Difficult negotiation scenarios', 'Lead generation strategies', 'Client communication']
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
    interviewTopics: ['Design process', 'FEA/analysis approach', 'Manufacturing considerations', 'Problem-solving examples', 'Cross-functional collaboration']
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
    interviewTopics: ['Motion planning algorithms', 'Sensor fusion', 'Real-time systems', 'Safety considerations', 'System integration challenges']
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
    interviewTopics: ['ML system design', 'Model selection rationale', 'Handling data quality issues', 'MLOps practices', 'Scaling ML systems']
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
    interviewTopics: ['Clinical scenarios', 'Patient communication', 'Treatment planning approach', 'Practice management', 'Continuing education']
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
    interviewTopics: ['Clinical case discussions', 'Difficult client scenarios', 'Emergency protocols', 'Ethical dilemmas', 'Practice management']
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
    interviewTopics: ['Technical design challenges', 'Project management approach', 'Regulatory compliance', 'Stakeholder coordination', 'Site problem-solving']
  },
  data_engineer: {
    name: 'Data Engineer',
    aliases: ['senior data engineer', 'analytics engineer', 'etl developer', 'data platform engineer', 'big data engineer', 'database engineer', 'data infrastructure engineer'],
    keySkills: ['SQL', 'Python', 'ETL/ELT', 'Data Warehousing', 'Spark/Hadoop', 'Airflow', 'Cloud Platforms (AWS/GCP/Azure)', 'Data Modeling'],
    mustHaveKeywords: ['data pipelines', 'ETL', 'data warehouse', 'SQL', 'data modeling', 'cloud', 'Spark', 'automation'],
    resumeTips: [
      'Quantify data volumes and pipeline performance',
      'Show reduction in processing time/costs',
      'List specific technologies and cloud platforms',
      'Highlight data quality improvements'
    ],
    bulletExamples: [
      { weak: 'Built data pipelines', strong: 'Designed ETL pipelines processing 5TB daily with 99.9% reliability, reducing data latency from 4 hours to 15 minutes' },
      { weak: 'Worked with data warehouse', strong: 'Architected Snowflake data warehouse serving 200+ analysts, cutting query times by 70% and infrastructure costs by 40%' }
    ],
    keyMetrics: ['Data volume processed', 'Pipeline reliability %', 'Latency reduction', 'Cost savings', 'Query performance improvement'],
    commonMistakes: [
      'Not quantifying data volumes',
      'Missing reliability and performance metrics',
      'Vague "built pipelines" without scale',
      'Not showing business impact of data work'
    ],
    interviewTopics: ['Data modeling approach', 'Pipeline architecture', 'Handling data quality', 'Cloud platform experience', 'Performance optimization']
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
    interviewTopics: ['Incident response scenarios', 'Threat analysis approach', 'Security architecture', 'Compliance requirements', 'Emerging threats']
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
    interviewTopics: ['Legal research approach', 'Case management systems', 'Deadline management', 'Confidentiality handling', 'Practice area knowledge']
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
    interviewTopics: ['Event logistics scenarios', 'Budget management', 'Crisis handling', 'Vendor negotiation', 'Client communication']
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
    interviewTopics: ['Code compliance scenarios', 'Troubleshooting approach', 'Safety protocols', 'Blueprint reading', 'Complex installation projects']
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
