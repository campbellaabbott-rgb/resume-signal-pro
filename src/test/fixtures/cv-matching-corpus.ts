/**
 * THE CORPUS THE DROP-A-RÉSUMÉ PATH IS MEASURED AGAINST.
 *
 * scripts/fit-path-probe.mjs checks the same chain live, against production,
 * with three careers. It cannot run in CI, it cannot fail a pull request, and
 * three careers is not the board: the board is also grocery aisles, school
 * districts, truck cabs and funeral homes. This file is the offline half —
 * hand-labelled, deterministic, no network — so a change to the extractor or
 * the scorer can be shown to help or shown to be cosmetic BEFORE it ships.
 *
 * Two things are measured and they are not the same thing:
 *
 *   RETRIEVAL — `resumeRoleTerms` reads an occupation out of the résumé and
 *   the client searches it. Wrong occupation, wrong board, and no scorer can
 *   recover: [[project_fit_retrieval]].
 *
 *   RANKING — `computeFit` scores a posting's description against the résumé.
 *   Right board, wrong order.
 *
 * WHAT A LABEL MEANS HERE, and why it is three-valued rather than two.
 * `accept` is the set of queries that put this reader in front of their own
 * occupation — several spellings are usually fine ("nurse", "registered
 * nurse"). Anything else in position 0 is HARMFUL, whoever the reader is: it
 * searches somebody else's career and presents the result as this reader's
 * match. `emptyIsFine` marks the résumés whose occupation the vocabulary may
 * not carry at all; for those, returning nothing is neither a win nor a harm,
 * because the client then keeps browsing normally — the behaviour everyone had
 * before retrieval existed.
 *
 * The three values matter because a two-valued label would have scored the
 * court reporter's "reporter" as merely a miss. It is not a miss. It is a
 * journalism search run on behalf of a stenographer, captioned as her match.
 *
 * The résumés are written the way résumés are actually written: a headline
 * line, dated employment history, a skills line, education. They are long
 * enough that the headline window (max(400 chars, 20%)) is a real window and
 * not the whole document — a fixture short enough to be all headline silently
 * disables the rule that stops a body mention from hijacking the query.
 */

/** A posting as the board stores one: the description is what computeFit reads. */
export interface CorpusPosting {
  id: string;
  title: string;
  /** null models a row whose description was never captured — must score null. */
  description: string | null;
  /** The occupation family, used to label good/bad without listing every pair. */
  family: string;
}

export interface CorpusResume {
  id: string;
  /** Plain-English occupation, for the report table. */
  occupation: string;
  /** Posting families this reader should be shown. */
  goodFamilies: string[];
  /** Queries that reach this reader's own occupation. */
  accept: string[];
  /** True when returning nothing is an acceptable answer for this résumé. */
  emptyIsFine?: boolean;
  /** Years of experience a human reads off this document. */
  years: number;
  text: string;
}

// ---------------------------------------------------------------------------
// POSTINGS
// ---------------------------------------------------------------------------

export const POSTINGS: CorpusPosting[] = [
  {
    id: "p-rn-icu",
    family: "nursing",
    title: "Registered Nurse - Intensive Care Unit (Nights)",
    description: `Registered Nurse, ICU. Provide direct patient care to critically ill
      adults on a 24-bed intensive care unit. Perform patient assessment, medication
      administration and IV therapy; manage ventilator patients; document in the
      electronic health record. Collaborate on care plans with the care team, support
      discharge planning and patient education. Requires an active RN license, BSN
      preferred, BLS and ACLS certification, and 2 years of acute care experience.
      Familiarity with telemetry, wound care, infection control and HIPAA required.
      Night shift, three twelves. Clinical documentation and triage skills essential.`,
  },
  {
    id: "p-rn-manager",
    family: "nursing",
    title: "Nurse Manager, Critical Care",
    description: `Nursing Manager for critical care services. Lead a team of registered
      nurses and patient care technicians across two units. Own staffing, scheduling,
      quality and regulatory compliance. Requires an active RN license, BSN required
      and MSN preferred, and a minimum of 8 years of nursing experience including
      charge nurse or supervisory work. Strong clinical background in acute care,
      patient assessment and care planning. Partner with the director of nursing on
      budget, infection control, patient safety and clinical documentation standards.
      Experience with electronic health records and HIPAA compliance required.`,
  },
  {
    id: "p-acct-staff",
    family: "accounting",
    title: "Staff Accountant",
    description: `Staff Accountant. Own month-end close, journal entries, account
      reconciliations and the general ledger for two entities. Prepare financial
      statements under GAAP, support the annual audit, and assist with accounts
      payable and accounts receivable. Requires a BS in Accounting and 2 years of
      accounting experience; CPA candidates encouraged. Strong Excel required;
      QuickBooks or NetSuite a plus. You will support budgeting, forecasting,
      financial reporting and payroll reconciliation, and help document SOX controls
      as the company scales. Tax return support during busy season.`,
  },
  {
    id: "p-acct-controller",
    family: "accounting",
    title: "Controller",
    description: `Controller. Own the accounting function end to end: financial
      statements, month-end close, general ledger, reconciliations, audit and tax.
      Manage a team of four including staff accountants and an accounts payable
      specialist. Requires an active CPA and a minimum of 10 years of accounting
      experience, including public accounting. Deep GAAP knowledge, SOX controls,
      budgeting, forecasting and financial reporting. Partner with the CFO on
      financial planning. Advanced Excel and ERP experience required; NetSuite
      preferred. Payroll, accounts receivable and revenue recognition oversight.`,
  },
  {
    id: "p-swe-mid",
    family: "software",
    title: "Software Engineer II, Backend",
    description: `Software Engineer, Backend. Build and operate backend services in
      Python and Go on Kubernetes. Own your services in production: observability,
      monitoring, on-call and incident response. Work with PostgreSQL, API design and
      distributed systems. We use Terraform for infrastructure as code and expect
      continuous integration with automated testing. Requires 3 years of professional
      software engineering experience and a strong grounding in code review,
      architecture and debugging. BS in Computer Science or equivalent experience.
      You will mentor interns and take part in design review.`,
  },
  {
    id: "p-swe-staff",
    family: "software",
    title: "Staff Software Engineer, Platform",
    description: `Staff Software Engineer on the Platform team. Set technical direction
      for our distributed systems: Kubernetes, Terraform, service mesh, and the
      continuous integration and automated testing that gates every deploy. Write
      backend services in Go and Python. Own observability, monitoring and incident
      response for tier-one systems, and lead architecture and code review across
      teams. Requires a minimum of 8 years of professional software engineering
      experience, including deep PostgreSQL and API design work. You will mentor
      senior engineers and own the platform roadmap.`,
  },
  {
    id: "p-wh-assoc",
    family: "warehouse",
    title: "Warehouse Associate",
    description: `Warehouse Associate. Pick, pack and ship customer orders in a
      high-volume distribution center. Operate a forklift and pallet jack (certification
      provided), receive inbound freight, complete cycle counts and keep inventory
      accurate in the warehouse management system. Load and unload trailers, stage
      outbound shipments, and follow all safety and OSHA procedures. No experience
      required; 1 year of warehouse or distribution experience preferred. Must be able
      to lift 50 lbs repeatedly and stand for a full shift. Shipping, receiving and
      order fulfillment across two shifts.`,
  },
  {
    id: "p-wh-manager",
    family: "warehouse",
    title: "Warehouse Operations Manager",
    description: `Warehouse Operations Manager for a 400,000 sq ft distribution center.
      Own inventory accuracy, shipping and receiving, order fulfillment and the
      warehouse management system. Lead 60 associates and four supervisors across
      three shifts. Requires a minimum of 7 years of warehouse or logistics experience
      including supervisory work, plus forklift certification and a strong safety and
      OSHA record. Drive continuous improvement in throughput, cycle counts and
      freight cost. Coordinate with transportation, supply chain and procurement.`,
  },
  {
    id: "p-retail-assoc",
    family: "retail",
    title: "Retail Sales Associate",
    description: `Retail Sales Associate. Greet customers, deliver friendly customer
      service, operate the point of sale, and process transactions accurately as a
      cashier. Maintain merchandising standards, restock shelves, handle returns, and
      support loss prevention and inventory counts. Meet sales goals and upsell
      accessories. No experience required — we train. Retail or customer service
      experience a plus. Flexible schedule including evenings and weekends. Visual
      merchandising and planogram compliance.`,
  },
  {
    id: "p-retail-store-manager",
    family: "retail",
    title: "Store Manager",
    description: `Store Manager. Run a high-volume retail store: sales, staffing,
      scheduling, merchandising, inventory and loss prevention. Hire, train and develop
      a team of 25 including assistant store managers and sales associates. Own the
      P&L, shrink, payroll and customer service scores. Requires a minimum of 5 years
      of retail management experience. Strong background in point of sale systems,
      visual merchandising, inventory counts and district reporting. You will partner
      with the district manager on promotions and store standards.`,
  },
  {
    id: "p-teacher-elem",
    family: "teaching",
    title: "Elementary School Teacher (3rd Grade)",
    description: `Elementary Teacher, 3rd grade. Plan and deliver standards-aligned
      instruction in literacy and math, differentiate for diverse learners, and use
      formative assessment to drive small-group instruction. Manage a positive
      classroom, communicate with families, and collaborate on curriculum with your
      grade-level team. Requires a state teaching license and a bachelor's degree;
      1 year of classroom experience preferred. Experience with IEPs, special
      education accommodations, lesson planning and classroom management. Support
      student assessment data reviews and professional development.`,
  },
  {
    id: "p-teacher-coach",
    family: "teaching",
    title: "Instructional Coach, Literacy",
    description: `Instructional Coach supporting literacy across four elementary
      schools. Model lessons, co-plan with teachers, lead professional development,
      and analyze student assessment data to guide curriculum decisions. Requires a
      state teaching license, a master's degree preferred, and a minimum of 6 years of
      classroom teaching experience. Deep knowledge of literacy instruction, lesson
      planning, differentiated instruction and classroom management. Partner with
      principals and the curriculum director on school improvement plans.`,
  },
  {
    id: "p-driver-cdl",
    family: "driving",
    title: "CDL Class A Truck Driver - Regional",
    description: `CDL Class A Truck Driver, regional routes. Haul dry van freight
      between our distribution centers, home weekly. Conduct pre-trip and post-trip
      inspections, maintain electronic logs and hours of service compliance under DOT
      and FMCSA rules, and secure loads properly. Requires a valid Class A commercial
      driver's license, a clean motor vehicle record, and 2 years of over the road or
      regional driving experience. Backing, coupling and trailer maintenance skills
      required. Delivery, dispatch coordination and customer paperwork.`,
  },
  {
    id: "p-driver-delivery",
    family: "driving",
    title: "Delivery Driver (Box Truck)",
    description: `Delivery Driver. Run a local route in a 26-foot box truck, delivering
      to residential and commercial customers. Load and unload freight, use a hand
      truck and pallet jack, capture proof of delivery, and provide friendly customer
      service at every stop. Requires a valid driver's license and a clean motor
      vehicle record; no CDL required. 1 year of delivery or route driving experience
      preferred. Pre-trip inspection, route planning, dispatch communication and DOT
      hours of service awareness.`,
  },
  {
    id: "p-exec-coo",
    family: "executive",
    title: "Chief Operating Officer",
    description: `Chief Operating Officer. Own company operations end to end: revenue,
      P&L, hiring, and the operating cadence across sales, marketing, customer success
      and support. Partner with the CEO and the board on strategy, fundraising and
      annual planning. Build and lead a senior leadership team; set OKRs and own
      forecasting and budgeting. Requires a minimum of 12 years of experience with at
      least 5 in an executive leadership role at a growth-stage company. Track record
      of scaling operations, go-to-market execution and organizational design.`,
  },
  {
    id: "p-exec-ops-director",
    family: "executive",
    title: "Director of Operations",
    description: `Director of Operations. Lead the operations organization: process,
      systems, vendor management, budgeting and forecasting. Own cross-functional
      programs across sales, marketing and customer success, and report to the COO on
      P&L and headcount planning. Hire, coach and develop managers. Requires a minimum
      of 10 years of operations experience including team leadership, plus strong
      analytics and SQL or Excel modelling skills. Experience with organizational
      design, OKRs and executive reporting.`,
  },
  {
    id: "p-data-analyst",
    family: "analytics",
    title: "Data Analyst",
    description: `Data Analyst. Build dashboards and reports that the business actually
      uses. Write SQL against our data warehouse, model data in dbt, and present
      findings to stakeholders. Own reporting for one business area end to end:
      metric definitions, data quality, and the analysis behind quarterly reviews.
      Requires 2 years of analytics experience, strong SQL, and comfort in Excel and
      a BI tool such as Tableau or Looker. Python for analysis is a plus. Experience
      with A/B testing, statistics and stakeholder communication.`,
  },
  {
    id: "p-dietitian",
    family: "dietetics",
    title: "Clinical Dietitian",
    description: `Clinical Dietitian. Complete nutrition assessments for inpatients,
      write enteral and parenteral nutrition recommendations, and document in the
      electronic health record. Round with the care team, counsel patients and
      families on therapeutic diets, and support the diabetes and renal programs.
      Requires registration with the Commission on Dietetic Registration, a state
      license, and 2 years of clinical experience. Knowledge of medical nutrition
      therapy, malnutrition criteria, patient education and HIPAA required.`,
  },
  {
    id: "p-funeral-director",
    family: "funeral",
    title: "Funeral Director / Embalmer",
    description: `Funeral Director and Embalmer. Meet with families to arrange
      services, complete death certificates and permits, coordinate with cemeteries
      and crematories, and conduct visitations and graveside services. Perform
      embalming, restorative art, dressing and casketing in our preparation room.
      Requires a state funeral director and embalmer license, mortuary science degree,
      and 3 years of funeral home experience. Compassionate family service, aftercare
      follow-up, preneed arrangements and rotating on-call removals.`,
  },
  {
    id: "p-court-reporter",
    family: "reporting",
    title: "Court Reporter",
    description: `Court Reporter. Produce verbatim stenographic records of depositions,
      hearings and trials. Operate a stenotype machine with realtime translation,
      manage exhibits, read back testimony on request, and deliver certified
      transcripts on deadline. Requires an RPR certification or state licensure and
      3 years of reporting experience at 225 words per minute. Familiarity with
      realtime software, transcript formatting and deposition procedure. Freelance and
      official assignments available.`,
  },
  {
    id: "p-welder",
    family: "welding",
    title: "MIG Welder / Fabricator",
    description: `MIG Welder and Fabricator. Run short-run production and custom
      fabrication in mild steel, stainless and aluminium. Read blueprints and weld
      symbols, lay out and fit parts, tack and finish weld to AWS D1.1, and grind and
      prep for paint. Operate a plasma cutter, band saw and press brake. Requires
      3 years of welding experience, a current MIG certification, and the ability to
      pass a weld test on day one. TIG and flux core a plus. Safety, PPE and OSHA
      compliance are non-negotiable in our shop.`,
  },
  {
    id: "p-project-manager",
    family: "projects",
    title: "Project Manager",
    description: `Project Manager. Own delivery for a portfolio of client
      implementations end to end: scope, schedule, budget, risk and stakeholder
      communication. Build and maintain the project plan, run status reporting, drive
      cross-functional teams to milestones, and manage change requests. Requires
      5 years of project management experience, PMP or Agile certification preferred,
      and fluency with Jira, Smartsheet or MS Project. Strong vendor management,
      resource planning and executive reporting skills. Waterfall and Scrum both in
      use here.`,
  },
  // -------------------------------------------------------------------------
  // OUT-OF-REACH POSTINGS. Each is the reader's OWN occupation and states a
  // year requirement they demonstrably do not meet, so cross-field separation
  // cannot answer them: only reading the posting's own stated minimum can.
  // -------------------------------------------------------------------------
  {
    id: "p-rn-cno",
    family: "nursing",
    title: "Chief Nursing Officer",
    description: `Chief Nursing Officer for a 600-bed academic medical center. Own
      nursing practice, quality, patient safety and regulatory readiness across the
      system. Lead a nursing leadership team of directors and nurse managers covering
      1,800 registered nurses. Requires an active RN license, an MSN or DNP, and a
      minimum of 15 years of nursing experience including 7 in executive leadership.
      Partner with the CEO and medical staff on strategy, budget and clinical
      documentation standards. Magnet designation experience strongly preferred.`,
  },
  {
    id: "p-acct-vp-finance",
    family: "accounting",
    title: "Vice President of Finance",
    description: `Vice President of Finance. Own accounting, financial reporting,
      financial planning and treasury for a $400M business. Lead a team of eighteen
      including a controller and several senior accountants. Requires an active CPA
      and a minimum of 15 years of accounting and finance experience, with at least
      5 leading a department. Deep GAAP, SOX, audit, budgeting and forecasting
      expertise. Own the month-end close calendar, the general ledger architecture and
      the annual external audit relationship. Board reporting experience required.`,
  },
  {
    id: "p-wh-director",
    family: "warehouse",
    title: "Director of Distribution Operations",
    description: `Director of Distribution Operations. Own six distribution centers,
      2,000 associates and a $90M operating budget. Set the network strategy for
      inventory, shipping, receiving and order fulfillment, and own the warehouse
      management system roadmap. Requires a minimum of 14 years of warehouse and
      logistics experience including multi-site leadership, plus a strong safety and
      OSHA record. Drive continuous improvement in throughput, cycle counts and
      freight cost across the network. Reports to the COO.`,
  },
  {
    id: "p-retail-district",
    family: "retail",
    title: "District Manager, Retail",
    description: `District Manager. Own twelve retail stores, their store managers and
      a $200M sales plan. Drive sales, staffing, merchandising, inventory, shrink and
      loss prevention across the district. Requires a minimum of 12 years of retail
      management experience including multi-unit leadership. Own the P&L, payroll and
      customer service scores for the district; hire and develop store managers and
      assistant store managers. Heavy travel. Point of sale and visual merchandising
      standards ownership.`,
  },
  {
    id: "p-teacher-principal",
    family: "teaching",
    title: "Elementary School Principal",
    description: `Elementary School Principal. Lead a K-5 building of 520 students and
      48 staff. Own instruction, curriculum, student assessment, school culture,
      budget and family engagement. Supervise and evaluate teachers and instructional
      coaches. Requires an administrator license, a master's degree, and a minimum of
      15 years in education including classroom teaching and school leadership. Deep
      knowledge of literacy instruction, special education law, IEPs and professional
      development design.`,
  },
  {
    id: "p-analytics-senior-manager",
    family: "analytics",
    title: "Senior Manager, Analytics",
    description: `Senior Manager, Analytics. Lead a team of eight analysts and
      analytics engineers. Own the metric layer, the data warehouse roadmap and the
      dbt models behind every executive dashboard. Requires a minimum of 12 years of
      analytics experience including 4 managing analysts. Expert SQL, strong Python,
      and a track record of experimentation and A/B testing programs at scale.
      Stakeholder communication with executives, reporting standards, and data quality
      ownership across the business.`,
  },
  // -------------------------------------------------------------------------
  // ADVERSARIAL POSTINGS. Every résumé in the corpus contains the words these
  // are built from — scheduling, communication, training, Excel, safety — so a
  // scorer that rewards incidental vocabulary ranks them above real matches.
  // -------------------------------------------------------------------------
  {
    id: "p-noise-csr",
    family: "support",
    title: "Customer Service Representative",
    description: `Customer Service Representative. Answer inbound calls, emails and
      chats. Provide friendly customer service, resolve issues, document every contact,
      and escalate when needed. Strong communication and organization skills required.
      Comfortable with Excel, scheduling, training new team members, meeting quality
      targets and following safety procedures. We value teamwork, attention to detail,
      time management, problem solving and a professional attitude. Full training
      provided; 1 year of customer service experience preferred.`,
  },
  {
    id: "p-noise-admin",
    family: "support",
    title: "Administrative Assistant",
    description: `Administrative Assistant. Support a busy office: calendar and
      scheduling, travel booking, expense reports, filing, data entry and reception
      coverage. Draft correspondence, take meeting notes, order supplies and coordinate
      onsite events. Requires strong Excel and Word, excellent written and verbal
      communication, attention to detail, time management and discretion with
      confidential information. Training provided on our systems. 2 years of
      administrative experience preferred. Safety and compliance training required
      annually.`,
  },
  // A row whose description was never captured. It must score null — never 0.
  {
    id: "p-no-description",
    family: "nursing",
    title: "Registered Nurse - Med/Surg",
    description: null,
  },
  // A row with a description too thin to recognize anything in. Also null.
  {
    id: "p-thin-description",
    family: "software",
    title: "Engineer",
    description: "Apply today. Great place to work. Competitive benefits.",
  },
];

// ---------------------------------------------------------------------------
// RÉSUMÉS
// ---------------------------------------------------------------------------

export const RESUMES: CorpusResume[] = [
  {
    id: "nurse-icu",
    occupation: "Registered nurse (ICU, 9 years)",
    goodFamilies: ["nursing"],
    accept: ["registered nurse", "nurse", "charge nurse", "staff nurse"],
    years: 9,
    text: `Sarah Nguyen, RN, BSN — Registered Nurse, Houston TX
sarah.nguyen@example.com | (713) 555-0142

Registered Nurse, Houston Methodist — Surgical ICU, 2020–2026
Direct patient care for critically ill adults on a 24-bed intensive care unit. Ventilator
management, patient assessment, medication administration and IV therapy. Precepted six new
graduate nurses. Charge nurse rotation two shifts a month. Documented all care in Epic.

Staff Nurse, Memorial Hermann — Medical-Surgical, 2017–2020
Medical-surgical unit of 32 beds. Care planning, discharge planning, patient education,
wound care and triage. Served on the infection control committee.

SKILLS: acute care, critical care, telemetry, ACLS, BLS, IV therapy, EMR charting, Epic,
phlebotomy, clinical documentation, HIPAA, patient safety
EDUCATION: BSN, University of Texas 2017. Active RN license, Texas.`,
  },
  {
    id: "nurse-newgrad",
    occupation: "New-graduate nurse (0 years)",
    goodFamilies: ["nursing"],
    accept: ["registered nurse", "nurse", "staff nurse"],
    years: 0,
    text: `Marcus Bell, BSN, RN — New Graduate Registered Nurse, Columbus OH
marcus.bell@example.com | (614) 555-0188

Nurse Extern, Ohio State Wexner Medical Center, Summer 2025
Supported the medical-surgical team with patient care, vital signs, ambulation and
documentation. Shadowed charge nurses across two units.

Clinical Rotations, 2023–2026
Medical-surgical, pediatrics, obstetrics, community health and a 180-hour capstone on a
telemetry unit. Patient assessment, medication administration, care planning and patient
education under preceptor supervision.

Patient Care Technician, Riverside Methodist, 2022–2024
Vital signs, ambulation, feeding assistance, phlebotomy and EMR charting.

SKILLS: patient care, BLS, EMR charting, vital signs, wound care, HIPAA, clinical documentation
EDUCATION: BSN, Ohio State University 2026. RN license, Ohio, active 2026. No prior RN experience.`,
  },
  {
    id: "accountant",
    occupation: "Accountant (10 years, CPA)",
    goodFamilies: ["accounting"],
    accept: ["accountant", "staff accountant", "senior accountant", "controller", "tax accountant"],
    years: 10,
    text: `Michael Reed, CPA — Senior Accountant, Chicago IL
michael.reed@example.com | (312) 555-0119

Senior Accountant, Deloitte, 2019–2026
Financial statements, month-end close and account reconciliations for a portfolio of eight
clients. Led the audit fieldwork for two mid-market manufacturers. Built the close checklist
that cut the cycle from eleven days to six.

Staff Accountant, Grant Thornton, 2016–2019
General ledger, accounts payable and accounts receivable, journal entries, audit support and
federal and state tax returns.

SKILLS: GAAP, financial reporting, month-end close, reconciliations, QuickBooks, NetSuite,
Excel, payroll, budgeting, forecasting, SOX, audit, tax
EDUCATION: BS Accounting, University of Illinois 2016. CPA licensed, Illinois.`,
  },
  {
    id: "swe-senior",
    occupation: "Software engineer (8 years, senior)",
    goodFamilies: ["software"],
    accept: ["software engineer", "software developer", "backend developer", "staff software engineer"],
    years: 8,
    text: `Jane Doe — Senior Software Engineer, Seattle WA
jane.doe@example.com | github.com/janedoe

Senior Software Engineer, Stripe, 2021–2026
Payment APIs in TypeScript and Go. Led the migration of the settlement pipeline onto
Kubernetes, cutting median latency from 400ms to 90ms. Introduced Terraform so environments
stopped drifting. Ran incident response as on-call lead for a tier-one service.

Software Engineer, Amazon, 2018–2021
AWS Lambda tooling in Python. Rebuilt the release path around continuous integration with
automated testing. PostgreSQL schema and API design for an internal platform.

SKILLS: TypeScript, Go, Python, React, PostgreSQL, Kubernetes, AWS, Terraform, distributed
systems, API design, observability, monitoring, code review
EDUCATION: BS Computer Science, University of Washington 2018.`,
  },
  {
    id: "swe-newgrad",
    occupation: "Software engineer (0 years, new grad)",
    goodFamilies: ["software"],
    accept: ["software engineer", "software developer", "backend developer", "programmer"],
    years: 0,
    text: `Priya Raman — Junior Software Developer, Austin TX
priya.raman@example.com | github.com/priyar

Software Engineering Intern, Indeed, Summer 2025
Built an internal dashboard in React and TypeScript. Wrote unit tests and took part in code
review. Shipped two features behind a flag.

Teaching Assistant, Data Structures, 2024–2026
Held office hours for 120 students. Graded projects in Python and Java.

Capstone Project, 2026
A URL shortener in Go backed by PostgreSQL, deployed with Docker, with continuous integration
and automated testing. Wrote the API design document.

SKILLS: Python, Java, TypeScript, React, Go, PostgreSQL, Docker, git, unit testing, REST APIs
EDUCATION: BS Computer Science, University of Texas 2026. No full-time experience yet.`,
  },
  {
    id: "warehouse",
    occupation: "Warehouse / logistics (6 years)",
    goodFamilies: ["warehouse"],
    accept: ["warehouse associate", "forklift operator", "warehouse manager", "package handler",
      "shipping coordinator", "inventory specialist", "order fulfillment associate", "machine operator"],
    years: 6,
    text: `Luis Ortega — Warehouse Associate, Memphis TN
luis.ortega@example.com | (901) 555-0173

Warehouse Associate, FedEx Supply Chain, 2020–2026
High-volume distribution center. Pick, pack and ship customer orders. Certified forklift and
pallet jack operator; ran the reach truck on the inbound dock. Loaded and unloaded trailers,
staged outbound shipments and completed daily cycle counts in the warehouse management system.
Trained eleven new associates on safety and OSHA procedures.

Material Handler, Nike Distribution, 2019–2020
Receiving, put-away, inventory accuracy and order fulfillment on second shift.

SKILLS: forklift, pallet jack, RF scanner, inventory, shipping, receiving, order fulfillment,
cycle counts, safety, OSHA, loading, unloading, freight
EDUCATION: High school diploma, 2019. Forklift certification current.`,
  },
  {
    id: "retail",
    occupation: "Retail store manager (7 years)",
    goodFamilies: ["retail"],
    accept: ["store manager", "retail manager", "retail associate", "assistant store manager",
      "sales associate", "store director", "department manager"],
    years: 7,
    text: `Dana Whitfield — Store Manager, Columbus OH
dana.whitfield@example.com | (614) 555-0121

Store Manager, Target, 2021–2026
Run a $28M store with 90 team members. Own sales, staffing, scheduling, merchandising,
inventory and loss prevention. Cut shrink from 1.8% to 0.9% in two years. Hired and developed
four team leads into supervisory roles.

Assistant Store Manager, Old Navy, 2019–2021
Point of sale operations, visual merchandising, returns, inventory counts and customer service
recovery. Opened and closed the store.

Sales Associate, Old Navy, 2018–2019
Cashier, fitting rooms, restocking and floor sets.

SKILLS: retail operations, point of sale, merchandising, inventory, loss prevention, shrink,
scheduling, payroll, customer service, hiring, coaching
EDUCATION: Associate degree, Columbus State 2018.`,
  },
  {
    id: "teacher",
    occupation: "Elementary teacher (11 years)",
    goodFamilies: ["teaching"],
    accept: ["teacher", "elementary teacher", "instructional coach", "bilingual teacher",
      "substitute teacher", "special education teacher", "educator", "literacy coach"],
    years: 11,
    text: `Amanda Cho — Elementary School Teacher, Portland OR
amanda.cho@example.com | (503) 555-0164

3rd Grade Teacher, Portland Public Schools, 2018–2026
Plan and deliver standards-aligned instruction in literacy and math to 27 students. Lead the
grade-level team's curriculum planning. Use formative assessment data to drive small-group
instruction; my class's reading growth led the building three years running. Mentor two
first-year teachers.

1st Grade Teacher, Beaverton School District, 2015–2018
Classroom management, lesson planning, differentiated instruction, IEP implementation and
family communication.

SKILLS: lesson planning, classroom management, differentiated instruction, formative
assessment, literacy instruction, IEPs, special education accommodations, family engagement,
professional development
EDUCATION: MEd Curriculum and Instruction, Portland State 2017. BA, 2015. Oregon teaching
license, active.`,
  },
  {
    id: "driver",
    occupation: "CDL truck driver (14 years)",
    goodFamilies: ["driving"],
    accept: ["truck driver", "cdl driver", "otr driver", "delivery driver", "route driver",
      "owner operator", "courier"],
    years: 14,
    text: `Roy Palmer — CDL Class A Truck Driver, Little Rock AR
roy.palmer@example.com | (501) 555-0198

Over the Road Driver, Schneider National, 2016–2026
Dry van and reefer freight, 48 states, 2.6 million safe miles. Pre-trip and post-trip
inspections, electronic logs, hours of service compliance under DOT and FMCSA rules. Zero
preventable accidents. Mentored twelve student drivers through their first 30 days.

Regional Driver, US Foods, 2012–2016
Multi-stop refrigerated delivery routes, hand unloading, customer paperwork and proof of
delivery. Backing into tight urban docks daily.

SKILLS: Class A CDL, doubles and tank endorsements, electronic logging device, hours of
service, DOT compliance, pre-trip inspection, load securement, backing, coupling, dispatch
EDUCATION: High school diploma 2011. Clean motor vehicle record. Hazmat endorsement current.`,
  },
  {
    id: "founder",
    occupation: "Founder / CEO (executive)",
    goodFamilies: ["executive"],
    accept: ["founder", "ceo", "chief executive officer", "coo", "chief operating officer",
      "general manager", "managing director", "executive director"],
    years: 12,
    text: `Campbell Abbott — Founder & CEO, Resume Booster, Seattle WA
campbell@example.com | linkedin.com/in/campbellabbott

Founder & CEO, Resume Booster, 2021–2026
Bootstrapped a job-search product to $4M ARR and 22 people. Owned the P&L, hiring and the
board relationship. Ran go-to-market from zero: built the go-to-market motion across three
launches, then hired the leaders who own it now. Raised a $6M seed round.

Head of Operations, Zapier, 2017–2021
Built the operations function from three people to nineteen. Owned forecasting, budgeting and
vendor management across support, billing and trust & safety.

SKILLS: leadership, strategy, hiring, fundraising, P&L ownership, go-to-market, forecasting,
analytics, SQL, Excel, organizational design
EDUCATION: BS, University of Washington 2012.`,
  },
  {
    id: "career-changer",
    occupation: "Career changer: teacher → data analyst",
    goodFamilies: ["analytics", "teaching"],
    accept: ["data analyst", "teacher", "business analyst", "analytics engineer", "bi analyst"],
    years: 6,
    text: `Nina Alvarez — Data Analyst (career changer, former teacher), Denver CO
nina.alvarez@example.com | (720) 555-0155

Data Analyst, Denver Public Schools — Assessment Office, 2024–2026
Own district reporting on student assessment outcomes. Write SQL against the warehouse, model
data in dbt, and build the Tableau dashboards principals use each week. Ran the A/B test that
retired two redundant benchmark assessments.

Middle School Math Teacher, Denver Public Schools, 2018–2024
Taught 7th and 8th grade math. Built the department's data review process, which is what moved
me into analytics. Lesson planning, classroom management and differentiated instruction.

SKILLS: SQL, dbt, Tableau, Excel, Python (pandas), statistics, A/B testing, data modelling,
stakeholder communication, reporting
EDUCATION: MEd, University of Denver 2018. BA Mathematics 2016. Google Data Analytics
Certificate 2023.`,
  },
  {
    id: "funeral-director",
    occupation: "Funeral director (absent from vocab)",
    goodFamilies: ["funeral"],
    accept: ["funeral director", "embalmer", "mortician"],
    emptyIsFine: true,
    years: 15,
    text: `Gerald Hines — Licensed Funeral Director and Embalmer, Savannah GA
gerald.hines@example.com | (912) 555-0107

Funeral Director and Embalmer, Fox & Weeks Funeral Directors, 2014–2026
Arrange and conduct roughly 220 services a year. Meet with families, complete death
certificates and burial permits, coordinate with cemeteries, crematories and clergy, and
conduct visitations and graveside services. Perform embalming, restorative art, dressing and
casketing. Carry the on-call rotation for removals one week in three.

Apprentice Embalmer, Gamble Funeral Service, 2011–2014
Preparation room work, transfers, and preneed paperwork.

SKILLS: embalming, restorative art, funeral arrangement, preneed contracts, aftercare,
cremation authorization, vital records filing, family service
EDUCATION: AS Mortuary Science, Gupton-Jones College 2011. Georgia funeral director and
embalmer license, active.`,
  },
  {
    id: "court-reporter",
    occupation: "Court reporter (absent from vocab)",
    goodFamilies: ["reporting"],
    accept: ["court reporter", "stenographer"],
    emptyIsFine: true,
    years: 12,
    text: `Helen Marsh, RPR — Freelance Court Reporter, Sacramento CA
helen.marsh@example.com | (916) 555-0134

Freelance Court Reporter, 2016–2026
Verbatim stenographic records of depositions, arbitrations and hearings across Northern
California. Realtime translation at 240 words per minute. Manage exhibits, read back testimony,
and deliver certified transcripts on a 48-hour turnaround for expedited matters.

Official Reporter, Sacramento County Superior Court, 2014–2016
Trials, sentencings and motions calendar. Produced daily copy for two long-cause trials.

SKILLS: stenotype, realtime translation, transcript production, exhibit handling, deposition
procedure, CAT software, punctuation and formatting standards, scoping
EDUCATION: Court reporting program, Humphreys College 2013. RPR certification, California CSR
license active.`,
  },
  {
    id: "dietitian",
    occupation: "Clinical dietitian (absent from vocab)",
    goodFamilies: ["dietetics"],
    accept: ["dietitian", "clinical dietitian", "registered dietitian"],
    emptyIsFine: true,
    years: 8,
    text: `Robin Achebe, RD, LD — Clinical Dietitian, Minneapolis MN
robin.achebe@example.com | (612) 555-0193

Clinical Dietitian, Hennepin Healthcare, 2018–2026
Nutrition assessments for inpatients on the renal and diabetes services. Write enteral and
parenteral nutrition recommendations, round with the interdisciplinary team, and counsel
patients and families on therapeutic diets. Document every encounter in Epic. Chaired the
malnutrition documentation workgroup.

Dietetic Intern, Mayo Clinic, 2017–2018
Rotations in clinical, food service and community nutrition.

SKILLS: medical nutrition therapy, nutrition assessment, enteral nutrition, parenteral
nutrition, malnutrition criteria, therapeutic diets, patient education, HIPAA
EDUCATION: MS Nutrition, University of Minnesota 2017. Registered with the Commission on
Dietetic Registration; Minnesota licensure active.`,
  },
  {
    // The control for any rule about compound headlines. "welder" is a whole
    // occupation and "mig" is a technique, so a rule that reads "MIG Welder" as
    // a two-word occupation must not cost this reader the word "welder".
    id: "welder",
    occupation: "MIG welder (compound headline)",
    goodFamilies: ["welding"],
    accept: ["welder", "mig welder"],
    years: 9,
    text: `Tomas Vega — MIG Welder and Fabricator, Toledo OH
tomas.vega@example.com | (419) 555-0166

MIG Welder, Libbey Manufacturing, 2019–2026
Short-run production and custom fabrication in mild steel, stainless and aluminium. Read
blueprints and weld symbols, lay out and fit parts, tack and finish weld to AWS D1.1, grind
and prep for paint. Ran the plasma cutter, band saw and press brake. Trained four apprentices.

Fabricator, Ohio Steel Works, 2017–2019
Structural fitting, flux core and stick work, and jig building for repeat orders.

SKILLS: MIG, TIG, flux core, stick, blueprint reading, weld symbols, fit-up, grinding,
plasma cutting, press brake, AWS D1.1, PPE, OSHA, shop safety
EDUCATION: Welding certificate, Owens Community College 2017. MIG certification current.`,
  },
  {
    // The occupation the vocabulary carries only as compounds of somebody
    // else's field ("project manager construction", "telecom project manager").
    // Bare "manager" is a stoplisted noise word, so this reader's headline has
    // nowhere in the vocabulary to land.
    id: "project-manager",
    occupation: "Project manager (compound headline)",
    goodFamilies: ["projects"],
    accept: ["project manager", "program manager", "technical program manager"],
    emptyIsFine: true,
    years: 8,
    text: `Elena Petrov — Project Manager, Boston MA
elena.petrov@example.com | (617) 555-0140

Project Manager, Iron Mountain, 2021–2026
Own delivery for a portfolio of eleven client implementations: scope, schedule, budget, risk
and stakeholder communication. Run weekly status reporting to executives and manage change
requests through a formal board. Brought a stalled $3M migration back to plan in one quarter.

Associate Project Manager, Iron Mountain, 2018–2021
Project plans, resource planning, vendor management and milestone tracking in Jira and
Smartsheet.

SKILLS: project planning, scope management, budget, risk register, stakeholder communication,
status reporting, Jira, Smartsheet, MS Project, Scrum, waterfall, vendor management
EDUCATION: BS Business, Northeastern 2018. PMP certified 2021.`,
  },
];
