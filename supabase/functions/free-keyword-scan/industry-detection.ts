/**
 * Industry Detection Engine
 *
 * Uses weighted keyword frequency, section awareness, co-occurrence clustering,
 * job title anchoring, employer name lookup, and recency-weighted bullet scoring
 * to detect industry with high accuracy.
 */

/**
 * Well-known employer → industry map.
 * Used as a high-confidence anchor: if the resume mentions a recognizable employer,
 * boost that industry's score before keyword scoring runs.
 * Score boost is ~3pts — meaningful for ties, but can't override a clear title mismatch
 * (e.g. SWE at Goldman still scores technology because title match gives 16+ pts).
 */
const KNOWN_EMPLOYERS: Record<string, string> = {
  // Technology
  'google': 'technology', 'alphabet': 'technology', 'deepmind': 'technology',
  'apple': 'technology', 'microsoft': 'technology', 'meta': 'technology',
  'facebook': 'technology', 'instagram': 'technology', 'whatsapp': 'technology',
  'amazon': 'technology', 'aws': 'technology', 'netflix': 'technology',
  'uber': 'technology', 'lyft': 'technology', 'airbnb': 'technology',
  'twitter': 'technology', 'x corp': 'technology', 'snap': 'technology',
  'pinterest': 'technology', 'reddit': 'technology', 'discord': 'technology',
  'salesforce': 'technology', 'oracle': 'technology', 'sap': 'technology',
  'ibm': 'technology', 'intel': 'technology', 'nvidia': 'technology',
  'amd': 'technology', 'qualcomm': 'technology', 'broadcom': 'technology',
  'cisco': 'technology', 'vmware': 'technology', 'workday': 'technology',
  'servicenow': 'technology', 'snowflake': 'technology', 'databricks': 'technology',
  'stripe': 'technology', 'square': 'technology', 'block': 'technology',
  'paypal': 'technology', 'braintree': 'technology', 'venmo': 'technology',
  'adobe': 'technology', 'intuit': 'technology', 'dropbox': 'technology',
  'slack': 'technology', 'zoom': 'technology', 'shopify': 'technology',
  'twilio': 'technology', 'cloudflare': 'technology', 'hashicorp': 'technology',
  'mongodb': 'technology', 'elastic': 'technology', 'palantir': 'technology',
  'splunk': 'technology', 'datadog': 'technology', 'new relic': 'technology',
  'pagerduty': 'technology', 'github': 'technology', 'gitlab': 'technology',
  'atlassian': 'technology', 'jira': 'technology', 'confluence': 'technology',
  'hubspot': 'technology', 'zendesk': 'technology', 'intercom': 'technology',
  'figma': 'technology', 'canva': 'technology', 'notion': 'technology',
  'airtable': 'technology', 'vercel': 'technology', 'netlify': 'technology',
  'digitalocean': 'technology', 'digital ocean': 'technology',
  'roblox': 'technology', 'unity': 'technology', 'epic games': 'technology',
  'openai': 'technology', 'anthropic': 'technology', 'cohere': 'technology',
  'scale ai': 'technology', 'anyscale': 'technology', 'mistral': 'technology',
  'okta': 'technology', 'crowdstrike': 'technology', 'palo alto networks': 'technology',
  'zscaler': 'technology', 'fortinet': 'technology', 'sentinelone': 'technology',
  'veeva': 'technology', 'epic systems': 'technology', 'cerner': 'technology',
  'toast': 'technology', 'mindbody': 'technology', 'procore': 'technology',
  'costar': 'technology', 'zillow': 'technology', 'redfin': 'technology',
  'opendoor': 'technology', 'compass': 'technology',
  // Fintech / Digital payments
  'klarna': 'finance', 'wise': 'finance', 'revolut': 'finance',
  'transferwise': 'finance', 'chime': 'finance', 'affirm': 'finance',
  'plaid': 'finance', 'brex': 'finance', 'ramp': 'finance',
  // GenAI / LLM-native companies
  'hugging face': 'machine_learning', 'stability ai': 'machine_learning',
  'character.ai': 'machine_learning', 'together.ai': 'machine_learning',
  'replicate': 'machine_learning', 'modal': 'machine_learning',
  'langchain': 'machine_learning', 'llamaindex': 'machine_learning',
  'perplexity': 'machine_learning', 'inflection': 'machine_learning',
  // Chinese / Asian tech
  'alibaba': 'technology', 'tencent': 'technology', 'bytedance': 'technology',
  'baidu': 'technology', 'xiaomi': 'technology', 'grab': 'technology',
  'sea limited': 'technology', 'shopee': 'technology',
  // Collaboration / no-code / design tools
  'miro': 'technology', 'monday.com': 'technology',
  'asana': 'technology', 'webflow': 'technology', 'retool': 'technology',
  'zapier': 'technology', 'loom': 'technology',
  'doordash': 'technology', 'booking.com': 'technology',
  // HR tech
  'lattice': 'technology', 'rippling': 'technology', 'deel': 'technology',
  'remote.com': 'technology', 'personio': 'technology',
  // Finance / Banking / Investment
  'goldman sachs': 'finance', 'goldman': 'finance',
  'morgan stanley': 'finance', 'jp morgan': 'finance', 'jpmorgan': 'finance',
  'bank of america': 'finance', 'wells fargo': 'finance',
  'citigroup': 'finance', 'citibank': 'finance', 'citi': 'finance',
  'deutsche bank': 'finance', 'barclays': 'finance', 'ubs': 'finance',
  'credit suisse': 'finance', 'hsbc': 'finance', 'bnp paribas': 'finance',
  'blackrock': 'finance', 'vanguard': 'finance', 'fidelity': 'finance',
  'charles schwab': 'finance', 'schwab': 'finance',
  'td ameritrade': 'finance', 'e*trade': 'finance', 'etrade': 'finance',
  'merrill lynch': 'finance', 'merrill': 'finance',
  'piper sandler': 'finance', 'jefferies': 'finance', 'lazard': 'finance',
  'evercore': 'finance', 'moelis': 'finance', 'houlihan lokey': 'finance',
  'kkr': 'finance', 'blackstone': 'finance', 'apollo': 'finance',
  'carlyle': 'finance', 'tpg': 'finance', 'bain capital': 'finance',
  'citadel': 'finance', 'two sigma': 'finance', 'de shaw': 'finance',
  'bridgewater': 'finance', 'renaissance': 'finance', 'point72': 'finance',
  'millennium': 'finance', 'jane street': 'finance', 'virtu': 'finance',
  'susquehanna': 'finance', 'drw': 'finance', 'imc trading': 'finance',
  'raymond james': 'finance', 'stifel': 'finance', 'truist': 'finance',
  'pnc': 'finance', 'us bancorp': 'finance', 'us bank': 'finance',
  'state street': 'finance', 'northern trust': 'finance',
  'american express': 'finance', 'amex': 'finance',
  'visa': 'finance', 'mastercard': 'finance', 'discover': 'finance',
  'nerdwallet': 'finance', 'sofi': 'finance', 'robinhood': 'finance',
  'coinbase': 'finance', 'kraken': 'finance',
  // Consulting
  'mckinsey': 'consulting', 'bain': 'consulting', 'bcg': 'consulting',
  'boston consulting group': 'consulting',
  'deloitte': 'consulting', 'pwc': 'consulting', 'kpmg': 'consulting',
  'ernst & young': 'consulting', 'ey': 'consulting',
  'accenture': 'consulting', 'booz allen': 'consulting',
  'oliver wyman': 'consulting', 'roland berger': 'consulting',
  'strategy&': 'consulting', 'lek consulting': 'consulting',
  'a.t. kearney': 'consulting', 'kearney': 'consulting',
  'alvarez & marsal': 'consulting', 'fti consulting': 'consulting',
  'gartner': 'consulting', 'huron': 'consulting', 'west monroe': 'consulting',
  'guidehouse': 'consulting', 'slalom': 'consulting', 'capgemini': 'consulting',
  'cognizant': 'consulting', 'wipro': 'consulting', 'infosys': 'consulting',
  'tata consultancy': 'consulting', 'tcs': 'consulting',
  'icf': 'consulting', 'l.e.k.': 'consulting',
  // Healthcare
  'mayo clinic': 'healthcare', 'cleveland clinic': 'healthcare',
  'johns hopkins': 'healthcare', 'kaiser permanente': 'healthcare',
  'hca healthcare': 'healthcare', 'ascension': 'healthcare',
  'commonspirit': 'healthcare', 'tenet healthcare': 'healthcare',
  'providence': 'healthcare', 'intermountain': 'healthcare',
  'unitedhealthcare': 'healthcare', 'unitedhealth': 'healthcare',
  'cigna': 'healthcare', 'aetna': 'healthcare', 'humana': 'healthcare',
  'anthem': 'healthcare', 'cvs health': 'healthcare', 'walgreens': 'healthcare',
  'pfizer': 'healthcare', 'johnson & johnson': 'healthcare', 'j&j': 'healthcare',
  'merck': 'healthcare', 'astrazeneca': 'healthcare',
  'bristol-myers squibb': 'healthcare', 'bms': 'healthcare',
  'abbott': 'healthcare', 'medtronic': 'healthcare',
  'boston scientific': 'healthcare', 'stryker': 'healthcare',
  'baxter': 'healthcare', 'becton dickinson': 'healthcare', 'bd': 'healthcare',
  'zimmer biomet': 'healthcare', 'edwards lifesciences': 'healthcare',
  'hologic': 'healthcare', 'intuitive surgical': 'healthcare',
  'biogen': 'healthcare', 'gilead': 'healthcare', 'regeneron': 'healthcare',
  'moderna': 'healthcare', 'biontech': 'healthcare', 'illumina': 'healthcare',
  'quest diagnostics': 'healthcare', 'labcorp': 'healthcare',
  // Legal
  'skadden': 'legal', 'sullivan & cromwell': 'legal',
  'latham & watkins': 'legal', 'kirkland & ellis': 'legal',
  'wachtell': 'legal', 'cravath': 'legal', 'davis polk': 'legal',
  'simpson thacher': 'legal', 'cleary gottlieb': 'legal',
  'white & case': 'legal', 'paul weiss': 'legal', 'sidley austin': 'legal',
  'gibson dunn': 'legal', 'cooley': 'legal', 'orrick': 'legal',
  'wilmerhale': 'legal', 'jones day': 'legal', 'baker mckenzie': 'legal',
  'dla piper': 'legal', 'greenberg traurig': 'legal',
  'morgan lewis': 'legal', 'hogan lovells': 'legal', 'freshfields': 'legal',
  'linklaters': 'legal', 'allen & overy': 'legal', 'clifford chance': 'legal',
  // Manufacturing / Industrial
  'general electric': 'manufacturing', 'ge': 'manufacturing',
  '3m': 'manufacturing', 'honeywell': 'manufacturing',
  'caterpillar': 'manufacturing', 'deere': 'manufacturing',
  'john deere': 'manufacturing', 'boeing': 'manufacturing',
  'lockheed martin': 'manufacturing', 'raytheon': 'manufacturing',
  'northrop grumman': 'manufacturing', 'general dynamics': 'manufacturing',
  'ford': 'manufacturing', 'general motors': 'manufacturing', 'gm': 'manufacturing',
  'toyota': 'manufacturing', 'honda': 'manufacturing', 'bmw': 'manufacturing',
  'volkswagen': 'manufacturing', 'stellantis': 'manufacturing',
  'whirlpool': 'manufacturing', 'emerson': 'manufacturing',
  'parker hannifin': 'manufacturing', 'eaton': 'manufacturing',
  'rockwell automation': 'manufacturing', 'siemens': 'manufacturing',
  'abb': 'manufacturing', 'schneider electric': 'manufacturing',
  'illinois tool works': 'manufacturing', 'itw': 'manufacturing',
  'dover': 'manufacturing', 'danaher': 'manufacturing', 'roper': 'manufacturing',
  'cooper industries': 'manufacturing', 'textron': 'manufacturing',
  'l3harris': 'manufacturing', 'bae systems': 'manufacturing',
  'dupont': 'manufacturing', 'basf': 'manufacturing', 'dow': 'manufacturing',
  'exxon': 'manufacturing', 'chevron': 'manufacturing', 'shell': 'manufacturing',
  // Retail
  'walmart': 'retail', 'target': 'retail', 'costco': 'retail',
  'kroger': 'retail', 'home depot': 'retail', "lowe's": 'retail', 'lowes': 'retail',
  "macy's": 'retail', 'macys': 'retail', 'nordstrom': 'retail',
  'gap': 'retail', 'old navy': 'retail', 'banana republic': 'retail',
  'h&m': 'retail', 'zara': 'retail', 'uniqlo': 'retail',
  'tj maxx': 'retail', 'marshalls': 'retail', 'ross': 'retail',
  'dollar general': 'retail', 'dollar tree': 'retail', 'five below': 'retail',
  'best buy': 'retail', 'autozone': 'retail', "o'reilly": 'retail',
  'advance auto': 'retail', 'petsmart': 'retail', 'petco': 'retail',
  'ulta': 'retail', 'sephora': 'retail',
  // Hospitality / Food & Beverage
  'marriott': 'hospitality', 'hilton': 'hospitality', 'hyatt': 'hospitality',
  'ihg': 'hospitality', 'wyndham': 'hospitality', 'four seasons': 'hospitality',
  'ritz-carlton': 'hospitality', 'ritz carlton': 'hospitality',
  'accor': 'hospitality', 'mgm resorts': 'hospitality', 'mgm': 'hospitality',
  'las vegas sands': 'hospitality', 'wynn': 'hospitality',
  'caesars': 'hospitality', 'hard rock': 'hospitality',
  'darden': 'hospitality', 'yum brands': 'hospitality',
  'restaurant brands': 'hospitality',
  'chipotle': 'hospitality', 'starbucks': 'hospitality',
  "mcdonald's": 'hospitality', 'mcdonalds': 'hospitality',
  'burger king': 'hospitality', 'wendy': 'hospitality',
  'taco bell': 'hospitality', 'subway': 'hospitality',
  'olive garden': 'hospitality', 'cheesecake factory': 'hospitality',
  'dominos': 'hospitality', "domino's": 'hospitality',
  // Government / Public Sector
  'department of defense': 'government', 'department of state': 'government',
  'department of treasury': 'government', 'department of energy': 'government',
  'department of justice': 'government', 'department of homeland': 'government',
  'federal bureau': 'government', 'fbi': 'government',
  'central intelligence': 'government', 'cia': 'government',
  'national security': 'government', 'nsa': 'government',
  'fema': 'government', 'cdc': 'government', 'nih': 'government',
  'epa': 'government', 'ftc': 'government', 'fda': 'government',
  'usaid': 'government', 'peace corps': 'government',
  'world bank': 'government', 'imf': 'government',
  'united nations': 'government', 'nato': 'government',
  // Education
  'harvard': 'education', 'mit': 'education', 'stanford': 'education',
  'yale': 'education', 'columbia': 'education', 'princeton': 'education',
  'university of chicago': 'education', 'nyu': 'education',
  'ucla': 'education', 'uc berkeley': 'education', 'berkeley': 'education',
  'michigan': 'education', 'penn state': 'education', 'ohio state': 'education',
  'khan academy': 'education', 'coursera': 'education', 'udemy': 'education',
  'duolingo': 'education', 'chegg': 'education', 'chegg tutors': 'education',
  // HR / Staffing
  'adp': 'hr', 'paychex': 'hr', 'aon': 'hr', 'mercer': 'hr',
  'korn ferry': 'hr', 'heidrick': 'hr', 'spencer stuart': 'hr',
  'manpower': 'hr', 'randstad': 'hr', 'adecco': 'hr', 'robert half': 'hr',
  'kelly services': 'hr', 'insight global': 'hr',
};

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
export const INDUSTRY_KEYWORDS: Record<string, { primary: string[]; secondary: string[]; certifications: string[]; titles: string[] }> = {
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
      'blockchain engineer', 'web3 engineer', 'smart contract engineer',
      // System/platform admins — configure and operate tech, not sell it
      'systems administrator', 'sysadmin', 'it administrator', 'it admin',
      'salesforce administrator', 'crm administrator', 'salesforce admin',
      'salesforce developer', 'salesforce engineer', 'salesforce architect',
      'it manager', 'it director', 'vp of engineering', 'head of engineering',
      'database administrator', 'dba', 'network administrator',
      'it support', 'help desk', 'desktop support', 'it specialist'
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
      'python', 'javascript', 'typescript', 'java', 'c++', 'c#', '.net',
      'golang', 'rust', 'ruby', 'php', 'scala', 'kotlin', 'swift',
      'react', 'angular', 'vue', 'node.js', 'nodejs', 'express',
      'django', 'flask', 'spring', 'rails', 'laravel', 'next.js',
      'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes',
      'terraform', 'ansible', 'jenkins', 'circleci', 'github actions',
      'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
      'rabbitmq', 'graphql', 'rest', 'restful',
      'github.com', 'portfolio', 'open source', 'open-source',
      // CRM/admin tools — in tech context these are admin/configuration roles, not sales
      'salesforce', 'salesforce.com', 'apex', 'soql', 'lightning', 'salesforce flow',
      'crm', 'hubspot crm', 'microsoft dynamics', 'servicenow', 'zendesk',
      'jira', 'confluence', 'atlassian', 'okta', 'active directory'
    ],
    certifications: [
      'aws certified', 'azure certified', 'gcp certified', 'ckad', 'cka',
      'cissp', 'comptia', 'cisco certified', 'ccna', 'ccnp',
      'scrum master', 'psm', 'csm', 'pmp',
      'salesforce certified', 'salesforce administrator', 'salesforce developer',
      'salesforce architect', 'microsoft certified', 'itil', 'servicenow certified'
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
      'statistical analysis', 'statistics', 'hypothesis testing', 'a/b testing', 'a/b test',
      'experiment design', 'experimentation', 'regression', 'classification',
      'clustering', 'predictive modeling', 'model building',
      'feature engineering', 'exploratory data analysis', 'eda',
      'data visualization', 'insights', 'dashboards', 'reporting',
      'business intelligence', 'kpi', 'metrics', 'forecasting',
      'causal inference', 'causal analysis', 'treatment effect',
      'time series', 'time series forecasting', 'survival analysis',
      'bayesian', 'bayesian inference', 'probabilistic modeling',
      'cohort analysis', 'retention analysis', 'funnel analysis'
      // NOTE: 'machine learning' intentionally excluded — belongs to machine_learning industry only.
      // A data scientist who mentions ML in a skills section should NOT match this keyword here;
      // they score via sklearn/tensorflow in secondary keywords + co-occurrence patterns.
    ],
    secondary: [
      'r language', 'sql', 'pandas', 'numpy', 'scikit-learn', 'sklearn',
      'jupyter', 'jupyter notebook', 'matplotlib', 'seaborn', 'plotly',
      'tableau', 'power bi', 'power-bi', 'looker', 'metabase', 'domo',
      'statsmodels', 'scipy', 'xgboost', 'lightgbm', 'catboost',
      'excel', 'google analytics', 'mixpanel', 'amplitude', 'segment',
      'spss', 'sas', 'stata',
      'arima', 'prophet', 'sarima', 'exponential smoothing',
      'kaplan-meier', 'cox regression', 'dowhy', 'causalml',
      'nltk', 'spacy', 'text analysis', 'sentiment analysis', 'topic modeling',
      'auc', 'roc curve', 'precision recall', 'f1 score', 'confusion matrix'
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
      'growth hacker', 'head of growth', 'growth manager', 'vp of growth',
      'director of growth', 'growth lead', 'growth product manager',
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
      'brand identity', 'brand guidelines', 'messaging', 'positioning',
      // Growth-specific primary signals — ensures growth roles beat data_science
      'mau', 'dau', 'growth rate', 'user acquisition', 'retention rate',
      'activation rate', 'referral', 'viral coefficient', 'k-factor',
      'cohort retention', 'day 30 retention', 'growth loop'
    ],
    secondary: [
      'google ads', 'facebook ads', 'meta ads', 'linkedin ads', 'tiktok ads',
      'google analytics', 'ga4', 'hubspot', 'marketo', 'salesforce marketing',
      'mailchimp', 'klaviyo', 'sendgrid', 'semrush', 'ahrefs', 'moz',
      'cac', 'customer acquisition cost', 'ltv', 'cltv', 'roas', 'roi',
      'ctr', 'click-through', 'conversion rate', 'attribution', 'funnel',
      'a/b testing', 'ab testing', 'landing page', 'lead generation',
      'mql', 'sales qualified lead', 'sql lead', 'pipeline generation', 'inbound marketing'
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
      'hedge fund', 'quantitative analyst', 'quantitative researcher', 'quant researcher',
      'quant', 'trader', 'trading', 'algorithmic trader', 'algo trader',
      'portfolio strategist', 'systematic trader', 'quantitative strategist',
      'auditor', 'tax manager', 'tax accountant', 'treasury', 'treasurer',
      'credit analyst', 'risk analyst', 'compliance officer', 'actuary',
      'financial advisor', 'wealth advisor', 'investment advisor', 'financial planner',
      'registered investment advisor', 'ria', 'wealth manager', 'private wealth manager',
      'cfp', 'certified financial planner', 'financial consultant', 'retirement planner',
      'head of operations', 'vp operations', 'director of operations', 'chief operating officer',
      'investment operations', 'fund operations', 'trade operations', 'securities operations'
    ],
    primary: [
      'financial statements', 'balance sheet', 'income statement', 'cash flow',
      'p&l', 'profit and loss', 'revenue', 'ebitda', 'net income',
      'budget', 'budgeting', 'forecast', 'financial forecast', 'variance',
      'audit', 'auditing', 'internal controls', 'sox', 'sarbanes-oxley',
      'gaap', 'ifrs', 'financial reporting', 'consolidation',
      'valuation', 'dcf', 'discounted cash flow', 'lbo', 'merger', 'm&a',
      'due diligence', 'deal', 'transaction', 'portfolio', 'aum',
      'trade settlement', 'trade operations', 'fund operations', 'investment operations',
      'prime brokerage', 'fund accounting', 'custodian', 'sec compliance',
      'fixed income portfolio', 'equity portfolio', 'asset management',
      'securities lending', 'derivatives trading', 'swap', 'futures', 'options trading',
      // Quant/hedge fund signals — these must beat data_science scoring
      'backtest', 'backtested', 'backtesting', 'alpha', 'alpha generation',
      'signal', 'trading signal', 'factor', 'risk-adjusted', 'sharpe',
      'drawdown', 'market neutral', 'long/short', 'execution algorithm'
    ],
    secondary: [
      'excel', 'financial modeling', 'bloomberg', 'factset', 'capital iq',
      'quickbooks', 'netsuite', 'sap', 'oracle financials', 'hyperion',
      'tax', 'taxation', 'deferred tax', 'depreciation', 'amortization',
      'accounts payable', 'accounts receivable', 'general ledger',
      'journal entry', 'reconciliation', 'accrual'
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
      'pharmacist', 'pharmacy technician', 'radiologist', 'radiologic technician', 'radiologic technologist',
      'medical technologist', 'lab technician', 'lab technologist', 'phlebotomist',
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
      'benefits', 'payroll', 'performance review', 'performance management',
      'talent development', 'succession planning', 'workforce planning',
      'employee engagement', 'employee relations', 'culture', 'engagement survey',
      'learning and development', 'training program'
    ],
    secondary: [
      'workday', 'adp', 'bamboohr', 'greenhouse', 'lever', 'icims',
      'taleo', 'successfactors', 'ultipro', 'paychex', 'gusto',
      'linkedin recruiter', 'indeed', 'glassdoor', 'handshake',
      'ats', 'applicant tracking', 'hris', 'hrms',
      'turnover', 'attrition', 'dei',
      'diversity', 'inclusion', 'equity', 'eeo', 'compliance',
      'people analytics', 'org design', 'organizational development'
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
      'board of directors', 'sec filing', 'sec compliance', 'sec regulation',
      'intellectual property', 'patent', 'trademark', 'copyright',
      'm&a', 'due diligence', 'labor law', 'billable hours',
      'matter', 'docket', 'filing', 'privilege', 'confidentiality',
      'indemnification', 'liability', 'damages', 'injunction', 'arbitration',
      'document review', 'e-discovery', 'ediscovery', 'gdpr', 'ccpa', 'privacy law'
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
      'r&d engineer', 'research engineer', 'applications engineer',
      'construction manager', 'construction project manager', 'site manager',
      'site superintendent', 'general contractor', 'construction superintendent'
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
      'strategy analyst', 'management analyst', 'operations analyst',
      'consulting partner', 'engagement partner', 'engagement manager',
      'consulting manager', 'senior consulting manager',
      'managing director', 'managing partner',
      // Note: bare 'analyst', 'manager', 'director', 'associate', 'vice president'
      // intentionally excluded — they match too broadly on non-consulting resumes
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
      'strategy', 'strategic', 'recommendation',
      'stakeholder', 'presentation', 'deliverable', 'workstream',
      'business case', 'operating model', 'cost reduction', 'revenue growth',
      'process improvement', 'diagnostic', 'assessment',
      'hypothesis', 'framework', 'structured problem solving',
      'value proposition', 'competitive landscape', 'target operating model',
      'client engagement', 'project management', 'issue tree'
    ],
    secondary: [
      'mckinsey', 'bain', 'bcg', 'deloitte', 'accenture', 'kpmg', 'ey', 'pwc',
      'capgemini', 'oliver wyman', 'roland berger', 'booz allen',
      'powerpoint', 'excel', 'benchmarking',
      'due diligence', 'transformation', 'change management', 'implementation',
      'deck', 'slide', 'executive presentation', 'c-suite', 'board presentation',
      'roi analysis', 'business model', 'go-to-market strategy',
      'market entry', 'organizational design', 'post-merger integration'
    ],
    certifications: [
      'pmp', 'prince2', 'mba', 'cmc', 'prosci'
    ]
  },
  
  creative: {
    titles: [
      'graphic designer', 'visual designer', 'ui designer', 'ux designer',
      'product designer', 'web designer', 'art director', 'creative director',
      'brand designer', 'motion designer', 'animator', 'illustrator',
      'photographer', 'videographer', 'video editor', 'copywriter',
      'content creator', 'social media creator',
      'ux researcher', 'user researcher', 'ux research lead', 'design researcher',
      'interaction designer', 'experience designer', 'service designer',
      'design lead', 'design manager', 'head of design', 'vp of design'
    ],
    primary: [
      'design', 'creative', 'visual', 'branding', 'brand identity',
      'layout', 'typography', 'color', 'composition', 'aesthetic',
      'user experience', 'user interface', 'wireframe', 'mockup',
      'prototype', 'portfolio', 'concept', 'ideation',
      'user research', 'usability testing', 'usability test', 'user testing', 'design thinking',
      'journey map', 'persona', 'information architecture', 'interaction design',
      'accessibility', 'a11y', 'heuristic evaluation', 'affinity mapping',
      'visual hierarchy', 'color theory', 'tone of voice', 'design system',
      'component library', 'style guide', 'brand guidelines'
    ],
    secondary: [
      'photoshop', 'illustrator', 'indesign', 'figma', 'sketch', 'xd',
      'after effects', 'premiere', 'final cut', 'cinema 4d', 'blender',
      'canva', 'invision', 'zeplin', 'principle', 'framer',
      'procreate', 'lightroom', 'capture one', 'davinci resolve'
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
      'sales floor', 'point of sale', 'pos system', 'pos terminal', 'inventory', 'merchandise', 'merchandising',
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
      'safety', 'osha', 'ehs', 'incident rate', 'near miss',
      'equipment', 'machinery', 'production planning', 'work instruction',
      'shift management', 'line balancing', 'takt time', 'changeover'
    ],
    secondary: [
      'sap', 'erp', 'mes', 'cmms', 'plc', 'scada', 'hmi',
      'iso 9001', 'as9100', 'iatf', 'ts16949', 'fda', 'gmp',
      'bom', 'bill of materials', 'work order', 'preventive maintenance',
      'supply chain', 'procurement', 'inventory', 'kanban', 'jit', 'just-in-time',
      'warehouse', 'logistics', 'shipping', 'receiving', 'material handling'
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
  },

  cybersecurity: {
    titles: [
      'security engineer', 'security analyst', 'soc analyst', 'penetration tester',
      'pentester', 'red team', 'blue team', 'security architect', 'ciso',
      'information security', 'infosec', 'threat analyst', 'incident responder',
      'vulnerability analyst', 'security consultant', 'application security',
      'appsec engineer', 'cloud security engineer', 'grc analyst',
      'security operations', 'cyber defense analyst', 'malware analyst',
      'forensics analyst', 'security researcher'
    ],
    primary: [
      'penetration testing', 'vulnerability', 'incident response', 'siem',
      'threat hunting', 'threat intelligence', 'security operations center',
      'soc', 'malware', 'phishing', 'zero trust', 'endpoint detection',
      'edr', 'xdr', 'ids', 'ips', 'firewall', 'security posture',
      'attack surface', 'red teaming', 'exploit', 'cve', 'patch management',
      'security audit', 'risk assessment', 'compliance framework',
      'security controls', 'encryption', 'identity and access management', 'iam'
    ],
    secondary: [
      'splunk', 'crowdstrike', 'sentinelone', 'palo alto', 'fortinet',
      'nessus', 'qualys', 'burp suite', 'metasploit', 'wireshark', 'kali',
      'nist', 'iso 27001', 'soc 2', 'mitre att&ck', 'owasp', 'pci dss',
      'hipaa compliance', 'fedramp', 'devsecops', 'sast', 'dast'
    ],
    certifications: [
      'cissp', 'ceh', 'oscp', 'security+', 'comptia security', 'gsec',
      'gcih', 'cism', 'ccsp', 'gpen', 'cisa'
    ]
  },

  logistics: {
    titles: [
      'supply chain manager', 'logistics manager', 'logistics coordinator',
      'warehouse manager', 'operations manager', 'procurement manager',
      'demand planner', 'supply planner', 'inventory manager',
      'transportation manager', 'fleet manager', 'distribution manager',
      'freight broker', 'customs broker', 'import export specialist',
      'supply chain analyst', 'logistics analyst', 'materials manager',
      'fulfillment manager', 'shipping coordinator', 'dispatcher'
    ],
    primary: [
      'supply chain', 'logistics', 'warehouse', 'inventory', 'procurement',
      'freight', 'shipping', 'distribution', 'fulfillment', 'transportation',
      'demand planning', 'forecasting', 'on-time delivery', 'otif',
      'inventory turnover', 'stock levels', 'purchase orders', '3pl',
      'carrier', 'lanes', 'ltl', 'ftl', 'last mile', 'cross-docking',
      'kitting', 'cycle count', 'lead time', 'reorder point', 'safety stock'
    ],
    secondary: [
      'sap', 'oracle scm', 'wms', 'tms', 'erp', 'edi', 'netsuite',
      'manhattan', 'blue yonder', 'kinaxis', 'incoterms', 'customs',
      'bill of lading', 'sku', 'rfid', 'barcode scanning', 'lean',
      'six sigma', 'kaizen', 'jit', 'just-in-time'
    ],
    certifications: [
      'cscp', 'cpim', 'cltd', 'apics', 'cips', 'lean six sigma',
      'six sigma green belt', 'six sigma black belt'
    ]
  },

  real_estate: {
    titles: [
      'real estate agent', 'realtor', 'broker', 'real estate broker',
      'property manager', 'leasing agent', 'leasing consultant',
      'real estate analyst', 'acquisitions analyst', 'asset manager',
      'commercial real estate', 'transaction coordinator', 'escrow officer',
      'title officer', 'appraiser', 'real estate developer',
      'mortgage loan officer', 'loan originator', 'underwriter'
    ],
    primary: [
      'listings', 'closings', 'escrow', 'mls', 'buyers', 'sellers',
      'property management', 'leasing', 'tenants', 'landlord', 'rent roll',
      'occupancy rate', 'noi', 'net operating income', 'cap rate',
      'appraisal', 'comps', 'comparative market analysis', 'cma',
      'transaction volume', 'sales volume', 'commission', 'open house',
      'residential', 'commercial property', 'multifamily', 'square feet',
      'acquisitions', 'dispositions', 'due diligence', 'title'
    ],
    secondary: [
      'zillow', 'redfin', 'costar', 'loopnet', 'yardi', 'appfolio',
      'buildium', 'dotloop', 'docusign', 'fha', 'va loan', 'conventional loan',
      'refinance', 'hoa', 'cam charges', 'triple net', 'nnn', '1031 exchange'
    ],
    certifications: [
      'real estate license', 'brokers license', 'ccim', 'crs', 'gri',
      'abr', 'sior', 'cpm', 'nmls'
    ]
  },

  insurance: {
    titles: [
      'insurance agent', 'insurance broker', 'underwriter', 'claims adjuster',
      'claims examiner', 'actuary', 'actuarial analyst', 'risk manager',
      'insurance sales', 'account manager insurance', 'benefits consultant',
      'claims manager', 'loss control', 'insurance producer'
    ],
    primary: [
      'underwriting', 'claims', 'premiums', 'policies', 'policyholders',
      'coverage', 'deductible', 'liability', 'property and casualty', 'p&c',
      'life insurance', 'health insurance', 'annuities', 'reinsurance',
      'loss ratio', 'combined ratio', 'risk assessment', 'actuarial',
      'book of business', 'renewals', 'endorsements', 'binders',
      'subrogation', 'adjusting', 'claims processing', 'quoting'
    ],
    secondary: [
      'guidewire', 'duck creek', 'applied epic', 'ams360', 'acord',
      'iso forms', 'naic', 'state filings', 'workers compensation',
      'workers comp', 'commercial lines', 'personal lines', 'e&o',
      'errors and omissions', 'umbrella policy', 'excess liability'
    ],
    certifications: [
      'cpcu', 'clu', 'chfc', 'arm', 'ains', 'cic', 'insurance license',
      'series 6', 'series 63', 'fsa', 'asa', 'acas', 'fcas'
    ]
  },

  nonprofit: {
    titles: [
      'program director', 'executive director', 'development director',
      'grant writer', 'grants manager', 'fundraising manager', 'major gifts officer',
      'volunteer coordinator', 'community outreach', 'advocacy director',
      'development associate', 'donor relations', 'program coordinator nonprofit',
      'nonprofit manager', 'philanthropy officer', 'impact manager'
    ],
    primary: [
      'fundraising', 'grants', 'donors', 'donor cultivation', 'major gifts',
      'annual fund', 'capital campaign', 'stewardship', 'philanthropy',
      'nonprofit', 'non-profit', 'ngo', '501c3', '501(c)(3)', 'mission-driven',
      'volunteers', 'community outreach', 'advocacy', 'program delivery',
      'impact measurement', 'beneficiaries', 'grant proposals', 'grant reporting',
      'board of directors', 'gala', 'annual appeal', 'planned giving',
      'endowment', 'restricted funds', 'in-kind donations'
    ],
    secondary: [
      'raisers edge', 'salesforce nonprofit', 'bloomerang', 'donorperfect',
      'classy', 'givebutter', 'foundation grants', 'federal grants',
      'united way', 'americorps', 'peace corps', 'community foundation',
      'theory of change', 'logic model', 'outcomes measurement'
    ],
    certifications: [
      'cfre', 'grant professional certified', 'gpc', 'cnp', 'nonprofit management'
    ]
  },

  biotech: {
    titles: [
      'research scientist', 'lab technician', 'laboratory technician',
      'research associate', 'clinical research coordinator', 'clinical research associate',
      'cra', 'bench scientist', 'bioinformatics scientist', 'process development',
      'quality control analyst', 'qc analyst', 'regulatory affairs specialist',
      'formulation scientist', 'principal scientist', 'postdoctoral',
      'postdoc', 'lab manager', 'biostatistician', 'medical science liaison', 'msl'
    ],
    primary: [
      'assay', 'pcr', 'qpcr', 'elisa', 'western blot', 'cell culture',
      'clinical trials', 'protocol', 'gmp', 'glp', 'gcp', 'ind', 'nda submission',
      'fda submission', 'preclinical', 'in vitro', 'in vivo', 'crispr',
      'sequencing', 'ngs', 'flow cytometry', 'chromatography', 'hplc',
      'mass spectrometry', 'antibody', 'protein purification', 'molecular biology',
      'drug discovery', 'pharmacokinetics', 'toxicology', 'bioprocess',
      'upstream', 'downstream processing', 'batch records', 'sop'
    ],
    secondary: [
      'benchling', 'labware', 'lims', 'graphpad', 'prism', 'biorender',
      'pubmed', 'clinicaltrials.gov', 'irb', 'informed consent', 'cro',
      'cdmo', 'biologics', 'small molecule', 'gene therapy', 'cell therapy',
      'monoclonal', 'immunoassay', 'stability studies'
    ],
    certifications: [
      'rac', 'ccrp', 'ccra', 'socra', 'acrp', 'aseptic', 'phd', 'ms biology'
    ]
  },

  aviation: {
    titles: [
      'pilot', 'commercial pilot', 'airline pilot', 'first officer', 'captain',
      'flight attendant', 'air traffic controller', 'aircraft mechanic',
      'a&p mechanic', 'avionics technician', 'flight instructor', 'cfi',
      'aircraft dispatcher', 'ground operations', 'ramp agent', 'airport operations',
      'aviation safety', 'aerospace engineer', 'flight test engineer'
    ],
    primary: [
      'flight hours', 'faa', 'part 121', 'part 135', 'part 91', 'type rating',
      'aircraft', 'airframe', 'powerplant', 'preflight', 'flight operations',
      'crew resource management', 'crm aviation', 'sops', 'checkride',
      'instrument rating', 'multi-engine', 'turbine', 'jet', 'rotorcraft',
      'airworthiness', 'maintenance logs', 'inspections', 'faa regulations',
      'atc', 'ifr', 'vfr', 'nomex', 'ground school', 'simulator'
    ],
    secondary: [
      'boeing', 'airbus', 'cessna', 'embraer', 'gulfstream', 'pratt whitney',
      'ge aviation', 'rolls royce', 'foreflight', 'jeppesen', 'metar', 'notam',
      'tsa', 'icao', 'easa', 'safety management system', 'sms aviation'
    ],
    certifications: [
      'atp', 'commercial pilot license', 'cpl', 'ppl', 'cfi', 'cfii', 'mei',
      'a&p license', 'ia', 'faa certificate', 'medical certificate', 'type rated'
    ]
  },

  energy: {
    titles: [
      'petroleum engineer', 'drilling engineer', 'reservoir engineer',
      'field engineer', 'plant operator', 'power plant operator',
      'lineman', 'utility technician', 'solar installer', 'solar technician',
      'wind technician', 'energy analyst', 'energy manager', 'grid operator',
      'transmission engineer', 'substation technician', 'pipeline operator',
      'hse manager', 'landman', 'energy trader'
    ],
    primary: [
      'oil and gas', 'upstream', 'midstream', 'downstream', 'drilling',
      'wellsite', 'rig', 'completion', 'fracking', 'hydraulic fracturing',
      'production optimization', 'reservoir', 'pipeline', 'refinery',
      'renewable energy', 'solar', 'wind', 'photovoltaic', 'pv systems',
      'battery storage', 'grid', 'transmission', 'distribution', 'substation',
      'megawatt', 'kilowatt', 'power generation', 'turbine', 'utility scale',
      'energy efficiency', 'hse', 'process safety', 'lockout tagout'
    ],
    secondary: [
      'scada', 'osha 30', 'api standards', 'asme', 'nerc', 'ferc',
      'interconnection', 'ppa', 'power purchase agreement', 'net metering',
      'inverters', 'petra', 'aries', 'pvsyst', 'helioscope', 'osisoft', 'pi system'
    ],
    certifications: [
      'nabcep', 'osha 30', 'osha 10', 'pe license', 'gwo', 'twic', 'h2s alive',
      'well control', 'iwcf', 'nerc certification'
    ]
  },

  skilled_trades: {
    titles: [
      'electrician', 'journeyman electrician', 'master electrician',
      'plumber', 'journeyman plumber', 'hvac technician', 'hvac installer',
      'carpenter', 'welder', 'pipefitter', 'millwright', 'machinist',
      'heavy equipment operator', 'crane operator', 'ironworker', 'mason',
      'construction foreman', 'superintendent', 'project superintendent',
      'general contractor', 'construction manager', 'estimator',
      'maintenance technician', 'facilities technician', 'diesel mechanic',
      'automotive technician', 'auto mechanic', 'service technician'
    ],
    primary: [
      'electrical', 'wiring', 'conduit', 'circuits', 'breaker panels',
      'plumbing', 'piping', 'fixtures', 'hvac', 'refrigeration', 'ductwork',
      'welding', 'fabrication', 'blueprint reading', 'blueprints', 'schematics',
      'installation', 'troubleshooting', 'preventive maintenance', 'repair',
      'residential', 'commercial construction', 'industrial', 'job site',
      'safety compliance', 'osha', 'code compliance', 'nec', 'building codes',
      'apprenticeship', 'journeyman', 'punch list', 'change orders', 'rough-in'
    ],
    secondary: [
      'hand tools', 'power tools', 'multimeter', 'megger', 'mig', 'tig',
      'stick welding', 'brazing', 'soldering', 'forklift', 'scissor lift',
      'boom lift', 'rigging', 'epa 608', 'backflow', 'low voltage',
      'fire alarm', 'sprinkler systems', 'service calls', 'work orders'
    ],
    certifications: [
      'journeyman license', 'master license', 'epa 608', 'osha 10', 'osha 30',
      'aws certified welder', 'nccer', 'ase certified', 'cdl', 'nate certified',
      'epa universal'
    ]
  },

  customer_success: {
    titles: [
      'customer support specialist', 'customer service representative',
      'support engineer', 'technical support', 'help desk', 'service desk',
      'support analyst', 'customer experience', 'cx manager',
      'customer care', 'call center', 'contact center', 'support team lead',
      'escalation manager', 'tier 2 support', 'tier 3 support'
    ],
    primary: [
      'customer support', 'tickets', 'ticket resolution', 'sla', 'csat',
      'nps', 'first response time', 'resolution time', 'escalations',
      'knowledge base', 'troubleshooting', 'customer inquiries', 'call volume',
      'average handle time', 'aht', 'first call resolution', 'fcr',
      'customer satisfaction', 'support queue', 'live chat', 'phone support',
      'email support', 'omnichannel', 'deflection', 'self-service'
    ],
    secondary: [
      'zendesk', 'freshdesk', 'intercom', 'servicenow', 'jira service desk',
      'salesforce service cloud', 'kustomer', 'gorgias', 'gladly',
      'talkdesk', 'five9', 'genesys', 'nice', 'quality assurance', 'qa scores',
      'workforce management', 'wfm', 'crm'
    ],
    certifications: [
      'itil', 'hdi', 'comptia a+', 'customer service certification'
    ]
  }
};

// ── Sub-industry taxonomy ─────────────────────────────────────────────────
// Second-level specialization within a detected industry. Detected by signal
// counting over the resume text; requires minSignals hits to claim the sub-industry.
export const SUB_INDUSTRY_TAXONOMY: Record<string, Array<{ id: string; label: string; signals: string[]; minSignals: number }>> = {
  healthcare: [
    { id: 'clinical', label: 'Clinical Care', signals: ['patient care', 'bedside', 'charting', 'vitals', 'medication administration', 'triage', 'acute care', 'icu', 'emergency', 'rn', 'nursing'], minSignals: 2 },
    { id: 'healthcare_admin', label: 'Healthcare Administration', signals: ['medical billing', 'coding', 'icd-10', 'cpt', 'claims', 'prior authorization', 'revenue cycle', 'practice management', 'hipaa compliance', 'credentialing'], minSignals: 2 },
    { id: 'pharma', label: 'Pharmaceutical', signals: ['pharmaceutical', 'pharma sales', 'formulary', 'prescribers', 'territory', 'drug launch', 'medical affairs', 'pharmacovigilance'], minSignals: 2 },
    { id: 'health_tech', label: 'Health Technology', signals: ['ehr', 'emr', 'epic', 'cerner', 'health tech', 'telehealth', 'interoperability', 'hl7', 'fhir', 'digital health'], minSignals: 2 },
  ],
  technology: [
    { id: 'frontend', label: 'Frontend Engineering', signals: ['react', 'vue', 'angular', 'css', 'typescript', 'ui components', 'responsive design', 'accessibility', 'webpack', 'vite'], minSignals: 3 },
    { id: 'backend', label: 'Backend Engineering', signals: ['api design', 'microservices', 'database', 'postgresql', 'redis', 'kafka', 'grpc', 'rest api', 'scalability', 'distributed systems'], minSignals: 3 },
    { id: 'devops', label: 'DevOps / Platform', signals: ['kubernetes', 'terraform', 'ci/cd', 'docker', 'infrastructure as code', 'observability', 'monitoring', 'sre', 'reliability', 'deployment pipelines'], minSignals: 3 },
    { id: 'mobile', label: 'Mobile Engineering', signals: ['ios', 'android', 'swift', 'kotlin', 'react native', 'flutter', 'app store', 'mobile app'], minSignals: 2 },
  ],
  finance: [
    { id: 'accounting', label: 'Accounting', signals: ['general ledger', 'month-end close', 'reconciliation', 'accounts payable', 'accounts receivable', 'journal entries', 'gaap', 'audit support'], minSignals: 2 },
    { id: 'fpa', label: 'FP&A', signals: ['budgeting', 'forecasting', 'variance analysis', 'financial modeling', 'fp&a', 'headcount planning', 'board deck'], minSignals: 2 },
    { id: 'ib_pe', label: 'Investment Banking / PE', signals: ['m&a', 'due diligence', 'lbo', 'dcf', 'pitch book', 'deal execution', 'valuation', 'private equity', 'investment banking'], minSignals: 2 },
    { id: 'banking', label: 'Retail / Commercial Banking', signals: ['loan origination', 'credit analysis', 'branch', 'teller', 'deposits', 'commercial lending', 'kyc', 'aml'], minSignals: 2 },
  ],
  marketing: [
    { id: 'growth', label: 'Growth / Performance Marketing', signals: ['paid acquisition', 'cac', 'roas', 'google ads', 'meta ads', 'conversion rate', 'a/b testing', 'funnel optimization'], minSignals: 2 },
    { id: 'content_brand', label: 'Content / Brand Marketing', signals: ['content strategy', 'editorial', 'brand voice', 'storytelling', 'copywriting', 'thought leadership', 'social media strategy'], minSignals: 2 },
    { id: 'product_marketing', label: 'Product Marketing', signals: ['positioning', 'messaging', 'go-to-market', 'launch', 'sales enablement', 'competitive intelligence', 'win/loss'], minSignals: 2 },
  ],
  engineering: [
    { id: 'civil', label: 'Civil / Structural', signals: ['civil engineering', 'structural', 'autocad civil', 'site development', 'stormwater', 'geotechnical', 'roadway', 'surveying'], minSignals: 2 },
    { id: 'mechanical', label: 'Mechanical', signals: ['solidworks', 'mechanical design', 'cad modeling', 'gd&t', 'thermal analysis', 'fea', 'prototyping', 'tolerance'], minSignals: 2 },
    { id: 'electrical_eng', label: 'Electrical', signals: ['circuit design', 'pcb', 'schematic capture', 'embedded systems', 'firmware', 'power electronics', 'signal integrity'], minSignals: 2 },
  ],
};

export function detectSubIndustry(industry: string, resumeText: string): { id: string; label: string; matchedSignals: string[] } | null {
  const subs = SUB_INDUSTRY_TAXONOMY[industry];
  if (!subs) return null;
  const lower = resumeText.toLowerCase();
  let best: { id: string; label: string; matchedSignals: string[] } | null = null;
  for (const sub of subs) {
    const matched = sub.signals.filter(s => lower.includes(s));
    if (matched.length >= sub.minSignals && (!best || matched.length > best.matchedSignals.length)) {
      best = { id: sub.id, label: sub.label, matchedSignals: matched };
    }
  }
  return best;
}

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
    ['gaap', 'financial', 'statements'],
    // Quant/hedge fund — must beat data_science when these appear together
    ['backtest', 'alpha', 'signal'],
    ['sharpe', 'drawdown', 'factor'],
    ['trading', 'execution', 'portfolio']
  ],
  healthcare: [
    ['patient', 'clinical', 'hospital'],
    ['nursing', 'care', 'medication'],
    ['hipaa', 'emr', 'charting'],
    ['epic', 'ehr', 'charting'],
    ['icu', 'patient', 'bedside'],
    ['medication', 'vital signs', 'clinical'],
    ['diagnosis', 'treatment', 'patient care']
  ],
  hr: [
    ['recruiting', 'hiring', 'talent'],
    ['onboarding', 'employee', 'hris'],
    ['compensation', 'benefits', 'payroll']
  ],
  legal: [
    ['litigation', 'court', 'contract'],
    ['counsel', 'compliance', 'legal'],
    ['westlaw', 'bar', 'attorney'],
    ['securities', 'intellectual property', 'corporate'],
    ['billable', 'matter', 'docket'],
    ['contract', 'draft', 'review']
  ],
  education: [
    ['teaching', 'students', 'curriculum'],
    ['classroom', 'instruction', 'lesson'],
    ['iep', 'special education', 'students'],
    ['k-12', 'curriculum', 'instruction'],
    ['grading', 'assessment', 'academic'],
    ['lesson plan', 'differentiated', 'students']
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
    ['deck', 'slide', 'executive'],
    ['client', 'deliverable', 'recommendation'],
    ['engagement manager', 'workstream', 'stakeholder'],
    ['business case', 'operating model', 'strategic']
  ],
  creative: [
    ['design', 'portfolio', 'visual'],
    ['figma', 'photoshop', 'branding'],
    ['user research', 'usability testing', 'wireframe'],
    ['ux', 'prototype', 'figma'],
    ['typography', 'layout', 'brand identity']
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
    ['dbt', 'prefect', 'pipeline'],
    ['dbt', 'dagster', 'pipeline'],
    // Streaming with warehouse anchor (guards against DevOps false positive)
    ['kafka', 'spark', 'data warehouse'],
    ['kafka', 'flink', 'pipeline'],
    ['snowflake', 'bigquery', 'data warehouse'],
    ['databricks', 'delta lake', 'pipeline'],
    ['fivetran', 'stitch', 'ingestion'],
    ['airbyte', 'dbt', 'transformation'],
    // Broader warehouse + orchestration combos
    ['data pipeline', 'etl', 'warehouse'],
    ['ingestion', 'transformation', 'orchestration']
  ],
  data_science: [
    // Remove 'model, training, accuracy' — too generic (fires for finance modeling)
    ['hypothesis testing', 'a/b test', 'experiment'],
    ['jupyter', 'pandas', 'scikit'],
    ['tableau', 'power bi', 'dashboard'],
    ['regression', 'classification', 'prediction'],
    ['cohort', 'retention', 'dashboard'],
    ['statistical', 'analysis', 'python'],
    ['auc', 'roc', 'precision recall'],
    ['feature engineering', 'cross-validation', 'model']
  ],
  machine_learning: [
    ['llm', 'fine-tuning', 'inference'],
    ['vector', 'embedding', 'rag'],
    ['production', 'serving', 'latency'],
    ['pytorch', 'tensorflow', 'model training'],
    ['langchain', 'openai', 'prompt'],
    ['pinecone', 'weaviate', 'vector database'],
    ['mlops', 'mlflow', 'deployment'],
    ['hugging face', 'transformers', 'bert'],
    ['lora', 'qlora', 'fine-tuning'],
    ['quantization', 'inference', 'gpu']
  ],
  retail: [
    ['sales floor', 'inventory', 'customer service'],
    ['point of sale', 'cashier', 'upselling'],
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
  // If someone has sales titles, marketing/technology keywords shouldn't reclassify them.
  // Key case: SaaS Account Executive who mentions APIs, integrations, software in job bullets
  // should stay sales — technology must not steal based on product vocabulary alone.
  sales: [
    { negativeFor: 'marketing', requiredTitleSignal: true },
    { negativeFor: 'creative', requiredTitleSignal: true },
    { negativeFor: 'technology', requiredTitleSignal: true }
  ],
  // If someone has tech titles (SWE, DevOps, admin), other industries shouldn't reclassify.
  // Key case: SWE at an ML company who writes Python scripts touching ML APIs should stay
  // technology — they need a machine_learning TITLE to score as ML engineer.
  // "Growth engineer": has "engineer" title but marketing signals — stays technology.
  technology: [
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'sales', requiredTitleSignal: true },
    { negativeFor: 'marketing', requiredTitleSignal: true },
    { negativeFor: 'data_engineering', requiredTitleSignal: true },
    { negativeFor: 'machine_learning', requiredTitleSignal: true }, // SWE at ML co ≠ ML engineer
    { negativeFor: 'data_science', requiredTitleSignal: true }
  ],
  // Machine learning: strong title required — writing Python at an ML company is NOT
  // sufficient to reclassify away from technology. ML engineer needs ML/AI title.
  machine_learning: [
    { negativeFor: 'technology', requiredTitleSignal: true },
    { negativeFor: 'data_science', requiredTitleSignal: true }
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
  // If someone has consulting titles, sales/PM keywords shouldn't reclassify
  consulting: [
    { negativeFor: 'sales', requiredTitleSignal: true },
    { negativeFor: 'product_management', requiredTitleSignal: true }
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
  // If someone has PM titles, technology/consulting keywords shouldn't reclassify
  product_management: [
    { negativeFor: 'technology', requiredTitleSignal: true },
    { negativeFor: 'data_engineering', requiredTitleSignal: true },
    { negativeFor: 'machine_learning', requiredTitleSignal: true },
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'sales', requiredTitleSignal: true },
    { negativeFor: 'marketing', requiredTitleSignal: true }
  ],
  // Government: policy analyst uses strategy/stakeholder/analysis — all consulting primary.
  // Require consulting title signals before reclassifying away from government.
  government: [
    { negativeFor: 'consulting', requiredTitleSignal: true },
    { negativeFor: 'finance', requiredTitleSignal: true }
  ],
  // Retail: buyer/manager uses vendor/negotiation/transactions — overlaps with finance.
  retail: [
    { negativeFor: 'finance', requiredTitleSignal: true },
    { negativeFor: 'consulting', requiredTitleSignal: true }
  ],
  // Hospitality: hotel/F&B roles share 'care', 'management', 'operations' with healthcare.
  hospitality: [
    { negativeFor: 'healthcare', requiredTitleSignal: true },
    { negativeFor: 'consulting', requiredTitleSignal: true }
  ],
  // Manufacturing: production roles share engineering/design/quality with engineering.
  manufacturing: [
    { negativeFor: 'engineering', requiredTitleSignal: true },
    { negativeFor: 'consulting', requiredTitleSignal: true }
  ]
};

interface DetectionResult {
  industry: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  signals: string[];
  alternativeIndustries: Array<{ industry: string; score: number; reason?: string }>;
  secondaryIndustry?: string;
  secondaryScore?: number;
  /** More specific sub-role within the detected industry, e.g. "Frontend Engineer", "FP&A Analyst", "IB Associate" */
  subRole?: string;
  /** Top detected tech stack items for tech roles, e.g. ["Python", "Go", "Kubernetes"] */
  techStack?: string[];
  /** Degree/credential signals found in education section */
  educationSignals?: string[];
  /** Sub-industry specialization within the detected industry, e.g. { id: 'clinical', label: 'Clinical Care' } */
  subIndustry?: { id: string; label: string; matchedSignals: string[] };
  /** Industry the job description (when provided) points to, if different from the resume */
  jdIndustry?: string;
  /** Blend percentages when the candidate straddles two industries, e.g. { primaryPct: 60, secondaryPct: 40 } */
  industryBlend?: { primaryPct: number; secondaryPct: number };
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
  employers: string[];
  summary: string;
  headings: string[];
  weightedBullets: Array<{ text: string; weight: number }>;
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
    'product owner', 'scrum master', 'product manager',
    'partner', 'superintendent', 'physician', 'doctor', 'pharmacist', 'paralegal',
    'buyer', 'planner', 'underwriter', 'actuary', 'appraiser', 'auditor',
    // Healthcare credential abbreviations used as standalone titles
    'rn', 'np', 'lpn', 'lvn', 'cna', 'emt', 'md', 'do', 'dpt', 'pa-c',
    // Hospitality service roles
    'chef', 'cook', 'bartender', 'cashier', 'concierge', 'server', 'sommelier',
    // Creative roles often absent from generic titleKeywords
    'illustrator', 'photographer', 'videographer', 'animator', 'housekeeper',
    // Technical / trade roles
    'technician', 'technologist', 'mechanic', 'electrician', 'welder', 'operator',
  ];
  
  const employers: string[] = [];

  for (const line of lines) {
    if (line.length < 120) {
      const hasTitle = titleKeywords.some(kw => line.includes(kw));
      if (hasTitle) {
        let cleanTitle = '';
        let employerFragment = '';

        // Pattern 1: "Company, Location; Title (Date)" — semicolon separates company from title
        const semicolonMatch = line.match(/;\s*(.+?)(?:\s*\(|$)/i);
        if (semicolonMatch) {
          cleanTitle = semicolonMatch[1].trim();
          employerFragment = line.split(';')[0].trim();
        }

        // Pattern 2: "Title - Company" or "Title | Company" or "Title @ Company"
        if (!cleanTitle) {
          const parts = line.split(/[-–—|@]|\d{4}|january|february|march|april|may|june|july|august|september|october|november|december/i);
          cleanTitle = parts[0].trim();
          if (parts[1]) employerFragment = parts[1].trim();
        }

        // Pattern 3: "Title at Company"
        if (!cleanTitle || cleanTitle === line.trim()) {
          const atMatch = line.match(/^(.+?)\s+at\s+(.+?)(?:\s*\(|$)/i);
          if (atMatch) {
            cleanTitle = atMatch[1].trim();
            employerFragment = atMatch[2].trim();
          }
        }

        if (cleanTitle && cleanTitle.length > 3 && cleanTitle.length < 80) {
          jobTitles.push(cleanTitle);
        }
        if (employerFragment && employerFragment.length > 1 && employerFragment.length < 60) {
          employers.push(employerFragment.toLowerCase());
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
    /^(experience|work experience|professional experience|employment|career|work history)/i,
    /^(education|academic|qualifications|academic background)/i,
    /^(skills|technical skills|core competencies|technical stack|key skills)/i,
    /^(certifications?|licenses?|credentials)/i,
    /^(projects?|key projects|notable projects|portfolio)/i,
    /^(achievements?|accomplishments?|awards?|honors?)/i,
    /^(summary|professional summary|profile|objective|about me)/i,
    /^(publications?|research|patents?)/i,
    /^(volunteer|community|leadership)/i,
    /^(languages|interests|hobbies)/i
  ];
  
  for (const line of lines) {
    if (line.length < 50 && headingPatterns.some(p => p.test(line))) {
      headings.push(line);
    }
  }
  
  // Build job blocks for recency-weighted bullet scoring.
  // Each block starts at a detected title line; bullets below belong to that block.
  // Blocks are in resume order (most recent first, reverse-chronological convention).
  const BLOCK_WEIGHTS = [2.0, 1.5, 1.0, 0.6]; // weight by block index: most recent -> oldest
  const isBulletLine = (l: string) =>
    l.startsWith('\u2022') || l.startsWith('-') || l.startsWith('*') ||
    /^[\u2022\u2023\u25E6\u2043\u2219]/.test(l) ||
    (l.length > 30 && l.length < 300);

  const jobBlocks: string[][] = [];
  let currentBlock: string[] | null = null;

  for (const line of lines) {
    const isTitleLine = line.length < 120 && titleKeywords.some(kw => line.includes(kw));
    if (isTitleLine) {
      currentBlock = [];
      jobBlocks.push(currentBlock);
    } else if (isBulletLine(line)) {
      if (currentBlock) {
        currentBlock.push(line);
      } else {
        // Bullets before any title line — treat as most-recent block
        currentBlock = [];
        jobBlocks.push(currentBlock);
        currentBlock.push(line);
      }
    }
  }

  // Flatten blocks into weightedBullets with per-bullet recency weight
  const weightedBullets: Array<{ text: string; weight: number }> = [];
  jobBlocks.forEach((block, blockIdx) => {
    const w = BLOCK_WEIGHTS[Math.min(blockIdx, BLOCK_WEIGHTS.length - 1)];
    block.forEach(bullet => weightedBullets.push({ text: bullet, weight: w }));
  });

  // Extract skills section
  let skills = '';
  const skillsStart = text.indexOf('skills');
  if (skillsStart !== -1) {
    skills = text.slice(skillsStart, skillsStart + 500);
  }

  return {
    jobTitles,
    employers,
    summary,
    headings,
    weightedBullets,
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
      // For very short abbreviations (≤3 chars), require word boundaries to prevent
      // substring matches — e.g. "rn" firing inside "International", "rt" in "partner"
      const matches = industryTitle.length <= 3
        ? new RegExp(`(?<![a-z])${industryTitle}(?![a-z])`).test(title)
        : title.includes(industryTitle);
      if (matches) {
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
  
  // Check bullets with per-bullet recency weight (recent job blocks score higher)
  for (const { text: bullet, weight } of sections.weightedBullets) {
    for (const kw of keywords.primary) {
      if (bullet.includes(kw)) {
        score += weight;
      }
    }
    for (const kw of keywords.secondary) {
      if (bullet.includes(kw)) {
        score += weight * 0.5;
      }
    }
  }

  // Employer name signal: well-known employers are unambiguous industry anchors.
  // Guard (#5): only apply the boost when the employer's industry matches what the
  // candidate's job titles suggest. A finance analyst at Google should NOT get a
  // +3 technology boost — the employer is known-tech but the person's role is finance.
  // We detect title-derived industry by checking whether this industry has any title
  // signal in the current signals array (populated earlier in this function).
  const hasTitleSignalForThisIndustry = signals.some(s => s.toLowerCase().includes('job title'));
  for (const employerFragment of sections.employers) {
    for (const [knownName, knownIndustry] of Object.entries(KNOWN_EMPLOYERS)) {
      if (knownIndustry === industry && employerFragment.includes(knownName)) {
        // Only boost when employer industry aligns with title signal, OR
        // when there are no title signals at all (employer is the only anchor)
        const titleSignalExists = sections.jobTitles.length > 0;
        if (!titleSignalExists || hasTitleSignalForThisIndustry) {
          score += 3.0;
          if (signals.length < 10) signals.push(`Known employer: "${knownName}"`);
        }
        break; // one check per employer fragment
      }
    }
  }
  
  // Check skills section (lower weight, hard-capped at 6pts to prevent long skills
  // lists from overwhelming the title/bullet signal — a 60-item skills section
  // would otherwise contribute 24+ pts and swamp job titles that give 8pts each).
  const SKILLS_SCORE_CAP = 6.0;
  let skillsScore = 0;
  for (const kw of [...keywords.primary, ...keywords.secondary]) {
    if (skillsScore >= SKILLS_SCORE_CAP) break;
    if (sections.skills.includes(kw)) {
      skillsScore = Math.min(SKILLS_SCORE_CAP, skillsScore + SECTION_WEIGHTS.skills);
    }
  }
  score += skillsScore;
  
  // Check certifications. A licensing certification (CPA, RN, PMP, JD, etc.) is
  // about as unambiguous a signal as exists on a resume — someone doesn't get a
  // CPA without being in accounting. Weight it above job titles, not level with
  // the much noisier summary section.
  for (const cert of keywords.certifications) {
    // Short abbreviations (≤4 chars) require word boundaries to prevent
    // substring matches — e.g. 'cha' inside 'Charles River', 'ca' inside 'Chicago'
    const certMatches = cert.length <= 4
      ? new RegExp(`(?<![a-z])${cert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i').test(sections.fullText)
      : sections.fullText.includes(cert);
    if (certMatches) {
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
  
  // Co-occurrence bonus — fires after minimum score is established.
  // Gate at 2.5 (lowered from 4): allows pattern-based rescue for roles like
  // growth hacker or marketing analyst that have keyword signals but weaker title matches,
  // while still blocking zero-signal false positives (DevOps→data_eng needs primary keywords first).
  if (score >= 2.5) {
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
    { industry: 'retail', keywords: ['store', 'retail', 'inventory', 'merchandise', 'customer service', 'point of sale', 'sales floor', 'upselling', 'loss prevention', 'shrink', 'cashier', 'planogram'], minMatches: 3 },
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
// FIX #3: COMPOUND CORRECTION LEARNING
// Corrections are aggregated into a multiplier-based system rather than flat boosts.
// Repeated corrections on the same original→target pattern compound logarithmically,
// and the corrected target industry also gets a score *multiplier* so even low-signal
// resumes get pulled in the right direction.
export function buildDynamicCorrectionBoosts(
  corrections: Array<{ original_industry: string; corrected_industry: string; count?: number }>
): Record<string, { target: string; boost: number; multiplier: number }[]> {
  // Group by original→target pair and sum counts
  const grouped: Record<string, { target: string; total: number }[]> = {};
  for (const { original_industry, corrected_industry, count } of corrections) {
    if (!grouped[original_industry]) grouped[original_industry] = [];
    const existing = grouped[original_industry].find(e => e.target === corrected_industry);
    if (existing) {
      existing.total += count ?? 1;
    } else {
      grouped[original_industry].push({ target: corrected_industry, total: count ?? 1 });
    }
  }

  const boosts: Record<string, { target: string; boost: number; multiplier: number }[]> = {};
  for (const [original, targets] of Object.entries(grouped)) {
    boosts[original] = targets.map(({ target, total }) => {
      // Flat boost: 1 correction = +2, 5 = +5, 10+ = +8 (log-scaled, capped at 8)
      const boost = Math.min(8, Math.max(2, Math.round(Math.log(total + 1) * 3.5)));
      // Multiplier for the target industry score: 1 correction = 1.1×, 10+ = 1.5× (capped)
      const multiplier = Math.min(1.5, 1 + Math.log(total + 1) * 0.12);
      return { target, boost, multiplier };
    });
  }
  return boosts;
}

function applyCorrectionsBoost(
  scores: Array<{ industry: string; score: number; signals: string[] }>,
  topIndustry: string,
  dynamicBoosts?: Record<string, { target: string; boost: number; multiplier?: number }[]>
): void {
  const boostMap = dynamicBoosts || STATIC_CORRECTION_BOOSTS;
  const boosts = boostMap[topIndustry];
  if (!boosts) return;

  for (const entry of boosts) {
    const { target, boost, multiplier } = entry as { target: string; boost: number; multiplier?: number };
    const scoreEntry = scores.find(s => s.industry === target);
    if (scoreEntry) {
      // Apply flat boost regardless of whether target had signal (corrections are strong evidence)
      const prev = scoreEntry.score;
      scoreEntry.score = (scoreEntry.score + boost) * (multiplier ?? 1.0);
      scoreEntry.signals.push(`Correction: +${boost} ×${(multiplier ?? 1).toFixed(2)} (${dynamicBoosts ? 'dynamic' : 'static'}, was ${prev.toFixed(1)})`);
      console.log(`[INDUSTRY-DETECTION] Correction boost: ${target} ${prev.toFixed(1)}→${scoreEntry.score.toFixed(1)} (from ${topIndustry})`);
    } else if (boost >= 4) {
      // Target had zero score but correction is strong — add it explicitly so it can rank
      scores.push({ industry: target, score: boost * (multiplier ?? 1.0), signals: [`Correction-introduced: ${target} (boost ${boost})`] });
    }
  }

  // Re-sort after boosts
  scores.sort((a, b) => b.score - a.score);
}

/**
 * Parse the education section for degree/credential signals.
 * Returns: array of { industry, boost, signal } — each representing one unambiguous
 * credential found. A JD = legal +12, MD = healthcare +12, CPA = finance +10, etc.
 */
function extractEducationSignals(resumeText: string): Array<{ industry: string; boost: number; signal: string }> {
  const text = resumeText.toLowerCase();
  const results: Array<{ industry: string; boost: number; signal: string }> = [];

  // Helper: check with word boundaries for short tokens
  const has = (token: string) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = token.length <= 4
      ? new RegExp(`(?<![a-z])${escaped}(?![a-z])`)
      : new RegExp(escaped);
    return re.test(text);
  };

  // Legal degrees — most unambiguous signals on a resume
  if (has('j.d.') || has('juris doctor') || /\bjd\b/.test(text)) {
    results.push({ industry: 'legal', boost: 12, signal: 'Degree: J.D. (Juris Doctor)' });
  }
  if (has('llm') || has('ll.m.') || has('master of laws')) {
    results.push({ industry: 'legal', boost: 10, signal: 'Degree: LL.M.' });
  }
  if (has('bar exam') || has('bar admission') || has('admitted to the bar') || has('passed the bar')) {
    results.push({ industry: 'legal', boost: 10, signal: 'Credential: Bar admission' });
  }

  // Medical degrees
  if (has('m.d.') || has('doctor of medicine') || /\bmd\b/.test(text)) {
    results.push({ industry: 'healthcare', boost: 12, signal: 'Degree: M.D.' });
  }
  if (has('d.o.') || has('doctor of osteopathy') || /\bdo\b/.test(text)) {
    results.push({ industry: 'healthcare', boost: 12, signal: 'Degree: D.O.' });
  }
  if (has('pharm.d.') || has('doctor of pharmacy') || /\bpharmd\b/.test(text)) {
    results.push({ industry: 'healthcare', boost: 10, signal: 'Degree: Pharm.D.' });
  }
  if (has('d.p.t.') || has('doctor of physical therapy') || /\bdpt\b/.test(text)) {
    results.push({ industry: 'healthcare', boost: 9, signal: 'Degree: D.P.T.' });
  }
  if (has('bsn') || has('b.s.n') || has('bachelor of science in nursing') || has('master of science in nursing') || has('msn')) {
    results.push({ industry: 'healthcare', boost: 9, signal: 'Degree: Nursing (BSN/MSN)' });
  }

  // Finance credentials — CPA and CFA are extremely specific
  if (/\bcpa\b/.test(text) || has('certified public accountant')) {
    results.push({ industry: 'finance', boost: 10, signal: 'Credential: CPA' });
  }
  if (/\bcfa\b/.test(text) || has('chartered financial analyst')) {
    results.push({ industry: 'finance', boost: 10, signal: 'Credential: CFA' });
  }
  if (/\bcfp\b/.test(text) || has('certified financial planner')) {
    results.push({ industry: 'finance', boost: 8, signal: 'Credential: CFP' });
  }
  if (has('series 7') || has('series 63') || has('series 65') || has('series 66')) {
    results.push({ industry: 'finance', boost: 8, signal: 'Credential: FINRA license' });
  }
  if (has('b.s. accounting') || has('bs accounting') || has('bachelor of accounting') || has('master of accounting') || has('msa') || has('m.s. accounting')) {
    results.push({ industry: 'finance', boost: 6, signal: 'Degree: Accounting' });
  }
  if (has('mba') || has('m.b.a.') || has('master of business administration')) {
    // MBA is broad — gives modest boost to consulting + finance but doesn't lock either
    results.push({ industry: 'consulting', boost: 4, signal: 'Degree: MBA' });
    results.push({ industry: 'finance', boost: 3, signal: 'Degree: MBA' });
  }

  // CS / Engineering degrees → technology
  if (
    has('b.s. computer science') || has('bs computer science') ||
    has('bachelor of science in computer science') ||
    has('m.s. computer science') || has('ms computer science') ||
    has('master of science in computer science') ||
    has('b.s. software engineering') || has('bs software engineering') ||
    has('b.eng.') || has('b.s.e') || has('bachelor of engineering')
  ) {
    results.push({ industry: 'technology', boost: 5, signal: 'Degree: CS/Software Engineering' });
  }
  if (
    has('ph.d. computer science') || has('phd computer science') ||
    has('ph.d. machine learning') || has('phd machine learning') ||
    has('ph.d. artificial intelligence') || has('phd artificial intelligence') ||
    has('ph.d. in cs') || has('phd in cs')
  ) {
    results.push({ industry: 'machine_learning', boost: 8, signal: 'Degree: PhD CS/ML/AI' });
    results.push({ industry: 'technology', boost: 4, signal: 'Degree: PhD CS/ML/AI' });
  }
  if (has('ph.d. statistics') || has('phd statistics') || has('ph.d. mathematics') || has('phd mathematics')) {
    results.push({ industry: 'data_science', boost: 6, signal: 'Degree: PhD Statistics/Math' });
  }

  // Engineering degrees → engineering
  if (
    has('b.s. mechanical engineering') || has('bs mechanical engineering') ||
    has('b.s. electrical engineering') || has('bs electrical engineering') ||
    has('b.s. civil engineering') || has('bs civil engineering') ||
    has('b.s. chemical engineering') || has('bs chemical engineering') ||
    has('m.s. mechanical engineering') || has('m.s. electrical engineering') ||
    has('m.s. civil engineering') || has('m.s. chemical engineering') ||
    (has('bachelor') && has('engineering') && !has('software')) ||
    (has('master') && has('engineering') && !has('software') && !has('machine learning'))
  ) {
    results.push({ industry: 'engineering', boost: 6, signal: 'Degree: Engineering' });
  }

  // Teaching certifications → education
  if (has('teaching credential') || has('teaching certificate') || has('state teaching license') || has('b.s. education') || has('b.a. education') || has('bachelor of education') || has('master of education') || has('m.ed.') || has('m.a.t.')) {
    results.push({ industry: 'education', boost: 8, signal: 'Credential: Teaching license/education degree' });
  }

  return results;
}

// Tech stack keyword groups for sub-role detection
const TECH_STACKS: Array<{ label: string; keywords: string[] }> = [
  { label: 'Python', keywords: ['python', 'django', 'flask', 'fastapi', 'pandas', 'numpy', 'pydantic'] },
  { label: 'Go', keywords: ['golang', ' go ', 'goroutine', 'grpc', 'gin framework'] },
  { label: 'Java', keywords: ['java', 'spring boot', 'spring framework', 'maven', 'gradle', 'jvm', 'hibernate'] },
  { label: 'TypeScript', keywords: ['typescript', 'ts', '.tsx', 'tsc'] },
  { label: 'JavaScript', keywords: ['javascript', 'node.js', 'nodejs', 'express.js', 'next.js', 'nuxt'] },
  { label: 'React', keywords: ['react', 'react.js', 'reactjs', 'redux', 'hooks', 'jsx'] },
  { label: 'Rust', keywords: ['rust', 'cargo', 'tokio'] },
  { label: 'Ruby', keywords: ['ruby on rails', 'rails', 'ruby'] },
  { label: 'Scala', keywords: ['scala', 'spark', 'akka'] },
  { label: 'C++', keywords: ['c++', 'cpp', 'cmake', 'stl', 'boost library'] },
  { label: 'Swift', keywords: ['swift', 'swiftui', 'xcode', 'ios sdk', 'cocoa'] },
  { label: 'Kotlin', keywords: ['kotlin', 'android studio', 'jetpack compose', 'coroutines'] },
  { label: 'AWS', keywords: ['aws', 'amazon web services', 'ec2', 's3', 'lambda', 'eks', 'cloudformation'] },
  { label: 'GCP', keywords: ['gcp', 'google cloud', 'bigquery', 'cloud run', 'pub/sub', 'gke'] },
  { label: 'Azure', keywords: ['azure', 'microsoft azure', 'aks', 'cosmos db', 'azure devops'] },
  { label: 'Kubernetes', keywords: ['kubernetes', 'k8s', 'helm', 'kubectl', 'eks', 'gke', 'aks'] },
  { label: 'Docker', keywords: ['docker', 'dockerfile', 'docker-compose', 'containers', 'container orchestration'] },
  { label: 'Terraform', keywords: ['terraform', 'iac', 'infrastructure as code', 'pulumi', 'cloudformation'] },
  { label: 'PyTorch', keywords: ['pytorch', 'torch', 'autograd'] },
  { label: 'TensorFlow', keywords: ['tensorflow', 'keras', 'tf2'] },
  { label: 'SQL', keywords: ['sql', 'postgresql', 'postgres', 'mysql', 'sqlite'] },
];

// Sub-role patterns within a detected industry
const TECH_SUB_ROLES: Array<{ role: string; signals: string[]; minSignals: number }> = [
  { role: 'ML Engineer', signals: ['pytorch', 'tensorflow', 'llm', 'fine-tuning', 'model training', 'inference', 'hugging face', 'mlflow', 'feature engineering', 'training pipeline'], minSignals: 2 },
  { role: 'Data Engineer', signals: ['dbt', 'airflow', 'spark', 'kafka', 'etl', 'data pipeline', 'data warehouse', 'fivetran', 'dagster', 'bigquery', 'snowflake', 'databricks'], minSignals: 2 },
  { role: 'DevOps / Platform Engineer', signals: ['kubernetes', 'docker', 'terraform', 'ci/cd', 'github actions', 'jenkins', 'helm', 'iac', 'infrastructure as code', 'sre', 'site reliability', 'observability', 'prometheus', 'grafana'], minSignals: 2 },
  { role: 'Security Engineer', signals: ['penetration testing', 'pentest', 'vulnerability', 'soc', 'siem', 'threat modeling', 'appsec', 'devsecops', 'zero trust', 'sast', 'dast', 'incident response', 'red team', 'blue team', 'soc analyst', 'cissp', 'security engineering'], minSignals: 2 },
  { role: 'Frontend Engineer', signals: ['react', 'vue', 'angular', 'css', 'html', 'ui components', 'responsive design', 'web performance', 'next.js', 'svelte', 'frontend', 'front-end', 'web app'], minSignals: 2 },
  { role: 'Mobile Engineer', signals: ['ios', 'android', 'swift', 'kotlin', 'react native', 'flutter', 'mobile app', 'app store', 'play store', 'xcode', 'android studio'], minSignals: 2 },
  { role: 'Backend Engineer', signals: ['api', 'rest', 'grpc', 'microservices', 'backend', 'back-end', 'server-side', 'database design', 'distributed systems', 'message queue', 'kafka', 'rabbitmq'], minSignals: 2 },
  { role: 'Solutions Architect', signals: ['solutions architect', 'enterprise architect', 'system design', 'architecture review', 'technical design', 'architecture diagram', 'cloud architecture'], minSignals: 1 },
];

const FINANCE_SUB_ROLES: Array<{ role: string; signals: string[]; minSignals: number }> = [
  { role: 'Investment Banker', signals: ['investment banking', 'ib', 'm&a', 'mergers and acquisitions', 'capital markets', 'ipo', 'lbo', 'leveraged buyout', 'dcf', 'pitchbook', 'deal team', 'bulge bracket', 'boutique bank', 'fairness opinion'], minSignals: 2 },
  { role: 'Private Equity', signals: ['private equity', 'pe', 'portfolio company', 'fund management', 'carried interest', 'carry', 'deal sourcing', 'lbo model', 'buyout', 'growth equity', 'venture capital', 'vc', 'cap table'], minSignals: 2 },
  { role: 'Asset Manager', signals: ['assets under management', 'aum', 'portfolio management', 'equity research', 'alpha', 'bloomberg terminal', 'factor model', 'fixed income', 'hedge fund', 'long/short', 'sharpe ratio', 'attribution analysis'], minSignals: 2 },
  { role: 'FP&A Analyst', signals: ['fp&a', 'financial planning', 'variance analysis', 'budget', 'headcount planning', 'business partnering', 'three-statement model', 'kpi dashboard', 'monthly close', 'reforecasting', 'opex', 'capex'], minSignals: 2 },
  { role: 'Accountant / Controller', signals: ['general ledger', 'gl', 'journal entries', 'month-end close', 'accounts payable', 'accounts receivable', 'reconciliation', 'gaap', 'ifrs', 'tax preparation', 'audit', 'cpa exam', 'big 4'], minSignals: 2 },
  { role: 'Quantitative Analyst', signals: ['quantitative', 'quant', 'stochastic', 'monte carlo', 'options pricing', 'derivatives', 'risk model', 'market making', 'algorithmic trading', 'backtesting', 'statistical arbitrage'], minSignals: 2 },
];

/**
 * Detect sub-role within the given industry using keyword pattern matching.
 * Returns the most specific sub-role label, or undefined if no pattern fires.
 */
function detectSubRole(industry: string, text: string): string | undefined {
  const lower = text.toLowerCase();
  const patterns = industry === 'finance' ? FINANCE_SUB_ROLES
    : (industry === 'technology' || industry === 'machine_learning' || industry === 'data_engineering' || industry === 'data_science') ? TECH_SUB_ROLES
    : null;
  if (!patterns) return undefined;

  let best: { role: string; count: number } | null = null;
  for (const p of patterns) {
    const count = p.signals.filter(s => lower.includes(s)).length;
    if (count >= p.minSignals && (!best || count > best.count)) {
      best = { role: p.role, count };
    }
  }
  return best?.role;
}

/**
 * Extract the top tech stack items present in the resume text (max 3).
 * Only meaningful for tech-industry resumes.
 */
function extractTechStack(text: string): string[] {
  const lower = text.toLowerCase();
  const found: Array<{ label: string; count: number }> = [];
  for (const stack of TECH_STACKS) {
    const count = stack.keywords.filter(kw => lower.includes(kw)).length;
    if (count > 0) found.push({ label: stack.label, count });
  }
  // Sort by frequency, dedupe cloud platforms to one entry
  found.sort((a, b) => b.count - a.count);
  const result: string[] = [];
  const cloudLabels = new Set(['AWS', 'GCP', 'Azure']);
  let addedCloud = false;
  for (const { label } of found) {
    if (result.length >= 3) break;
    if (cloudLabels.has(label)) {
      if (!addedCloud) { result.push(label); addedCloud = true; }
    } else {
      result.push(label);
    }
  }
  return result;
}

/**
 * Build human-readable reason strings for alternative industry suggestions.
 * These appear in IndustryConfidenceIndicator to explain why the alternative
 * was considered (e.g. "Your Salesforce skills match RevOps roles").
 */
function buildAlternativeReason(primaryIndustry: string, altIndustry: string, resumeText: string): string | undefined {
  const text = resumeText.toLowerCase();
  const reasons: Record<string, Record<string, string | (() => string)>> = {
    technology: {
      data_science: 'SQL + analytics keywords suggest data science alignment',
      data_engineering: 'ETL/pipeline keywords suggest data engineering roles',
      machine_learning: 'ML framework keywords suggest ML engineering roles',
      product_management: 'Cross-functional + roadmap keywords suggest PM roles',
      sales: 'CRM tools + account keywords suggest pre/post-sales engineering',
    },
    finance: {
      consulting: 'Strategy + advisory keywords align with consulting roles',
      technology: 'Fintech + API keywords suggest financial technology roles',
      data_science: 'Quantitative + statistical analysis suggests finance data roles',
    },
    consulting: {
      finance: 'Financial modeling + valuation keywords suggest finance fit',
      technology: 'Technical implementation keywords suggest tech consulting',
      product_management: 'Strategy + stakeholder keywords suggest PM roles',
    },
    sales: {
      marketing: 'Campaign + content keywords suggest demand generation',
      technology: 'Technical product knowledge suggests sales engineering',
      product_management: 'Product feedback + user insight keywords suggest PM fit',
    },
    marketing: {
      data_science: 'Analytics + attribution keywords suggest marketing analytics',
      sales: 'Pipeline + revenue keywords suggest demand gen / growth',
      product_management: 'User research + growth keywords suggest product marketing',
    },
  };
  const primaryMap = reasons[primaryIndustry];
  if (!primaryMap) return undefined;
  const r = primaryMap[altIndustry];
  if (!r) return undefined;
  return typeof r === 'function' ? r() : r;
}

// ─── FIX #2: ROLE-FIRST TITLE ANCHORING ─────────────────────────────────────

// Patterns that unambiguously lock an industry regardless of keyword scores.
// Order matters: more specific patterns first.
const ROLE_LOCKS: Array<{ pattern: RegExp; industry: string; label: string }> = [
  // Healthcare — clinical titles
  { pattern: /\b(registered nurse|rn\b|nurse practitioner|np\b|clinical nurse|charge nurse|staff nurse|travel nurse|lpn|lvn|cna|phlebotomist|medical assistant|radiologic technologist|respiratory therapist|occupational therapist|physical therapist|speech.*therapist|pharmacist|pharmacy technician|dental hygienist|dentist|physician|surgeon|cardiologist|oncologist|radiologist|psychiatrist|anesthesiologist|hospitalist|attending physician|intern.*medicine|pediatrician|obstetrician|gynecologist|emt|paramedic|medical director|chief medical officer|cmo\b)\b/i, industry: 'healthcare', label: 'clinical title' },
  // Legal — attorney/counsel titles
  { pattern: /\b(attorney|lawyer|counsel|associate.*law|partner.*law|paralegal|legal.*assistant|law.*clerk|public defender|prosecutor|district attorney|solicitor|barrister|in-house counsel|general counsel|chief legal officer|clo\b|deputy general counsel|associate general counsel)\b/i, industry: 'legal', label: 'legal title' },
  // Education — teaching titles
  { pattern: /\b(teacher|classroom teacher|k-12 teacher|substitute teacher|adjunct professor|professor|lecturer|instructor.*university|dean.*academic|principal.*school|school principal|vice principal|curriculum specialist|instructional coach|special education teacher|esl teacher|tutor|librarian.*school|school counselor)\b/i, industry: 'education', label: 'education title' },
  // Product management — PM-specific (distinct from "manager")
  { pattern: /\b(product manager|senior product manager|principal product manager|staff product manager|director of product|vp of product|chief product officer|cpo\b|group product manager|associate product manager|technical product manager|product lead)\b/i, industry: 'product_management', label: 'PM title' },
  // Data Engineering — distinct from data science
  { pattern: /\b(data engineer|senior data engineer|staff data engineer|principal data engineer|analytics engineer|etl developer|data pipeline engineer|data platform engineer|data infrastructure engineer)\b/i, industry: 'data_engineering', label: 'data engineering title' },
  // Machine Learning / AI
  { pattern: /\b(machine learning engineer|ml engineer|ai engineer|research scientist.*ml|research engineer.*ai|llm engineer|applied scientist|applied ml|mlops engineer|nlp engineer|computer vision engineer|deep learning engineer)\b/i, industry: 'machine_learning', label: 'ML/AI title' },
  // Data Science
  { pattern: /\b(data scientist|senior data scientist|staff data scientist|principal data scientist|lead data scientist|quantitative analyst|quant analyst|research analyst.*data|statistician)\b/i, industry: 'data_science', label: 'data science title' },
  // Finance — specific finance roles not in technology
  { pattern: /\b(investment banker|investment banking analyst|investment banking associate|private equity analyst|private equity associate|venture capital analyst|portfolio manager|fund manager|hedge fund|equity researcher|credit analyst|loan officer|underwriter|financial analyst|fp&a analyst|fp&a manager|financial planning|treasury analyst|risk analyst|compliance officer|aml analyst|chief financial officer|cfo\b|controller.*finance|vp.*finance|director.*finance)\b/i, industry: 'finance', label: 'finance title' },
  // Retail
  { pattern: /\b(store manager|retail manager|assistant store manager|floor manager|department manager.*retail|merchandise manager|store director|district manager.*retail|loss prevention|visual merchandiser|retail buyer|category manager.*retail|store associate|retail associate|cashier|sales associate.*retail)\b/i, industry: 'retail', label: 'retail title' },
  // Hospitality
  { pattern: /\b(hotel manager|general manager.*hotel|front desk manager|food and beverage manager|f&b manager|executive chef|sous chef|restaurant manager|banquet manager|event coordinator.*hotel|catering manager|concierge|revenue manager.*hotel|housekeeping manager|room service)\b/i, industry: 'hospitality', label: 'hospitality title' },
  // Manufacturing / Supply Chain
  { pattern: /\b(manufacturing engineer|process engineer.*manufacturing|plant manager|production manager|quality engineer|quality assurance engineer|qc manager|lean engineer|six sigma.*engineer|supply chain manager|logistics manager|warehouse manager|operations manager.*manufacturing|industrial engineer|process improvement.*manufacturing)\b/i, industry: 'manufacturing', label: 'manufacturing title' },
  // Government / Public sector
  { pattern: /\b(policy analyst|foreign service officer|intelligence analyst|program analyst.*government|government contractor|public administrator|city manager|county manager|legislative aide|congressional staffer|federal agent|intelligence officer|security clearance.*analyst)\b/i, industry: 'government', label: 'government title' },
  // HR
  { pattern: /\b(hr business partner|hrbp|recruiter|talent acquisition|head of recruiting|director.*hr|vp.*hr|chief people officer|cpo.*people|hr director|hr manager|people operations|compensation analyst|benefits administrator|employee relations|hris analyst|workforce planning|organizational development)\b/i, industry: 'hr', label: 'HR title' },
  // Creative / Design
  { pattern: /\b(ux designer|ui designer|product designer|graphic designer|visual designer|brand designer|motion designer|creative director|art director|illustrator.*designer|interaction designer|user experience researcher|ux researcher|design lead|head of design)\b/i, industry: 'creative', label: 'design title' },
  // Cybersecurity
  { pattern: /\b(security engineer|security analyst|soc analyst|penetration tester|pentester|ciso|security architect|incident responder|threat analyst|vulnerability analyst|application security engineer|appsec engineer|malware analyst|forensics analyst)\b/i, industry: 'cybersecurity', label: 'security title' },
  // Logistics / Supply chain
  { pattern: /\b(supply chain manager|supply chain analyst|logistics coordinator|logistics manager|demand planner|supply planner|freight broker|customs broker|transportation manager|fleet manager|fulfillment manager|dispatcher)\b/i, industry: 'logistics', label: 'logistics title' },
  // Real estate
  { pattern: /\b(real estate agent|realtor|real estate broker|leasing agent|leasing consultant|property manager|escrow officer|title officer|appraiser|mortgage loan officer|loan originator|transaction coordinator)\b/i, industry: 'real_estate', label: 'real estate title' },
  // Insurance
  { pattern: /\b(claims adjuster|claims examiner|actuary|actuarial analyst|insurance agent|insurance broker|insurance producer|insurance underwriter)\b/i, industry: 'insurance', label: 'insurance title' },
  // Nonprofit
  { pattern: /\b(grant writer|grants manager|development director|major gifts officer|fundraising manager|volunteer coordinator|donor relations|philanthropy officer|executive director.*nonprofit)\b/i, industry: 'nonprofit', label: 'nonprofit title' },
  // Biotech / Lab science
  { pattern: /\b(research scientist|lab technician|laboratory technician|research associate|clinical research coordinator|clinical research associate|bench scientist|bioinformatics scientist|biostatistician|medical science liaison|qc analyst|postdoc|postdoctoral)\b/i, industry: 'biotech', label: 'lab science title' },
  // Aviation
  { pattern: /\b(commercial pilot|airline pilot|first officer|flight attendant|air traffic controller|aircraft mechanic|a&p mechanic|avionics technician|flight instructor|aircraft dispatcher)\b/i, industry: 'aviation', label: 'aviation title' },
  // Energy
  { pattern: /\b(petroleum engineer|drilling engineer|reservoir engineer|power plant operator|lineman|solar installer|solar technician|wind technician|grid operator|pipeline operator|substation technician|landman|energy trader)\b/i, industry: 'energy', label: 'energy title' },
  // Skilled trades
  { pattern: /\b(electrician|journeyman|plumber|hvac technician|hvac installer|welder|pipefitter|millwright|machinist|carpenter|crane operator|ironworker|diesel mechanic|automotive technician|auto mechanic|maintenance technician)\b/i, industry: 'skilled_trades', label: 'trade title' },
  // Customer support (distinct from sales-flavored customer success)
  { pattern: /\b(customer support specialist|customer service representative|support engineer|technical support engineer|help desk|service desk analyst|call center|contact center|escalation manager|tier [23] support)\b/i, industry: 'customer_success', label: 'support title' },
];

// ─── CERTIFICATION-BASED INDUSTRY LOCKING ────────────────────────────────────
// Licenses/certifications that are near-unambiguous industry signals. Weaker
// than a role lock (people change fields) but a strong anchor: adds a large
// boost rather than force-locking.
const CERT_LOCKS: Array<{ pattern: RegExp; industry: string; label: string; boost: number }> = [
  { pattern: /\b(registered nurse|rn license|bsn|msn|nclex|licensed practical nurse|lpn|cna certified)\b/i, industry: 'healthcare', label: 'nursing credential', boost: 15 },
  { pattern: /\b(md\b|do\b|board certified physician|usmle|medical license)\b/i, industry: 'healthcare', label: 'physician credential', boost: 15 },
  { pattern: /\b(cpa\b|certified public accountant|cfa\b|chartered financial analyst|series 7|series 63|series 65|series 66|frm\b)\b/i, industry: 'finance', label: 'finance credential', boost: 12 },
  { pattern: /\b(juris doctor|jd degree|bar admission|admitted to the bar|state bar|paralegal certificate)\b/i, industry: 'legal', label: 'legal credential', boost: 15 },
  { pattern: /\b(pmp certified|pmp\b|csm\b|certified scrum|safe agilist|pspo|psm i+\b)\b/i, industry: 'product_management', label: 'PM credential', boost: 6 },
  { pattern: /\b(pe license|professional engineer|eit\b|fe exam|fundamentals of engineering)\b/i, industry: 'engineering', label: 'engineering credential', boost: 12 },
  { pattern: /\b(cissp|oscp|ceh\b|gsec|gcih|cism\b|comptia security\+)\b/i, industry: 'cybersecurity', label: 'security credential', boost: 12 },
  { pattern: /\b(shrm-cp|shrm-scp|phr\b|sphr\b|gphr)\b/i, industry: 'hr', label: 'HR credential', boost: 12 },
  { pattern: /\b(cscp|cpim|cltd|apics certified)\b/i, industry: 'logistics', label: 'supply chain credential', boost: 12 },
  { pattern: /\b(real estate license|brokers license|ccim|nmls|crs\b|gri\b)\b/i, industry: 'real_estate', label: 'real estate credential', boost: 12 },
  { pattern: /\b(cpcu|fcas|acas|fsa\b|asa\b|insurance license)\b/i, industry: 'insurance', label: 'insurance credential', boost: 12 },
  { pattern: /\b(cfre|grant professional certified)\b/i, industry: 'nonprofit', label: 'fundraising credential', boost: 12 },
  { pattern: /\b(atp certificate|commercial pilot license|cfi\b|cfii|a&p license|faa certificate)\b/i, industry: 'aviation', label: 'aviation credential', boost: 14 },
  { pattern: /\b(journeyman license|master electrician|epa 608|aws certified welder|nccer|ase certified|nate certified)\b/i, industry: 'skilled_trades', label: 'trade credential', boost: 14 },
  { pattern: /\b(nabcep|nerc certification|iwcf|h2s alive)\b/i, industry: 'energy', label: 'energy credential', boost: 12 },
  { pattern: /\b(teaching license|teaching credential|state certified teacher|praxis)\b/i, industry: 'education', label: 'teaching credential', boost: 14 },
];

function applyCertLocks(scores: Array<{ industry: string; score: number; signals: string[] }>, resumeText: string): void {
  const text = resumeText.toLowerCase();
  for (const lock of CERT_LOCKS) {
    if (lock.pattern.test(text)) {
      const entry = scores.find(s => s.industry === lock.industry);
      if (entry) {
        entry.score += lock.boost;
        entry.signals.unshift(`Cert-lock: ${lock.label} (+${lock.boost})`);
      } else {
        scores.push({ industry: lock.industry, score: lock.boost, signals: [`Cert-lock: ${lock.label}`] });
      }
      console.log(`[INDUSTRY-DETECTION] Cert-lock applied: ${lock.label} → ${lock.industry} (+${lock.boost})`);
    }
  }
}

/**
 * Check if any job title on the resume matches a role-lock pattern.
 * Returns the first match or null.
 */
function applyRoleFirstAnchoring(
  jobTitles: string[],
  resumeText: string,
): { industry: string; matchedTitle: string } | null {
  const allText = [...jobTitles, resumeText.substring(0, 500)].join('\n').toLowerCase();
  for (const lock of ROLE_LOCKS) {
    const m = allText.match(lock.pattern);
    if (m) {
      return { industry: lock.industry, matchedTitle: m[0].trim() };
    }
  }
  return null;
}

// ─── FIX #4: REQUIRED ANCHOR TERMS ──────────────────────────────────────────

// Each industry must have at least one of these terms present.
// If none appear, the detection is almost certainly noise from a long skills list.
const REQUIRED_ANCHORS: Record<string, string[]> = {
  finance: ['financial', 'revenue', 'budget', 'investment', 'accounting', 'portfolio', 'trading', 'audit', 'banking', 'p&l', 'forecast', 'valuation', 'capital'],
  technology: ['software', 'code', 'engineering', 'developer', 'programming', 'deploy', 'api', 'database', 'cloud', 'system', 'technical', 'infrastructure'],
  healthcare: ['patient', 'clinical', 'medical', 'health', 'hospital', 'care', 'nursing', 'therapy', 'treatment', 'diagnosis'],
  legal: ['legal', 'law', 'contract', 'court', 'compliance', 'attorney', 'counsel', 'litigation', 'regulation'],
  marketing: ['campaign', 'marketing', 'brand', 'content', 'seo', 'social media', 'advertising', 'digital', 'demand generation'],
  sales: ['sales', 'quota', 'revenue', 'pipeline', 'closed', 'deals', 'account', 'prospecting', 'closing'],
  consulting: ['client', 'consulting', 'strategy', 'advisory', 'engagement', 'stakeholder', 'deliverable'],
  education: ['students', 'teaching', 'curriculum', 'classroom', 'academic', 'school', 'instruction', 'learning'],
  hr: ['recruiting', 'hiring', 'talent', 'employee', 'hr', 'human resources', 'onboarding', 'workforce'],
  data_science: ['data', 'analysis', 'statistical', 'model', 'python', 'analytics', 'insights', 'experiment'],
  data_engineering: ['data', 'pipeline', 'etl', 'warehouse', 'database', 'ingestion', 'transform'],
  machine_learning: ['model', 'training', 'inference', 'neural', 'deep learning', 'ml', 'ai', 'llm'],
  product_management: ['product', 'roadmap', 'user', 'feature', 'launch', 'stakeholder', 'backlog'],
  manufacturing: ['manufacturing', 'production', 'quality', 'assembly', 'operations', 'process', 'plant'],
  engineering: ['engineering', 'design', 'technical', 'systems', 'specifications', 'infrastructure', 'architecture'],
  creative: ['design', 'creative', 'visual', 'brand', 'ux', 'ui', 'portfolio', 'illustration'],
  retail: ['retail', 'store', 'sales', 'customer', 'inventory', 'merchandise', 'floor'],
  hospitality: ['hotel', 'guest', 'hospitality', 'food', 'beverage', 'restaurant', 'catering', 'reservations'],
  government: ['policy', 'government', 'federal', 'public', 'regulation', 'agency', 'compliance'],
  cybersecurity: ['security', 'threat', 'vulnerability', 'incident', 'soc', 'siem', 'penetration', 'cyber'],
  logistics: ['supply chain', 'logistics', 'warehouse', 'inventory', 'freight', 'shipping', 'distribution', 'procurement'],
  real_estate: ['real estate', 'property', 'listings', 'escrow', 'leasing', 'tenants', 'closings', 'mortgage'],
  insurance: ['insurance', 'claims', 'underwriting', 'policies', 'premiums', 'coverage', 'actuarial'],
  nonprofit: ['nonprofit', 'non-profit', 'fundraising', 'grants', 'donors', 'volunteers', 'mission', 'philanthropy'],
  biotech: ['lab', 'laboratory', 'research', 'assay', 'clinical', 'scientific', 'biology', 'samples', 'protocol'],
  aviation: ['aircraft', 'flight', 'aviation', 'faa', 'pilot', 'airline', 'airport', 'airframe'],
  energy: ['energy', 'oil', 'gas', 'power', 'solar', 'wind', 'utility', 'grid', 'drilling', 'pipeline'],
  skilled_trades: ['electrical', 'plumbing', 'hvac', 'welding', 'construction', 'maintenance', 'installation', 'repair', 'trade'],
  customer_success: ['customer', 'support', 'tickets', 'service', 'csat', 'help desk', 'resolution'],
};

function checkRequiredAnchors(industry: string, resumeText: string): boolean {
  const anchors = REQUIRED_ANCHORS[industry];
  if (!anchors) return true; // no anchor list = don't penalize
  const lower = resumeText.toLowerCase();
  return anchors.some(a => lower.includes(a));
}

// ─── FIX #6: SENIORITY × INDUSTRY PLAUSIBILITY ───────────────────────────────

// Patterns in job titles that suggest a seniority level (for plausibility check only;
// this is separate from the full seniority detection engine in index.ts).
function inferSeniorityFromTitles(titles: string[]): string {
  const joined = titles.join(' ').toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cpo|cmo|chief|president|founder|co-founder|managing partner|managing director|executive vice president|evp)\b/.test(joined)) return 'executive';
  if (/\b(vp|vice president|director|head of|senior director|principal)\b/.test(joined)) return 'senior';
  if (/\b(senior|lead|staff|architect|sr\.)\b/.test(joined)) return 'senior';
  if (/\b(junior|jr\.?|entry|associate|intern|graduate|trainee|assistant)\b/.test(joined)) return 'entry';
  return 'mid';
}

// Industry × seniority combos that are genuinely implausible and likely indicate
// misclassification. Does NOT fire for role-locked detections.
const IMPLAUSIBLE_COMBOS: Array<{ industry: string; seniority: string; reason: string }> = [
  // A C-suite executive is almost never "retail" — they'd be "consulting" or "general"
  { industry: 'retail', seniority: 'executive', reason: 'C-suite exec rarely classified as retail' },
  // Entry-level "consulting" is extremely rare — usually misclassified from PM/ops
  { industry: 'consulting', seniority: 'entry', reason: 'Entry-level consulting is unusual — likely PM or ops' },
  // Data engineering executive is extremely rare — usually VP Engineering or CTO
  { industry: 'data_engineering', seniority: 'executive', reason: 'Exec data engineer — likely technology or engineering' },
  // Machine learning entry level without any ML-specific titles is usually technology
  { industry: 'machine_learning', seniority: 'executive', reason: 'Exec ML role — likely technology or data_science' },
  // Manufacturing executive with no mfg keywords — usually engineering or ops
  { industry: 'manufacturing', seniority: 'entry', reason: 'Entry manufacturing — verify vs engineering' },
];

function checkSeniorityIndustryPlausibility(industry: string, seniority: string, titles: string[]): boolean {
  // Returns true if the combo is implausible (= confidence should be capped)
  const joined = titles.join(' ').toLowerCase();
  for (const combo of IMPLAUSIBLE_COMBOS) {
    if (combo.industry === industry && combo.seniority === seniority) {
      // Extra guard: if the titles explicitly contain the industry name, it's plausible
      if (REQUIRED_ANCHORS[industry]?.some(a => joined.includes(a))) return false;
      return true; // implausible
    }
  }
  return false;
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

  // === EDUCATION SIGNALS — run before main scoring so boosts are baked in ===
  const educationBoosts = extractEducationSignals(resumeText);
  const educationSignalStrings = educationBoosts.map(e => e.signal);

  // Calculate scores for all industries
  const scores: Array<{ industry: string; score: number; signals: string[] }> = [];

  for (const industry of Object.keys(INDUSTRY_KEYWORDS)) {
    const result = calculateIndustryScore(sections, industry);
    const signals = result.signals;
    let score = result.score;

    // Apply education boosts
    for (const edu of educationBoosts) {
      if (edu.industry === industry) {
        score += edu.boost;
        if (signals.length < 10) signals.push(edu.signal);
      }
    }

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

  // === FIX #2: ROLE-FIRST TITLE ANCHORING ===
  // Certain job titles unambiguously lock the industry regardless of keyword scores.
  // A "Registered Nurse" can't be technology; an "Attorney" can't be marketing.
  // These take precedence over ANY keyword-based scoring result.
  const roleLocks = applyRoleFirstAnchoring(sections.jobTitles, resumeText);
  if (roleLocks) {
    const lockedEntry = scores.find(s => s.industry === roleLocks.industry);
    if (lockedEntry) {
      lockedEntry.score = Math.max(lockedEntry.score, 40); // force to top
      lockedEntry.signals.unshift(`Role-lock: "${roleLocks.matchedTitle}" → ${roleLocks.industry}`);
    } else {
      scores.push({ industry: roleLocks.industry, score: 40, signals: [`Role-lock: "${roleLocks.matchedTitle}" → ${roleLocks.industry}`] });
    }
    scores.sort((a, b) => b.score - a.score);
    console.log(`[INDUSTRY-DETECTION] Role-lock applied: "${roleLocks.matchedTitle}" → ${roleLocks.industry}`);
  }

  // === CERTIFICATION-BASED LOCKING ===
  // Licenses (RN, CPA, PE, CISSP…) are near-unambiguous anchors — large boost.
  applyCertLocks(scores, resumeText);
  scores.sort((a, b) => b.score - a.score);

  // === JD-FIRST INDUSTRY OVERRIDE ===
  // When a job description is provided, the TARGET role's industry should anchor
  // the analysis — a teacher applying to an edtech PM role should be analyzed
  // against PM expectations, not education. Compute the JD's own top industry;
  // if it's strong and differs from the resume's top, boost it heavily.
  let jdIndustry: string | undefined;
  if (jobDescriptionText && jobDescriptionText.trim().length > 100) {
    let jdTop: { industry: string; score: number } | null = null;
    for (const industry of Object.keys(INDUSTRY_KEYWORDS)) {
      const r = calculateJobPostingScore(jobDescriptionText, industry);
      if (!jdTop || r.score > jdTop.score) jdTop = { industry, score: r.score };
    }
    if (jdTop && jdTop.score >= 5) {
      jdIndustry = jdTop.industry;
      if (jdTop.industry !== scores[0].industry && !roleLocks) {
        const entry = scores.find(s => s.industry === jdTop!.industry);
        if (entry) {
          entry.score += 10;
          entry.signals.unshift(`JD-first anchor: target role is ${jdTop.industry} (+10)`);
        }
        scores.sort((a, b) => b.score - a.score);
        console.log(`[INDUSTRY-DETECTION] JD-first anchor: target role industry "${jdTop.industry}" (JD score ${jdTop.score})`);
      }
    }
  }

  // === FIX #1: THIN RESUME BRANCH ===
  // If resume is very short (< 80 words), keyword scoring is unreliable.
  // Fall back to title-only lookup to avoid noise-driven misclassification.
  const wordCount = resumeText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 80 && sections.jobTitles.length > 0) {
    const titleOnlyLock = applyRoleFirstAnchoring(sections.jobTitles, resumeText);
    if (titleOnlyLock) {
      console.log(`[INDUSTRY-DETECTION] Thin resume (${wordCount} words) — title-only override: ${titleOnlyLock.industry}`);
      // Suppress all keyword-driven scores; only keep title signal
      for (const s of scores) {
        if (s.industry !== titleOnlyLock.industry) s.score *= 0.2;
      }
      scores.sort((a, b) => b.score - a.score);
    }
  }

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
  
  // === FIX #4: REQUIRED ANCHOR TERMS ===
  // Each industry has 3–4 anchor terms that any genuine resume in that field will mention.
  // If ALL are absent, the detection is almost certainly noise from a long skills list.
  // Cap confidence at 'medium' in that case — do not override to 'high'.
  if (confidence === 'high' && !roleLocks) {
    const anchorsPresent = checkRequiredAnchors(adjustedTop.industry, resumeText);
    if (!anchorsPresent) {
      confidence = 'medium';
      adjustedTop.signals.push('Anchor check: no required anchor terms found — confidence capped at medium');
      console.log(`[INDUSTRY-DETECTION] Anchor check failed for ${adjustedTop.industry} — confidence downgraded to medium`);
    }
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
  
  // DOUBLE-CHECK: If remap still returned a phantom, pick the top-scoring real industry
  // or fall back to consulting only for military (career transition context).
  if (['military', 'general'].includes(finalIndustry)) {
    const topReal = scores.find(s => !['military', 'general'].includes(s.industry) && s.score >= 3);
    if (topReal) {
      console.log(`[INDUSTRY-DETECTION] FORCE-KILL: "${finalIndustry}" → best real industry "${topReal.industry}" (score ${topReal.score})`);
      finalIndustry = topReal.industry;
      if (confidence === 'high') confidence = 'medium';
      finalSignals.push('Remapped from non-functional industry to best real match');
    } else if (finalIndustry === 'military') {
      console.log(`[INDUSTRY-DETECTION] FORCE-KILL: military with no real signals → consulting`);
      finalIndustry = 'consulting';
      if (confidence === 'high') confidence = 'medium';
      finalSignals.push('Military transition with no industry signals → consulting');
    } else {
      // True general resume — pick consulting as a reasonable neutral
      console.log(`[INDUSTRY-DETECTION] FORCE-KILL: genuine general resume → general (kept for low-signal profiles)`);
      finalIndustry = 'general';
    }
  }
  
  // === FIX #6: SENIORITY × INDUSTRY PLAUSIBILITY CHECK ===
  // Certain industry × seniority combos are implausible and indicate misclassification.
  // "VP, Clinical Operations" → technology is wrong; downgrade confidence to medium.
  const seniorityFromText = inferSeniorityFromTitles(sections.jobTitles);
  const implausible = checkSeniorityIndustryPlausibility(finalIndustry, seniorityFromText, sections.jobTitles);
  if (implausible && confidence === 'high' && !roleLocks) {
    confidence = 'medium';
    finalSignals.push(`Plausibility check: ${finalIndustry} × ${seniorityFromText} is uncommon — confidence capped`);
    console.log(`[INDUSTRY-DETECTION] Plausibility flag: ${finalIndustry} × ${seniorityFromText}`);
  }

  // === MULTI-INDUSTRY DETECTION ===
  // If the second industry has a strong enough score relative to the first,
  // report it as a secondary industry (useful for cross-functional roles)
  let secondaryIndustry: string | undefined;
  let secondaryScore: number | undefined;
  
  const nonPhantomSecond = scores.find(s =>
    s.industry !== finalIndustry &&
    !['military', 'general'].includes(s.industry) &&
    s.score >= 5
  );

  if (nonPhantomSecond && nonPhantomSecond.score >= adjustedTop.score * 0.5) {
    secondaryIndustry = nonPhantomSecond.industry;
    secondaryScore = nonPhantomSecond.score;
    console.log(`[INDUSTRY-DETECTION] Multi-industry: primary="${finalIndustry}" (${finalScore}), secondary="${secondaryIndustry}" (${secondaryScore})`);
  }
  
  // === SUB-ROLE DETECTION ===
  const subRole = detectSubRole(finalIndustry, resumeText);

  // === SUB-INDUSTRY TAXONOMY ===
  const subIndustry = detectSubIndustry(finalIndustry, resumeText) ?? undefined;

  // === HYBRID INDUSTRY BLEND ===
  // When a strong secondary exists, express the split as percentages so the
  // report can say "reads 60% data / 40% marketing".
  let industryBlend: { primaryPct: number; secondaryPct: number } | undefined;
  if (secondaryIndustry && secondaryScore && finalScore > 0) {
    const total = finalScore + secondaryScore;
    industryBlend = {
      primaryPct: Math.round((finalScore / total) * 100),
      secondaryPct: Math.round((secondaryScore / total) * 100),
    };
  }

  // === TECH STACK EXTRACTION (tech-family industries only) ===
  const isTechFamily = ['technology', 'machine_learning', 'data_engineering', 'data_science'].includes(finalIndustry);
  const techStack = isTechFamily ? extractTechStack(resumeText) : undefined;

  // === ALTERNATIVE INDUSTRIES with reason strings ===
  const altIndustries = scores
    .filter(s => s.industry !== finalIndustry && !['military', 'general'].includes(s.industry) && s.score >= 2)
    .slice(0, 3)
    .map(s => ({
      industry: s.industry,
      score: s.score,
      reason: buildAlternativeReason(finalIndustry, s.industry, resumeText),
    }));

  return {
    industry: finalIndustry,
    confidence,
    score: finalScore,
    signals: finalSignals.slice(0, 5),
    alternativeIndustries: altIndustries,
    secondaryIndustry,
    secondaryScore,
    subRole,
    techStack,
    educationSignals: educationSignalStrings.length > 0 ? educationSignalStrings : undefined,
    subIndustry,
    jdIndustry,
    industryBlend,
  };
}

/**
 * Format detection result for AI prompt
 */
export function formatDetectionForPrompt(result: DetectionResult): string {
  const multiIndustryNote = result.secondaryIndustry 
    ? `\n- Secondary Industry: ${result.secondaryIndustry} (score: ${result.secondaryScore?.toFixed(1)})\n  NOTE: This candidate shows strong signals for BOTH industries. Tailor keywords and recommendations to cover both domains.`
    : '';
    
  const subRoleNote = result.subRole ? `\n- Detected Sub-Role: ${result.subRole}` : '';
  const subIndustryNote = result.subIndustry ? `\n- Sub-Industry Specialization: ${result.subIndustry.label} (signals: ${result.subIndustry.matchedSignals.slice(0, 4).join(', ')}) — tailor keywords, benchmarks, and advice to this specialization, not the broad industry.` : '';
  const jdIndustryNote = result.jdIndustry && result.jdIndustry !== result.industry ? `\n- TARGET ROLE INDUSTRY (from job description): ${result.jdIndustry} — the candidate is applying INTO this field. Frame gaps and advice as a transition toward ${result.jdIndustry} expectations.` : '';
  const blendNote = result.industryBlend && result.secondaryIndustry ? `\n- Industry Blend: resume reads ~${result.industryBlend.primaryPct}% ${result.industry} / ~${result.industryBlend.secondaryPct}% ${result.secondaryIndustry}.` : '';
  const techStackNote = result.techStack && result.techStack.length > 0 ? `\n- Tech Stack Detected: ${result.techStack.join(', ')} — use these specific technologies when suggesting keywords or rewrites` : '';
  const eduNote = result.educationSignals && result.educationSignals.length > 0 ? `\n- Education Signals: ${result.educationSignals.join('; ')}` : '';

  return `
**PRE-DETECTED INDUSTRY (MANDATORY — your response MUST use this industry):**
- Detected Industry: ${result.industry.toUpperCase()}
- Confidence: ${result.confidence}
- Score: ${result.score.toFixed(1)}
- Key Signals: ${result.signals.join('; ')}${subRoleNote}${subIndustryNote}${jdIndustryNote}${blendNote}${techStackNote}${eduNote}${multiIndustryNote}
${result.alternativeIndustries.length > 0 ? `- Alternative industries: ${result.alternativeIndustries.map(a => `${a.industry}(${a.score.toFixed(1)})${a.reason ? ` — ${a.reason}` : ''}`).join(', ')}` : ''}

CRITICAL INSTRUCTION: The pre-detection algorithm has analyzed job titles, keyword frequency, section weights, co-occurrence patterns, and education credentials.
${result.confidence === 'high' ?
  `HIGH CONFIDENCE — You MUST return "${result.industry}" as the industry. DO NOT override this. The algorithm matched job titles directly. Even if the skills section mentions other fields (e.g., marketing keywords on a sales resume), the JOB TITLES determine industry.` :
  result.confidence === 'medium' ?
  `MEDIUM CONFIDENCE — Return "${result.industry}" unless you have STRONG title-based evidence for a different industry. Skills-section keywords alone are NOT sufficient evidence to override.` :
  'LOW CONFIDENCE — Use your judgment but consider these signals. Job titles should weigh more than skills lists.'}
${result.subRole ? `\nThis candidate appears to be a ${result.subRole}. Tailor all keyword suggestions, quick wins, and red flags specifically to this sub-role.` : ''}
`;
}
