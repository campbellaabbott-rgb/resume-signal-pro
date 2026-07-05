// Occupation expectations sourced from O*NET — the U.S. Department of Labor's
// occupational database (onetonline.org, public domain). Each entry maps one
// of our industry slugs to a representative O*NET occupation with its core
// skills and commonly listed technologies.
//
// WHY: resume-only scans (no job description) previously modeled keyword
// expectations from our own curated tables. Sourcing them from O*NET makes
// the expectation list CITABLE — "expected skills for Registered Nurses,
// per the U.S. Department of Labor" is a verifiable claim; "our model
// thinks" is not. When a job description IS provided, it overrides this
// entirely (the employer's actual ask beats any database).
//
// Curation rules: only skills/technologies that appear in the occupation's
// O*NET profile (skills, knowledge, technology skills sections); generic
// cross-occupation skills (e.g. "communication") kept only where O*NET ranks
// them centrally for that occupation. Keep lists short and defensible.

export interface OnetExpectation {
  occupation: string;
  code: string; // O*NET-SOC code
  skills: string[];
  technologies: string[];
}

export const ONET_EXPECTATIONS: Record<string, OnetExpectation> = {
  technology: {
    occupation: "Software Developers",
    code: "15-1252.00",
    skills: ["programming", "debugging", "systems analysis", "software testing", "complex problem solving", "systems design"],
    technologies: ["Python", "Java", "JavaScript", "SQL", "Git", "AWS", "Docker", "Linux"],
  },
  data_science: {
    occupation: "Data Scientists",
    code: "15-2051.00",
    skills: ["statistical analysis", "machine learning", "data visualization", "data cleaning", "mathematical reasoning", "critical thinking"],
    technologies: ["Python", "R", "SQL", "Tableau", "TensorFlow", "pandas", "scikit-learn"],
  },
  data_engineering: {
    occupation: "Database Architects",
    code: "15-1243.00",
    skills: ["data modeling", "ETL design", "database administration", "data warehousing", "systems evaluation"],
    technologies: ["SQL", "Python", "Apache Spark", "Airflow", "Snowflake", "PostgreSQL", "AWS"],
  },
  machine_learning: {
    occupation: "Data Scientists (ML specialization)",
    code: "15-2051.01",
    skills: ["machine learning", "model evaluation", "feature engineering", "statistical modeling", "experiment design"],
    technologies: ["Python", "PyTorch", "TensorFlow", "scikit-learn", "SQL", "MLflow", "Kubernetes"],
  },
  cybersecurity: {
    occupation: "Information Security Analysts",
    code: "15-1212.00",
    skills: ["vulnerability assessment", "incident response", "risk analysis", "network security monitoring", "security auditing"],
    technologies: ["SIEM", "Splunk", "firewalls", "penetration testing tools", "Wireshark", "Python"],
  },
  healthcare: {
    occupation: "Registered Nurses",
    code: "29-1141.00",
    skills: ["patient assessment", "care planning", "medication administration", "patient education", "clinical documentation", "critical thinking"],
    technologies: ["Epic Systems", "electronic health records", "MEDITECH", "medication management systems"],
  },
  pharmacy: {
    occupation: "Pharmacists",
    code: "29-1051.00",
    skills: ["medication therapy management", "prescription verification", "patient counseling", "drug utilization review", "immunization"],
    technologies: ["pharmacy management systems", "electronic health records", "automated dispensing systems"],
  },
  dental: {
    occupation: "Dental Hygienists",
    code: "29-1292.00",
    skills: ["periodontal assessment", "prophylaxis", "patient education", "radiography", "infection control"],
    technologies: ["digital radiography", "Dentrix", "ultrasonic scalers"],
  },
  finance: {
    occupation: "Accountants and Auditors",
    code: "13-2011.00",
    skills: ["financial reporting", "reconciliation", "variance analysis", "GAAP compliance", "auditing", "budgeting"],
    technologies: ["Excel", "QuickBooks", "SAP", "NetSuite", "Oracle Financials"],
  },
  sales: {
    occupation: "Sales Representatives (Services)",
    code: "41-3091.00",
    skills: ["prospecting", "negotiation", "pipeline management", "needs assessment", "closing", "account management"],
    technologies: ["Salesforce", "CRM software", "LinkedIn Sales Navigator", "HubSpot"],
  },
  marketing: {
    occupation: "Marketing Managers",
    code: "11-2021.00",
    skills: ["campaign management", "market research", "brand management", "content strategy", "budget management", "analytics"],
    technologies: ["Google Analytics", "Google Ads", "Meta Ads", "HubSpot", "SEO tools", "CRM software"],
  },
  hr: {
    occupation: "Human Resources Specialists",
    code: "13-1071.00",
    skills: ["recruiting", "employee relations", "onboarding", "compensation administration", "compliance", "conflict resolution"],
    technologies: ["Workday", "applicant tracking systems", "HRIS", "ADP"],
  },
  legal: {
    occupation: "Lawyers",
    code: "23-1011.00",
    skills: ["legal research", "legal writing", "negotiation", "case management", "client counseling", "litigation"],
    technologies: ["Westlaw", "LexisNexis", "e-discovery software", "document management systems"],
  },
  education: {
    occupation: "Elementary School Teachers",
    code: "25-2021.00",
    skills: ["lesson planning", "classroom management", "differentiated instruction", "student assessment", "parent communication"],
    technologies: ["learning management systems", "Google Classroom", "SMART Boards"],
  },
  engineering: {
    occupation: "Mechanical Engineers",
    code: "17-2141.00",
    skills: ["engineering design", "CAD modeling", "tolerance analysis", "prototyping", "root cause analysis", "project engineering"],
    technologies: ["SolidWorks", "AutoCAD", "MATLAB", "ANSYS", "GD&T"],
  },
  product_management: {
    occupation: "Project Management Specialists",
    code: "13-1082.00",
    skills: ["roadmap planning", "stakeholder management", "requirements gathering", "prioritization", "cross-functional leadership"],
    technologies: ["Jira", "Confluence", "SQL", "analytics platforms", "Figma"],
  },
  consulting: {
    occupation: "Management Analysts",
    code: "13-1111.00",
    skills: ["business analysis", "process improvement", "financial modeling", "client engagement", "presentation development"],
    technologies: ["Excel", "PowerPoint", "Tableau", "SQL"],
  },
  creative: {
    occupation: "Graphic Designers",
    code: "27-1024.00",
    skills: ["visual design", "typography", "brand identity", "layout design", "client collaboration"],
    technologies: ["Adobe Photoshop", "Adobe Illustrator", "Figma", "InDesign", "After Effects"],
  },
  retail: {
    occupation: "First-Line Supervisors of Retail Sales Workers",
    code: "41-1011.00",
    skills: ["inventory management", "merchandising", "staff scheduling", "loss prevention", "customer service management"],
    technologies: ["point-of-sale systems", "inventory management software"],
  },
  hospitality: {
    occupation: "Lodging Managers",
    code: "11-9081.00",
    skills: ["guest relations", "front office operations", "revenue management", "staff supervision", "service recovery"],
    technologies: ["property management systems", "reservation systems", "Opera PMS"],
  },
  culinary: {
    occupation: "Chefs and Head Cooks",
    code: "35-1011.00",
    skills: ["menu development", "food cost control", "kitchen management", "food safety", "inventory ordering"],
    technologies: ["kitchen display systems", "ServSafe practices", "inventory software"],
  },
  manufacturing: {
    occupation: "Industrial Production Managers",
    code: "11-3051.00",
    skills: ["production planning", "quality control", "lean manufacturing", "safety compliance", "process optimization"],
    technologies: ["ERP systems", "SAP", "CNC equipment", "Six Sigma tools"],
  },
  logistics: {
    occupation: "Logisticians",
    code: "13-1081.00",
    skills: ["supply chain coordination", "inventory control", "carrier management", "demand planning", "warehouse operations"],
    technologies: ["WMS", "SAP", "TMS", "Excel", "EDI"],
  },
  construction_management: {
    occupation: "Construction Managers",
    code: "11-9021.00",
    skills: ["project scheduling", "cost estimation", "subcontractor coordination", "safety management", "blueprint reading"],
    technologies: ["Procore", "AutoCAD", "MS Project", "Bluebeam"],
  },
  skilled_trades: {
    occupation: "Electricians",
    code: "47-2111.00",
    skills: ["electrical installation", "troubleshooting", "blueprint reading", "code compliance", "preventive maintenance"],
    technologies: ["multimeters", "conduit systems", "NEC code", "hand and power tools"],
  },
  government: {
    occupation: "Compliance Officers",
    code: "13-1041.00",
    skills: ["regulatory compliance", "policy analysis", "program administration", "report writing", "stakeholder coordination"],
    technologies: ["case management systems", "Excel", "records management systems"],
  },
  real_estate: {
    occupation: "Real Estate Sales Agents",
    code: "41-9022.00",
    skills: ["property valuation", "client representation", "contract negotiation", "market analysis", "lead generation"],
    technologies: ["MLS", "CRM software", "DocuSign", "transaction management systems"],
  },
  insurance: {
    occupation: "Insurance Sales Agents",
    code: "41-3021.00",
    skills: ["needs analysis", "policy explanation", "claims assistance", "risk assessment", "client retention"],
    technologies: ["policy management systems", "CRM software", "quoting software"],
  },
  customer_success: {
    occupation: "Customer Service Representatives",
    code: "43-4051.00",
    skills: ["issue resolution", "account management", "product knowledge", "escalation handling", "customer retention"],
    technologies: ["Zendesk", "Salesforce", "CRM software", "ticketing systems"],
  },
  media: {
    occupation: "News Analysts, Reporters, and Journalists",
    code: "27-3023.00",
    skills: ["reporting", "interviewing", "editing", "fact-checking", "story development", "deadline management"],
    technologies: ["content management systems", "Adobe Premiere", "social media platforms"],
  },
  academia: {
    occupation: "Postsecondary Teachers",
    code: "25-1099.00",
    skills: ["curriculum development", "research", "grant writing", "peer-reviewed publication", "student mentoring"],
    technologies: ["learning management systems", "statistical software", "reference managers"],
  },
  biotech: {
    occupation: "Biological Scientists",
    code: "19-1029.00",
    skills: ["experimental design", "assay development", "data analysis", "laboratory documentation", "GLP compliance"],
    technologies: ["PCR", "cell culture", "flow cytometry", "ELISA", "chromatography"],
  },
  aviation: {
    occupation: "Aircraft Mechanics and Service Technicians",
    code: "49-3011.00",
    skills: ["aircraft inspection", "preventive maintenance", "troubleshooting", "FAA compliance", "maintenance documentation"],
    technologies: ["avionics test equipment", "maintenance tracking systems", "torque tools"],
  },
  energy: {
    occupation: "Power Plant Operators",
    code: "51-8013.00",
    skills: ["equipment monitoring", "safety procedures", "systems operation", "preventive maintenance", "regulatory compliance"],
    technologies: ["SCADA", "control systems", "turbines and generators"],
  },
  social_work: {
    occupation: "Child, Family, and School Social Workers",
    code: "21-1021.00",
    skills: ["case management", "crisis intervention", "needs assessment", "advocacy", "documentation", "community resource coordination"],
    technologies: ["case management software", "electronic records systems"],
  },
  law_enforcement: {
    occupation: "Police and Sheriff's Patrol Officers",
    code: "33-3051.00",
    skills: ["incident response", "report writing", "evidence handling", "de-escalation", "community policing"],
    technologies: ["CAD systems", "records management systems", "body-worn cameras"],
  },
  administrative: {
    occupation: "Executive Secretaries and Administrative Assistants",
    code: "43-6011.00",
    skills: ["calendar management", "correspondence", "meeting coordination", "records management", "travel arrangement"],
    technologies: ["Microsoft Office", "Outlook", "scheduling software", "expense systems"],
  },
  fitness: {
    occupation: "Exercise Trainers and Group Fitness Instructors",
    code: "39-9031.00",
    skills: ["program design", "fitness assessment", "client motivation", "injury prevention", "nutrition guidance"],
    technologies: ["fitness tracking apps", "scheduling software"],
  },
  veterinary: {
    occupation: "Veterinary Technologists and Technicians",
    code: "29-2056.00",
    skills: ["animal restraint", "laboratory testing", "anesthesia monitoring", "client education", "surgical assistance"],
    technologies: ["veterinary practice management software", "digital radiography", "IDEXX analyzers"],
  },
  agriculture: {
    occupation: "Farmers, Ranchers, and Agricultural Managers",
    code: "11-9013.00",
    skills: ["crop planning", "livestock management", "equipment operation", "irrigation management", "yield optimization"],
    technologies: ["precision agriculture systems", "GPS guidance", "farm management software"],
  },
};

/** Look up O*NET expectations for an industry; null when uncovered. */
export function getOnetExpectation(industry: string): OnetExpectation | null {
  return ONET_EXPECTATIONS[industry] ?? null;
}
