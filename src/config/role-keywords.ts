// Role-specific keywords database
// Keywords tailored to specific job titles beyond industry-level keywords

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
    aliases: ['software developer', 'programmer', 'swe', 'dev', 'coder'],
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
    aliases: ['ux/ui designer', 'product designer', 'user experience designer', 'interaction designer'],
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
    aliases: ['hrbp', 'people partner', 'hr manager'],
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
    aliases: ['csm', 'client success', 'customer success specialist'],
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

// Find matching role config
export function findRoleConfig(roleTitle: string): RoleKeywordConfig | null {
  const normalized = roleTitle.toLowerCase().trim();
  
  for (const config of ROLE_KEYWORDS) {
    if (config.title.toLowerCase() === normalized) {
      return config;
    }
    if (config.aliases.some(alias => 
      normalized.includes(alias) || alias.includes(normalized)
    )) {
      return config;
    }
  }
  
  // Partial matching for common patterns
  for (const config of ROLE_KEYWORDS) {
    const titleWords = config.title.toLowerCase().split(' ');
    const normalizedWords = normalized.split(' ');
    
    // Check if any significant words match
    const matchingWords = titleWords.filter(word => 
      word.length > 3 && normalizedWords.some(nw => nw.includes(word) || word.includes(nw))
    );
    
    if (matchingWords.length >= 1) {
      return config;
    }
  }
  
  return null;
}

// Analyze which role keywords are present in resume
export function analyzeRoleKeywords(
  roleTitle: string,
  resumeText: string
): { present: RoleKeyword[]; missing: RoleKeyword[]; config: RoleKeywordConfig | null } {
  const config = findRoleConfig(roleTitle);
  if (!config) return { present: [], missing: [], config: null };
  
  const normalizedResume = resumeText.toLowerCase();
  const present: RoleKeyword[] = [];
  const missing: RoleKeyword[] = [];
  
  for (const keyword of config.keywords) {
    const normalizedKeyword = keyword.keyword.toLowerCase();
    const isPresent = normalizedResume.includes(normalizedKeyword) ||
      normalizedResume.includes(normalizedKeyword.replace(/\s+/g, '')) ||
      normalizedResume.includes(normalizedKeyword.replace(/-/g, ' '));
    
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
