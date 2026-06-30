/**
 * Industry Detection Engine
 * 
 * Uses weighted keyword frequency, section awareness, co-occurrence clustering,
 * and job title anchoring to detect industry with high accuracy.
 */

// Section weights - job titles and summary have highest influence
// REBALANCED: Titles increased, skills decreased to prevent misclassification
// from skills-section noise (e.g., "Digital Marketing" in a Sales person's skills)
const SECTION_WEIGHTS = {
  jobTitle: 8.0,     // Job titles are the STRONGEST signal (was 5.0)
  summary: 3.5,      // Professional summary is second most important
  heading: 2.5,      // Section headings (e.g., "Sales Experience")
  firstBullets: 2.0, // First 2-3 bullets per role
  otherBullets: 1.0, // Other bullet points
  skills: 0.4,       // Skills section - LOW weight (was 0.7) — skills lists are noisy
  jobPosting: 6.0,   // Target job posting text, when the user provides one — a stated
                     // job title/industry in a posting the candidate is actively
                     // applying to is a strong, unambiguous signal, but stays below
                     // jobTitle since the resume itself is still the primary source
                     // of truth about who the candidate actually is.
  misc: 0.3          // Footer, education descriptions, etc.
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
      'revenue operations', 'revops', 'sales operations',
      // Customer-facing post-sales roles (distinct from marketing/support)
      'customer success manager', 'csm', 'account manager', 'am',
      'customer success', 'renewal manager', 'expansion manager',
      'client success manager', 'client success', 'customer growth manager',
      'strategic customer success', 'enterprise customer success'
    ],
    primary: [
      'quota', 'closed won', 'closed-won', 'arr', 'mrr',
      'bookings', 'deals', 'prospects', 'prospecting', 'cold calling',
      'outbound', 'inbound sales', 'demo', 'demos', 'discovery call',
      'sales cycle', 'deal size', 'average deal', 'enterprise deals',
      'attainment', 'exceeded quota', 'above quota', 'over-achieved',
      'new business', 'net new', 'expansion revenue', 'upsell', 'cross-sell',
      'renewal', 'churn', 'customer acquisition', 'sales qualified',
      'acv', 'total contract value', 'tcv', 'closed deals', 'landed',
      'surpassed quota', 'shattered quota', 'leaderboard',
      'selling', 'sold', 'sales pipeline', 'sales revenue',
      'sales quota', 'sales target', 'sales goal'
    ],
    secondary: [
      'crm', 'salesforce', 'hubspot', 'outreach', 'salesloft', 'gong',
      'zoominfo', 'linkedin sales navigator', 'clari', 'chorus',
      'customer success', 'account management',
      'c-suite', 'decision maker', 'buying committee', 'procurement',
      'rfp', 'sow',
      'client relationship', 'land and expand', 'white space',
      'apollo', 'rb2b', 'outbound motions',
      'consultative selling', 'objection handling',
      'cold call', 'lead generation',
      // PLG / modern SaaS sales
      'product-led growth', 'plg', 'freemium', 'free trial', 'trial conversion',
      'self-serve', 'product adoption', 'activation', 'activation funnel',
      'inbound sales', 'inbound motion', 'viral loop', 'user expansion',
      'usage-based', 'consumption-based', 'seat expansion'
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
      'platform engineer', 'cloud engineer',
      'qa engineer', 'test engineer', 'sdet', 'quality assurance engineer',
      'systems engineer', 'network engineer', 'security engineer', 'appsec engineer',
      'solutions architect', 'technical architect', 'enterprise architect',
      'cloud architect', 'software architect',
      'engineering manager', 'tech lead', 'technical lead', 'cto',
      'vp of engineering', 'director of engineering',
      'staff engineer', 'senior staff engineer', 'principal engineer',
      'distinguished engineer', 'engineering fellow', 'fellow',
      'developer advocate', 'developer relations', 'devrel', 'programmer', 'coder',
      'fullstack engineer', 'full-stack engineer', 'full stack engineer',
      'embedded engineer', 'firmware engineer', 'game developer', 'game engineer',
      'blockchain engineer', 'web3 engineer', 'smart contract engineer'
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
      'rabbitmq', 'graphql', 'rest', 'restful',
      'github.com', 'portfolio', 'open source', 'open-source'
    ],
    certifications: [
      'aws certified', 'azure certified', 'gcp certified', 'ckad', 'cka',
      'cissp', 'comptia', 'cisco certified', 'ccna', 'ccnp',
      'scrum master', 'psm', 'csm', 'pmp'
    ]
  },

  data_engineering: {
    titles: [
      'data engineer', 'senior data engineer', 'staff data engineer', 'principal data engineer',
      'analytics engineer', 'data platform engineer', 'data infrastructure engineer',
      'data architect', 'data warehouse engineer', 'etl developer', 'etl engineer',
      'bi engineer', 'business intelligence engineer', 'bi developer',
      'database engineer', 'database administrator', 'dba',
      'streaming engineer', 'real-time data engineer', 'lakehouse engineer',
      'data reliability engineer', 'reverse etl engineer',
      'analytics engineer', 'dbt engineer', 'data integration engineer'
    ],
    primary: [
      'etl', 'elt', 'pipeline', 'data pipeline', 'data warehouse', 'data lake',
      'data lakehouse', 'data platform', 'data infrastructure',
      'airflow', 'apache airflow', 'dbt', 'data build tool',
      'spark', 'apache spark', 'kafka', 'apache kafka',
      'ingestion', 'orchestration', 'transformation', 'batch processing', 'stream processing',
      'dimensional modeling', 'star schema', 'data modeling', 'data quality'
    ],
    secondary: [
      'snowflake', 'bigquery', 'redshift', 'databricks', 'delta lake',
      'flink', 'apache flink', 'fivetran', 'stitch', 'airbyte',
      'dbt core', 'dbt cloud', 'great expectations', 'monte carlo',
      'pyspark', 'hadoop', 'hive', 'presto', 'trino', 'athena',
      'dagster', 'prefect', 'luigi', 'mwaa',
      'parquet', 'avro', 'iceberg', 'hudi',
      'dynamodb', 'cassandra', 'hbase',
      'oltp', 'olap', 'data mart', 'fact table', 'dimension table', 'slowly changing dimension'
    ],
    certifications: [
      'databricks certified', 'snowflake core', 'aws data', 'gcp data engineer',
      'azure data engineer', 'dbt certified'
    ]
  },

  data_science: {
    titles: [
      'data scientist', 'senior data scientist', 'staff data scientist', 'principal data scientist',
      'data analyst', 'senior data analyst', 'analytics manager', 'head of analytics',
      'quantitative analyst', 'quant analyst', 'research scientist',
      'applied scientist', 'decision scientist', 'growth analyst',
      'product analyst', 'marketing analyst', 'operations analyst',
      'statistician', 'biostatistician', 'clinical data scientist',
      'ml scientist', 'research scientist', 'experimentation analyst',
      'insights analyst', 'decision scientist', 'revenue analytics',
      'revenue operations analyst', 'go-to-market analyst',
      // BI roles that use analytics tools — included only when co-occurring with analytics keywords
      'business intelligence analyst', 'bi analyst'
      // NOTE: 'business analyst' intentionally excluded — too generic, routes to finance/consulting
    ],
    primary: [
      'statistical analysis', 'statistics', 'hypothesis testing', 'a/b testing',
      'experiment design', 'experimentation', 'regression', 'classification',
      'clustering', 'predictive modeling', 'machine learning', 'model building',
      'feature engineering', 'exploratory data analysis', 'eda',
      'data visualization', 'insights', 'dashboards', 'reporting',
      'business intelligence', 'kpi', 'metrics', 'forecasting',
      'causal inference', 'causal analysis', 'treatment effect',
      'time series', 'time series forecasting', 'survival analysis',
      'bayesian', 'bayesian inference', 'probabilistic modeling'
    ],
    secondary: [
      'python', 'r', 'sql', 'pandas', 'numpy', 'scikit-learn', 'sklearn',
      'jupyter', 'jupyter notebook', 'matplotlib', 'seaborn', 'plotly',
      'tableau', 'power bi', 'looker', 'metabase', 'domo',
      'statsmodels', 'scipy', 'xgboost', 'lightgbm', 'catboost',
      'excel', 'google analytics', 'mixpanel', 'amplitude', 'segment',
      'spss', 'sas', 'stata',
      'arima', 'prophet', 'sarima', 'exponential smoothing',
      'kaplan-meier', 'cox regression', 'dowhy', 'causalml',
      'nltk', 'spacy', 'text analysis', 'sentiment analysis', 'topic modeling'
    ],
    certifications: [
      'google data analytics', 'ibm data science', 'tableau certified',
      'aws machine learning', 'coursera', 'datacamp'
    ]
  },

  machine_learning: {
    titles: [
      'machine learning engineer', 'ml engineer', 'senior ml engineer',
      'ai engineer', 'ai/ml engineer', 'applied ml engineer',
      'llm engineer', 'large language model engineer',
      'generative ai engineer', 'gen ai engineer', 'genai engineer',
      'prompt engineer', 'ai prompt engineer',
      'rag engineer', 'retrieval augmented generation engineer',
      'mlops engineer', 'ml platform engineer', 'ml infrastructure engineer',
      'ai research engineer', 'research engineer', 'applied research scientist',
      'foundation model engineer', 'alignment researcher', 'ai safety researcher',
      'multimodal engineer', 'speech engineer', 'ranking engineer',
      'recsys engineer', 'recommendation systems engineer',
      'applied ml engineer', 'applied ai engineer',
      'computer vision engineer', 'nlp engineer', 'speech engineer',
      'recommendation systems engineer', 'ranking engineer',
      'ai product engineer', 'multimodal engineer'
    ],
    primary: [
      'machine learning', 'deep learning', 'neural network', 'model training',
      'model deployment', 'model serving', 'inference', 'fine-tuning', 'fine tuning',
      'llm', 'large language model', 'generative ai', 'generative artificial intelligence',
      'rag', 'retrieval augmented generation', 'vector database', 'vector db',
      'embeddings', 'embedding', 'prompt engineering', 'prompt design',
      'rlhf', 'reinforcement learning from human feedback',
      'transfer learning', 'pre-training', 'foundation model', 'base model',
      'computer vision', 'natural language processing', 'nlp', 'speech recognition'
    ],
    secondary: [
      'pytorch', 'tensorflow', 'keras', 'jax',
      'hugging face', 'transformers', 'diffusers',
      'langchain', 'llamaindex', 'llama index',
      'openai', 'openai api', 'anthropic', 'claude',
      'vllm', 'triton', 'torchserve', 'bentoml', 'ray serve',
      'mlops', 'ml pipeline', 'model registry', 'model monitoring', 'feature store',
      'pinecone', 'weaviate', 'milvus', 'qdrant', 'chroma',
      'lora', 'qlora', 'peft', 'bitsandbytes', 'gptq', 'awq', 'quantization',
      'mlflow', 'weights & biases', 'wandb', 'neptune',
      'sagemaker', 'vertex ai', 'azure ml', 'databricks ml',
      'cuda', 'gpu', 'a100', 'h100', 'tensor cores',
      'bert', 'gpt', 't5', 'llama', 'mistral', 'falcon',
      'langsmith', 'dspy', 'guidance', 'semantic kernel'
    ],
    certifications: [
      'aws machine learning specialty', 'gcp professional ml engineer',
      'azure ai engineer', 'tensorflow developer', 'deeplearning.ai',
      'coursera machine learning', 'fast.ai'
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
      'demand generation', 'demand gen', 'campaign manager', 'creative director',
      'marketing operations manager', 'marketing ops', 'revenue marketing manager',
      'lifecycle marketing manager', 'crm manager', 'retention marketing',
      'growth engineer' // growth engineers use marketing signals AND tech — see disambiguation rule
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
      'charge nurse', 'case manager', 'care coordinator',
      'respiratory therapist', 'rt', 'speech language pathologist', 'slp',
      'surgical technologist', 'sterile processing technician',
      'dialysis technician', 'emt', 'paramedic', 'emergency medical technician',
      'dental assistant', 'dental hygienist', 'optometrist', 'optician',
      'clinical research coordinator', 'clinical trial manager',
      'health information manager', 'medical coder', 'medical biller',
      'patient access representative', 'medical receptionist',
      'director of nursing', 'don', 'chief nursing officer', 'cno',
      'hospitalist', 'intensivist', 'anesthesiologist', 'crna'
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
      'ip attorney', 'patent attorney', 'trademark attorney',
      'securities attorney', 'real estate attorney', 'tax attorney',
      'employment attorney', 'labor attorney', 'family law attorney',
      'criminal defense attorney', 'public defender', 'district attorney',
      'assistant district attorney', 'ada', 'deputy general counsel',
      'associate general counsel', 'chief legal officer', 'clo',
      'legal operations manager', 'legal ops', 'contract specialist',
      'regulatory affairs manager', 'regulatory counsel',
      'privacy counsel', 'data privacy attorney', 'fintech counsel'
    ],
    primary: [
      'legal', 'law', 'litigation', 'contract', 'contracts',
      'agreement', 'agreements', 'negotiate', 'negotiation',
      'court', 'trial', 'discovery', 'deposition', 'motion',
      'brief', 'pleading', 'complaint', 'settlement', 'judgment',
      'legal research', 'case law', 'statute', 'regulation',
      'counsel', 'advise', 'draft', 'review', 'corporate governance',
      'securities', 'intellectual property', 'employment law', 'compliance'
    ],
    secondary: [
      'westlaw', 'lexisnexis', 'practical law', 'contract lifecycle',
      'clm', 'docusign', 'ironclad', 'matter management',
      'board', 'sec', 'ip', 'patent', 'trademark', 'copyright',
      'm&a', 'due diligence', 'labor law', 'billable hours',
      'matter', 'docket', 'filing', 'privilege', 'confidentiality',
      'indemnification', 'liability', 'damages', 'injunction', 'arbitration'
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
      'school counselor', 'academic advisor', 'tutor', 'teaching assistant',
      'curriculum director', 'director of curriculum', 'director of instruction',
      'literacy coach', 'math coach', 'stem coordinator',
      'school psychologist', 'school social worker',
      'library media specialist', 'librarian', 'media specialist',
      'esl teacher', 'esl instructor', 'bilingual teacher',
      'substitute teacher', 'paraprofessional', 'paraeducator',
      'adjunct professor', 'adjunct instructor', 'visiting lecturer',
      'department chair', 'associate dean', 'provost',
      'director of education', 'education coordinator', 'training coordinator',
      'corporate trainer', 'learning specialist'
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
      'pe', 'professional engineer', 'engineering manager',
      'reliability engineer', 'test engineer', 'field engineer',
      'maintenance engineer', 'controls engineer', 'automation engineer',
      'materials engineer', 'nuclear engineer', 'marine engineer',
      'geological engineer', 'mining engineer', 'safety engineer',
      'packaging engineer', 'validation engineer', 'commissioning engineer',
      'r&d engineer', 'research engineer', 'applications engineer'
      // NOTE: 'editor' is NOT an engineering title — do NOT add it
    ],
    primary: [
      'engineering', 'design', 'analysis', 'testing', 'prototype',
      'specifications', 'drawings', 'schematics', 'calculations',
      'simulation', 'modeling', 'manufacturing', 'production',
      'quality', 'inspection', 'tolerance', 'materials',
      'blueprints', 'cad', 'technical drawings', 'bill of materials',
      'bom', 'fabrication', 'assembly', 'welding', 'machining',
      'thermal', 'structural', 'fluid', 'dynamics', 'statics',
      'load', 'stress', 'strain', 'fatigue', 'vibration',
      'commissioning', 'installation', 'maintenance', 'troubleshooting',
      'root cause analysis', 'rca', 'failure analysis', 'fmea',
      'validation', 'verification', 'calibration', 'metrology'
    ],
    secondary: [
      'autocad', 'solidworks', 'catia', 'creo', 'inventor', 'revit',
      'matlab', 'simulink', 'ansys', 'fea', 'cfd', 'cam', 'cnc',
      'lean', 'six sigma', 'iso', 'asme', 'astm', 'osha', 'safety',
      'gd&t', 'geometric dimensioning', 'p&id', 'piping',
      'plc', 'scada', 'hmi', 'pneumatic', 'hydraulic',
      'thermodynamics', 'heat transfer', 'kinematics', 'robotics'
    ],
    certifications: [
      'pe license', 'professional engineer', 'fe', 'eit',
      'pmp', 'six sigma black belt', 'green belt', 'lean certified',
      'api certified', 'aws cwi', 'certified welding inspector',
      'nace', 'asnt', 'nbic'
    ]
  },
  
  product_management: {
    titles: [
      'product manager', 'senior product manager', 'group product manager',
      'director of product', 'vp of product', 'head of product', 'chief product officer',
      'cpo', 'associate product manager', 'apm', 'product lead',
      'product owner', 'program manager', 'technical program manager', 'tpm',
      'scrum master', 'agile coach', 'release train engineer', 'rte',
      'portfolio manager', 'product director', 'product strategist'
    ],
    primary: [
      'product roadmap', 'roadmap', 'product strategy', 'product vision',
      'user stories', 'backlog', 'sprint planning', 'prioritization',
      'product launch', 'feature', 'mvp', 'minimum viable product',
      'product requirements', 'prd', 'product spec', 'product discovery',
      'stakeholder alignment', 'cross-functional', 'go-to-market',
      'product metrics', 'okr', 'kpi', 'adoption', 'retention',
      'product lifecycle', 'product development', 'ideation',
      // Single-word strong signals for PM (help when multi-word phrases miss)
      'stakeholders', 'epics', 'sprints', 'retrospective', 'standup',
      'wireframes', 'prototyping', 'requirements', 'specifications'
    ],
    secondary: [
      'jira', 'confluence', 'asana', 'trello', 'notion', 'productboard',
      'amplitude', 'mixpanel', 'fullstory', 'hotjar', 'pendo',
      'figma', 'miro', 'lucidchart', 'aha',
      'a/b testing', 'user research', 'customer interviews',
      'competitive analysis', 'market research', 'customer feedback',
      'safe', 'scaled agile', 'pi planning'
    ],
    certifications: [
      'cspo', 'pspo', 'csm', 'psm', 'safe', 'pmp', 'prince2',
      'pragmatic marketing', 'product school', 'certified scrum'
    ]
  },
  
  consulting: {
    titles: [
      'consultant', 'senior consultant', 'management consultant',
      'strategy consultant', 'business analyst', 'associate consultant',
      'principal', 'partner', 'engagement manager', 'project manager',
      'advisory', 'advisor', 'director',
      'managing director', 'md', 'vice president', 'associate',
      'analyst', 'senior analyst', 'manager', 'senior manager',
      'it consultant', 'technology consultant', 'operations consultant',
      'hr consultant', 'financial consultant', 'risk consultant',
      'transformation lead', 'change management lead', 'implementation lead',
      'business transformation', 'organizational effectiveness',
      // Pre-sales and client-facing architects who consult rather than build
      'solutions architect', 'presales architect', 'presales engineer',
      'pre-sales architect', 'pre-sales engineer', 'customer success architect',
      'enterprise architect' // when co-occurring with client/engagement signals
    ],
    primary: [
      'consulting', 'advisory', 'client', 'clients', 'engagement',
      'strategy', 'strategic', 'analysis', 'recommendation',
      'stakeholder', 'presentation', 'deliverable', 'workstream',
      'problem solving', 'business case', 'roi',
      'go-to-market', 'operating model', 'cost reduction', 'revenue growth',
      'process improvement', 'diagnostic', 'assessment', 'roadmap',
      'hypothesis', 'framework', 'structured problem solving'
    ],
    secondary: [
      'mckinsey', 'bain', 'bcg', 'deloitte', 'accenture', 'kpmg', 'ey', 'pwc',
      'capgemini', 'oliver wyman', 'roland berger', 'booz allen', 'leek',
      'powerpoint', 'excel', 'modeling', 'research', 'benchmarking',
      'due diligence', 'transformation', 'change management', 'implementation',
      'deck', 'slide', 'executive presentation', 'c-suite', 'board presentation'
    ],
    certifications: [
      'pmp', 'prince2', 'mba', 'cmc', 'six sigma', 'lean', 'prosci'
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
  },

  retail: {
    titles: [
      'store manager', 'assistant store manager', 'retail manager', 'district manager',
      'sales associate', 'retail associate', 'cashier', 'customer service representative',
      'visual merchandiser', 'loss prevention', 'inventory specialist',
      'buyer', 'merchandise planner', 'category manager', 'brand ambassador',
      'department manager', 'team lead', 'shift supervisor', 'floor manager'
    ],
    primary: [
      'sales floor', 'point of sale', 'pos', 'inventory', 'merchandise', 'merchandising',
      'customer service', 'upselling', 'cross-selling', 'shrink', 'loss prevention',
      'store operations', 'planogram', 'visual display', 'retail sales',
      'foot traffic', 'conversion rate', 'basket size', 'units per transaction'
    ],
    secondary: [
      'store', 'retail', 'shop', 'boutique', 'mall', 'outlet',
      'shopify', 'square', 'lightspeed', 'netsuite retail', 'revel',
      'seasonal', 'holiday', 'promotional', 'markdown', 'clearance',
      'kpi', 'sales target', 'comp sales', 'same-store sales', 'revenue per square foot'
    ],
    certifications: [
      'retail management certificate', 'customer service certification', 'loss prevention certified'
    ]
  },

  hospitality: {
    titles: [
      'hotel manager', 'general manager', 'front desk agent', 'front desk manager',
      'concierge', 'guest services manager', 'housekeeping manager', 'executive housekeeper',
      'food and beverage manager', 'f&b manager', 'restaurant manager', 'chef',
      'executive chef', 'sous chef', 'line cook', 'server', 'bartender',
      'event coordinator', 'banquet manager', 'catering manager', 'revenue manager',
      'reservations manager', 'director of operations', 'hospitality manager'
    ],
    primary: [
      'guest satisfaction', 'guest experience', 'check-in', 'check-out',
      'reservations', 'occupancy', 'revpar', 'adr', 'front of house', 'back of house',
      'food and beverage', 'banquet', 'catering', 'event', 'hospitality',
      'hotel', 'resort', 'restaurant', 'dining', 'menu', 'service standards'
    ],
    secondary: [
      'opera', 'pms', 'property management system', 'folio', 'tripadvisor',
      'yelp', 'expedia', 'booking.com', 'ota', 'loyalty program',
      'spa', 'amenities', 'upsell', 'room upgrade', 'turndown service',
      'servsafe', 'tips certification', 'liquor license', 'health inspection'
    ],
    certifications: [
      'cha', 'chia', 'servsafe', 'tips certified', 'chha', 'crde'
    ]
  },

  manufacturing: {
    titles: [
      'production manager', 'plant manager', 'operations manager', 'manufacturing engineer',
      'process engineer', 'quality engineer', 'quality manager', 'quality control',
      'production supervisor', 'shift supervisor', 'line supervisor', 'team leader',
      'maintenance technician', 'maintenance manager', 'industrial engineer',
      'supply chain manager', 'logistics coordinator', 'warehouse manager',
      'assembly technician', 'machine operator', 'cnc operator'
    ],
    primary: [
      'production', 'manufacturing', 'assembly', 'fabrication', 'machining',
      'quality control', 'quality assurance', 'inspection', 'oee', 'throughput',
      'cycle time', 'downtime', 'scrap', 'yield', 'defect rate',
      'lean', 'six sigma', 'kaizen', 'continuous improvement', '5s',
      'safety', 'osha', 'ehs', 'incident rate', 'near miss'
    ],
    secondary: [
      'sap', 'erp', 'mes', 'cmms', 'plc', 'scada', 'hmi',
      'iso 9001', 'as9100', 'iatf', 'ts16949', 'fda', 'gmp',
      'bom', 'bill of materials', 'work order', 'preventive maintenance',
      'supply chain', 'procurement', 'inventory', 'kanban', 'jit', 'just-in-time'
    ],
    certifications: [
      'six sigma black belt', 'six sigma green belt', 'lean certified',
      'osha 30', 'osha 10', 'pmp', 'apics cpim', 'apics cscp', 'cqe'
    ]
  },

  government: {
    titles: [
      'policy analyst', 'program manager', 'program director', 'government analyst',
      'public administrator', 'city manager', 'county administrator',
      'federal employee', 'civil servant', 'government contractor',
      'grant manager', 'grant writer', 'budget analyst', 'legislative analyst',
      'compliance officer', 'regulatory affairs', 'public affairs officer',
      'military officer', 'military enlisted', 'veteran', 'law enforcement',
      'firefighter', 'emergency manager', 'public health official'
    ],
    primary: [
      'policy', 'regulation', 'compliance', 'public sector', 'government',
      'federal', 'state', 'municipal', 'grant', 'funding', 'appropriation',
      'budget', 'fiscal', 'taxpayer', 'constituent', 'stakeholder',
      'procurement', 'rfp', 'rfq', 'contract', 'far', 'dfar',
      'program', 'initiative', 'legislation', 'ordinance', 'statute'
    ],
    secondary: [
      'usajobs', 'gs level', 'gs-', 'security clearance', 'top secret',
      'secret clearance', 'ts/sci', 'dod', 'department of', 'agency',
      'foia', 'apa', 'administrative procedure', 'public comment',
      'interagency', 'cross-agency', 'oversight', 'audit', 'inspector general'
    ],
    certifications: [
      'pmp', 'cfe', 'cgfm', 'cpa', 'security clearance', 'dau', 'fac-c'
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
    ['attainment', 'bookings', 'arr'],
    ['gtm', 'revenue', 'sales'],
    ['selling', 'quota', 'deals']
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
  ],
  healthcare: [
    ['patient', 'clinical', 'hospital'],
    ['nursing', 'care', 'medication'],
    ['hipaa', 'emr', 'charting']
  ],
  hr: [
    ['recruiting', 'hiring', 'talent'],
    ['onboarding', 'employee', 'hris'],
    ['compensation', 'benefits', 'payroll']
  ],
  legal: [
    ['litigation', 'court', 'contract'],
    ['counsel', 'compliance', 'legal'],
    ['westlaw', 'bar', 'attorney']
  ],
  education: [
    ['teaching', 'students', 'curriculum'],
    ['classroom', 'instruction', 'lesson']
  ],
  engineering: [
    ['design', 'manufacturing', 'specifications'],
    ['autocad', 'solidworks', 'tolerance'],
    ['engineering', 'design', 'analysis'],
    ['prototype', 'testing', 'specifications'],
    ['cad', 'simulation', 'materials'],
    ['fea', 'ansys', 'modeling'],
    ['mechanical', 'thermal', 'structural'],
    ['electrical', 'circuit', 'power'],
    ['civil', 'structural', 'construction'],
    ['process', 'chemical', 'plant']
  ],
  consulting: [
    ['client', 'engagement', 'strategy'],
    ['advisory', 'deliverable', 'workstream'],
    ['mckinsey', 'bain', 'bcg'],
    ['deloitte', 'accenture', 'pwc'],
    ['transformation', 'recommendation', 'stakeholder'],
    ['deck', 'slide', 'executive']
  ],
  legal: [
    ['litigation', 'court', 'contract'],
    ['counsel', 'compliance', 'legal'],
    ['westlaw', 'bar', 'attorney'],
    ['securities', 'ip', 'corporate'],
    ['billable', 'matter', 'docket'],
    ['contract', 'draft', 'review']
  ],
  creative: [
    ['design', 'portfolio', 'visual'],
    ['figma', 'photoshop', 'branding']
  ],
  product_management: [
    ['roadmap', 'stakeholder', 'prioritization'],
    ['product', 'sprint', 'backlog'],
    ['okr', 'metrics', 'adoption'],
    ['jira', 'confluence', 'agile'],
    ['product manager', 'roadmap', 'cross-functional'],
    ['epics', 'sprints', 'backlog'],
    ['stakeholders', 'requirements', 'roadmap'],
    ['prd', 'product', 'feature'],
    ['mvp', 'product', 'launch']
  ],
  data_engineering: [
    // Canonical modern data stack — strongest signal
    ['dbt', 'snowflake', 'airflow'],
    ['dbt', 'bigquery', 'airflow'],
    ['dbt', 'databricks', 'pipeline'],
    ['airflow', 'dbt', 'etl'],
    // Streaming with warehouse anchor (guards against DevOps false positive)
    ['kafka', 'spark', 'data warehouse'],
    ['kafka', 'flink', 'pipeline'],
    ['snowflake', 'bigquery', 'data warehouse'],
    ['databricks', 'delta lake', 'pipeline'],
    ['fivetran', 'stitch', 'ingestion'],
    ['airbyte', 'dbt', 'transformation']
  ],
  data_science: [
    ['model', 'training', 'accuracy'],
    ['hypothesis testing', 'a/b test', 'experiment'],
    ['jupyter', 'pandas', 'scikit'],
    ['tableau', 'power bi', 'dashboard'],
    ['regression', 'classification', 'prediction'],
    ['sql', 'python', 'analysis']
  ],
  machine_learning: [
    ['llm', 'fine-tuning', 'inference'],
    ['vector', 'embedding', 'rag'],
    ['production', 'serving', 'latency'],
    ['pytorch', 'tensorflow', 'model'],
    ['langchain', 'openai', 'prompt'],
    ['pinecone', 'weaviate', 'vector database'],
    ['mlops', 'mlflow', 'deployment'],
    ['hugging face', 'transformers', 'bert']
  ],
  retail: [
    ['sales floor', 'inventory', 'customer service'],
    ['pos', 'cashier', 'upselling'],
    ['store', 'shrink', 'loss prevention'],
    ['merchandising', 'planogram', 'visual display']
  ],
  hospitality: [
    ['guest', 'hotel', 'reservations'],
    ['food and beverage', 'banquet', 'catering'],
    ['revpar', 'occupancy', 'adr'],
    ['front desk', 'check-in', 'concierge']
  ],
  manufacturing: [
    ['production', 'quality control', 'oee'],
    ['lean', 'six sigma', 'kaizen'],
    ['assembly', 'fabrication', 'inspection'],
    ['plc', 'scada', 'maintenance']
  ],
  government: [
    ['policy', 'regulation', 'compliance'],
    ['federal', 'grant', 'procurement'],
    ['security clearance', 'dod', 'agency'],
    ['constituent', 'public sector', 'legislation']
  ]
};

// Negative keyword rules — when an industry has high title score but these
// keywords dominate the skills/bullets, it should NOT switch to the negative industry.
// Format: { industry: keywords_that_should_NOT_cause_reclassification_away }
const DISAMBIGUATION_RULES: Record<string, { negativeFor: string; requiredTitleSignal: boolean }[]> = {
  // If someone has sales titles, marketing keywords in skills shouldn't reclassify them
  sales: [
    { negativeFor: 'marketing', requiredTitleSignal: true },
    { negativeFor: 'creative', requiredTitleSignal: true }
  ],
  // If someone has tech titles, consulting/sales keywords shouldn't reclassify.
  // Note: "solutions architect" at a consulting firm should NOT be caught here —
  // the consulting industry's title list also includes solutions architect; if
  // consulting co-occurrence patterns fire (client, engagement, advisory, presales),
  // consulting should win via higher title+co-occurrence combined score.
  // "Growth engineer": has "engineer" title but marketing signals — stays technology
  // if title score for technology dominates; marketing title wins only if explicit
  // marketing title (growth marketing, demand gen) present without "engineer".
  technology: [
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'sales', requiredTitleSignal: true },
    { negativeFor: 'marketing', requiredTitleSignal: true }, // growth engineer stays tech
    { negativeFor: 'data_engineering', requiredTitleSignal: true },
    { negativeFor: 'machine_learning', requiredTitleSignal: true }
  ],
  // If someone has marketing titles, sales keywords shouldn't reclassify
  marketing: [
    { negativeFor: 'sales', requiredTitleSignal: true }
  ],
  // If someone has engineering titles, sales/consulting keywords shouldn't reclassify
  engineering: [
    { negativeFor: 'sales', requiredTitleSignal: true },
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'technology', requiredTitleSignal: true }
  ],
  // If someone has healthcare titles, sales keywords shouldn't reclassify
  healthcare: [
    { negativeFor: 'sales', requiredTitleSignal: true }
  ],
  // If someone has finance titles, consulting keywords shouldn't reclassify
  finance: [
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'sales', requiredTitleSignal: true }
  ],
  // If someone has HR titles, consulting/sales keywords shouldn't reclassify
  hr: [
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'sales', requiredTitleSignal: true }
  ],
  // If someone has education titles, consulting keywords shouldn't reclassify
  education: [
    { negativeFor: 'consulting', requiredTitleSignal: true }
  ],
  // If someone has legal titles, consulting keywords shouldn't reclassify
  legal: [
    { negativeFor: 'consulting', requiredTitleSignal: true }
  ],
  // If someone has consulting titles, sales keywords shouldn't reclassify
  consulting: [
    { negativeFor: 'sales', requiredTitleSignal: true }
  ],
  // If someone has creative titles, marketing keywords shouldn't reclassify
  creative: [
    { negativeFor: 'marketing', requiredTitleSignal: true }
  ],
  // Data engineering titles shouldn't reclassify to generic tech or data science.
  // Also: Kafka/Spark mention alone (from DevOps/SRE infra work) must NOT score data_engineering
  // unless accompanied by dbt, Airflow, or a data warehouse platform — enforced in scoring weights.
  data_engineering: [
    { negativeFor: 'technology', requiredTitleSignal: true },
    { negativeFor: 'data_science', requiredTitleSignal: true }
  ],
  // Data science titles shouldn't reclassify to technology or data engineering
  data_science: [
    { negativeFor: 'technology', requiredTitleSignal: true },
    { negativeFor: 'data_engineering', requiredTitleSignal: true }
  ],
  // ML engineers shouldn't reclassify to generic technology
  machine_learning: [
    { negativeFor: 'technology', requiredTitleSignal: true },
    { negativeFor: 'data_science', requiredTitleSignal: true }
  ],
  // If someone has PM titles, technology/consulting keywords shouldn't reclassify
  product_management: [
    { negativeFor: 'technology', requiredTitleSignal: true },
    { negativeFor: 'data_engineering', requiredTitleSignal: true },
    { negativeFor: 'machine_learning', requiredTitleSignal: true },
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'sales', requiredTitleSignal: true }
  ]
};

interface DetectionResult {
  industry: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  signals: string[];
  alternativeIndustries: Array<{ industry: string; score: number }>;
  secondaryIndustry?: string;
  secondaryScore?: number;
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
  // Title-detecting keywords — used to identify lines that may contain job titles
  // NOTE: 'editor' is excluded because it causes false matches (e.g., "Photo Editor", "Video Editor")
  // which incorrectly score as engineering. Creative/media editors are handled by the creative industry.
  const titleKeywords = [
    'manager', 'director', 'engineer', 'developer', 'analyst', 'specialist',
    'coordinator', 'consultant', 'executive', 'lead', 'head', 'vp', 'president',
    'associate', 'senior', 'principal', 'architect', 'designer', 'administrator',
    'representative', 'rep', 'officer', 'nurse', 'teacher', 'attorney', 'accountant',
    'salesperson', 'gtm', 'go-to-market', 'founder', 'ceo', 'cfo', 'cto', 'cro',
    'recruiter', 'therapist', 'scientist', 'researcher', 'strategist',
    'product owner', 'scrum master', 'product manager'
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
  
  // FALSE POSITIVE TITLE PATTERNS — prevent specific title words from matching wrong industries
  const FALSE_POSITIVE_TITLES: Record<string, string[]> = {
    engineering: ['editor', 'photo editor', 'video editor', 'copy editor', 'managing editor', 'editor-in-chief', 'content editor'],
  };
  const falsePositives = FALSE_POSITIVE_TITLES[industry] || [];
  
  // Check job titles (HIGHEST WEIGHT). Resumes are conventionally reverse-
  // chronological, so earlier entries in this array are more recent roles —
  // weight them more heavily than older ones, since a person's current/most
  // recent role is a much stronger industry signal than something from years
  // ago (e.g. someone who moved from engineering into sales 3 years ago should
  // score as sales, not engineering).
  sections.jobTitles.forEach((title, index) => {
    // Skip if this title matches a known false positive for this industry
    const isFalsePositive = falsePositives.some(fp => title.includes(fp));
    if (isFalsePositive) return;

    const recencyMultiplier = Math.max(0.4, 1 - index * 0.15);

    for (const industryTitle of keywords.titles) {
      if (title.includes(industryTitle)) {
        score += SECTION_WEIGHTS.jobTitle * 2 * recencyMultiplier; // Double weight for exact title match
        signals.push(`Job title match: "${industryTitle}"${index === 0 ? ' (most recent role)' : ''}`);
      }
    }
  });
  
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
  
  // Check certifications. A licensing certification (CPA, RN, PMP, JD, etc.) is
  // about as unambiguous a signal as exists on a resume — someone doesn't get a
  // CPA without being in accounting. Weight it above job titles, not level with
  // the much noisier summary section.
  for (const cert of keywords.certifications) {
    if (sections.fullText.includes(cert)) {
      score += SECTION_WEIGHTS.jobTitle * 1.5;
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
  
  // Co-occurrence bonus — ONLY fires after minimum keyword/title score is established.
  // Without this gate, DevOps resumes mentioning [kafka, spark, data warehouse] could
  // score as data_engineering with zero matching titles or primary keywords.
  // Threshold: at least one solid keyword match (score >= 4) before co-occurrence adds weight.
  if (score >= 4) {
    const coOccurrenceScore = checkCoOccurrence(sections.fullText, industry);
    if (coOccurrenceScore > 0) {
      score += coOccurrenceScore;
      signals.push(`Co-occurrence patterns detected`);
    }
  }

  return { score, signals };
}

/**
 * Score signal from a target job posting, when the user provided one for
 * job-matching. A posting's title and required-skills section state the
 * target industry directly — a strong signal that's otherwise sitting
 * unused, since job-matching mode only used this text for skill-gap
 * comparison, never for industry detection itself.
 */
function calculateJobPostingScore(jobDescriptionText: string, industry: string): {
  score: number;
  signals: string[];
} {
  const keywords = INDUSTRY_KEYWORDS[industry];
  if (!keywords) return { score: 0, signals: [] };

  const text = jobDescriptionText.toLowerCase();
  let score = 0;
  const signals: string[] = [];

  // Job titles in a posting are usually stated plainly near the top — treat
  // any title match anywhere in the text as a strong signal, same weight
  // class as a resume's own job title.
  for (const title of keywords.titles) {
    if (text.includes(title)) {
      score += SECTION_WEIGHTS.jobPosting;
      signals.push(`Job posting title match: "${title}"`);
    }
  }

  for (const kw of keywords.primary) {
    if (text.includes(kw)) {
      score += SECTION_WEIGHTS.jobPosting * 0.3;
    }
  }

  return { score, signals: signals.slice(0, 3) };
}

/**
 * Check if the top industry has strong title-based signals
 */
function hasStrongTitleSignal(signals: string[]): boolean {
  return signals.some(s => s.startsWith('Job title match:'));
}

/**
 * Apply disambiguation rules to prevent misclassification
 * when skills-section noise from a different industry inflates scores
 */
function applyDisambiguation(
  scores: Array<{ industry: string; score: number; signals: string[] }>
): void {
  const top = scores[0];
  if (!top) return;
  
  const rules = DISAMBIGUATION_RULES[top.industry];
  if (!rules) return;
  
  const topHasTitles = hasStrongTitleSignal(top.signals);
  if (!topHasTitles) return;
  
  // If the top industry has title matches, penalize competing industries
  // that are marked as "negative" (i.e., noise from skills section)
  for (let i = 1; i < scores.length; i++) {
    const competitor = scores[i];
    const rule = rules.find(r => r.negativeFor === competitor.industry);
    if (rule && rule.requiredTitleSignal && !hasStrongTitleSignal(competitor.signals)) {
      // Competitor has no title signal but high score → likely skills noise
      // Penalize by 50%
      competitor.score *= 0.5;
      competitor.signals.push('Score reduced: no title signal vs dominant industry');
    }
  }
  
  // Re-sort after penalties
  scores.sort((a, b) => b.score - a.score);
}

/**
 * Fallback keyword pass — lightweight scan when primary engine returns low scores.
 * Uses broad keyword clusters to at least narrow down the industry family.
 */
function fallbackKeywordPass(text: string): { industry: string; score: number; signals: string[] } | null {
  const lowerText = text.toLowerCase();
  
  // Broad keyword clusters — less precise but catches resumes the main engine misses
  const broadClusters: Array<{ industry: string; keywords: string[]; minMatches: number }> = [
    { industry: 'finance', keywords: ['revenue', 'budget', 'financial', 'accounting', 'audit', 'tax', 'investment', 'portfolio', 'banking', 'fiscal', 'quarterly', 'annual report', 'p&l', 'balance sheet', 'cash flow', 'forecast', 'compliance'], minMatches: 3 },
    { industry: 'technology', keywords: ['software', 'code', 'programming', 'developer', 'engineer', 'api', 'database', 'cloud', 'deploy', 'agile', 'sprint', 'git', 'infrastructure', 'system', 'architecture'], minMatches: 3 },
    { industry: 'healthcare', keywords: ['patient', 'clinical', 'hospital', 'medical', 'nursing', 'care', 'health', 'diagnosis', 'treatment', 'medication', 'physician', 'therapy', 'hipaa'], minMatches: 3 },
    { industry: 'sales', keywords: ['quota', 'revenue target', 'closed', 'deals', 'prospect', 'pipeline', 'crm', 'selling', 'account executive', 'sales', 'commission', 'territory'], minMatches: 3 },
    { industry: 'marketing', keywords: ['campaign', 'brand', 'content', 'seo', 'social media', 'advertising', 'analytics', 'digital', 'engagement', 'conversion', 'funnel', 'leads'], minMatches: 3 },
    { industry: 'engineering', keywords: ['design', 'manufacturing', 'cad', 'specifications', 'tolerance', 'materials', 'testing', 'prototype', 'simulation', 'assembly', 'quality', 'inspection'], minMatches: 3 },
    { industry: 'hr', keywords: ['recruiting', 'hiring', 'talent', 'onboarding', 'employee', 'compensation', 'benefits', 'payroll', 'workforce', 'retention', 'hris'], minMatches: 3 },
    { industry: 'education', keywords: ['teaching', 'students', 'curriculum', 'classroom', 'lesson', 'instruction', 'academic', 'school', 'university', 'learning'], minMatches: 3 },
    { industry: 'legal', keywords: ['legal', 'law', 'contract', 'compliance', 'court', 'litigation', 'attorney', 'counsel', 'regulation', 'statute'], minMatches: 3 },
    { industry: 'consulting', keywords: ['client', 'engagement', 'strategy', 'advisory', 'deliverable', 'stakeholder', 'recommendation', 'transformation', 'consulting'], minMatches: 3 },
    { industry: 'product_management', keywords: ['product manager', 'roadmap', 'backlog', 'sprint planning', 'user stories', 'prioritization', 'product strategy', 'product launch', 'cross-functional', 'stakeholder alignment', 'okr', 'product requirements'], minMatches: 3 },
    { industry: 'retail', keywords: ['store', 'retail', 'inventory', 'merchandise', 'customer service', 'pos', 'sales floor', 'upselling', 'loss prevention', 'shrink', 'cashier', 'planogram'], minMatches: 3 },
    { industry: 'hospitality', keywords: ['hotel', 'guest', 'reservations', 'hospitality', 'food and beverage', 'banquet', 'catering', 'front desk', 'occupancy', 'revpar', 'restaurant', 'concierge'], minMatches: 3 },
    { industry: 'manufacturing', keywords: ['production', 'manufacturing', 'assembly', 'quality control', 'lean', 'six sigma', 'oee', 'fabrication', 'machining', 'inspection', 'safety', 'osha'], minMatches: 3 },
    { industry: 'government', keywords: ['policy', 'government', 'federal', 'regulation', 'compliance', 'grant', 'public sector', 'procurement', 'legislation', 'constituent', 'agency', 'security clearance'], minMatches: 3 },
    // Data/AI fallback clusters — required so these industries survive when primary scoring
    // returns LOW confidence. Without these, data engineers / data scientists / ML engineers
    // fall through to generic 'technology' via the technology cluster above.
    { industry: 'data_engineering', keywords: ['dbt', 'airflow', 'snowflake', 'bigquery', 'databricks', 'etl', 'data pipeline', 'data warehouse', 'kafka', 'spark', 'fivetran', 'dagster'], minMatches: 2 },
    { industry: 'data_science', keywords: ['statistical', 'hypothesis testing', 'a/b test', 'experiment', 'scikit-learn', 'tableau', 'power bi', 'looker', 'regression', 'classification', 'predictive', 'forecasting'], minMatches: 2 },
    { industry: 'machine_learning', keywords: ['pytorch', 'tensorflow', 'llm', 'fine-tuning', 'inference', 'embedding', 'vector database', 'langchain', 'hugging face', 'model deployment', 'mlflow', 'wandb'], minMatches: 2 },
    { industry: 'creative', keywords: ['figma', 'adobe', 'photoshop', 'illustrator', 'ux design', 'ui design', 'brand design', 'visual design', 'portfolio', 'typography', 'motion design'], minMatches: 2 },
    { industry: 'product_management', keywords: ['product roadmap', 'backlog', 'user stories', 'sprint planning', 'product strategy', 'okr', 'product launch', 'cross-functional', 'product requirements', 'go-to-market'], minMatches: 2 },
  ];
  
  let bestMatch: { industry: string; score: number; signals: string[] } | null = null;
  
  for (const cluster of broadClusters) {
    const matched = cluster.keywords.filter(kw => lowerText.includes(kw));
    if (matched.length >= cluster.minMatches) {
      const score = matched.length * 2; // Simple scoring
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          industry: cluster.industry,
          score,
          signals: matched.slice(0, 3).map(kw => `Fallback match: "${kw}"`)
        };
      }
    }
  }
  
  return bestMatch;
}

/**
 * Context-aware military/operations remapping (v2).
 * "military" isn't a real industry — detect what the person actually does.
 * V2: More aggressive remapping — NEVER allow military/general as final.
 */
function remapPhantomIndustry(
  industry: string,
  text: string,
  scores: Array<{ industry: string; score: number; signals: string[] }>
): string {
  const phantomIndustries = ['military', 'general'];
  if (!phantomIndustries.includes(industry)) return industry;
  
  // Military-specific context clues for remapping
  const lowerText = text.toLowerCase();
  const contextClues: Record<string, string[]> = {
    'consulting': ['strategic planning', 'advisory', 'transformation', 'change management', 'stakeholder'],
    'finance': ['budget', 'financial', 'procurement', 'fiscal', 'cost analysis', 'audit'],
    'technology': ['software', 'systems', 'network', 'cyber', 'it infrastructure', 'database'],
    'hr': ['recruiting', 'training', 'personnel', 'workforce', 'staffing', 'talent'],
    'engineering': ['maintenance', 'equipment', 'technical', 'mechanical', 'electrical', 'design'],
    'healthcare': ['medical', 'patient', 'clinical', 'health', 'nursing'],
    'education': ['instructor', 'training program', 'curriculum', 'teaching'],
    'sales': ['account', 'business development', 'client', 'revenue', 'pipeline'],
    'product_management': ['program manager', 'project manager', 'roadmap', 'cross-functional', 'stakeholder alignment'],
  };
  
  // Score each potential remap based on context keywords
  let bestRemap: { industry: string; matchCount: number } | null = null;
  for (const [targetIndustry, clues] of Object.entries(contextClues)) {
    const matchCount = clues.filter(clue => lowerText.includes(clue)).length;
    if (matchCount >= 2 && (!bestRemap || matchCount > bestRemap.matchCount)) {
      bestRemap = { industry: targetIndustry, matchCount };
    }
  }
  
  if (bestRemap) {
    console.log(`[INDUSTRY-DETECTION] Remapped "${industry}" → "${bestRemap.industry}" (${bestRemap.matchCount} context clues matched)`);
    return bestRemap.industry;
  }
  
  // Fall back to second-best scoring industry (lower threshold than v1)
  const secondBest = scores.find(s => !phantomIndustries.includes(s.industry) && s.score >= 3);
  if (secondBest) {
    console.log(`[INDUSTRY-DETECTION] Remapped "${industry}" → "${secondBest.industry}" (score: ${secondBest.score})`);
    return secondBest.industry;
  }
  
  // Absolute last resort: return consulting (most common for military transitions)
  if (industry === 'military') {
    console.log(`[INDUSTRY-DETECTION] Military fallback → consulting (no other signals)`);
    return 'consulting';
  }
  
  return industry;
}

/**
 * Apply feedback loop: boost scores based on historical user corrections.
 * DYNAMIC VERSION: accepts correction data loaded from DB at scan time.
 * Falls back to a static map if no dynamic data is provided.
 */
const STATIC_CORRECTION_BOOSTS: Record<string, { target: string; boost: number }[]> = {
  // Fallback if dynamic data isn't available
  'military': [
    { target: 'consulting', boost: 5 },
    { target: 'finance', boost: 4 },
    { target: 'technology', boost: 3 },
  ],
  'general': [
    { target: 'technology', boost: 3 },
    { target: 'consulting', boost: 3 },
    { target: 'sales', boost: 2 },
  ],
  'technology': [
    { target: 'product_management', boost: 2 },
    { target: 'engineering', boost: 2 },
  ],
  'consulting': [
    { target: 'finance', boost: 2 },
    { target: 'technology', boost: 2 },
  ],
};

/**
 * Build dynamic correction boosts from DB correction records.
 * Format: array of { original_industry, corrected_industry, count }
 */
export function buildDynamicCorrectionBoosts(
  corrections: Array<{ original_industry: string; corrected_industry: string; count: number }>
): Record<string, { target: string; boost: number }[]> {
  const boosts: Record<string, { target: string; boost: number }[]> = {};
  
  for (const { original_industry, corrected_industry, count } of corrections) {
    if (!boosts[original_industry]) boosts[original_industry] = [];
    // Scale boost: 1 correction = +1, 3+ = +3, 5+ = +5 (capped)
    const boost = Math.min(5, Math.max(1, Math.floor(count * 1.5)));
    boosts[original_industry].push({ target: corrected_industry, boost });
  }
  
  return boosts;
}

function applyCorrectionsBoost(
  scores: Array<{ industry: string; score: number; signals: string[] }>,
  topIndustry: string,
  dynamicBoosts?: Record<string, { target: string; boost: number }[]>
): void {
  const boostMap = dynamicBoosts || STATIC_CORRECTION_BOOSTS;
  const boosts = boostMap[topIndustry];
  if (!boosts) return;
  
  for (const { target, boost } of boosts) {
    const entry = scores.find(s => s.industry === target);
    if (entry && entry.score > 0) {
      entry.score += boost;
      entry.signals.push(`Correction boost: +${boost} (${dynamicBoosts ? 'dynamic' : 'static'} pattern)`);
      console.log(`[INDUSTRY-DETECTION] Applied correction boost: ${target} +${boost} (from ${topIndustry}, ${dynamicBoosts ? 'dynamic' : 'static'})`);
    }
  }
  
  // Re-sort after boosts
  scores.sort((a, b) => b.score - a.score);
}

/**
 * Main detection function
 * @param dynamicCorrections - Optional correction data from DB for dynamic learning
 */
export function detectIndustry(
  resumeText: string,
  dynamicCorrections?: Record<string, { target: string; boost: number }[]>,
  jobDescriptionText?: string
): DetectionResult {
  const sections = extractSections(resumeText);

  // Calculate scores for all industries
  const scores: Array<{ industry: string; score: number; signals: string[] }> = [];

  for (const industry of Object.keys(INDUSTRY_KEYWORDS)) {
    const result = calculateIndustryScore(sections, industry);
    const signals = result.signals;
    let score = result.score;

    if (jobDescriptionText && jobDescriptionText.trim().length > 0) {
      const jobPostingResult = calculateJobPostingScore(jobDescriptionText, industry);
      score += jobPostingResult.score;
      signals.push(...jobPostingResult.signals);
    }

    scores.push({
      industry,
      score,
      signals
    });
  }
  
  // Sort by score
  scores.sort((a, b) => b.score - a.score);
  
  // Apply disambiguation rules to handle skills-section noise
  applyDisambiguation(scores);
  
  const top = scores[0];
  const second = scores[1];
  
  // === FEEDBACK LOOP: Apply correction boosts (dynamic or static) ===
  applyCorrectionsBoost(scores, top.industry, dynamicCorrections);
  
  // Re-read top/second after potential re-sort
  const adjustedTop = scores[0];
  const adjustedSecond = scores[1];
  
  // Determine confidence — with boosted thresholds for title-matched industries
  let confidence: 'high' | 'medium' | 'low';
  const hasTitles = hasStrongTitleSignal(adjustedTop.signals);
  
  if (hasTitles && adjustedTop.score >= 10) {
    confidence = 'high';
  } else if (hasTitles && adjustedTop.score >= 7 && adjustedSecond && (adjustedTop.score / adjustedSecond.score) >= 1.4) {
    // Title match + clear lead over second place — still high confidence
    confidence = 'high';
  } else if (adjustedTop.score >= 18 && (adjustedTop.score / (adjustedSecond?.score || 1)) >= 1.6) {
    // Very high keyword score with clear margin — high confidence even without title
    confidence = 'high';
  } else if (adjustedTop.score >= 11 && (adjustedTop.score / (adjustedSecond?.score || 1)) >= 1.3) {
    // Solid keyword score with reasonable margin — medium confidence
    confidence = 'medium';
  } else if (hasTitles && adjustedTop.score >= 5) {
    // Title match but weak keyword support — medium confidence
    confidence = 'medium';
  } else {
    // Weak or no title, marginal keyword score — low confidence, trust AI
    confidence = 'low';
  }
  
  // Check for mixed signals — but NOT if top has title matches
  if (!hasTitles && adjustedSecond && adjustedSecond.score > 0 && (adjustedTop.score / adjustedSecond.score) < 1.3) {
    confidence = confidence === 'high' ? 'medium' : 'low';
    adjustedTop.signals.push(`Note: Also shows signals for ${adjustedSecond.industry}`);
  }
  
  // Determine initial industry
  let finalIndustry = adjustedTop.score >= 3 ? adjustedTop.industry : 'general';
  let finalSignals = adjustedTop.signals;
  let finalScore = adjustedTop.score;
  
  // === FALLBACK KEYWORD PASS ===
  if (confidence === 'low' || finalIndustry === 'general') {
    const fallback = fallbackKeywordPass(resumeText);
    if (fallback && fallback.score > finalScore) {
      console.log(`[INDUSTRY-DETECTION] Fallback pass upgraded: "${finalIndustry}" → "${fallback.industry}" (fallback score: ${fallback.score})`);
      finalIndustry = fallback.industry;
      finalSignals = [...fallback.signals, ...finalSignals.slice(0, 2)];
      finalScore = fallback.score;
      if (confidence === 'low' && fallback.score >= 6) {
        confidence = 'medium';
      }
    }
  }
  
  // === PHANTOM INDUSTRY REMAPPING (v3 — MANDATORY) ===
  // Military/general should NEVER be a final result
  finalIndustry = remapPhantomIndustry(finalIndustry, resumeText, scores);
  
  // DOUBLE-CHECK: If remap still returned a phantom, force to consulting
  if (['military', 'general'].includes(finalIndustry)) {
    console.log(`[INDUSTRY-DETECTION] FORCE-KILL: "${finalIndustry}" escaped remap → forcing to consulting`);
    finalIndustry = 'consulting';
    if (confidence === 'high') confidence = 'medium';
    finalSignals.push('Forced remap from non-functional industry');
  }
  
  // === MULTI-INDUSTRY DETECTION ===
  // If the second industry has a strong enough score relative to the first,
  // report it as a secondary industry (useful for cross-functional roles)
  let secondaryIndustry: string | undefined;
  let secondaryScore: number | undefined;
  
  const nonPhantomSecond = scores.find(s => 
    s.industry !== finalIndustry && 
    !['military', 'general'].includes(s.industry) && 
    s.score >= 8
  );
  
  if (nonPhantomSecond && nonPhantomSecond.score >= adjustedTop.score * 0.5) {
    secondaryIndustry = nonPhantomSecond.industry;
    secondaryScore = nonPhantomSecond.score;
    console.log(`[INDUSTRY-DETECTION] Multi-industry: primary="${finalIndustry}" (${finalScore}), secondary="${secondaryIndustry}" (${secondaryScore})`);
  }
  
  return {
    industry: finalIndustry,
    confidence,
    score: finalScore,
    signals: finalSignals.slice(0, 5),
    alternativeIndustries: scores.slice(1, 4).map(s => ({
      industry: s.industry,
      score: s.score
    })),
    secondaryIndustry,
    secondaryScore,
  };
}

/**
 * Format detection result for AI prompt
 */
export function formatDetectionForPrompt(result: DetectionResult): string {
  const multiIndustryNote = result.secondaryIndustry 
    ? `\n- Secondary Industry: ${result.secondaryIndustry} (score: ${result.secondaryScore?.toFixed(1)})\n  NOTE: This candidate shows strong signals for BOTH industries. Tailor keywords and recommendations to cover both domains.`
    : '';
    
  return `
**PRE-DETECTED INDUSTRY (MANDATORY — your response MUST use this industry):**
- Detected Industry: ${result.industry.toUpperCase()}
- Confidence: ${result.confidence}
- Score: ${result.score.toFixed(1)}
- Key Signals: ${result.signals.join('; ')}${multiIndustryNote}
${result.alternativeIndustries.length > 0 ? `- Alternative industries: ${result.alternativeIndustries.map(a => `${a.industry}(${a.score.toFixed(1)})`).join(', ')}` : ''}

CRITICAL INSTRUCTION: The pre-detection algorithm has analyzed job titles, keyword frequency, section weights, and co-occurrence patterns.
${result.confidence === 'high' ? 
  `HIGH CONFIDENCE — You MUST return "${result.industry}" as the industry. DO NOT override this. The algorithm matched job titles directly. Even if the skills section mentions other fields (e.g., marketing keywords on a sales resume), the JOB TITLES determine industry.` : 
  result.confidence === 'medium' ? 
  `MEDIUM CONFIDENCE — Return "${result.industry}" unless you have STRONG title-based evidence for a different industry. Skills-section keywords alone are NOT sufficient evidence to override.` :
  'LOW CONFIDENCE — Use your judgment but consider these signals. Job titles should weigh more than skills lists.'}
`;
}
