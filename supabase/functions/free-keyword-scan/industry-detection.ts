/**
 * Industry Detection Engine
 * 
 * Uses weighted keyword frequency, section awareness, co-occurrence clustering,
 * and job title anchoring to detect industry with high accuracy.
 */

// Section weights - job titles and summary have highest influence
const SECTION_WEIGHTS = {
  jobTitle: 5.0,     // Job titles are the strongest signal
  summary: 3.0,      // Professional summary is second most important
  heading: 2.5,      // Section headings (e.g., "Sales Experience")
  firstBullets: 2.0, // First 2-3 bullets per role
  otherBullets: 1.0, // Other bullet points
  skills: 0.7,       // Skills section - lower weight
  misc: 0.5          // Footer, education descriptions, etc.
};

// Industry-specific keyword dictionaries with weights
const INDUSTRY_KEYWORDS: Record<string, { primary: string[]; secondary: string[]; certifications: string[]; titles: string[] }> = {
  sales: {
    titles: [
      'account executive', 'sales representative', 'sales rep', 'sales manager',
      'business development rep', 'bdr', 'sdr', 'sales development rep',
      'inside sales', 'outside sales', 'field sales', 'enterprise sales',
      'regional sales manager', 'territory manager', 'sales director',
      'vp of sales', 'chief revenue officer', 'cro', 'sales engineer',
      'solution consultant', 'sales consultant', 'client executive',
      'named account executive', 'strategic account executive',
      'commercial account executive', 'gtm', 'go-to-market',
      'founding gtm', 'salesperson', 'sales associate', 'sales lead',
      'business development manager', 'partnerships manager',
      'revenue operations', 'revops', 'sales operations'
    ],
    primary: [
      'quota', 'pipeline', 'closed won', 'closed-won', 'revenue', 'arr', 'mrr',
      'bookings', 'deals', 'prospects', 'prospecting', 'cold calling',
      'outbound', 'inbound sales', 'demo', 'demos', 'discovery call',
      'sales cycle', 'deal size', 'average deal', 'enterprise deals',
      'attainment', 'exceeded quota', 'above quota', 'over-achieved',
      'new business', 'net new', 'expansion revenue', 'upsell', 'cross-sell',
      'renewal', 'churn', 'customer acquisition', 'sales qualified',
      'opportunity', 'opportunities', 'forecast', 'forecasting',
      'acv', 'total contract value', 'tcv', 'closed deals', 'landed',
      'surpassed quota', 'shattered', 'exceeded', 'leaderboard',
      'selling', 'sell', 'sold', 'sale', 'sales'
    ],
    secondary: [
      'crm', 'salesforce', 'hubspot', 'outreach', 'salesloft', 'gong',
      'zoominfo', 'linkedin sales navigator', 'clari', 'chorus',
      'customer success', 'account management', 'stakeholder',
      'c-suite', 'decision maker', 'buying committee', 'procurement',
      'contract', 'negotiation', 'pricing', 'proposal', 'rfp', 'sow',
      'client relationship', 'land and expand', 'white space',
      'apollo', 'rb2b', 'outbound motions', 'tech stack', 'prospecting',
      'consultative selling', 'objection handling', 'closing',
      'cold call', 'lead generation', 'business development'
    ],
    certifications: [
      'meddpicc', 'meddic', 'bant', 'spin selling', 'challenger sale',
      'sandler', 'solution selling', 'value selling', 'force management',
      'command of the message', 'miller heiman', 'strategic selling'
    ]
  },
  
  technology: {
    titles: [
      'software engineer', 'software developer', 'full stack developer',
      'frontend developer', 'backend developer', 'web developer',
      'mobile developer', 'ios developer', 'android developer',
      'devops engineer', 'sre', 'site reliability engineer',
      'platform engineer', 'cloud engineer', 'data engineer',
      'ml engineer', 'machine learning engineer', 'ai engineer',
      'data scientist', 'qa engineer', 'test engineer', 'sdet',
      'systems engineer', 'network engineer', 'security engineer',
      'solutions architect', 'technical architect', 'enterprise architect',
      'engineering manager', 'tech lead', 'technical lead', 'cto',
      'vp of engineering', 'director of engineering', 'staff engineer',
      'principal engineer', 'distinguished engineer', 'developer advocate',
      'developer relations', 'devrel', 'programmer', 'coder'
    ],
    primary: [
      'code', 'coding', 'programming', 'develop', 'development',
      'software', 'application', 'system', 'api', 'apis', 'microservices',
      'architecture', 'deploy', 'deployment', 'ci/cd', 'continuous integration',
      'agile', 'scrum', 'sprint', 'git', 'github', 'gitlab', 'bitbucket',
      'pull request', 'code review', 'testing', 'unit test', 'integration test',
      'debugging', 'bug fix', 'refactor', 'optimization', 'performance',
      'scalability', 'distributed systems', 'cloud', 'infrastructure'
    ],
    secondary: [
      'python', 'javascript', 'typescript', 'java', 'c++', 'c#', 'go',
      'golang', 'rust', 'ruby', 'php', 'scala', 'kotlin', 'swift',
      'react', 'angular', 'vue', 'node.js', 'nodejs', 'express',
      'django', 'flask', 'spring', 'rails', 'laravel', 'next.js',
      'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes',
      'terraform', 'ansible', 'jenkins', 'circleci', 'github actions',
      'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
      'kafka', 'rabbitmq', 'graphql', 'rest', 'restful'
    ],
    certifications: [
      'aws certified', 'azure certified', 'gcp certified', 'ckad', 'cka',
      'cissp', 'comptia', 'cisco certified', 'ccna', 'ccnp',
      'scrum master', 'psm', 'csm', 'pmp'
    ]
  },
  
  marketing: {
    titles: [
      'marketing manager', 'marketing director', 'cmo', 'chief marketing officer',
      'vp of marketing', 'head of marketing', 'brand manager', 'product marketing',
      'growth marketing', 'performance marketing', 'digital marketing',
      'content marketing', 'content strategist', 'seo specialist', 'seo manager',
      'ppc specialist', 'paid media', 'social media manager', 'community manager',
      'email marketing', 'marketing analyst', 'marketing coordinator',
      'demand generation', 'demand gen', 'campaign manager', 'creative director'
    ],
    primary: [
      'campaign', 'campaigns', 'brand awareness', 'brand strategy',
      'content strategy', 'content creation', 'copywriting', 'copy',
      'social media', 'organic social', 'paid social', 'advertising',
      'media buying', 'media planning', 'creative', 'creative direction',
      'brand identity', 'brand guidelines', 'messaging', 'positioning'
    ],
    secondary: [
      'google ads', 'facebook ads', 'meta ads', 'linkedin ads', 'tiktok ads',
      'google analytics', 'ga4', 'hubspot', 'marketo', 'salesforce marketing',
      'mailchimp', 'klaviyo', 'sendgrid', 'semrush', 'ahrefs', 'moz',
      'cac', 'customer acquisition cost', 'ltv', 'cltv', 'roas', 'roi',
      'ctr', 'click-through', 'conversion rate', 'attribution', 'funnel',
      'a/b testing', 'ab testing', 'landing page', 'lead generation',
      'mql', 'sql', 'pipeline generation', 'inbound marketing'
    ],
    certifications: [
      'google ads certified', 'facebook blueprint', 'hubspot certified',
      'google analytics certified', 'hootsuite certified'
    ]
  },
  
  finance: {
    titles: [
      'accountant', 'cpa', 'controller', 'cfo', 'chief financial officer',
      'finance manager', 'financial analyst', 'fp&a', 'financial planning',
      'investment analyst', 'portfolio manager', 'fund manager',
      'investment banker', 'private equity', 'venture capital', 'vc',
      'hedge fund', 'quantitative analyst', 'quant', 'trader', 'trading',
      'auditor', 'tax manager', 'tax accountant', 'treasury', 'treasurer',
      'credit analyst', 'risk analyst', 'compliance officer', 'actuary'
    ],
    primary: [
      'financial statements', 'balance sheet', 'income statement', 'cash flow',
      'p&l', 'profit and loss', 'revenue', 'ebitda', 'net income',
      'budget', 'budgeting', 'forecast', 'financial forecast', 'variance',
      'audit', 'auditing', 'internal controls', 'sox', 'sarbanes-oxley',
      'gaap', 'ifrs', 'financial reporting', 'consolidation',
      'valuation', 'dcf', 'discounted cash flow', 'lbo', 'merger', 'm&a',
      'due diligence', 'deal', 'transaction', 'portfolio', 'aum'
    ],
    secondary: [
      'excel', 'financial modeling', 'bloomberg', 'factset', 'capital iq',
      'quickbooks', 'netsuite', 'sap', 'oracle financials', 'hyperion',
      'tax', 'taxation', 'deferred tax', 'depreciation', 'amortization',
      'accounts payable', 'accounts receivable', 'ap', 'ar', 'gl',
      'general ledger', 'journal entry', 'reconciliation', 'accrual'
    ],
    certifications: [
      'cpa', 'cfa', 'cma', 'cfp', 'series 7', 'series 63', 'series 65',
      'frm', 'caia', 'chartered accountant', 'ca', 'acca'
    ]
  },
  
  healthcare: {
    titles: [
      'registered nurse', 'rn', 'nurse practitioner', 'np', 'lpn', 'lvn',
      'physician', 'doctor', 'md', 'do', 'surgeon', 'specialist',
      'medical assistant', 'cna', 'certified nursing assistant',
      'physical therapist', 'pt', 'occupational therapist', 'ot',
      'pharmacist', 'pharmacy technician', 'radiologist', 'radiologic technician',
      'medical technologist', 'lab technician', 'phlebotomist',
      'healthcare administrator', 'clinical director', 'nursing manager',
      'charge nurse', 'case manager', 'care coordinator'
    ],
    primary: [
      'patient care', 'patient', 'patients', 'clinical', 'bedside',
      'diagnosis', 'treatment', 'medication', 'medications', 'pharmacy',
      'vital signs', 'assessment', 'documentation', 'charting',
      'hospital', 'clinic', 'healthcare', 'medical', 'nursing',
      'emergency', 'icu', 'or', 'operating room', 'surgery', 'surgical'
    ],
    secondary: [
      'epic', 'cerner', 'meditech', 'allscripts', 'emr', 'ehr',
      'hipaa', 'hipaa compliance', 'jcaho', 'joint commission',
      'infection control', 'sterile', 'sterilization', 'wound care',
      'iv', 'injection', 'catheter', 'monitoring', 'triage'
    ],
    certifications: [
      'bls', 'acls', 'pals', 'nrp', 'tncc', 'ccrn', 'cnor',
      'board certified', 'state licensed', 'dea', 'npi'
    ]
  },
  
  hr: {
    titles: [
      'hr manager', 'human resources manager', 'hr director', 'chro',
      'chief human resources officer', 'hr business partner', 'hrbp',
      'recruiter', 'talent acquisition', 'sourcer', 'recruiting manager',
      'hr coordinator', 'hr generalist', 'hr specialist',
      'compensation analyst', 'benefits manager', 'total rewards',
      'learning and development', 'l&d', 'training manager',
      'employee relations', 'hr operations', 'people operations',
      'people partner', 'head of people'
    ],
    primary: [
      'recruiting', 'recruitment', 'hiring', 'talent', 'candidates',
      'interviews', 'interviewing', 'onboarding', 'offboarding',
      'employee', 'employees', 'headcount', 'workforce', 'staffing',
      'job description', 'job posting', 'offer letter', 'compensation',
      'benefits', 'payroll', 'performance review', 'performance management'
    ],
    secondary: [
      'workday', 'adp', 'bamboohr', 'greenhouse', 'lever', 'icims',
      'taleo', 'successfactors', 'ultipro', 'paychex', 'gusto',
      'linkedin recruiter', 'indeed', 'glassdoor', 'handshake',
      'ats', 'applicant tracking', 'hris', 'hrms',
      'engagement', 'retention', 'turnover', 'culture', 'dei',
      'diversity', 'inclusion', 'equity', 'eeo', 'compliance'
    ],
    certifications: [
      'shrm-cp', 'shrm-scp', 'phr', 'sphr', 'gphr', 'airs', 'cir'
    ]
  },
  
  legal: {
    titles: [
      'attorney', 'lawyer', 'counsel', 'general counsel', 'gc',
      'associate attorney', 'partner', 'of counsel', 'legal counsel',
      'paralegal', 'legal assistant', 'legal secretary',
      'compliance officer', 'compliance manager', 'contract manager',
      'litigation', 'litigator', 'corporate counsel', 'in-house counsel',
      'ip attorney', 'patent attorney', 'trademark attorney'
    ],
    primary: [
      'legal', 'law', 'litigation', 'contract', 'contracts',
      'agreement', 'agreements', 'negotiate', 'negotiation',
      'court', 'trial', 'discovery', 'deposition', 'motion',
      'brief', 'pleading', 'complaint', 'settlement', 'judgment',
      'legal research', 'case law', 'statute', 'regulation'
    ],
    secondary: [
      'westlaw', 'lexisnexis', 'practical law', 'contract lifecycle',
      'clm', 'docusign', 'ironclad', 'matter management',
      'corporate governance', 'board', 'securities', 'sec',
      'intellectual property', 'ip', 'patent', 'trademark', 'copyright',
      'm&a', 'due diligence', 'employment law', 'labor law'
    ],
    certifications: [
      'jd', 'juris doctor', 'bar admission', 'bar certified',
      'state bar', 'llm', 'patent bar'
    ]
  },
  
  education: {
    titles: [
      'teacher', 'educator', 'professor', 'instructor', 'lecturer',
      'principal', 'assistant principal', 'dean', 'superintendent',
      'curriculum coordinator', 'instructional coach', 'department head',
      'special education teacher', 'sped teacher', 'counselor',
      'school counselor', 'academic advisor', 'tutor', 'teaching assistant'
    ],
    primary: [
      'teaching', 'instruction', 'curriculum', 'lesson plan', 'lesson plans',
      'classroom', 'students', 'student', 'learning', 'education',
      'academic', 'grade', 'grading', 'assessment', 'testing',
      'standardized test', 'differentiated instruction', 'pedagogy'
    ],
    secondary: [
      'k-12', 'elementary', 'middle school', 'high school', 'higher education',
      'university', 'college', 'school district', 'iep', 'special education',
      'common core', 'state standards', 'accreditation', 'blackboard',
      'canvas', 'moodle', 'google classroom', 'zoom', 'lms'
    ],
    certifications: [
      'teaching license', 'teaching certificate', 'state certified',
      'national board certified', 'nbct', 'tesol', 'tefl', 'celta'
    ]
  },
  
  engineering: {
    titles: [
      'mechanical engineer', 'civil engineer', 'electrical engineer',
      'chemical engineer', 'structural engineer', 'project engineer',
      'design engineer', 'manufacturing engineer', 'process engineer',
      'quality engineer', 'industrial engineer', 'systems engineer',
      'aerospace engineer', 'environmental engineer', 'biomedical engineer',
      'pe', 'professional engineer', 'engineering manager'
    ],
    primary: [
      'engineering', 'design', 'analysis', 'testing', 'prototype',
      'specifications', 'drawings', 'schematics', 'calculations',
      'simulation', 'modeling', 'manufacturing', 'production',
      'quality', 'inspection', 'tolerance', 'materials'
    ],
    secondary: [
      'autocad', 'solidworks', 'catia', 'creo', 'inventor', 'revit',
      'matlab', 'simulink', 'ansys', 'fea', 'cfd', 'cam', 'cnc',
      'lean', 'six sigma', 'iso', 'asme', 'astm', 'osha', 'safety'
    ],
    certifications: [
      'pe license', 'professional engineer', 'fe', 'eit',
      'pmp', 'six sigma black belt', 'green belt', 'lean certified'
    ]
  },
  
  consulting: {
    titles: [
      'consultant', 'senior consultant', 'management consultant',
      'strategy consultant', 'business analyst', 'associate consultant',
      'principal', 'partner', 'engagement manager', 'project manager',
      'advisory', 'advisor', 'director'
    ],
    primary: [
      'consulting', 'advisory', 'client', 'clients', 'engagement',
      'strategy', 'strategic', 'analysis', 'recommendation',
      'stakeholder', 'presentation', 'deliverable', 'workstream',
      'problem solving', 'business case', 'roi'
    ],
    secondary: [
      'mckinsey', 'bain', 'bcg', 'deloitte', 'accenture', 'kpmg', 'ey', 'pwc',
      'powerpoint', 'excel', 'modeling', 'research', 'benchmarking',
      'due diligence', 'transformation', 'change management', 'implementation'
    ],
    certifications: [
      'pmp', 'prince2', 'mba', 'cmc', 'six sigma'
    ]
  },
  
  creative: {
    titles: [
      'graphic designer', 'visual designer', 'ui designer', 'ux designer',
      'product designer', 'web designer', 'art director', 'creative director',
      'brand designer', 'motion designer', 'animator', 'illustrator',
      'photographer', 'videographer', 'video editor', 'copywriter',
      'content creator', 'social media creator'
    ],
    primary: [
      'design', 'creative', 'visual', 'branding', 'brand identity',
      'layout', 'typography', 'color', 'composition', 'aesthetic',
      'user experience', 'user interface', 'wireframe', 'mockup',
      'prototype', 'portfolio', 'concept', 'ideation'
    ],
    secondary: [
      'photoshop', 'illustrator', 'indesign', 'figma', 'sketch', 'xd',
      'after effects', 'premiere', 'final cut', 'cinema 4d', 'blender',
      'canva', 'invision', 'zeplin', 'principle', 'framer'
    ],
    certifications: [
      'adobe certified', 'google ux', 'uxcel'
    ]
  }
};

// Co-occurrence patterns - keywords that appear together strongly indicate an industry
const CO_OCCURRENCE_PATTERNS: Record<string, string[][]> = {
  sales: [
    ['quota', 'pipeline', 'crm'],
    ['closed', 'deals', 'revenue'],
    ['prospecting', 'outbound', 'cold'],
    ['account', 'executive', 'enterprise'],
    ['meddpicc', 'salesforce', 'quota'],
    ['attainment', 'bookings', 'arr']
  ],
  technology: [
    ['code', 'deploy', 'git'],
    ['api', 'microservices', 'cloud'],
    ['react', 'typescript', 'node'],
    ['aws', 'docker', 'kubernetes'],
    ['agile', 'sprint', 'scrum']
  ],
  marketing: [
    ['campaign', 'roi', 'conversion'],
    ['seo', 'content', 'organic'],
    ['paid', 'ads', 'cpc'],
    ['brand', 'awareness', 'positioning'],
    ['funnel', 'leads', 'mql']
  ],
  finance: [
    ['audit', 'sox', 'compliance'],
    ['valuation', 'dcf', 'modeling'],
    ['portfolio', 'aum', 'returns'],
    ['budget', 'forecast', 'variance'],
    ['gaap', 'financial', 'statements']
  ]
};

interface DetectionResult {
  industry: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  signals: string[];
  alternativeIndustries: Array<{ industry: string; score: number }>;
}

interface SectionMatch {
  section: keyof typeof SECTION_WEIGHTS;
  keyword: string;
  weight: number;
}

/**
 * Extract sections from resume text
 */
function extractSections(resumeText: string): {
  jobTitles: string[];
  summary: string;
  headings: string[];
  firstBullets: string[];
  otherBullets: string[];
  skills: string;
  fullText: string;
} {
  const text = resumeText.toLowerCase();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Extract job titles - look for common patterns
  const jobTitles: string[] = [];
  const titleKeywords = [
    'manager', 'director', 'engineer', 'developer', 'analyst', 'specialist',
    'coordinator', 'consultant', 'executive', 'lead', 'head', 'vp', 'president',
    'associate', 'senior', 'principal', 'architect', 'designer', 'administrator',
    'representative', 'rep', 'officer', 'nurse', 'teacher', 'attorney', 'accountant',
    'salesperson', 'gtm', 'go-to-market', 'founder', 'ceo', 'cfo', 'cto', 'cro',
    'recruiter', 'therapist', 'scientist', 'researcher', 'strategist'
  ];
  
  for (const line of lines) {
    if (line.length < 120) {
      const hasTitle = titleKeywords.some(kw => line.includes(kw));
      if (hasTitle) {
        let cleanTitle = '';
        
        // Pattern 1: "Company, Location; Title (Date)" — semicolon separates company from title
        const semicolonMatch = line.match(/;\s*(.+?)(?:\s*\(|$)/i);
        if (semicolonMatch) {
          cleanTitle = semicolonMatch[1].trim();
        }
        
        // Pattern 2: "Title - Company" or "Title | Company" or "Title @ Company"
        if (!cleanTitle) {
          cleanTitle = line.split(/[-–|@]|\d{4}|january|february|march|april|may|june|july|august|september|october|november|december/i)[0].trim();
        }
        
        // Pattern 3: "Title at Company"
        if (!cleanTitle || cleanTitle === line.trim()) {
          const atMatch = line.match(/^(.+?)\s+at\s+/i);
          if (atMatch) {
            cleanTitle = atMatch[1].trim();
          }
        }
        
        if (cleanTitle && cleanTitle.length > 3 && cleanTitle.length < 80) {
          jobTitles.push(cleanTitle);
        }
      }
    }
  }
  
  // Extract summary - usually at the top, after contact info
  let summary = '';
  const summaryIndicators = ['summary', 'profile', 'objective', 'about'];
  let inSummary = false;
  const summaryLines: string[] = [];
  
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i];
    if (summaryIndicators.some(ind => line.includes(ind))) {
      inSummary = true;
      continue;
    }
    if (inSummary) {
      if (line.length > 20 && !line.includes(':') && !line.match(/^\d/)) {
        summaryLines.push(line);
      } else if (summaryLines.length > 0) {
        break;
      }
    }
  }
  summary = summaryLines.join(' ');
  
  // If no explicit summary section, use first substantial paragraph
  if (!summary) {
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i];
      if (line.length > 100) {
        summary = line;
        break;
      }
    }
  }
  
  // Extract headings
  const headings: string[] = [];
  const headingPatterns = [
    /^(experience|work experience|professional experience|employment|career)/i,
    /^(education|academic|qualifications)/i,
    /^(skills|technical skills|core competencies)/i,
    /^(certifications?|licenses?)/i,
    /^(projects?|key projects)/i,
    /^(achievements?|accomplishments?)/i
  ];
  
  for (const line of lines) {
    if (line.length < 50 && headingPatterns.some(p => p.test(line))) {
      headings.push(line);
    }
  }
  
  // Extract bullets
  const allBullets: string[] = [];
  for (const line of lines) {
    if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*') || 
        line.match(/^[\u2022\u2023\u25E6\u2043\u2219]/) ||
        (line.length > 30 && line.length < 300)) {
      allBullets.push(line);
    }
  }
  
  // First 3 bullets per "section" (rough approximation)
  const firstBullets = allBullets.slice(0, 9);
  const otherBullets = allBullets.slice(9);
  
  // Extract skills section
  let skills = '';
  const skillsStart = text.indexOf('skills');
  if (skillsStart !== -1) {
    skills = text.slice(skillsStart, skillsStart + 500);
  }
  
  return {
    jobTitles,
    summary,
    headings,
    firstBullets,
    otherBullets,
    skills,
    fullText: text
  };
}

/**
 * Check for co-occurrence patterns
 */
function checkCoOccurrence(text: string, industry: string): number {
  const patterns = CO_OCCURRENCE_PATTERNS[industry];
  if (!patterns) return 0;
  
  let score = 0;
  for (const pattern of patterns) {
    const matches = pattern.filter(keyword => text.includes(keyword));
    if (matches.length >= 2) {
      // Bonus for multiple co-occurring keywords
      score += matches.length * 0.5;
    }
  }
  return score;
}

/**
 * Calculate weighted score for an industry
 */
function calculateIndustryScore(sections: ReturnType<typeof extractSections>, industry: string): {
  score: number;
  signals: string[];
} {
  const keywords = INDUSTRY_KEYWORDS[industry];
  if (!keywords) return { score: 0, signals: [] };
  
  let score = 0;
  const signals: string[] = [];
  
  // Check job titles (HIGHEST WEIGHT)
  for (const title of sections.jobTitles) {
    for (const industryTitle of keywords.titles) {
      if (title.includes(industryTitle)) {
        score += SECTION_WEIGHTS.jobTitle * 2; // Double weight for exact title match
        signals.push(`Job title match: "${industryTitle}"`);
      }
    }
  }
  
  // Check summary
  for (const kw of [...keywords.primary, ...keywords.titles]) {
    if (sections.summary.includes(kw)) {
      score += SECTION_WEIGHTS.summary;
      if (signals.length < 10) signals.push(`Summary: "${kw}"`);
    }
  }
  
  // Check first bullets (higher weight)
  for (const bullet of sections.firstBullets) {
    for (const kw of keywords.primary) {
      if (bullet.includes(kw)) {
        score += SECTION_WEIGHTS.firstBullets;
      }
    }
    for (const kw of keywords.secondary) {
      if (bullet.includes(kw)) {
        score += SECTION_WEIGHTS.firstBullets * 0.5;
      }
    }
  }
  
  // Check other bullets
  for (const bullet of sections.otherBullets) {
    for (const kw of keywords.primary) {
      if (bullet.includes(kw)) {
        score += SECTION_WEIGHTS.otherBullets;
      }
    }
  }
  
  // Check skills section (lower weight)
  for (const kw of [...keywords.primary, ...keywords.secondary]) {
    if (sections.skills.includes(kw)) {
      score += SECTION_WEIGHTS.skills;
    }
  }
  
  // Check certifications (strong signal)
  for (const cert of keywords.certifications) {
    if (sections.fullText.includes(cert)) {
      score += SECTION_WEIGHTS.summary; // Same weight as summary
      if (signals.length < 10) signals.push(`Certification: "${cert}"`);
    }
  }
  
  // Frequency analysis - count primary keyword occurrences
  for (const kw of keywords.primary) {
    const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = sections.fullText.match(regex);
    if (matches && matches.length > 1) {
      // Bonus for repeated mentions
      score += (matches.length - 1) * 0.3;
    }
  }
  
  // Co-occurrence bonus
  const coOccurrenceScore = checkCoOccurrence(sections.fullText, industry);
  if (coOccurrenceScore > 0) {
    score += coOccurrenceScore;
    signals.push(`Co-occurrence patterns detected`);
  }
  
  return { score, signals };
}

/**
 * Main detection function
 */
export function detectIndustry(resumeText: string): DetectionResult {
  const sections = extractSections(resumeText);
  
  // Calculate scores for all industries
  const scores: Array<{ industry: string; score: number; signals: string[] }> = [];
  
  for (const industry of Object.keys(INDUSTRY_KEYWORDS)) {
    const result = calculateIndustryScore(sections, industry);
    scores.push({
      industry,
      score: result.score,
      signals: result.signals
    });
  }
  
  // Sort by score
  scores.sort((a, b) => b.score - a.score);
  
  const top = scores[0];
  const second = scores[1];
  
  // Determine confidence
  let confidence: 'high' | 'medium' | 'low';
  
  if (top.score >= 15 && (top.score / (second?.score || 1)) >= 1.5) {
    confidence = 'high';
  } else if (top.score >= 8) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  // Check for mixed signals (dilutes confidence)
  if (second && second.score > 0 && (top.score / second.score) < 1.3) {
    // Close competition = lower confidence
    confidence = confidence === 'high' ? 'medium' : 'low';
    top.signals.push(`Note: Also shows signals for ${second.industry}`);
  }
  
  // Fallback to general if no clear winner
  const finalIndustry = top.score >= 3 ? top.industry : 'general';
  
  return {
    industry: finalIndustry,
    confidence,
    score: top.score,
    signals: top.signals.slice(0, 5),
    alternativeIndustries: scores.slice(1, 4).map(s => ({
      industry: s.industry,
      score: s.score
    }))
  };
}

/**
 * Format detection result for AI prompt
 */
export function formatDetectionForPrompt(result: DetectionResult): string {
  return `
**PRE-DETECTED INDUSTRY (Use this as strong prior):**
- Detected Industry: ${result.industry.toUpperCase()}
- Confidence: ${result.confidence}
- Score: ${result.score.toFixed(1)}
- Key Signals: ${result.signals.join('; ')}
${result.alternativeIndustries.length > 0 ? `- Alternative industries: ${result.alternativeIndustries.map(a => `${a.industry}(${a.score.toFixed(1)})`).join(', ')}` : ''}

IMPORTANT: The pre-detection algorithm has analyzed job titles, keyword frequency, section weights, and co-occurrence patterns. 
${result.confidence === 'high' ? 'HIGH CONFIDENCE - Accept this industry classification unless there is overwhelming evidence otherwise.' : 
  result.confidence === 'medium' ? 'MEDIUM CONFIDENCE - Verify but lean toward this classification.' :
  'LOW CONFIDENCE - Use your judgment but consider these signals.'}
`;
}
