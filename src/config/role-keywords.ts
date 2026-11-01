// Role-specific keywords database
// Keywords tailored to specific job titles beyond industry-level keywords
import { resumeHasTerm } from "../../supabase/functions/free-keyword-scan/term-presence";

export interface RoleKeyword {
  keyword: string;
  category: 'core' | 'advanced' | 'differentiator';
  reason: string;
}

export interface RoleKeywordConfig {
  title: string;
  aliases: string[];
  seniority: 'entry' | 'mid' | 'senior' | 'all';
  keywords: RoleKeyword[];
}

export const ROLE_KEYWORDS: RoleKeywordConfig[] = [
  // Engineering & Tech Roles
  {
    title: 'Software Engineer',
    aliases: ['software developer', 'developer', 'programmer', 'swe', 'dev', 'coder'],
    seniority: 'all',
    keywords: [
      { keyword: 'Code Review', category: 'core', reason: 'Shows collaboration & quality focus' },
      { keyword: 'Unit Testing', category: 'core', reason: 'Essential for code quality' },
      { keyword: 'System Design', category: 'advanced', reason: 'Demonstrates architectural thinking' },
      { keyword: 'Technical Debt', category: 'differentiator', reason: 'Shows strategic thinking' },
      { keyword: 'Performance Optimization', category: 'advanced', reason: 'High-impact skill' },
      { keyword: 'Code Coverage', category: 'core', reason: 'Quality metrics awareness' },
      { keyword: 'Debugging', category: 'core', reason: 'Problem-solving evidence' },
      { keyword: 'Version Control', category: 'core', reason: 'Fundamental requirement' },
    ],
  },
  {
    title: 'Senior Software Engineer',
    aliases: ['staff engineer', 'principal engineer', 'lead developer', 'tech lead'],
    seniority: 'senior',
    keywords: [
      { keyword: 'Mentorship', category: 'core', reason: 'Leadership expectation' },
      { keyword: 'Architecture Design', category: 'core', reason: 'Senior-level responsibility' },
      { keyword: 'Cross-Functional', category: 'core', reason: 'Collaboration at scale' },
      { keyword: 'Technical Strategy', category: 'advanced', reason: 'Strategic thinking' },
      { keyword: 'Code Standards', category: 'core', reason: 'Team quality leadership' },
      { keyword: 'Scalability', category: 'advanced', reason: 'Enterprise-level thinking' },
      { keyword: 'Technical Roadmap', category: 'differentiator', reason: 'Vision & planning' },
      { keyword: 'Stakeholder Communication', category: 'core', reason: 'Senior collaboration' },
    ],
  },
  {
    title: 'Frontend Developer',
    aliases: ['frontend engineer', 'ui developer', 'web developer', 'react developer'],
    seniority: 'all',
    keywords: [
      { keyword: 'Responsive Design', category: 'core', reason: 'Fundamental requirement' },
      { keyword: 'Performance Optimization', category: 'advanced', reason: 'Core Web Vitals matter' },
      { keyword: 'Accessibility', category: 'core', reason: 'WCAG compliance expected' },
      { keyword: 'Component Library', category: 'advanced', reason: 'Reusability focus' },
      { keyword: 'State Management', category: 'core', reason: 'App architecture skill' },
      { keyword: 'Cross-Browser', category: 'core', reason: 'Compatibility awareness' },
      { keyword: 'CSS Architecture', category: 'differentiator', reason: 'Maintainability' },
      { keyword: 'Bundle Optimization', category: 'advanced', reason: 'Performance expertise' },
    ],
  },
  {
    title: 'Backend Developer',
    aliases: ['backend engineer', 'server-side developer', 'api developer'],
    seniority: 'all',
    keywords: [
      { keyword: 'API Design', category: 'core', reason: 'Core responsibility' },
      { keyword: 'Database Optimization', category: 'advanced', reason: 'Performance critical' },
      { keyword: 'Authentication', category: 'core', reason: 'Security fundamental' },
      { keyword: 'Caching', category: 'advanced', reason: 'Scalability skill' },
      { keyword: 'Rate Limiting', category: 'core', reason: 'API protection' },
      { keyword: 'Message Queues', category: 'advanced', reason: 'Async processing' },
      { keyword: 'Data Modeling', category: 'core', reason: 'Database design' },
      { keyword: 'Load Balancing', category: 'differentiator', reason: 'Infrastructure awareness' },
    ],
  },
  {
    title: 'Data Analyst',
    aliases: ['business analyst', 'data analytics', 'analytics specialist'],
    seniority: 'all',
    keywords: [
      { keyword: 'Data Visualization', category: 'core', reason: 'Storytelling with data' },
      { keyword: 'Dashboard', category: 'core', reason: 'Reporting deliverable' },
      { keyword: 'Statistical Analysis', category: 'core', reason: 'Core methodology' },
      { keyword: 'ETL', category: 'advanced', reason: 'Data pipeline skills' },
      { keyword: 'Business Intelligence', category: 'core', reason: 'Strategic value' },
      { keyword: 'Stakeholder Reporting', category: 'core', reason: 'Communication skill' },
      { keyword: 'Data Quality', category: 'advanced', reason: 'Accuracy focus' },
      { keyword: 'Predictive Modeling', category: 'differentiator', reason: 'Advanced analytics' },
    ],
  },
  {
    title: 'Product Manager',
    aliases: ['pm', 'product owner', 'product lead', 'product management'],
    seniority: 'all',
    keywords: [
      { keyword: 'Product Roadmap', category: 'core', reason: 'Strategic planning' },
      { keyword: 'User Research', category: 'core', reason: 'Customer-centric approach' },
      { keyword: 'Prioritization', category: 'core', reason: 'Decision-making skill' },
      { keyword: 'Cross-Functional', category: 'core', reason: 'Collaboration essential' },
      { keyword: 'A/B Testing', category: 'advanced', reason: 'Data-driven decisions' },
      { keyword: 'OKRs', category: 'core', reason: 'Goal-setting framework' },
      { keyword: 'Go-to-Market', category: 'advanced', reason: 'Launch expertise' },
      { keyword: 'Product-Led Growth', category: 'differentiator', reason: 'Modern strategy' },
    ],
  },
  {
    title: 'UX Designer',
    aliases: ['ux/ui designer', 'ux design', 'product designer', 'user experience designer', 'interaction designer'],
    seniority: 'all',
    keywords: [
      { keyword: 'User Testing', category: 'core', reason: 'Validation methodology' },
      { keyword: 'Wireframing', category: 'core', reason: 'Design process' },
      { keyword: 'Design System', category: 'advanced', reason: 'Scalable design' },
      { keyword: 'Information Architecture', category: 'core', reason: 'Structural design' },
      { keyword: 'Journey Mapping', category: 'core', reason: 'User-centric approach' },
      { keyword: 'Prototype', category: 'core', reason: 'Iteration skill' },
      { keyword: 'Heuristic Evaluation', category: 'advanced', reason: 'Expert analysis' },
      { keyword: 'Design Handoff', category: 'differentiator', reason: 'Dev collaboration' },
    ],
  },
  // Marketing Roles
  {
    title: 'Marketing Manager',
    aliases: ['marketing director', 'marketing lead', 'head of marketing'],
    seniority: 'mid',
    keywords: [
      { keyword: 'Campaign Management', category: 'core', reason: 'Core responsibility' },
      { keyword: 'Marketing ROI', category: 'core', reason: 'Business impact focus' },
      { keyword: 'Brand Strategy', category: 'advanced', reason: 'Strategic thinking' },
      { keyword: 'Marketing Attribution', category: 'advanced', reason: 'Data sophistication' },
      { keyword: 'Budget Management', category: 'core', reason: 'Resource allocation' },
      { keyword: 'Team Leadership', category: 'core', reason: 'Management skill' },
      { keyword: 'Market Research', category: 'core', reason: 'Strategic input' },
      { keyword: 'Customer Acquisition', category: 'differentiator', reason: 'Growth focus' },
    ],
  },
  {
    title: 'Digital Marketing Specialist',
    aliases: ['digital marketer', 'online marketing', 'performance marketer'],
    seniority: 'entry',
    keywords: [
      { keyword: 'Paid Social', category: 'core', reason: 'Channel expertise' },
      { keyword: 'Conversion Rate', category: 'core', reason: 'Performance metric' },
      { keyword: 'Landing Page', category: 'core', reason: 'Optimization skill' },
      { keyword: 'Retargeting', category: 'advanced', reason: 'Advanced tactic' },
      { keyword: 'UTM Tracking', category: 'core', reason: 'Attribution basics' },
      { keyword: 'Ad Creative', category: 'core', reason: 'Content creation' },
      { keyword: 'ROAS', category: 'advanced', reason: 'Efficiency metric' },
      { keyword: 'Audience Segmentation', category: 'differentiator', reason: 'Targeting expertise' },
    ],
  },
  {
    title: 'Content Marketing Manager',
    aliases: ['content strategist', 'content manager', 'content marketing specialist'],
    seniority: 'mid',
    keywords: [
      { keyword: 'Content Strategy', category: 'core', reason: 'Core responsibility' },
      { keyword: 'Editorial Calendar', category: 'core', reason: 'Planning skill' },
      { keyword: 'Content Performance', category: 'core', reason: 'Metrics focus' },
      { keyword: 'Thought Leadership', category: 'advanced', reason: 'Brand building' },
      { keyword: 'Content Distribution', category: 'core', reason: 'Amplification' },
      { keyword: 'Storytelling', category: 'core', reason: 'Engagement driver' },
      { keyword: 'Content Repurposing', category: 'differentiator', reason: 'Efficiency' },
      { keyword: 'Brand Voice', category: 'advanced', reason: 'Consistency' },
    ],
  },
  // Sales Roles
  {
    title: 'Account Executive',
    aliases: ['sales executive', 'ae', 'sales rep', 'sales representative'],
    seniority: 'mid',
    keywords: [
      { keyword: 'Pipeline Generation', category: 'core', reason: 'Core metric' },
      { keyword: 'Discovery Calls', category: 'core', reason: 'Sales process' },
      { keyword: 'Proposal Development', category: 'core', reason: 'Deal progression' },
      { keyword: 'Quota Attainment', category: 'core', reason: 'Performance proof' },
      { keyword: 'Enterprise Sales', category: 'advanced', reason: 'Deal complexity' },
      { keyword: 'Contract Negotiation', category: 'advanced', reason: 'Closing skill' },
      { keyword: 'Sales Forecasting', category: 'core', reason: 'Predictability' },
      { keyword: 'Solution Selling', category: 'differentiator', reason: 'Consultative approach' },
    ],
  },
  {
    title: 'Sales Manager',
    aliases: ['sales director', 'head of sales', 'sales lead'],
    seniority: 'senior',
    keywords: [
      { keyword: 'Team Quota', category: 'core', reason: 'Team performance' },
      { keyword: 'Sales Coaching', category: 'core', reason: 'Development skill' },
      { keyword: 'Revenue Growth', category: 'core', reason: 'Business impact' },
      { keyword: 'Sales Playbook', category: 'advanced', reason: 'Process creation' },
      { keyword: 'Territory Planning', category: 'core', reason: 'Strategic allocation' },
      { keyword: 'Pipeline Review', category: 'core', reason: 'Management cadence' },
      { keyword: 'Sales Enablement', category: 'advanced', reason: 'Team effectiveness' },
      { keyword: 'Revenue Operations', category: 'differentiator', reason: 'Modern approach' },
    ],
  },
  // Operations Roles
  {
    title: 'Operations Manager',
    aliases: ['ops manager', 'operations lead', 'business operations'],
    seniority: 'mid',
    keywords: [
      { keyword: 'Process Optimization', category: 'core', reason: 'Core responsibility' },
      { keyword: 'SOP Development', category: 'core', reason: 'Documentation skill' },
      { keyword: 'Operational Efficiency', category: 'core', reason: 'Value driver' },
      { keyword: 'Cross-Functional', category: 'core', reason: 'Collaboration' },
      { keyword: 'Vendor Management', category: 'core', reason: 'External relationships' },
      { keyword: 'Cost Reduction', category: 'advanced', reason: 'Financial impact' },
      { keyword: 'Workflow Automation', category: 'differentiator', reason: 'Modern approach' },
      { keyword: 'Operational Metrics', category: 'core', reason: 'Data-driven' },
    ],
  },
  {
    title: 'Project Manager',
    aliases: ['program manager', 'project coordinator', 'delivery manager'],
    seniority: 'mid',
    keywords: [
      { keyword: 'Project Planning', category: 'core', reason: 'Core skill' },
      { keyword: 'Risk Mitigation', category: 'core', reason: 'Proactive management' },
      { keyword: 'Resource Allocation', category: 'core', reason: 'Team optimization' },
      { keyword: 'Milestone Tracking', category: 'core', reason: 'Progress visibility' },
      { keyword: 'Scope Management', category: 'advanced', reason: 'Boundary control' },
      { keyword: 'Stakeholder Updates', category: 'core', reason: 'Communication' },
      { keyword: 'Post-Mortem', category: 'differentiator', reason: 'Continuous improvement' },
      { keyword: 'Change Management', category: 'advanced', reason: 'Adaptability' },
    ],
  },
  // HR Roles
  {
    title: 'Recruiter',
    aliases: ['talent acquisition', 'recruiting coordinator', 'hr recruiter'],
    seniority: 'all',
    keywords: [
      { keyword: 'Sourcing', category: 'core', reason: 'Pipeline building' },
      { keyword: 'Candidate Experience', category: 'core', reason: 'Employer brand' },
      { keyword: 'Hiring Manager Partnership', category: 'core', reason: 'Stakeholder work' },
      { keyword: 'Offer Negotiation', category: 'advanced', reason: 'Closing skill' },
      { keyword: 'Time-to-Fill', category: 'core', reason: 'Efficiency metric' },
      { keyword: 'Employer Branding', category: 'advanced', reason: 'Strategic recruiting' },
      { keyword: 'Diversity Hiring', category: 'differentiator', reason: 'DEI focus' },
      { keyword: 'Pipeline Metrics', category: 'core', reason: 'Data-driven' },
    ],
  },
  {
    title: 'HR Business Partner',
    aliases: ['hrbp', 'human resources business partner', 'people partner', 'hr manager', 'people operations'],
    seniority: 'mid',
    keywords: [
      { keyword: 'Employee Relations', category: 'core', reason: 'Core responsibility' },
      { keyword: 'Performance Management', category: 'core', reason: 'Cycle ownership' },
      { keyword: 'Talent Development', category: 'core', reason: 'Growth focus' },
      { keyword: 'HR Analytics', category: 'advanced', reason: 'Data-driven HR' },
      { keyword: 'Organizational Design', category: 'advanced', reason: 'Strategic impact' },
      { keyword: 'Change Management', category: 'core', reason: 'Transition support' },
      { keyword: 'Workforce Planning', category: 'differentiator', reason: 'Strategic planning' },
      { keyword: 'Leadership Coaching', category: 'advanced', reason: 'Development skill' },
    ],
  },
  // Finance Roles
  {
    title: 'Financial Analyst',
    aliases: ['finance analyst', 'fp&a analyst', 'business finance analyst'],
    seniority: 'entry',
    keywords: [
      { keyword: 'Financial Modeling', category: 'core', reason: 'Core skill' },
      { keyword: 'Variance Analysis', category: 'core', reason: 'Performance tracking' },
      { keyword: 'Budget vs Actual', category: 'core', reason: 'Monitoring skill' },
      { keyword: 'Revenue Forecasting', category: 'advanced', reason: 'Predictive ability' },
      { keyword: 'Cost Analysis', category: 'core', reason: 'Efficiency focus' },
      { keyword: 'Executive Reporting', category: 'core', reason: 'Communication' },
      { keyword: 'Scenario Analysis', category: 'differentiator', reason: 'Strategic thinking' },
      { keyword: 'P&L Ownership', category: 'advanced', reason: 'Accountability' },
    ],
  },
  {
    title: 'Accountant',
    aliases: ['staff accountant', 'senior accountant', 'accounting specialist'],
    seniority: 'all',
    keywords: [
      { keyword: 'Month-End Close', category: 'core', reason: 'Core process' },
      { keyword: 'Account Reconciliation', category: 'core', reason: 'Accuracy skill' },
      { keyword: 'Journal Entries', category: 'core', reason: 'Fundamental task' },
      { keyword: 'Audit Support', category: 'core', reason: 'Compliance' },
      { keyword: 'GAAP Compliance', category: 'core', reason: 'Standards adherence' },
      { keyword: 'Financial Statements', category: 'core', reason: 'Reporting output' },
      { keyword: 'Process Improvement', category: 'differentiator', reason: 'Efficiency' },
      { keyword: 'ERP Systems', category: 'advanced', reason: 'Tool proficiency' },
    ],
  },
  // Customer Success
  {
    title: 'Customer Success Manager',
    aliases: ['csm', 'customer success', 'client success', 'customer success specialist'],
    seniority: 'mid',
    keywords: [
      { keyword: 'Customer Retention', category: 'core', reason: 'Core metric' },
      { keyword: 'Onboarding', category: 'core', reason: 'Customer journey' },
      { keyword: 'Churn Prevention', category: 'core', reason: 'Retention focus' },
      { keyword: 'QBR', category: 'core', reason: 'Review cadence' },
      { keyword: 'Upsell', category: 'advanced', reason: 'Revenue expansion' },
      { keyword: 'Health Score', category: 'core', reason: 'Proactive monitoring' },
      { keyword: 'Advocacy', category: 'differentiator', reason: 'Reference building' },
      { keyword: 'Renewal Management', category: 'core', reason: 'Contract continuity' },
    ],
  },
];

// Find matching role config. Aliases and title words are read as words of
// their own (register S13-092): "software".includes("of") made every
// "Director of Nursing" and "VP of Sales" a Software Engineer, and the alias
// "dev" caught every "Business Development Manager" (it stood for
// "developer", which is now an alias of its own). A title names a config when
// it holds the config's title or one of its aliases as a phrase, or every word
// of the config's title ("Senior Data Analyst" is a Data Analyst; "Store
// Manager" is not a Product Manager, and an Interior Designer is not a UX
// Designer). When several configs are named, the longest name wins, and a
// phrase beats the same number of scattered words: a "Senior Backend
// Developer" is a Backend Developer, not a developer; a "Product Marketing
// Manager" is a Marketing Manager. Otherwise nothing: no card beats the wrong
// one.
//
// A title word is also read in the short forms titles write it in ("Sr
// Software Engineer", "Account Exec", "Sr Mgr"). The name of the job's work
// counts only in the card's own phrase: "Project Management" and "Project
// Mgmt" are a Project Manager's, "Software Engineering" a Software
// Engineer's, "Accounting" an Accountant's, "Recruitment" a Recruiter's; but
// "Product Information Management" is no Product Manager's. A field word is
// never read as anything but itself, so one shared word still names nothing.
const TITLE_WORD_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  senior: ['sr', 'snr'],
  manager: ['mgr'],
  executive: ['exec'],
  engineer: ['eng', 'engr'],
};
const TITLE_WORK_NOUNS: Readonly<Record<string, readonly string[]>> = {
  manager: ['management', 'mgmt'],
  engineer: ['engineering'],
  developer: ['development'],
  designer: ['design'],
  analyst: ['analysis', 'analytics'],
  accountant: ['accounting'],
  recruiter: ['recruiting', 'recruitment'],
};
// The other ranks that run a field's work hold its manager's card: a Project
// Director, a Head of Marketing, a "VP, Sales", a Marketing Coordinator (as a
// Project Coordinator already holds the Project Manager's). The rank heads
// its part of the title ("Lead Project Engineer" and "Head Chef" are not
// ranks: "lead" counts only last or before a preposition, "head" only as
// "head of"); the field word heads its own phrase, in the rank's part or the
// next one ("Director, Physical Product Security" runs security, and "Business
// Lead (Finance, Vendor, Product...)" names a product four parts away).
const MANAGER_RANKS: readonly string[] = ['director', 'vp', 'avp', 'svp', 'evp', 'vice president', 'coordinator', 'leader', 'lead', 'head of'];
const RANK_LAST_OR_PREPOSITION = new Set(['lead']);
const FIELD_WORD_ENDS = new Set(['&', 'and', 'or', 'at', 'in', 'for', 'the', 'with']);
// A field whose job is named by its subject rather than by its card's words:
// a full-stack or platform engineer (or developer) writes software; financial
// planning and FP&A are a financial analyst's work; a BI, business
// intelligence or reporting analyst (or developer) does a data analyst's.
// The subject stands at most one word before the head ("Full Stack Java
// Engineer"); "Senior Analyst - Regulatory Reporting" reports to a regulator.
const FIELD_FAMILIES: ReadonlyArray<{ config: string; subjects: readonly string[][]; heads: readonly string[] }> = [
  { config: 'Software Engineer', subjects: [['full', 'stack'], ['fullstack'], ['platform']], heads: ['engineer', 'engineers', 'engineering', 'developer', 'developers'] },
  { config: 'Financial Analyst', subjects: [['fp&a'], ['financial', 'planning']], heads: [] },
  { config: 'Data Analyst', subjects: [['bi'], ['business', 'intelligence'], ['reporting']], heads: ['analyst', 'analysts', 'developer', 'developers'] },
];
// A one-word alias names a config only as the head of its part of the title:
// "Developer Relations Manager" and "Developer Experience Lead" work with
// developers, and "PM Legal" is no product manager. A level, a preposition or
// nothing may follow it ("Developer II", "Developer Intern", "Developer for
// Health Education").
const AFTER_HEAD = /^(?:[ivx]+|\d+|intern|interns|internship|trainee|apprentice|graduate|associate|senior|sr|junior|jr|lead|for|in|at|with|of|on|to|and|&|or)$/;
// "Developer" names other work too: a business, product, content, proposal,
// editorial, curriculum or property developer writes no software. Nor is a
// student, member, donor or study-participant recruiter hiring staff.
const NOT_SOFTWARE_DEVELOPER = /(?:^|[^\p{L}\p{N}])(?:business|product|content|proposal|editorial|curriculum|course|instructional|learning|training|talent|leadership|organi[sz]ational|property|land|estate|project|fund|donor|community|formulation|process|method|assay|recipe|menu|concept|brand)s?[\s/-]+dev(?:eloper)?s?(?![\p{L}\p{N}])/iu;
const NOT_STAFF_RECRUITING = /(?:^|[^\p{L}\p{N}])(?:student|membership|member|donor|participant|patient|study|trial|subject|admissions?|enrol(?:l)?ment|volunteer)s?[\s/-]+recruit(?:er|ers|ing|ment)(?![\p{L}\p{N}])/iu;

// A teaching post names the subject taught, not the job: a "Lecturer in
// Software Engineering" or an "Accounting Instructor" gets no card.
const TEACHING_POST = /(?<![\p{L}\p{N}])(?:teacher|lecturer|instructor|professor|adjunct|tutor|faculty|lehrer(?:in)?|docent|enseignant|profesor|professeur)s?(?![\p{L}\p{N}])/iu;

const PART_BREAK = /\s*[–—|/]\s*|\s+-\s*|-\s+|[,;:()[\]{}·•\u3000]/u;
const bare = (word: string) => word.toLowerCase().replace(/^[^\p{L}\p{N}&]+|[^\p{L}\p{N}+#&]+$/gu, '');
function titleParts(title: string): string[][] {
  return title.split(PART_BREAK).map(part => part.split(/[\s-]+/).map(bare).filter(Boolean)).filter(words => words.length > 0);
}
const at = (words: string[], i: number, seq: readonly string[]) => seq.every((w, k) => words[i + k] === w);

function holdsWord(roleTitle: string, word: string): boolean {
  return resumeHasTerm(roleTitle, word) || (TITLE_WORD_ABBREVIATIONS[word] ?? []).some(form => resumeHasTerm(roleTitle, form));
}

// The card's title phrase with its last word written as the job's work.
function holdsWorkPhrase(roleTitle: string, titleWords: string[]): boolean {
  const head = titleWords[titleWords.length - 1];
  const lead = titleWords.slice(0, -1);
  return (TITLE_WORK_NOUNS[head] ?? []).some(noun => resumeHasTerm(roleTitle, [...lead, noun].join(' ')));
}

// Whether a one-word alias heads a part of the title (see AFTER_HEAD).
function aliasHeads(parts: string[][], alias: string): boolean {
  return parts.some(words => words.some((w, i) => w === alias && (words[i + 1] === undefined || AFTER_HEAD.test(words[i + 1]))));
}

// Whether the field word `field` and a manager's rank head the title together
// (see MANAGER_RANKS).
function rankRunsField(parts: string[][], field: string): boolean {
  const rankAt: Array<[number, number, number]> = [];
  parts.forEach((words, p) => words.forEach((_, i) => {
    for (const rank of MANAGER_RANKS) {
      const seq = rank.split(' ');
      if (!at(words, i, seq)) continue;
      const next = words[i + seq.length];
      if (RANK_LAST_OR_PREPOSITION.has(rank) && next !== undefined && next !== 'of' && next !== 'for' && next !== 'to') continue;
      rankAt.push([p, i, seq.length]);
    }
  }));
  if (rankAt.length === 0) return false;
  return parts.some((words, p) => words.some((w, i) => {
    if (w !== field) return false;
    const next = words[i + 1];
    return rankAt.some(([rp, ri]) => Math.abs(rp - p) <= 1
      && (next === undefined || FIELD_WORD_ENDS.has(next) || (rp === p && ri === i + 1)));
  }));
}

// Whether a family's subject stands at most one word before its head.
function familyNames(parts: string[][], family: (typeof FIELD_FAMILIES)[number], roleTitle: string): boolean {
  if (family.heads.length === 0) return family.subjects.some(s => resumeHasTerm(roleTitle, s.join(' ')));
  return parts.some(words => words.some((_, i) => family.subjects.some(s => at(words, i, s)
    && [0, 1].some(gap => family.heads.includes(words[i + s.length + gap] ?? '')))));
}

export function findRoleConfig(roleTitle: string): RoleKeywordConfig | null {
  const normalized = roleTitle.toLowerCase().trim();
  if (!normalized || TEACHING_POST.test(roleTitle)) return null;
  const parts = titleParts(roleTitle);
  const softwareSense = !NOT_SOFTWARE_DEVELOPER.test(roleTitle);
  const staffSense = !NOT_STAFF_RECRUITING.test(roleTitle);

  let best: RoleKeywordConfig | null = null;
  let bestScore = 0;
  for (const config of ROLE_KEYWORDS) {
    if (config.title.toLowerCase() === normalized || config.aliases.includes(normalized)) return config;
    if (config.title === 'Recruiter' && !staffSense) continue;
    const titleWords = config.title.toLowerCase().split(' ');
    let score = 0;
    for (const name of [config.title.toLowerCase(), ...config.aliases]) {
      if (!resumeHasTerm(roleTitle, name)) continue;
      const oneWord = !/\s/.test(name);
      if (oneWord && name !== titleWords.join(' ') && !aliasHeads(parts, name)) continue;
      if ((name === 'developer' || name === 'dev') && !softwareSense) continue;
      score = Math.max(score, name.split(' ').length + 0.5);
    }
    if (score === 0 && holdsWorkPhrase(roleTitle, titleWords)) score = titleWords.length + 0.5;
    if (score === 0 && titleWords.every(word => holdsWord(roleTitle, word))) score = titleWords.length;
    const fieldWords = titleWords.slice(0, -1);
    if (score === 0 && titleWords[titleWords.length - 1] === 'manager' && fieldWords.length > 0
      && fieldWords.every(word => holdsWord(roleTitle, word)) && rankRunsField(parts, fieldWords[fieldWords.length - 1])) {
      score = titleWords.length - 0.25;
    }
    if (score === 0 && FIELD_FAMILIES.some(f => f.config === config.title && familyNames(parts, f, roleTitle))) score = 1.75;
    if (score > bestScore) {
      best = config;
      bestScore = score;
    }
  }
  return best;
}

// Analyze which role keywords are present in resume
export function analyzeRoleKeywords(
  roleTitle: string,
  resumeText: string
): { present: RoleKeyword[]; missing: RoleKeyword[]; config: RoleKeywordConfig | null } {
  const config = findRoleConfig(roleTitle);
  if (!config) return { present: [], missing: [], config: null };
  
  const present: RoleKeyword[] = [];
  const missing: RoleKeyword[] = [];
  
  for (const keyword of config.keywords) {
    // A word of its own, in any of its spellings ("CI/CD", "CI-CD", "cicd"):
    // the scanner's own test (S13-092).
    const isPresent = resumeHasTerm(resumeText, keyword.keyword);
    
    if (isPresent) {
      present.push(keyword);
    } else {
      missing.push(keyword);
    }
  }
  
  // Sort by category priority
  const categoryOrder = { core: 0, advanced: 1, differentiator: 2 };
  present.sort((a, b) => categoryOrder[a.category] - categoryOrder[b.category]);
  missing.sort((a, b) => categoryOrder[a.category] - categoryOrder[b.category]);
  
  return { present, missing, config };
}
