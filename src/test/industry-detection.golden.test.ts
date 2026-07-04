// Golden regression suite for the industry detection engine.
//
// The engine (52 industries, role locks, cert locks, disambiguation, anchors,
// recency weighting) had no automated coverage — every keyword-table change
// risked silently breaking existing detection. These synthetic fixtures pin
// the expected classification for representative resumes plus the known
// crossover traps. If a table change flips one of these, the suite fails and
// the change gets reviewed instead of shipped blind.
//
// Fixtures are intentionally SHORT. Real resumes give the engine far more
// signal, so a pass here is a floor, not a ceiling.

import { describe, it, expect } from "vitest";
import { detectIndustry } from "../../supabase/functions/free-keyword-scan/industry-detection.ts";

interface GoldenCase {
  name: string;
  resume: string;
  expected: string;
  /** Accept any of these (for genuinely ambiguous hybrids) */
  acceptAlso?: string[];
}

const EXPERIENCE = "PROFESSIONAL EXPERIENCE";

const cases: GoldenCase[] = [
  // ── Core industries ──────────────────────────────────────────────────────
  {
    name: "software engineer",
    expected: "technology",
    resume: `Jane Doe\nSenior Software Engineer\n${EXPERIENCE}\nSenior Software Engineer, Acme (2021-present)\n- Built REST API services in Python, deployed to AWS with Docker and CI/CD\n- Designed database schema in PostgreSQL, improved query performance 40%\nSKILLS\nPython, AWS, Docker, PostgreSQL, Kubernetes`,
  },
  {
    name: "registered nurse with SQL in skills (classic trap)",
    expected: "healthcare",
    resume: `Maria Lopez, RN\nRegistered Nurse\n${EXPERIENCE}\nRegistered Nurse, ICU, Mercy Hospital (2019-present)\n- Provided patient care for 6-bed ICU, medication administration and charting\n- Triage and vitals monitoring in acute care setting\nSKILLS\nSQL, Excel, Epic EHR, patient care, nursing`,
  },
  {
    name: "account executive at SaaS company (tech vocabulary trap)",
    expected: "sales",
    resume: `Tom Chen\nEnterprise Account Executive\n${EXPERIENCE}\nAccount Executive, CloudCo SaaS (2020-present)\n- Exceeded quota 4 quarters running, closed won $2.1M ARR in enterprise deals\n- Ran discovery calls and demos of our API integration platform\n- Managed pipeline in Salesforce, prospecting and outbound sequences\nSKILLS\nSalesforce, APIs, software platforms`,
  },
  {
    name: "attorney",
    expected: "legal",
    resume: `Sarah Kim, JD\nAttorney\n${EXPERIENCE}\nAssociate Attorney, Baker Firm (2018-present)\n- Drafted motions and pleadings for commercial litigation matters\n- Managed discovery and depositions, second-chaired two trials\nEDUCATION\nJuris Doctor, admitted to the bar (State Bar of California)`,
  },
  {
    name: "elementary teacher",
    expected: "education",
    resume: `Amy Ruiz\nElementary Teacher\n${EXPERIENCE}\n3rd Grade Teacher, Lincoln Elementary (2017-present)\n- Developed lesson plans aligned to state standards for 28 students\n- Classroom management, parent conferences, IEP participation\nCERTIFICATIONS\nState teaching license`,
  },
  {
    name: "financial analyst",
    expected: "finance",
    resume: `Raj Patel\nFinancial Analyst\n${EXPERIENCE}\nFP&A Analyst, RetailCorp (2020-present)\n- Built financial models for budgeting and forecasting, variance analysis\n- Monthly close support and board deck preparation\nSKILLS\nExcel, financial modeling, forecasting`,
  },
  {
    name: "product manager",
    expected: "product_management",
    resume: `Lee Wong\nSenior Product Manager\n${EXPERIENCE}\nProduct Manager, AppCo (2019-present)\n- Owned product roadmap, wrote user stories and managed backlog\n- Launched 3 features, ran stakeholder reviews and A/B tests\nSKILLS\nJira, roadmapping, user research`,
  },
  {
    name: "data scientist",
    expected: "data_science",
    resume: `Ana Silva\nData Scientist\n${EXPERIENCE}\nData Scientist, FinTech Inc (2021-present)\n- Built churn prediction models in Python, statistical analysis and experiments\n- Presented insights to leadership, A/B experiment design\nSKILLS\nPython, pandas, scikit-learn, SQL`,
  },
  {
    name: "marketing manager",
    expected: "marketing",
    resume: `Nina Brown\nMarketing Manager\n${EXPERIENCE}\nDigital Marketing Manager, BrandCo (2019-present)\n- Ran paid campaigns across Google Ads and Meta, improved ROAS 35%\n- Led SEO and content strategy, grew organic traffic 3x\nSKILLS\nGoogle Ads, SEO, HubSpot`,
  },
  {
    name: "recruiter",
    expected: "hr",
    resume: `Omar Hassan\nSenior Recruiter\n${EXPERIENCE}\nTalent Acquisition Specialist, TechCorp (2020-present)\n- Full-cycle recruiting for engineering roles, 40 hires per year\n- Sourcing, screening, offers, and onboarding coordination\nSKILLS\nGreenhouse, LinkedIn Recruiter, hiring`,
  },

  // ── Newer industries (batch 1) ───────────────────────────────────────────
  {
    name: "security engineer (technology trap)",
    expected: "cybersecurity",
    resume: `Ken Ito\nSecurity Engineer\n${EXPERIENCE}\nSecurity Engineer, BankCo (2020-present)\n- Ran incident response and threat hunting in Splunk SIEM\n- Vulnerability management and penetration testing coordination\nCERTIFICATIONS\nCISSP, Security+`,
  },
  {
    name: "supply chain manager",
    expected: "logistics",
    resume: `Dana White\nSupply Chain Manager\n${EXPERIENCE}\nSupply Chain Manager, RetailCo (2018-present)\n- Managed inventory and demand planning across 4 warehouses\n- Negotiated freight carrier contracts, improved on-time delivery to 97%\nSKILLS\nSAP, WMS, forecasting`,
  },
  {
    name: "realtor (sales trap)",
    expected: "real_estate",
    resume: `Paula Green\nRealtor\n${EXPERIENCE}\nReal Estate Agent, Keller Homes (2017-present)\n- Closed 45 transactions totaling $18M in sales volume, managed listings and escrow\n- Ran open houses, comparative market analysis for sellers\nLICENSES\nReal estate license`,
  },
  {
    name: "claims adjuster",
    expected: "insurance",
    resume: `Bill Ford\nClaims Adjuster\n${EXPERIENCE}\nSenior Claims Adjuster, StateSure (2016-present)\n- Investigated and settled property claims, managed coverage decisions\n- Handled subrogation and worked within policy limits\nSKILLS\nGuidewire, claims processing`,
  },
  {
    name: "grant writer",
    expected: "nonprofit",
    resume: `Eve Adams\nGrants Manager\n${EXPERIENCE}\nGrant Writer, Community Foundation (2019-present)\n- Secured $2.4M in foundation and federal grants, wrote proposals and reports\n- Managed donor stewardship and annual fund appeals\nSKILLS\nRaisers Edge, fundraising`,
  },
  {
    name: "research associate biotech",
    expected: "biotech",
    resume: `Ming Zhao\nResearch Associate\n${EXPERIENCE}\nResearch Associate II, GeneTx (2021-present)\n- Ran PCR, ELISA and cell culture assays under GMP\n- Maintained batch records and SOPs, flow cytometry analysis\nEDUCATION\nMS Biology`,
  },
  {
    name: "commercial pilot",
    expected: "aviation",
    resume: `Jack Reed\nCommercial Pilot\n${EXPERIENCE}\nFirst Officer, Regional Air (2019-present)\n- 3,200 flight hours, Part 121 operations, instrument rating\n- Type rated E175, crew resource management\nCERTIFICATIONS\nATP certificate, FAA first class medical`,
  },
  {
    name: "solar technician",
    expected: "energy",
    resume: `Sam Cole\nSolar Installer\n${EXPERIENCE}\nSolar Technician, SunPro (2020-present)\n- Installed residential photovoltaic systems and inverters, 200+ installs\n- Commissioning, grid interconnection paperwork\nCERTIFICATIONS\nNABCEP, OSHA 10`,
  },
  {
    name: "electrician",
    expected: "skilled_trades",
    resume: `Luis Ortiz\nJourneyman Electrician\n${EXPERIENCE}\nElectrician, Volt Bros (2015-present)\n- Wiring, conduit and breaker panel installs for commercial construction\n- Blueprint reading, NEC code compliance, troubleshooting\nLICENSES\nJourneyman license, OSHA 30`,
  },
  {
    name: "support specialist (sales trap)",
    expected: "customer_success",
    resume: `Tia Moore\nCustomer Support Specialist\n${EXPERIENCE}\nSupport Specialist, AppCo (2021-present)\n- Resolved 60 tickets/day in Zendesk, maintained 96% CSAT within SLA\n- Wrote knowledge base articles, cut first response time 30%\nSKILLS\nZendesk, live chat, escalations`,
  },

  // ── Newer industries (batch 2) ───────────────────────────────────────────
  {
    name: "pharmacist (healthcare trap)",
    expected: "pharmacy",
    resume: `Kim Tran, PharmD\nPharmacist\n${EXPERIENCE}\nStaff Pharmacist, MedRx (2018-present)\n- Dispensing and verification of 400 prescriptions daily, patient counseling\n- Immunizations, medication therapy management, controlled substances compliance\nLICENSES\nPharmD, RPh`,
  },
  {
    name: "dental hygienist",
    expected: "dental",
    resume: `Joy Park, RDH\nDental Hygienist\n${EXPERIENCE}\nDental Hygienist, Smile Dental (2019-present)\n- Prophylaxis, scaling and root planing, radiographs for 10 patients daily\n- Patient education and periodontal charting in Dentrix\nLICENSES\nRDH`,
  },
  {
    name: "vet tech",
    expected: "veterinary",
    resume: `Ben Diaz\nVeterinary Technician\n${EXPERIENCE}\nVet Tech, Paws Clinic (2020-present)\n- Anesthesia monitoring and surgical assistance for canine and feline patients\n- Vaccinations, lab diagnostics, client education\nCERTIFICATIONS\nCVT`,
  },
  {
    name: "personal trainer",
    expected: "fitness",
    resume: `Alexis Ray\nPersonal Trainer\n${EXPERIENCE}\nPersonal Trainer, FitLife Gym (2019-present)\n- Designed strength training programs, fitness assessments for 30 clients\n- 85% client retention, session packages and program design\nCERTIFICATIONS\nNASM, CPR`,
  },
  {
    name: "journalist (marketing trap)",
    expected: "media",
    resume: `Cara Boyd\nStaff Reporter\n${EXPERIENCE}\nReporter, City Herald (2018-present)\n- Beat reporting on city hall, 400+ bylines, breaking news coverage\n- Investigative features, source development, AP style editing\nSKILLS\nFOIA requests, fact-checking`,
  },
  {
    name: "fiber technician",
    expected: "telecom",
    resume: `Ray Nunez\nFiber Optic Technician\n${EXPERIENCE}\nFiber Technician, NetLink (2019-present)\n- Fiber splicing and OTDR testing for FTTH buildouts\n- Installed and turned up DOCSIS and VoIP services\nCERTIFICATIONS\nBICSI`,
  },
  {
    name: "farm manager",
    expected: "agriculture",
    resume: `Hank Miller\nFarm Manager\n${EXPERIENCE}\nFarm Manager, Miller Farms (2014-present)\n- Managed 2,400 acres of corn and soybean crops, planting through harvest\n- Livestock operations, irrigation scheduling, yield mapping\nCERTIFICATIONS\nPesticide applicator license, CDL`,
  },
  {
    name: "athletic director",
    expected: "sports_management",
    resume: `Coach Dan Wells\nAthletic Director\n${EXPERIENCE}\nAthletic Director, State University (2017-present)\n- Oversaw 14 athletic programs, NCAA compliance and recruiting coordination\n- Game day operations, season tickets and sponsorships growth\nSKILLS\nHudl, Teamworks`,
  },
  {
    name: "film producer",
    expected: "entertainment",
    resume: `Mia Fox\nLine Producer\n${EXPERIENCE}\nLine Producer, Studio X (2018-present)\n- Managed production budgets and call sheets for episodic TV\n- Crew management through principal photography and wrap\nSKILLS\nMovie Magic, SAG-AFTRA compliance`,
  },
  {
    name: "professor (education trap)",
    expected: "academia",
    resume: `Dr. Ida Nash\nAssociate Professor\n${EXPERIENCE}\nAssociate Professor, State University (2015-present)\n- 32 peer-reviewed publications, NSF grant funding as principal investigator\n- Supervised 6 graduate students, dissertation committees, tenure achieved 2020\nEDUCATION\nPhD`,
  },

  // ── Newest industries (batch 3) ──────────────────────────────────────────
  {
    name: "construction superintendent (trades/PM trap)",
    expected: "construction_management",
    resume: `Gus Hall\nConstruction Superintendent\n${EXPERIENCE}\nSuperintendent, BuildCorp (2016-present)\n- Managed subcontractors on $40M ground-up commercial projects\n- RFIs, submittals, change orders, punch list and closeout\nSKILLS\nProcore, Primavera P6, OSHA 30`,
  },
  {
    name: "project architect (creative trap)",
    expected: "architecture",
    resume: `Zoe Lin\nProject Architect\n${EXPERIENCE}\nProject Architect, Studio A (2018-present)\n- Led schematic design through construction documents for mixed-use projects\n- Building code analysis, permit sets, construction administration\nSKILLS\nRevit, AutoCAD\nLICENSES\nLicensed architect, NCARB`,
  },
  {
    name: "clinical social worker (healthcare trap)",
    expected: "social_work",
    resume: `Ann Reyes, LCSW\nClinical Social Worker\n${EXPERIENCE}\nTherapist, Family Services (2019-present)\n- Managed caseload of 45 clients, treatment plans and crisis intervention\n- Individual and group therapy using CBT, trauma-informed care\nLICENSES\nLCSW`,
  },
  {
    name: "preschool teacher (education trap)",
    expected: "childcare",
    resume: `Beth Cook\nPreschool Teacher\n${EXPERIENCE}\nLead Preschool Teacher, Little Steps (2018-present)\n- Play-based learning for 16 toddlers, developmentally appropriate lesson plans\n- Parent communication, daily reports, circle time\nCERTIFICATIONS\nCDA, CPR certified`,
  },
  {
    name: "hair stylist",
    expected: "beauty",
    resume: `Gigi Marsh\nHair Stylist\n${EXPERIENCE}\nStylist, Luxe Salon (2017-present)\n- Color services, balayage and cuts for 200+ regular clients\n- 90% rebooking rate, retail sales and consultations\nLICENSES\nCosmetology license`,
  },
  {
    name: "sous chef (hospitality trap)",
    expected: "culinary",
    resume: `Nico Bell\nSous Chef\n${EXPERIENCE}\nSous Chef, The Grove (2019-present)\n- Ran line for 300-cover service, expediting and station management\n- Menu development, food cost control to 28%, HACCP compliance\nCERTIFICATIONS\nServSafe`,
  },
  {
    name: "police officer (government trap)",
    expected: "law_enforcement",
    resume: `Officer Ed Stone\nPolice Officer\n${EXPERIENCE}\nPatrol Officer, Metro PD (2015-present)\n- Patrol operations, arrests and incident reports, community policing\n- Evidence collection and court testimony, field training officer\nCERTIFICATIONS\nPOST certification`,
  },
  {
    name: "sustainability analyst (engineering trap)",
    expected: "environmental",
    resume: `Ivy Chen\nSustainability Analyst\n${EXPERIENCE}\nESG Analyst, GreenCorp (2021-present)\n- Built GHG inventory and emissions reporting under GHG Protocol\n- CDP and GRI sustainability reporting, carbon footprint reduction roadmap\nSKILLS\nGHG Protocol, GRI standards`,
  },
  {
    name: "game designer (technology trap)",
    expected: "gaming",
    resume: `Kai Wolf\nGame Designer\n${EXPERIENCE}\nGame Designer, PixelForge (2020-present)\n- Designed gameplay systems and level design for shipped mobile titles\n- Balanced game economy, live ops events, player retention +18%\nSKILLS\nUnity, C#, playtesting`,
  },
  {
    name: "ecommerce manager (marketing trap)",
    expected: "ecommerce",
    resume: `Lola Reed\nEcommerce Manager\n${EXPERIENCE}\nEcommerce Manager, HomeGoods DTC (2020-present)\n- Grew Shopify revenue 60%, improved conversion rate and AOV\n- Managed Amazon Seller Central, FBA and buy box strategy\nSKILLS\nShopify Plus, Klaviyo`,
  },
  {
    name: "medical interpreter",
    expected: "translation",
    resume: `Yuri Sato\nMedical Interpreter\n${EXPERIENCE}\nMedical Interpreter, City Health (2019-present)\n- Simultaneous and consecutive interpretation for patient visits (EN-JA)\n- Terminology management and sight translation of consent forms\nCERTIFICATIONS\nCCHI certified`,
  },
  {
    name: "event planner (hospitality trap)",
    expected: "event_planning",
    resume: `Rita Vale\nEvent Planner\n${EXPERIENCE}\nEvent Manager, Summit Events (2018-present)\n- Produced 40 corporate events and conferences yearly, 5,000+ attendees\n- Vendor management, run of show, event budgets to $1.2M, BEOs\nCERTIFICATIONS\nCMP`,
  },

  // ── Remaining core industries ────────────────────────────────────────────
  {
    name: "management consultant",
    expected: "consulting",
    resume: `Ted Vo\nManagement Consultant\n${EXPERIENCE}\nConsultant, McKinley Group (2019-present)\n- Led client engagements on operating model strategy, built deliverables for C-suite stakeholders\n- Managed workstreams across due diligence and transformation engagements\nSKILLS\nPowerPoint, stakeholder management`,
  },
  {
    name: "ux designer",
    expected: "creative",
    resume: `Ava Kohl\nSenior UX Designer\n${EXPERIENCE}\nUX Designer, DesignLab (2020-present)\n- Designed user flows, wireframes and prototypes in Figma for mobile app\n- Ran usability research and design reviews, built the design system\nSKILLS\nFigma, prototyping, user research`,
  },
  {
    name: "store manager",
    expected: "retail",
    resume: `Rob Lane\nStore Manager\n${EXPERIENCE}\nStore Manager, ValueMart (2017-present)\n- Ran a $6M store: scheduling, inventory, merchandising and loss prevention\n- Coached 25 associates, improved customer satisfaction scores\nSKILLS\nPOS systems, merchandising`,
  },
  {
    name: "hotel manager",
    expected: "hospitality",
    resume: `Elle Marsh\nHotel Manager\n${EXPERIENCE}\nFront Desk Manager, Grand Plaza Hotel (2018-present)\n- Managed guest services and reservations for a 300-room property\n- Oversaw housekeeping coordination and F&B alignment, RevPAR up 12%\nSKILLS\nOpera PMS, guest relations`,
  },
  {
    name: "policy analyst",
    expected: "government",
    resume: `Ian Cho\nPolicy Analyst\n${EXPERIENCE}\nPolicy Analyst, State Department of Commerce (2019-present)\n- Drafted legislative analysis and regulatory impact assessments\n- Managed federal grant compliance and stakeholder briefings\nCLEARANCE\nSecret clearance`,
  },
  {
    name: "ml engineer (technology trap)",
    expected: "machine_learning",
    resume: `Ola Deng\nMachine Learning Engineer\n${EXPERIENCE}\nML Engineer, VisionAI (2021-present)\n- Trained and deployed deep learning models for image classification\n- Built inference pipelines, model monitoring and evaluation in PyTorch\nSKILLS\nPyTorch, MLOps, transformers`,
  },
  {
    name: "data engineer (technology trap)",
    expected: "data_engineering",
    resume: `Uma Roy\nData Engineer\n${EXPERIENCE}\nData Engineer, StreamCo (2020-present)\n- Built ETL pipelines in Airflow feeding the Snowflake warehouse\n- Managed data ingestion from Kafka, dbt transformations and data quality checks\nSKILLS\nAirflow, dbt, Snowflake, Kafka`,
  },
  {
    name: "mechanical engineer",
    expected: "engineering",
    resume: `Hal Berg\nMechanical Engineer\n${EXPERIENCE}\nMechanical Engineer, MachWorks (2018-present)\n- Designed components in SolidWorks with GD&T, ran FEA thermal analysis\n- Prototyping and tolerance stack-ups for production parts\nLICENSES\nEIT`,
  },

  // ── Multilingual title locks ─────────────────────────────────────────────
  {
    name: "German nurse (Krankenschwester)",
    expected: "healthcare",
    resume: `Anna Weber\nKrankenschwester\nBERUFSERFAHRUNG\nKrankenschwester, Klinikum München (2019-heute)\n- Patientenversorgung auf der Intensivstation, Medikamentengabe\n- Dokumentation und Pflegeplanung\nKENNTNISSE\nPflege, Dokumentation`,
  },
  {
    name: "Spanish electrician (electricista)",
    expected: "skilled_trades",
    resume: `Carlos Ruiz\nElectricista\nEXPERIENCIA\nElectricista, Instalaciones Ruiz (2016-presente)\n- Instalación y mantenimiento de sistemas eléctricos residenciales\n- Cableado, cuadros eléctricos y cumplimiento de normativa\nLICENCIAS\nCarnet de instalador`,
  },

  // ── Thin resume (title-only fallback) ────────────────────────────────────
  {
    name: "thin resume with only a title",
    expected: "legal",
    resume: `Jo Best\nParalegal\n${EXPERIENCE}\nParalegal, Smith & Co (2021-present)\n- Legal research and case files`,
  },

  // ── Coverage batch: admin, drivers, and smaller fields ───────────────────
  {
    name: "executive assistant (HR/finance trap)",
    expected: "administrative",
    resume: `Meg Cole\nExecutive Assistant\n${EXPERIENCE}\nExecutive Assistant to CFO, FinCorp (2018-present)\n- Calendar management, travel arrangements and expense reports for C-suite\n- Meeting coordination, minutes and correspondence, inbox management\nSKILLS\nOutlook, Concur, scheduling`,
  },
  {
    name: "truck driver (must land in logistics)",
    expected: "logistics",
    resume: `Ray Boone\nOTR Truck Driver\n${EXPERIENCE}\nCDL Driver, Schneider National (2015-present)\n- 1.8M accident-free miles hauling dry van freight across 48 states\n- DOT compliance, hours of service logs, pre-trip inspections, load securement\nLICENSES\nCDL Class A`,
  },
  {
    name: "librarian (education/academia trap)",
    expected: "library",
    resume: `Ann Page\nReference Librarian\n${EXPERIENCE}\nReference Librarian, City Public Library (2017-present)\n- Reference services and library instruction for 500 patrons weekly\n- Cataloging in MARC records, collection development and interlibrary loan\nEDUCATION\nMLIS`,
  },
  {
    name: "pastor (social work trap)",
    expected: "clergy",
    resume: `Rev. Sam Ford\nSenior Pastor\n${EXPERIENCE}\nSenior Pastor, Grace Community Church (2012-present)\n- Preached weekly sermons for a congregation of 400, pastoral care and counseling\n- Led discipleship programs, bible study groups and mission trips\nEDUCATION\nMaster of Divinity`,
  },
  {
    name: "mining engineer (energy trap)",
    expected: "mining",
    resume: `Ida Ross\nMining Engineer\n${EXPERIENCE}\nMining Engineer, Copper Ridge Mine (2018-present)\n- Mine planning for open pit operations, drilling and blasting design\n- MSHA compliance, ground control and ventilation planning\nCERTIFICATIONS\nMSHA certification`,
  },
  {
    name: "deck officer (logistics trap)",
    expected: "maritime",
    resume: `Leo Hunt\nChief Mate\n${EXPERIENCE}\nChief Mate, Crowley Maritime (2016-present)\n- Watchkeeping and navigation on 600-ft product tankers, cargo operations\n- Mooring operations, voyage planning, SOLAS and MARPOL compliance\nLICENSES\nUSCG license, STCW`,
  },
  {
    name: "groundskeeper (agriculture/trades trap)",
    expected: "landscaping",
    resume: `Gil Moss\nGrounds Manager\n${EXPERIENCE}\nGroundskeeper, Fairview Golf Club (2016-present)\n- Turf management, mowing, fertilization and irrigation systems for 18 holes\n- Tree care, pruning and seasonal planting programs\nCERTIFICATIONS\nPesticide applicator license`,
  },
  {
    name: "custodian (trades trap)",
    expected: "janitorial",
    resume: `Pat Ives\nCustodial Supervisor\n${EXPERIENCE}\nCustodian, Unified School District (2014-present)\n- Floor care including stripping and waxing, buffing and carpet cleaning\n- Sanitizing and disinfecting classrooms, restrooms and common areas\nCERTIFICATIONS\nBloodborne pathogen certified`,
  },

  // ── Executive & investor resumes ─────────────────────────────────────────
  {
    name: "VC partner",
    expected: "finance",
    resume: `Vera Long\nPartner, Ridge Ventures\n${EXPERIENCE}\nInvestment Partner, Ridge Ventures (2018-present)\n- Sourced and led 14 seed stage and series a investments from a $120M fund\n- Developed investment thesis for vertical SaaS, negotiated term sheets\n- Hold 6 board seats, manage lp relations and portfolio support\nGeneral Partner track record: 3 exits, deal flow of 400 companies/year`,
  },
  {
    name: "CFO (executive finance)",
    expected: "finance",
    resume: `Neil Marsh\nChief Financial Officer\n${EXPERIENCE}\nCFO, GrowthCo (2019-present)\n- Own $85M P&L and annual budget; led an organization of 45 across FP&A, accounting and treasury\n- Board presentations quarterly; led due diligence for two acquisitions\n- Drove financial transformation cutting close cycle from 12 to 4 days\nEDUCATION\nMBA, CPA`,
  },
  {
    name: "COO with operations vocabulary stays leadership-plausible",
    expected: "consulting",
    acceptAlso: ["manufacturing", "logistics", "finance", "product_management", "general"],
    resume: `Rita Vaughn\nChief Operating Officer\n${EXPERIENCE}\nCOO, ScaleWorks (2017-present)\n- Led an organization of 220 across operations, strategy and transformation\n- Owned $40M budget, presented operating model changes to the board of directors\n- Drove turnaround delivering $15M in cost savings`,
  },

  // ── Additional crossover traps ───────────────────────────────────────────
  {
    name: "office manager at a construction company stays administrative",
    expected: "administrative",
    acceptAlso: ["construction_management"],
    resume: `Dee Ford\nOffice Manager\n${EXPERIENCE}\nOffice Manager, BuildRight Construction (2018-present)\n- Calendar management, scheduling and expense reports for 3 executives\n- Front desk coverage, office supplies, meeting coordination and minutes\nSKILLS\nOutlook, QuickBooks entry, scheduling`,
  },
  {
    name: "customer success manager with revenue metrics goes to sales",
    expected: "sales",
    acceptAlso: ["customer_success"],
    resume: `Kim Soo\nCustomer Success Manager\n${EXPERIENCE}\nCSM, SaaSCo (2020-present)\n- Owned $2.4M renewal book, drove 118% net revenue retention through upsell and expansion revenue\n- Ran QBRs and account health reviews, reduced churn 20%\nSKILLS\nSalesforce, Gainsight`,
  },
  {
    name: "warehouse associate lands in logistics",
    expected: "logistics",
    resume: `Ed Reyes\nWarehouse Associate\n${EXPERIENCE}\nWarehouse Associate, FulfillCo (2019-present)\n- Picking and packing 400 orders daily, cycle counts and receiving\n- Certified forklift operator, maintained 99.8% inventory accuracy in WMS\nCERTIFICATIONS\nForklift certified, OSHA 10`,
  },

  // ── Context guards ───────────────────────────────────────────────────────
  {
    name: "aspiring nurse in summary must NOT lock healthcare",
    expected: "customer_success",
    resume: `Pat Doe\nSUMMARY\nAspiring registered nurse seeking opportunities in healthcare\n${EXPERIENCE}\nCustomer Support Specialist, TelCo (2019-present)\n- Resolved 70 tickets daily in Zendesk with 95% CSAT within SLA\n- Escalations handling, knowledge base authoring, live chat support\nSKILLS\nZendesk, call center`,
  },
  {
    name: "worked WITH attorneys must NOT lock legal",
    expected: "hr",
    acceptAlso: ["consulting"],
    resume: `Sue King\nHR Business Partner\n${EXPERIENCE}\nHR Business Partner, BigCo (2018-present)\n- Employee relations and performance management for 400-person org\n- Worked closely with attorneys on workplace investigations\n- Workforce planning and engagement surveys\nSKILLS\nWorkday, employee relations`,
  },
  {
    name: "recency: recent data role beats older marketing era",
    expected: "data_science",
    acceptAlso: ["technology", "data_engineering"],
    resume: `Val Moss\nData Analyst\n${EXPERIENCE}\nData Analyst, ShopCo (2021-present)\n- Statistical analysis and churn models in Python, dashboards in SQL\n- Experiment design and insights reporting for product teams\nMarketing Manager, AdCo (2015-2018)\n- Ran campaigns, brand and social media content, advertising budgets\nSKILLS\nPython, SQL, Tableau`,
  },

  // ── Title-coverage expansion (133 new title variants) ───────────────────
  {
    name: "site reliability engineer",
    expected: "technology",
    resume: `Kim Park\nSite Reliability Engineer\n${EXPERIENCE}\nSite Reliability Engineer, StreamCo (2021-present)\n- On-call incident response, SLO/error-budget management for 200 microservices\n- Terraform infrastructure, Kubernetes cluster upgrades, observability with Prometheus\nSKILLS\nKubernetes, Terraform, Prometheus, Go`,
  },
  {
    name: "nurse practitioner",
    expected: "healthcare",
    resume: `Dana Wells, NP\nNurse Practitioner\n${EXPERIENCE}\nFamily Nurse Practitioner, Community Clinic (2019-present)\n- Primary care panel of 1,200 patients: diagnosis, treatment plans, prescriptions\n- Chronic disease management and preventive screenings\nCERTIFICATIONS\nFNP-BC, DEA licensure`,
  },
  {
    name: "soc analyst",
    expected: "cybersecurity",
    resume: `Ravi Nair\nSOC Analyst\n${EXPERIENCE}\nSOC Analyst II, SecureOps (2021-present)\n- Triaged SIEM alerts in Splunk, escalated confirmed incidents per playbooks\n- Threat hunting with EDR telemetry, phishing investigation and containment\nSKILLS\nSplunk, CrowdStrike, MITRE ATT&CK`,
  },
  {
    name: "fp&a analyst",
    expected: "finance",
    resume: `Lea Wong\nFP&A Analyst\n${EXPERIENCE}\nFP&A Analyst, RetailCorp (2020-present)\n- Built annual operating plan and rolling forecasts, variance analysis vs budget\n- Monthly close support and board reporting packages in Adaptive Insights\nSKILLS\nExcel, Adaptive Insights, SQL`,
  },
  {
    name: "arborist lands in landscaping",
    expected: "landscaping",
    resume: `Sam Oak\nCertified Arborist\n${EXPERIENCE}\nArborist, GreenCanopy Tree Care (2018-present)\n- Tree pruning, removals, and cabling for residential and municipal clients\n- Plant health care assessments, pest and disease diagnosis\nCERTIFICATIONS\nISA Certified Arborist`,
  },
  {
    name: "911 dispatcher lands in law enforcement",
    expected: "law_enforcement",
    acceptAlso: ["government"],
    resume: `Pat Rivera\n911 Dispatcher\n${EXPERIENCE}\n911 Dispatcher, County Communications Center (2017-present)\n- Answered emergency calls, dispatched police, fire, and EMS units via CAD\n- Maintained radio traffic logs and officer status during critical incidents\nCERTIFICATIONS\nAPCO Public Safety Telecommunicator`,
  },

  // ── License-driven thin resumes (new grads / trades) ────────────────────
  {
    name: "new-grad nurse with NCLEX and no work history",
    expected: "healthcare",
    resume: `Amy Torres, BSN\nRecent Graduate\nEDUCATION\nBachelor of Science in Nursing, State University (2026)\nPassed NCLEX-RN, RN license pending\nCLINICAL ROTATIONS\n- Med-surg and ICU rotations, 400 clinical hours\nSKILLS\nVitals, charting, patient communication`,
  },
  {
    name: "journeyman electrician with thin bullets",
    expected: "skilled_trades",
    resume: `Rob Diaz\nJourneyman Electrician\nCERTIFICATIONS\nJourneyman electrician license, OSHA 30\nPROFESSIONAL EXPERIENCE\nElectrician, Diaz Electric (2020-present)\n- Residential and light commercial wiring\n- Panel upgrades and code compliance`,
  },

  // ── Adversarial: known-hard crossover classes ────────────────────────────
  {
    name: "technical recruiter AT a tech company is HR, not technology",
    expected: "hr",
    acceptAlso: ["recruiting"],
    resume: `Nina Patel\nSenior Technical Recruiter\n${EXPERIENCE}\nSenior Technical Recruiter, CloudScale Inc (2020-present)\n- Full-cycle recruiting for software engineering and DevOps roles\n- Sourced candidates for Python, Kubernetes, and AWS positions via LinkedIn Recruiter\n- Managed ATS pipeline in Greenhouse, ran intake meetings with hiring managers\n- Negotiated offers and improved offer-accept rate to 87%\nSKILLS\nGreenhouse, LinkedIn Recruiter, sourcing, offer negotiation`,
  },
  {
    name: "sales engineer is sales-side, not pure engineering",
    expected: "sales",
    acceptAlso: ["technology"],
    resume: `Omar Reyes\nSenior Sales Engineer\n${EXPERIENCE}\nSales Engineer, DataPlatform Co (2019-present)\n- Ran technical discovery and proof-of-concept demos for enterprise prospects\n- Partnered with account executives to close $3.4M in new ARR\n- Answered RFPs and security questionnaires, built demo environments\n- Presented architecture overviews to CTO-level buyers\nSKILLS\nSalesforce, demos, POCs, solution architecture`,
  },
  {
    name: "clinical data scientist leans clinical/pharma, not generic data",
    expected: "pharmacy",
    acceptAlso: ["healthcare", "data_science", "biotech"],
    resume: `Dr. Lena Fischer\nClinical Data Scientist\n${EXPERIENCE}\nClinical Data Scientist, NovaTherapeutics (2020-present)\n- Analyzed Phase II/III clinical trial data under GCP and FDA 21 CFR Part 11\n- Built survival models for oncology endpoints in R, submitted to regulatory review\n- Worked with biostatisticians on SDTM/ADaM datasets and CDISC standards\nSKILLS\nR, SAS, CDISC, clinical trials, biostatistics`,
  },
  {
    name: "military-to-civilian transition reads on held roles, not target",
    expected: "government",
    acceptAlso: ["logistics", "operations", "security"],
    resume: `James Carter\nOperations Leader | Transitioning Veteran\nSeeking program management roles in technology\n${EXPERIENCE}\nCompany Commander, US Army (2016-2023)\n- Led 120-soldier logistics company; accountable for $14M in equipment\n- Planned and executed supply convoy operations across three deployments\n- Awarded Meritorious Service Medal for operational readiness improvements\nSKILLS\nLeadership, logistics planning, risk management`,
  },
  {
    name: "management consultant with four client industries stays consulting",
    expected: "consulting",
    resume: `Aisha Bello\nEngagement Manager\n${EXPERIENCE}\nEngagement Manager, Strategy Partners LLP (2018-present)\n- Led client engagements across healthcare payers, retail banking, ecommerce, and energy\n- Built market-entry strategy for a pharma client; sized TAM and pricing corridors\n- Managed 4-consultant case teams, owned steering-committee readouts and workstreams\n- Developed due-diligence models for private equity clients\nSKILLS\nStrategy, client delivery, workstream management, PowerPoint, financial modeling`,
  },
];

describe("industry detection golden corpus", () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = detectIndustry(c.resume);
      const acceptable = [c.expected, ...(c.acceptAlso ?? [])];
      expect(acceptable, `detected "${result.industry}" (score ${result.score.toFixed(1)}; signals: ${result.signals.join(" | ")})`).toContain(result.industry);
    });
  }

  it("returns telemetry with top3 and margin on every result", () => {
    const result = detectIndustry(cases[0].resume);
    expect(result.telemetry?.top3.length).toBeGreaterThan(0);
    expect(result.telemetry?.marginRatio).toBeGreaterThan(0);
  });
});
