/**
 * WORKDAY TENANTS WITH MORE THAN ONE CATALOGUED SITE -- GENERATED, do not edit by hand.
 *
 *   npx tsx scripts/workday-multi-site-tenants.ts
 *
 * job-board's Workday cross-site dedupe (supabase/functions/job-board/index.ts,
 * the block logged as "workday cross-site dedupe") skips a site's new
 * requisition copy, an id with a one- or two-digit suffix such as R31339-1,
 * whenever a stored row of any site of the same tenant holds its base id
 * (R31339). So on a tenant with a second site, a watch on one site can count
 * nothing of a posting the employer lists there: strayer~wd1~CU_Careers listed
 * 9 roles dated this month on 2026-10-25 and served none, and 7 of the 9 were
 * copies of requisitions strayer~wd1~SEI serves. The zero page withholds its
 * watch promise on these tenants (lander-model's watchPromiseOf). 511 tenants.
 *
 * The guard pd-hotfix-a-watch-on-a-workday-site-whose-tenant-has-another-promises-nothing.test.tsx
 * recomputes this list from supabase/functions/job-board/sources.ts.
 */

const TENANTS: ReadonlyArray<string> = [
  "7eleven", "9dot", "a1group", "aaamidatlantic", "abbott", "academyofartuniversity",
  "accelentertainment", "accelleron", "accenture", "acehardware", "acelero", "acrt", "acxiomllc",
  "adient", "admiralbeverage", "adtran", "advisorgroup", "aes", "aesop", "agecare", "agf",
  "agilent", "agiliti", "aia", "aig", "airliquidehr", "airproducts", "akumincorp", "albemarle",
  "albertamotorassociation", "alfalaval", "aliaxis", "allegion", "alleima", "alliancedata",
  "alliancewd", "allstate", "alterra", "ambgroup", "amerilife", "amfam", "amherst", "anaheimducks",
  "anticimexinc", "aoins", "aptiagroup", "argonne", "armaninollp", "arrow", "ashealthnet",
  "aspendental", "assurant", "astrazeneca", "astro", "asuep", "asurion", "athene", "autodesk",
  "availity", "avera", "aveva", "avisbudget", "awc", "awepeople", "awg", "axiscapital", "babilou",
  "badgermeter", "bah", "baincapital", "baltimorecity", "barnard", "barryu", "bb", "bbinsurance",
  "bdx", "beemok", "belk", "belron", "beneva", "bf", "bgfoods", "bison", "blackstone", "blattner",
  "bmo", "boeing", "bonterra", "bpinternational", "bridgestone", "brighthorizons", "brilliancanada",
  "brinks", "bristow", "bronsonhg", "brookfield", "brooksauto", "browardcollege", "brunswick",
  "bullish", "cadence", "calibercollision", "calistacorp", "calix", "capitaland", "capitalauto",
  "capri", "cat", "cba", "cbgoc", "cbh", "ccf", "cecentertainment", "ceu", "childrensplace",
  "choicehotels", "churchdwight", "churchs", "cibc", "cip", "city", "cmu", "cna", "collaborative",
  "comfortsystemsusa", "compassion", "conagrabrands", "corebridgefinancial", "cornell",
  "corpartners", "corrohealth", "costar", "countryfinancial", "covestro", "crhc", "cubic", "db",
  "dealertire", "deepwater", "deseretmanagement", "dinebrands", "disney", "djeholdings", "doterra",
  "dowjones", "duckcreek", "dynastymanagement", "easyservice", "ebi", "eisneramper",
  "elderslimited", "elevancehealth", "embryriddle", "emerson", "emerysapp", "employeeownedbrands",
  "ensign", "essentiahealth", "essity", "etsy", "evotecgroup", "extendicare", "extraspace",
  "faithtechnologies", "fastretailing", "fedex", "fgcu", "fhiworks", "fil", "firstam",
  "firstnational", "flexerasoftware", "flextronics", "flpoly", "forcepoint", "fox", "fph",
  "franklintempleton", "freseniusglobal", "fticonsulting", "gafsgi", "gaig", "galderma",
  "gandwukeurope", "gbmc", "gcaa", "gcu", "georgetown", "gfs", "ghc", "ghr", "gici", "gilead",
  "globalhr", "globe", "gn", "gnw", "graybar", "groundworks", "guggenheim", "guillevin", "gxs",
  "haier", "haihospitality", "hargroveepc", "harriscomputer", "harvestroad", "hcsc",
  "heartlandhomeservices", "hec", "heidelbergmaterials", "heinz", "hendrick", "hengeler", "hexcel",
  "hhs", "hl", "holmanautogroup", "hospicecom", "hp", "hpe", "huhtamaki", "humana", "hyperiongrp",
  "hyvee", "ia", "ich", "idexcorp", "iheartmedia", "iko", "ilitch", "immatics",
  "independencepetgroup", "ing", "insbrk", "integritymarketing", "invenergyllc", "irvingoil",
  "jackson", "jacksongov", "jacksonhealthcare", "jci", "jcrew", "jj", "jll", "juliusbaer",
  "jurists", "justfab", "kaishaservice", "kantar", "kapsch", "kengarff", "kimberlyclark",
  "kiongroup", "kla", "kmkp", "knitwellgroup", "kokosing", "kyndryl", "lambweston", "landolakes",
  "languageline", "lazboy", "lbg", "learfield", "leecompany", "lesschwab", "lgt", "liberty",
  "libertyglobal", "lifung", "linklaters", "livenation", "lmg", "lnw", "logicalis", "luminegrp",
  "lvhn", "maersk", "manulife", "maricopa", "marvell", "marylandconnect", "masco", "massmutual",
  "mastercard", "mbda", "mckesson", "medaviehs", "mehilainen", "meijer", "melcoresorts",
  "merceruniversity", "methodisthealthsystem", "mgmchina", "miamioh", "mica", "mksinst", "mmc",
  "modsquad", "mohegan", "montefiore", "monumenthealth", "morningstar", "mouvrh", "ms", "msamlin",
  "mtb", "mufgub", "myhcm", "myhrabc", "mymvw", "myview", "mywdhr", "nacoal", "nasdaq",
  "nationalindemnity", "nb", "ncr", "ncratleos", "nebraskamed", "nexperia", "nkg", "noerr",
  "norconsult", "northeastern", "nphosting", "nrf", "nshe", "ochsner", "olemiss", "olg",
  "onehealthineers", "open", "optioncare", "oregon", "orix", "otis", "ourhrconnect",
  "owensborohealth", "oxford", "pacificlife", "pbk", "peak6group", "peets", "pennant", "penncolor",
  "pensacolastate", "petstock", "pewtrusts", "pfg", "pgatour", "phcgroup", "phreesia", "pladis",
  "plantemoran", "plastipak", "pmpediatrics", "pnc", "polaris", "politico", "polpharma",
  "powerdesigninc", "premera", "pretiumenterpriseservices", "priceline", "propetroservices", "pru",
  "prudential", "psu", "publicmedia", "puma", "pwc", "q8hcm", "quadreal", "qvc", "rakuten", "rbc",
  "reed", "relx", "repsol", "resmed", "revantage", "rhe", "richmond", "ringling", "rivhs", "rmit",
  "roberthalf", "roche", "rockwoolgroup", "rollsroyce", "roswellpark", "rpcinc", "ryan", "ryansg",
  "salesforce", "salvationarmy", "sandvik", "savista", "scanhealthplan", "scj", "sdguthrie",
  "seaworldentertainment", "sedgwick", "sfcollege", "sharpservices", "signetjewelers", "slihrms",
  "sluhn", "snapchat", "spectris", "srsdistribution", "stageentertainment", "stanfordmedicine",
  "strayer", "structural", "suddath", "sunlife", "surbanajurong", "svha", "swbc", "swinerton",
  "swisscom", "swisslife", "synchronyfinancial", "synnex", "takkt", "talentmanagementsolution",
  "tamus", "taxwell", "tbkbank", "tcbrands", "tcsedsystem", "tempus", "tencent", "tennis",
  "theclaremontcolleges", "thekineticgroup", "thgrp", "tmhcc", "topcon", "trafigura",
  "transamerica", "truist", "trumed", "trumpf", "trustmark", "ttc", "tti", "tuckahoeholdings",
  "tulsacounty", "tvc", "tysonfoods", "uasys", "ubc", "ucf", "ukgrantt", "uline", "umb", "umiami",
  "umusic", "unhcr", "unilever", "unisonriskadvisors", "unitedchurchhomes", "upenn", "uq", "usbank",
  "usc", "usicinc", "usuro", "utampa", "utaustin", "uvmhealth", "vanguard", "velux", "veoliauki",
  "veralto", "verawholehealth", "vertexinc", "vfc", "vhaca", "volarisgroup", "vst", "warnerbros",
  "wasatchproperty", "waynestatephysicians", "web", "websteronline", "wehi", "wellington",
  "wellstar", "westernalliancebank", "westernunion", "wf", "wfscorp", "wfu", "wilhelmsen",
  "williams", "wisconsin", "wmeimg", "wmg", "wsfsbank", "wvumedicine", "wwecorp", "wycliffe",
  "xignux", "younglife", "zeppelin", "zoetis",
];

/** The tenants as generated, for the guard. */
export const WORKDAY_MULTI_SITE_TENANT_LIST = TENANTS;

/** A Workday tenant (a Workday token's first segment) with more than one catalogued site. */
export const WORKDAY_MULTI_SITE_TENANTS: ReadonlySet<string> = new Set(TENANTS);
