// Industry-specific keywords database
// Keywords are ranked by importance for ATS matching

export interface IndustryKeyword {
  keyword: string;
  category: 'technical' | 'soft' | 'certification' | 'tool' | 'methodology';
  importance: 'critical' | 'high' | 'medium';
}

export interface IndustryKeywordConfig {
  name: string;
  aliases: string[];
  keywords: IndustryKeyword[];
}

export const INDUSTRY_KEYWORDS: Record<string, IndustryKeywordConfig> = {
  technology: {
    name: 'Technology',
    aliases: ['tech', 'software', 'it', 'information technology', 'software development', 'engineering'],
    keywords: [
      { keyword: 'Agile', category: 'methodology', importance: 'critical' },
      { keyword: 'Scrum', category: 'methodology', importance: 'high' },
      { keyword: 'CI/CD', category: 'methodology', importance: 'high' },
      { keyword: 'Cloud Computing', category: 'technical', importance: 'critical' },
      { keyword: 'AWS', category: 'tool', importance: 'critical' },
      { keyword: 'Python', category: 'technical', importance: 'high' },
      { keyword: 'JavaScript', category: 'technical', importance: 'high' },
      { keyword: 'SQL', category: 'technical', importance: 'high' },
      { keyword: 'API', category: 'technical', importance: 'high' },
      { keyword: 'Machine Learning', category: 'technical', importance: 'medium' },
      { keyword: 'Data Analysis', category: 'technical', importance: 'high' },
      { keyword: 'Git', category: 'tool', importance: 'high' },
      { keyword: 'DevOps', category: 'methodology', importance: 'high' },
      { keyword: 'Microservices', category: 'technical', importance: 'medium' },
      { keyword: 'REST', category: 'technical', importance: 'high' },
    ],
  },
  finance: {
    name: 'Finance',
    aliases: ['financial services', 'banking', 'investment', 'fintech', 'accounting'],
    keywords: [
      { keyword: 'Financial Analysis', category: 'technical', importance: 'critical' },
      { keyword: 'Risk Management', category: 'technical', importance: 'critical' },
      { keyword: 'Excel', category: 'tool', importance: 'critical' },
      { keyword: 'Financial Modeling', category: 'technical', importance: 'high' },
      { keyword: 'Bloomberg', category: 'tool', importance: 'high' },
      { keyword: 'Compliance', category: 'technical', importance: 'high' },
      { keyword: 'GAAP', category: 'certification', importance: 'high' },
      { keyword: 'Budgeting', category: 'technical', importance: 'high' },
      { keyword: 'Forecasting', category: 'technical', importance: 'high' },
      { keyword: 'SQL', category: 'tool', importance: 'medium' },
      { keyword: 'CFA', category: 'certification', importance: 'high' },
      { keyword: 'Due Diligence', category: 'technical', importance: 'medium' },
      { keyword: 'Portfolio Management', category: 'technical', importance: 'medium' },
      { keyword: 'Valuation', category: 'technical', importance: 'high' },
      { keyword: 'P&L', category: 'technical', importance: 'high' },
    ],
  },
  healthcare: {
    name: 'Healthcare',
    aliases: ['medical', 'health', 'pharmaceutical', 'biotech', 'clinical', 'nursing'],
    keywords: [
      { keyword: 'Patient Care', category: 'technical', importance: 'critical' },
      { keyword: 'HIPAA', category: 'certification', importance: 'critical' },
      { keyword: 'EMR/EHR', category: 'tool', importance: 'critical' },
      { keyword: 'Clinical Research', category: 'technical', importance: 'high' },
      { keyword: 'FDA Regulations', category: 'certification', importance: 'high' },
      { keyword: 'Medical Terminology', category: 'technical', importance: 'high' },
      { keyword: 'Patient Safety', category: 'technical', importance: 'high' },
      { keyword: 'CPR Certified', category: 'certification', importance: 'high' },
      { keyword: 'Epic', category: 'tool', importance: 'high' },
      { keyword: 'Care Coordination', category: 'technical', importance: 'medium' },
      { keyword: 'Quality Assurance', category: 'technical', importance: 'medium' },
      { keyword: 'BLS', category: 'certification', importance: 'high' },
      { keyword: 'Case Management', category: 'technical', importance: 'medium' },
      { keyword: 'Diagnostic', category: 'technical', importance: 'medium' },
      { keyword: 'Treatment Planning', category: 'technical', importance: 'medium' },
    ],
  },
  marketing: {
    name: 'Marketing',
    aliases: ['digital marketing', 'advertising', 'brand', 'communications', 'content'],
    keywords: [
      { keyword: 'SEO', category: 'technical', importance: 'critical' },
      { keyword: 'Google Analytics', category: 'tool', importance: 'critical' },
      { keyword: 'Content Strategy', category: 'technical', importance: 'critical' },
      { keyword: 'Social Media', category: 'technical', importance: 'high' },
      { keyword: 'PPC', category: 'technical', importance: 'high' },
      { keyword: 'Email Marketing', category: 'technical', importance: 'high' },
      { keyword: 'CRM', category: 'tool', importance: 'high' },
      { keyword: 'HubSpot', category: 'tool', importance: 'high' },
      { keyword: 'A/B Testing', category: 'methodology', importance: 'high' },
      { keyword: 'Brand Management', category: 'technical', importance: 'medium' },
      { keyword: 'ROI', category: 'technical', importance: 'high' },
      { keyword: 'Lead Generation', category: 'technical', importance: 'high' },
      { keyword: 'Marketing Automation', category: 'tool', importance: 'medium' },
      { keyword: 'Copywriting', category: 'technical', importance: 'medium' },
      { keyword: 'Campaign Management', category: 'technical', importance: 'high' },
    ],
  },
  sales: {
    name: 'Sales',
    aliases: ['business development', 'account management', 'sales management', 'retail'],
    keywords: [
      { keyword: 'CRM', category: 'tool', importance: 'critical' },
      { keyword: 'Salesforce', category: 'tool', importance: 'critical' },
      { keyword: 'Pipeline Management', category: 'technical', importance: 'critical' },
      { keyword: 'Revenue Growth', category: 'technical', importance: 'high' },
      { keyword: 'Quota Attainment', category: 'technical', importance: 'high' },
      { keyword: 'Lead Generation', category: 'technical', importance: 'high' },
      { keyword: 'Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'Account Management', category: 'technical', importance: 'high' },
      { keyword: 'B2B', category: 'technical', importance: 'medium' },
      { keyword: 'B2C', category: 'technical', importance: 'medium' },
      { keyword: 'Cold Calling', category: 'technical', importance: 'medium' },
      { keyword: 'Closing', category: 'technical', importance: 'high' },
      { keyword: 'Client Retention', category: 'technical', importance: 'medium' },
      { keyword: 'Territory Management', category: 'technical', importance: 'medium' },
      { keyword: 'Upselling', category: 'technical', importance: 'medium' },
    ],
  },
  humanResources: {
    name: 'Human Resources',
    aliases: ['hr', 'people operations', 'talent', 'recruiting', 'recruitment'],
    keywords: [
      { keyword: 'Talent Acquisition', category: 'technical', importance: 'critical' },
      { keyword: 'HRIS', category: 'tool', importance: 'critical' },
      { keyword: 'Employee Relations', category: 'technical', importance: 'high' },
      { keyword: 'Onboarding', category: 'technical', importance: 'high' },
      { keyword: 'Performance Management', category: 'technical', importance: 'high' },
      { keyword: 'Workday', category: 'tool', importance: 'high' },
      { keyword: 'ADP', category: 'tool', importance: 'high' },
      { keyword: 'Compensation', category: 'technical', importance: 'medium' },
      { keyword: 'Benefits Administration', category: 'technical', importance: 'medium' },
      { keyword: 'Compliance', category: 'technical', importance: 'high' },
      { keyword: 'SHRM', category: 'certification', importance: 'high' },
      { keyword: 'Training & Development', category: 'technical', importance: 'medium' },
      { keyword: 'Diversity & Inclusion', category: 'technical', importance: 'medium' },
      { keyword: 'Employee Engagement', category: 'technical', importance: 'medium' },
      { keyword: 'Succession Planning', category: 'technical', importance: 'medium' },
    ],
  },
  consulting: {
    name: 'Consulting',
    aliases: ['management consulting', 'strategy', 'advisory', 'professional services'],
    keywords: [
      { keyword: 'Strategy', category: 'technical', importance: 'critical' },
      { keyword: 'Stakeholder Management', category: 'soft', importance: 'critical' },
      { keyword: 'Business Analysis', category: 'technical', importance: 'high' },
      { keyword: 'PowerPoint', category: 'tool', importance: 'high' },
      { keyword: 'Excel', category: 'tool', importance: 'high' },
      { keyword: 'Problem Solving', category: 'soft', importance: 'high' },
      { keyword: 'Client Engagement', category: 'technical', importance: 'high' },
      { keyword: 'Process Improvement', category: 'technical', importance: 'high' },
      { keyword: 'Change Management', category: 'methodology', importance: 'high' },
      { keyword: 'Data Analysis', category: 'technical', importance: 'medium' },
      { keyword: 'Project Management', category: 'methodology', importance: 'high' },
      { keyword: 'PMP', category: 'certification', importance: 'medium' },
      { keyword: 'ROI', category: 'technical', importance: 'medium' },
      { keyword: 'Due Diligence', category: 'technical', importance: 'medium' },
      { keyword: 'Executive Presentation', category: 'soft', importance: 'medium' },
    ],
  },
  education: {
    name: 'Education',
    aliases: ['teaching', 'academic', 'university', 'school', 'training', 'e-learning'],
    keywords: [
      { keyword: 'Curriculum Development', category: 'technical', importance: 'critical' },
      { keyword: 'Lesson Planning', category: 'technical', importance: 'critical' },
      { keyword: 'Student Engagement', category: 'technical', importance: 'high' },
      { keyword: 'Classroom Management', category: 'technical', importance: 'high' },
      { keyword: 'Assessment', category: 'technical', importance: 'high' },
      { keyword: 'LMS', category: 'tool', importance: 'high' },
      { keyword: 'Differentiated Instruction', category: 'methodology', importance: 'high' },
      { keyword: 'IEP', category: 'technical', importance: 'medium' },
      { keyword: 'EdTech', category: 'tool', importance: 'medium' },
      { keyword: 'Google Classroom', category: 'tool', importance: 'medium' },
      { keyword: 'State Standards', category: 'technical', importance: 'medium' },
      { keyword: 'Student Achievement', category: 'technical', importance: 'high' },
      { keyword: 'Parent Communication', category: 'soft', importance: 'medium' },
      { keyword: 'Professional Development', category: 'technical', importance: 'medium' },
      { keyword: 'Data-Driven Instruction', category: 'methodology', importance: 'medium' },
    ],
  },
  operations: {
    name: 'Operations',
    aliases: ['operations management', 'supply chain', 'logistics', 'manufacturing', 'production'],
    keywords: [
      { keyword: 'Process Improvement', category: 'technical', importance: 'critical' },
      { keyword: 'Lean', category: 'methodology', importance: 'critical' },
      { keyword: 'Six Sigma', category: 'methodology', importance: 'critical' },
      { keyword: 'Supply Chain', category: 'technical', importance: 'high' },
      { keyword: 'Inventory Management', category: 'technical', importance: 'high' },
      { keyword: 'ERP', category: 'tool', importance: 'high' },
      { keyword: 'SAP', category: 'tool', importance: 'high' },
      { keyword: 'KPI', category: 'technical', importance: 'high' },
      { keyword: 'Cost Reduction', category: 'technical', importance: 'high' },
      { keyword: 'Vendor Management', category: 'technical', importance: 'medium' },
      { keyword: 'Quality Control', category: 'technical', importance: 'medium' },
      { keyword: 'Logistics', category: 'technical', importance: 'medium' },
      { keyword: 'Capacity Planning', category: 'technical', importance: 'medium' },
      { keyword: 'Continuous Improvement', category: 'methodology', importance: 'high' },
      { keyword: 'ISO', category: 'certification', importance: 'medium' },
    ],
  },
  design: {
    name: 'Design',
    aliases: ['ux', 'ui', 'graphic design', 'product design', 'creative', 'visual design'],
    keywords: [
      { keyword: 'Figma', category: 'tool', importance: 'critical' },
      { keyword: 'User Research', category: 'technical', importance: 'critical' },
      { keyword: 'Prototyping', category: 'technical', importance: 'high' },
      { keyword: 'Wireframing', category: 'technical', importance: 'high' },
      { keyword: 'Adobe Creative Suite', category: 'tool', importance: 'high' },
      { keyword: 'Design Systems', category: 'technical', importance: 'high' },
      { keyword: 'Usability Testing', category: 'methodology', importance: 'high' },
      { keyword: 'Sketch', category: 'tool', importance: 'medium' },
      { keyword: 'Information Architecture', category: 'technical', importance: 'medium' },
      { keyword: 'Interaction Design', category: 'technical', importance: 'medium' },
      { keyword: 'Visual Design', category: 'technical', importance: 'high' },
      { keyword: 'Accessibility', category: 'technical', importance: 'high' },
      { keyword: 'Design Thinking', category: 'methodology', importance: 'medium' },
      { keyword: 'Typography', category: 'technical', importance: 'medium' },
      { keyword: 'Responsive Design', category: 'technical', importance: 'high' },
    ],
  },
  legal: {
    name: 'Legal',
    aliases: ['law', 'attorney', 'paralegal', 'compliance', 'regulatory'],
    keywords: [
      { keyword: 'Legal Research', category: 'technical', importance: 'critical' },
      { keyword: 'Contract Review', category: 'technical', importance: 'critical' },
      { keyword: 'Compliance', category: 'technical', importance: 'high' },
      { keyword: 'Due Diligence', category: 'technical', importance: 'high' },
      { keyword: 'Litigation', category: 'technical', importance: 'high' },
      { keyword: 'Westlaw', category: 'tool', importance: 'high' },
      { keyword: 'LexisNexis', category: 'tool', importance: 'high' },
      { keyword: 'Corporate Law', category: 'technical', importance: 'medium' },
      { keyword: 'Regulatory', category: 'technical', importance: 'medium' },
      { keyword: 'Drafting', category: 'technical', importance: 'high' },
      { keyword: 'Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'IP', category: 'technical', importance: 'medium' },
      { keyword: 'M&A', category: 'technical', importance: 'medium' },
      { keyword: 'Risk Assessment', category: 'technical', importance: 'medium' },
      { keyword: 'Case Management', category: 'tool', importance: 'medium' },
    ],
  },
  dataScience: {
    name: 'Data Science',
    aliases: ['data analytics', 'machine learning', 'ai', 'artificial intelligence', 'analytics'],
    keywords: [
      { keyword: 'Python', category: 'technical', importance: 'critical' },
      { keyword: 'Machine Learning', category: 'technical', importance: 'critical' },
      { keyword: 'SQL', category: 'technical', importance: 'critical' },
      { keyword: 'Data Visualization', category: 'technical', importance: 'high' },
      { keyword: 'TensorFlow', category: 'tool', importance: 'high' },
      { keyword: 'Statistical Analysis', category: 'technical', importance: 'high' },
      { keyword: 'R', category: 'technical', importance: 'medium' },
      { keyword: 'Tableau', category: 'tool', importance: 'high' },
      { keyword: 'Deep Learning', category: 'technical', importance: 'medium' },
      { keyword: 'NLP', category: 'technical', importance: 'medium' },
      { keyword: 'Pandas', category: 'tool', importance: 'high' },
      { keyword: 'Data Modeling', category: 'technical', importance: 'high' },
      { keyword: 'A/B Testing', category: 'methodology', importance: 'high' },
      { keyword: 'ETL', category: 'technical', importance: 'medium' },
      { keyword: 'Big Data', category: 'technical', importance: 'medium' },
    ],
  },
  projectManagement: {
    name: 'Project Management',
    aliases: ['program management', 'pmo', 'project coordinator'],
    keywords: [
      { keyword: 'PMP', category: 'certification', importance: 'critical' },
      { keyword: 'Agile', category: 'methodology', importance: 'critical' },
      { keyword: 'Scrum', category: 'methodology', importance: 'high' },
      { keyword: 'Stakeholder Management', category: 'soft', importance: 'critical' },
      { keyword: 'Risk Management', category: 'technical', importance: 'high' },
      { keyword: 'Jira', category: 'tool', importance: 'high' },
      { keyword: 'MS Project', category: 'tool', importance: 'high' },
      { keyword: 'Budget Management', category: 'technical', importance: 'high' },
      { keyword: 'Resource Allocation', category: 'technical', importance: 'medium' },
      { keyword: 'Gantt Charts', category: 'tool', importance: 'medium' },
      { keyword: 'Sprint Planning', category: 'methodology', importance: 'medium' },
      { keyword: 'Waterfall', category: 'methodology', importance: 'medium' },
      { keyword: 'Cross-Functional', category: 'soft', importance: 'high' },
      { keyword: 'Timeline Management', category: 'technical', importance: 'high' },
      { keyword: 'Scope Management', category: 'technical', importance: 'medium' },
    ],
  },
  customerService: {
    name: 'Customer Service',
    aliases: ['customer support', 'client services', 'customer success', 'support'],
    keywords: [
      { keyword: 'Customer Satisfaction', category: 'technical', importance: 'critical' },
      { keyword: 'CRM', category: 'tool', importance: 'critical' },
      { keyword: 'Problem Resolution', category: 'technical', importance: 'high' },
      { keyword: 'Zendesk', category: 'tool', importance: 'high' },
      { keyword: 'Salesforce', category: 'tool', importance: 'high' },
      { keyword: 'Communication', category: 'soft', importance: 'high' },
      { keyword: 'Conflict Resolution', category: 'soft', importance: 'high' },
      { keyword: 'SLA', category: 'technical', importance: 'medium' },
      { keyword: 'First Call Resolution', category: 'technical', importance: 'medium' },
      { keyword: 'NPS', category: 'technical', importance: 'medium' },
      { keyword: 'Ticket Management', category: 'technical', importance: 'medium' },
      { keyword: 'Empathy', category: 'soft', importance: 'high' },
      { keyword: 'Multitasking', category: 'soft', importance: 'medium' },
      { keyword: 'Product Knowledge', category: 'technical', importance: 'medium' },
      { keyword: 'Escalation', category: 'technical', importance: 'medium' },
    ],
  },
  hospitality: {
    name: 'Hospitality',
    aliases: ['hotel', 'restaurant', 'food service', 'tourism', 'event management', 'catering'],
    keywords: [
      { keyword: 'Guest Satisfaction', category: 'technical', importance: 'critical' },
      { keyword: 'Revenue Management', category: 'technical', importance: 'critical' },
      { keyword: 'OPERA', category: 'tool', importance: 'high' },
      { keyword: 'ServSafe', category: 'certification', importance: 'high' },
      { keyword: 'Food Cost Control', category: 'technical', importance: 'high' },
      { keyword: 'Front Office', category: 'technical', importance: 'high' },
      { keyword: 'Housekeeping Management', category: 'technical', importance: 'medium' },
      { keyword: 'Event Coordination', category: 'technical', importance: 'high' },
      { keyword: 'POS Systems', category: 'tool', importance: 'high' },
      { keyword: 'Customer Service', category: 'soft', importance: 'critical' },
      { keyword: 'Banquet Operations', category: 'technical', importance: 'medium' },
      { keyword: 'Yield Management', category: 'technical', importance: 'medium' },
      { keyword: 'HACCP', category: 'certification', importance: 'high' },
      { keyword: 'STR Reports', category: 'tool', importance: 'medium' },
      { keyword: 'Labor Cost Management', category: 'technical', importance: 'high' },
    ],
  },
  manufacturing: {
    name: 'Manufacturing',
    aliases: ['production', 'factory', 'assembly', 'quality', 'lean', 'industrial'],
    keywords: [
      { keyword: 'Lean Manufacturing', category: 'methodology', importance: 'critical' },
      { keyword: 'Six Sigma', category: 'certification', importance: 'critical' },
      { keyword: 'Quality Control', category: 'technical', importance: 'critical' },
      { keyword: 'ISO 9001', category: 'certification', importance: 'high' },
      { keyword: 'ERP', category: 'tool', importance: 'high' },
      { keyword: 'SAP', category: 'tool', importance: 'high' },
      { keyword: 'CNC', category: 'technical', importance: 'high' },
      { keyword: 'GD&T', category: 'technical', importance: 'high' },
      { keyword: 'Kaizen', category: 'methodology', importance: 'high' },
      { keyword: '5S', category: 'methodology', importance: 'medium' },
      { keyword: 'OSHA', category: 'certification', importance: 'high' },
      { keyword: 'Root Cause Analysis', category: 'methodology', importance: 'high' },
      { keyword: 'SPC', category: 'technical', importance: 'medium' },
      { keyword: 'TPM', category: 'methodology', importance: 'medium' },
      { keyword: 'Value Stream Mapping', category: 'methodology', importance: 'medium' },
    ],
  },
  nonprofit: {
    name: 'Nonprofit',
    aliases: ['ngo', 'charity', 'foundation', 'philanthropy', 'social impact', '501c3'],
    keywords: [
      { keyword: 'Fundraising', category: 'technical', importance: 'critical' },
      { keyword: 'Grant Writing', category: 'technical', importance: 'critical' },
      { keyword: 'Donor Relations', category: 'technical', importance: 'critical' },
      { keyword: 'Program Evaluation', category: 'technical', importance: 'high' },
      { keyword: 'Impact Measurement', category: 'technical', importance: 'high' },
      { keyword: 'CRM', category: 'tool', importance: 'high' },
      { keyword: 'Raiser\'s Edge', category: 'tool', importance: 'high' },
      { keyword: 'Volunteer Management', category: 'technical', importance: 'high' },
      { keyword: 'Stewardship', category: 'technical', importance: 'high' },
      { keyword: 'Community Outreach', category: 'technical', importance: 'medium' },
      { keyword: 'Major Gifts', category: 'technical', importance: 'high' },
      { keyword: 'Board Relations', category: 'soft', importance: 'medium' },
      { keyword: 'Annual Fund', category: 'technical', importance: 'medium' },
      { keyword: 'Capital Campaign', category: 'technical', importance: 'medium' },
      { keyword: 'Advocacy', category: 'technical', importance: 'medium' },
    ],
  },
  logistics: {
    name: 'Logistics',
    aliases: ['supply chain', 'shipping', 'warehouse', 'distribution', 'freight', 'transportation'],
    keywords: [
      { keyword: 'Supply Chain Management', category: 'technical', importance: 'critical' },
      { keyword: 'WMS', category: 'tool', importance: 'critical' },
      { keyword: 'TMS', category: 'tool', importance: 'high' },
      { keyword: 'Inventory Optimization', category: 'technical', importance: 'critical' },
      { keyword: 'SAP', category: 'tool', importance: 'high' },
      { keyword: 'Oracle SCM', category: 'tool', importance: 'high' },
      { keyword: 'Demand Forecasting', category: 'technical', importance: 'high' },
      { keyword: 'Logistics Planning', category: 'technical', importance: 'high' },
      { keyword: 'Route Optimization', category: 'technical', importance: 'medium' },
      { keyword: 'Vendor Management', category: 'technical', importance: 'high' },
      { keyword: 'Cost Reduction', category: 'technical', importance: 'high' },
      { keyword: 'CPIM', category: 'certification', importance: 'high' },
      { keyword: 'CSCP', category: 'certification', importance: 'high' },
      { keyword: '3PL', category: 'technical', importance: 'medium' },
      { keyword: 'Just-In-Time', category: 'methodology', importance: 'medium' },
    ],
  },
  government: {
    name: 'Government',
    aliases: ['public sector', 'federal', 'state', 'municipal', 'policy', 'public administration'],
    keywords: [
      { keyword: 'Policy Analysis', category: 'technical', importance: 'critical' },
      { keyword: 'Budget Management', category: 'technical', importance: 'critical' },
      { keyword: 'Public Administration', category: 'technical', importance: 'high' },
      { keyword: 'Regulatory Compliance', category: 'technical', importance: 'high' },
      { keyword: 'Grant Management', category: 'technical', importance: 'high' },
      { keyword: 'Stakeholder Engagement', category: 'soft', importance: 'high' },
      { keyword: 'Program Evaluation', category: 'technical', importance: 'high' },
      { keyword: 'Security Clearance', category: 'certification', importance: 'high' },
      { keyword: 'FOIA', category: 'technical', importance: 'medium' },
      { keyword: 'FAR/DFAR', category: 'technical', importance: 'medium' },
      { keyword: 'Procurement', category: 'technical', importance: 'high' },
      { keyword: 'Legislative Affairs', category: 'technical', importance: 'medium' },
      { keyword: 'Interagency Coordination', category: 'soft', importance: 'medium' },
      { keyword: 'Performance Metrics', category: 'technical', importance: 'medium' },
      { keyword: 'Public Speaking', category: 'soft', importance: 'medium' },
    ],
  },
  realEstate: {
    name: 'Real Estate',
    aliases: ['property', 'realty', 'commercial real estate', 'residential', 'property management'],
    keywords: [
      { keyword: 'Property Management', category: 'technical', importance: 'critical' },
      { keyword: 'Lease Negotiation', category: 'technical', importance: 'critical' },
      { keyword: 'Market Analysis', category: 'technical', importance: 'high' },
      { keyword: 'MLS', category: 'tool', importance: 'high' },
      { keyword: 'CRM', category: 'tool', importance: 'high' },
      { keyword: 'Transaction Coordination', category: 'technical', importance: 'high' },
      { keyword: 'Due Diligence', category: 'technical', importance: 'high' },
      { keyword: 'Real Estate License', category: 'certification', importance: 'critical' },
      { keyword: 'Yardi', category: 'tool', importance: 'medium' },
      { keyword: 'Cap Rate Analysis', category: 'technical', importance: 'medium' },
      { keyword: 'Tenant Relations', category: 'soft', importance: 'high' },
      { keyword: 'Property Valuation', category: 'technical', importance: 'high' },
      { keyword: 'Contract Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'Investment Analysis', category: 'technical', importance: 'medium' },
      { keyword: 'Closing Coordination', category: 'technical', importance: 'medium' },
    ],
  },
  investmentBanking: {
    name: 'Investment Banking',
    aliases: ['ib', 'm&a', 'mergers acquisitions', 'capital markets', 'equity research', 'debt capital', 'leveraged finance', 'private equity', 'bulge bracket', 'boutique bank'],
    keywords: [
      { keyword: 'Financial Modeling', category: 'technical', importance: 'critical' },
      { keyword: 'DCF', category: 'technical', importance: 'critical' },
      { keyword: 'LBO', category: 'technical', importance: 'critical' },
      { keyword: 'M&A', category: 'technical', importance: 'critical' },
      { keyword: 'Valuation', category: 'technical', importance: 'critical' },
      { keyword: 'Pitch Book', category: 'technical', importance: 'high' },
      { keyword: 'Deal Execution', category: 'technical', importance: 'high' },
      { keyword: 'Due Diligence', category: 'technical', importance: 'high' },
      { keyword: 'Comparable Analysis', category: 'technical', importance: 'high' },
      { keyword: 'Precedent Transactions', category: 'technical', importance: 'high' },
      { keyword: 'Capital Structure', category: 'technical', importance: 'high' },
      { keyword: 'Bloomberg Terminal', category: 'tool', importance: 'high' },
      { keyword: 'FactSet', category: 'tool', importance: 'high' },
      { keyword: 'Capital IQ', category: 'tool', importance: 'high' },
      { keyword: 'Excel', category: 'tool', importance: 'critical' },
      { keyword: 'PowerPoint', category: 'tool', importance: 'high' },
      { keyword: 'Accretion/Dilution', category: 'technical', importance: 'medium' },
      { keyword: 'Synergy Analysis', category: 'technical', importance: 'medium' },
      { keyword: 'Credit Analysis', category: 'technical', importance: 'medium' },
      { keyword: 'IPO', category: 'technical', importance: 'medium' },
      { keyword: 'Debt Financing', category: 'technical', importance: 'medium' },
      { keyword: 'Equity Financing', category: 'technical', importance: 'medium' },
      { keyword: 'WACC', category: 'technical', importance: 'high' },
      { keyword: 'EBITDA', category: 'technical', importance: 'high' },
      { keyword: 'Enterprise Value', category: 'technical', importance: 'high' },
      { keyword: 'Series 7', category: 'certification', importance: 'medium' },
      { keyword: 'Series 79', category: 'certification', importance: 'high' },
      { keyword: 'CFA', category: 'certification', importance: 'medium' },
    ],
  },
  clinicalResearch: {
    name: 'Clinical Research',
    aliases: ['clinical trials', 'cra', 'clinical research associate', 'clinical operations', 'drug development', 'pharmaceutical research', 'biomedical research', 'cro', 'sponsor', 'investigator site'],
    keywords: [
      { keyword: 'GCP', category: 'certification', importance: 'critical' },
      { keyword: 'ICH Guidelines', category: 'certification', importance: 'critical' },
      { keyword: 'Protocol Development', category: 'technical', importance: 'critical' },
      { keyword: 'Clinical Monitoring', category: 'technical', importance: 'critical' },
      { keyword: 'Site Management', category: 'technical', importance: 'high' },
      { keyword: 'Patient Recruitment', category: 'technical', importance: 'high' },
      { keyword: 'Informed Consent', category: 'technical', importance: 'high' },
      { keyword: 'Adverse Event Reporting', category: 'technical', importance: 'critical' },
      { keyword: 'CTMS', category: 'tool', importance: 'high' },
      { keyword: 'EDC', category: 'tool', importance: 'high' },
      { keyword: 'Veeva', category: 'tool', importance: 'high' },
      { keyword: 'Medidata Rave', category: 'tool', importance: 'high' },
      { keyword: 'IRB', category: 'technical', importance: 'high' },
      { keyword: 'FDA Regulations', category: 'certification', importance: 'high' },
      { keyword: '21 CFR Part 11', category: 'certification', importance: 'high' },
      { keyword: 'CDISC', category: 'technical', importance: 'medium' },
      { keyword: 'Data Cleaning', category: 'technical', importance: 'medium' },
      { keyword: 'Query Resolution', category: 'technical', importance: 'medium' },
      { keyword: 'Source Document Verification', category: 'technical', importance: 'high' },
      { keyword: 'Phase I-IV Trials', category: 'technical', importance: 'high' },
      { keyword: 'CRF', category: 'technical', importance: 'medium' },
      { keyword: 'SAE Reporting', category: 'technical', importance: 'high' },
      { keyword: 'Regulatory Submissions', category: 'technical', importance: 'medium' },
      { keyword: 'CCRA', category: 'certification', importance: 'medium' },
      { keyword: 'ACRP', category: 'certification', importance: 'medium' },
      { keyword: 'Pharmacovigilance', category: 'technical', importance: 'medium' },
    ],
  },
  eventManagement: {
    name: 'Event Management',
    aliases: ['event planning', 'event coordinator', 'conference management', 'trade show', 'corporate events', 'meeting planner', 'convention', 'exhibition', 'event production', 'special events'],
    keywords: [
      { keyword: 'Event Planning', category: 'technical', importance: 'critical' },
      { keyword: 'Budget Management', category: 'technical', importance: 'critical' },
      { keyword: 'Vendor Coordination', category: 'technical', importance: 'critical' },
      { keyword: 'Logistics Management', category: 'technical', importance: 'high' },
      { keyword: 'Contract Negotiation', category: 'soft', importance: 'high' },
      { keyword: 'Venue Selection', category: 'technical', importance: 'high' },
      { keyword: 'Cvent', category: 'tool', importance: 'high' },
      { keyword: 'Eventbrite', category: 'tool', importance: 'high' },
      { keyword: 'Registration Management', category: 'technical', importance: 'high' },
      { keyword: 'Catering Coordination', category: 'technical', importance: 'high' },
      { keyword: 'AV Management', category: 'technical', importance: 'high' },
      { keyword: 'Timeline Management', category: 'technical', importance: 'high' },
      { keyword: 'CMP', category: 'certification', importance: 'high' },
      { keyword: 'CSEP', category: 'certification', importance: 'medium' },
      { keyword: 'Sponsorship Management', category: 'technical', importance: 'medium' },
      { keyword: 'Attendee Experience', category: 'technical', importance: 'high' },
      { keyword: 'On-Site Management', category: 'technical', importance: 'high' },
      { keyword: 'Post-Event Analysis', category: 'technical', importance: 'medium' },
      { keyword: 'RFP Process', category: 'technical', importance: 'medium' },
      { keyword: 'Virtual Events', category: 'technical', importance: 'high' },
      { keyword: 'Hybrid Events', category: 'technical', importance: 'medium' },
      { keyword: 'Event Marketing', category: 'technical', importance: 'medium' },
      { keyword: 'Crisis Management', category: 'soft', importance: 'medium' },
      { keyword: 'Stakeholder Communication', category: 'soft', importance: 'high' },
    ],
  },
};

// Helper function to find industry config by name (case-insensitive, alias matching)
export function findIndustryConfig(industryName: string): IndustryKeywordConfig | null {
  const normalized = industryName.toLowerCase().trim();
  
  // Direct match
  for (const [key, config] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (key.toLowerCase() === normalized || config.name.toLowerCase() === normalized) {
      return config;
    }
    // Alias match
    if (config.aliases.some(alias => normalized.includes(alias) || alias.includes(normalized))) {
      return config;
    }
  }
  
  return null;
}

// Get top keywords for an industry sorted by importance
export function getTopKeywords(industryName: string, limit: number = 10): IndustryKeyword[] {
  const config = findIndustryConfig(industryName);
  if (!config) return [];
  
  const importanceOrder = { critical: 0, high: 1, medium: 2 };
  return [...config.keywords]
    .sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance])
    .slice(0, limit);
}

// Check which keywords are present in resume text
export function analyzeKeywordPresence(
  industryName: string, 
  resumeText: string
): { present: IndustryKeyword[]; missing: IndustryKeyword[] } {
  const config = findIndustryConfig(industryName);
  if (!config) return { present: [], missing: [] };
  
  const normalizedResume = resumeText.toLowerCase();
  const present: IndustryKeyword[] = [];
  const missing: IndustryKeyword[] = [];
  
  for (const keyword of config.keywords) {
    const normalizedKeyword = keyword.keyword.toLowerCase();
    // Check for keyword presence (with word boundary awareness)
    const isPresent = normalizedResume.includes(normalizedKeyword) ||
      normalizedResume.includes(normalizedKeyword.replace(/\s+/g, '')) || // Handle no-space versions
      normalizedResume.includes(normalizedKeyword.replace(/&/g, 'and')); // Handle & vs "and"
    
    if (isPresent) {
      present.push(keyword);
    } else {
      missing.push(keyword);
    }
  }
  
  // Sort by importance
  const importanceOrder = { critical: 0, high: 1, medium: 2 };
  present.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);
  missing.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance]);
  
  return { present, missing };
}
