/**
 * BOARD TOKENS TWO HIRING SYSTEMS CARRY -- GENERATED, do not edit by hand.
 *
 *   npx tsx scripts/board-collisions.ts
 *
 * A company page lives at /jobs/company/<token>, and the token is the board's
 * name on its hiring system. 139 tokens are carried by two systems at once,
 * and nothing we hold says whether the two boards are one employer. Often they
 * are not: /jobs/company/clear lists Clear (BambooHR) beside CLEAR - Corporate
 * (Greenhouse), and /jobs/company/ans lists ANS beside the Agence du Numérique
 * en Santé. Every per-employer reader keys on the token, so on these pages
 * intel, pay, headcount, SEC figures, filings, wage filings, the hiring record
 * and similar employers could describe two companies as one. A missed merge
 * shows a name twice; a wrong one prints one company's record as another's.
 * So the page reads this list (the catalogue, not which boards happen to have
 * live postings) and shows only the per-vendor split and its open-role counts
 * (company profiles plan 2026-10-11, section 2).
 *
 * The guard a-board-name-two-employers-share-shows-no-employer-facts.test.tsx
 * recomputes this list from supabase/functions/job-board/sources.ts.
 */

export interface CollidedBoard {
  /** job_board_postings.source */
  source: string;
  /** The board's name in the catalogue. */
  name: string;
}

const ROWS: ReadonlyArray<readonly [token: string, boards: ReadonlyArray<readonly [source: string, name: string]>]> = [
  ["ada", [["personio", "ada Learning GmbH"], ["pinpoint", "Ada"]]],
  ["afg", [["bamboohr", "Afg"], ["workable", "ApexFocusGroup"]]],
  ["aira", [["breezy", "FreePower"], ["workable", "Aira"]]],
  ["aleph", [["ashby", "Aleph"], ["lever", "Aleph"]]],
  ["alloy", [["greenhouse", "Alloy"], ["lever", "Alloy"]]],
  ["andromeda", [["ashby", "Andromeda Cluster"], ["bamboohr", "Andromeda"]]],
  ["anima", [["ashby", "Anima"], ["teamtailor", "Ánima"]]],
  ["ans", [["lever", "ANS"], ["recruitee", "Agence du Numérique en Santé"]]],
  ["antenna", [["greenhouse", "Antenna"], ["workable", "Antenna Group"]]],
  ["applus", [["recruitee", "Applus+"], ["workable", "Applus"]]],
  ["appvia", [["pinpoint", "Appvia"], ["workable", "Appvia"]]],
  ["arcus", [["personio", "Arcus"], ["recruitee", "ARCUS Planung + Beratung Bauplanungsgesellschaft mbH"]]],
  ["arvo", [["teamtailor", "Arvo"], ["workable", "ARVO"]]],
  ["atlas", [["ashby", "Atlas"], ["personio", "Atlas-Bildungs-Center e.V."]]],
  ["autorola", [["personio", "Autorola"], ["teamtailor", "Autorola Group"]]],
  ["axiom", [["ashby", "Axiom"], ["greenhouse", "Axiom"]]],
  ["bergmanclinics", [["personio", "Bergmanclinics"], ["recruitee", "Bergman Clinics Nederland B.V."]]],
  ["big-leap-health", [["ashby", "Big Leap Health"], ["breezy", "Big Leap Health"]]],
  ["birchesgroup", [["bamboohr", "Birches Group"], ["pinpoint", "Birches Group"]]],
  ["bis", [["lever", "BIS Safety Software"], ["personio", "Bavarian International School gAG"]]],
  ["bluefield", [["bamboohr", "Bluefield"], ["recruitee", "Bluefield Finance B.V."]]],
  ["bobbie", [["greenhouse", "Bobbie"], ["personio", "Bobbie"]]],
  ["booknook-inc", [["rippling", "Booknook Inc"], ["workable", "BookNook"]]],
  ["brilliant", [["breezy", "Brilliant"], ["lever", "Brilliant"]]],
  ["bullfinch", [["breezy", "Bullfinch Recruitment"], ["personio", "Bullfinch Asset AG"]]],
  ["burr", [["bamboohr", "Burr"], ["greenhouse", "Harvester Veterinary Hospital of Burr Ridge"]]],
  ["cabrillohospice", [["bamboohr", "Cabrillohospice"], ["greenhouse", "Cabrillo Hospice"]]],
  ["cactus", [["personio", "Cactus"], ["workable", "Cactus"]]],
  ["cambio", [["ashby", "Cambio"], ["teamtailor", "Cambio"]]],
  ["caribou", [["breezy", "Caribou"], ["greenhouse", "Caribou Financial"]]],
  ["cas", [["ashby", "Cas"], ["personio", "Cas"]]],
  ["celcuity", [["bamboohr", "Celcuity"], ["greenhouse", "Celcuity Inc."]]],
  ["change", [["ashby", "Change.org"], ["recruitee", "Change"]]],
  ["clear", [["bamboohr", "Clear"], ["greenhouse", "CLEAR - Corporate"]]],
  ["coople", [["bamboohr", "Coople"], ["pinpoint", "Coople"]]],
  ["cpc", [["bamboohr", "CPC Clinical Research"], ["recruitee", "Crescent Purchasing Consortium"]]],
  ["datatonic", [["ashby", "Datatonic"], ["pinpoint", "Datatonic"]]],
  ["dayshape", [["pinpoint", "Dayshape"], ["workable", "Dayshape"]]],
  ["dga", [["bamboohr", "Dga"], ["lever", "Democratic Governors Association"]]],
  ["dgi", [["bamboohr", "discoverygarden inc."], ["personio", "Dgi"]]],
  ["dispatch", [["ashby", "Dispatch"], ["greenhouse", "Dispatch Technologies, Inc"]]],
  ["dnata", [["pinpoint", "dnata"], ["recruitee", "dnata B.V."]]],
  ["duffel", [["ashby", "Duffel"], ["lever", "Duffel"]]],
  ["duolingo", [["breezy", "Duolingo"], ["greenhouse", "Duolingo"]]],
  ["echo", [["ashby", "Echo"], ["greenhouse", "Echo Neurotechnologies"]]],
  ["edb", [["greenhouse", "EDB"], ["personio", "Jobs EDB GmbH"]]],
  ["elfbeauty", [["lever", "e.l.f. Beauty"], ["pinpoint", "Elfbeauty"]]],
  ["eraneos", [["personio", "Eraneos"], ["recruitee", "Eraneos"]]],
  ["ethenalabs", [["lever", "Ethena Labs"], ["teamtailor", "Ethena Labs"]]],
  ["everstar", [["ashby", "Everstar"], ["breezy", "Everstar"]]],
  ["excel", [["greenhouse", "Excel Learning Center"], ["rippling", "Excel"]]],
  ["extend", [["ashby", "Extend"], ["greenhouse", "Extend"]]],
  ["finch", [["ashby", "Finch"], ["lever", "Finch"]]],
  ["firsthand", [["ashby", "Firsthand"], ["greenhouse", "firsthand Health"]]],
  ["fleishmanhillard", [["greenhouse", "FleishmanHillard"], ["personio", "Fleishmanhillard"]]],
  ["florence", [["lever", "Florence Health"], ["recruitee", "Florence"]]],
  ["forvismazars", [["bamboohr", "Forvis Mazars Holding (Thailand) Ltd."], ["recruitee", "Forvis Mazars Ireland Limited"]]],
  ["found", [["ashby", "Found"], ["greenhouse", "Found"]]],
  ["foxelligroup", [["ashby", "Foxelligroup"], ["recruitee", "Foxelli Group"]]],
  ["gateway", [["bamboohr", "Gateway"], ["recruitee", "Gateway to Germany"]]],
  ["getyourguide", [["greenhouse", "GetYourGuide"], ["pinpoint", "Getyourguide"]]],
  ["glide", [["ashby", "Glide"], ["lever", "Glide"]]],
  ["goodlord", [["ashby", "Goodlord"], ["pinpoint", "Goodlord"]]],
  ["goody", [["ashby", "Goody"], ["greenhouse", "Goody Garage Doors"]]],
  ["grand", [["ashby", "Grand"], ["lever", "Grand Games"]]],
  ["grantthornton", [["bamboohr", "Grant Thornton"], ["teamtailor", "Grant Thornton Sweden"]]],
  ["headway", [["ashby", "Headway"], ["teamtailor", "Headway Inc"]]],
  ["helsing", [["greenhouse", "Helsing"], ["pinpoint", "Helsing"]]],
  ["hived", [["ashby", "Hived"], ["recruitee", "Hived NV"]]],
  ["hll", [["bamboohr", "Hll"], ["teamtailor", "HLL Hyreslandslaget"]]],
  ["infinite", [["ashby", "Infinite"], ["breezy", "Infinite Group"]]],
  ["ism", [["greenhouse", "ISM"], ["recruitee", "valantic NL"]]],
  ["jobandtalent", [["bamboohr", "Jobandtalent"], ["lever", "Job&Talent"], ["teamtailor", "Job&Talent"]]],
  ["jungheinrich", [["bamboohr", "Jungheinrich"], ["greenhouse", "Jungheinrich UK"]]],
  ["lab37", [["breezy", "Lab37"], ["greenhouse", "Lab37"]]],
  ["lavendo", [["ashby", "Lavendo"], ["teamtailor", "Lavendo"]]],
  ["level", [["ashby", "Level"], ["teamtailor", "LEVEL"]]],
  ["lineleap", [["pinpoint", "LineLeap | LineLeap"], ["rippling", "Lineleap"]]],
  ["lockwood", [["greenhouse", "The Lockwood Group, LLC"], ["workable", "Lockwood Publishing"]]],
  ["lunar", [["ashby", "Lunar"], ["teamtailor", "Lunar"]]],
  ["lush", [["greenhouse", "Lush Handmade Cosmetics"], ["personio", "Lush"]]],
  ["mapbox", [["ashby", "Mapbox"], ["pinpoint", "Mapbox"]]],
  ["matia", [["ashby", "Matia"], ["teamtailor", "Matia Fundazioa"]]],
  ["mcs", [["greenhouse", "Minnesota Cannabis Services"], ["workable", "MCS"]]],
  ["mec", [["bamboohr", "Mec"], ["recruitee", "MEC Consulting Group"]]],
  ["mercari", [["greenhouse", "Mercari"], ["workable", "Mercari, inc."]]],
  ["method", [["ashby", "Method"], ["greenhouse", "Method, a GlobalLogic company"]]],
  ["mozn-ai", [["rippling", "Mozn Ai"], ["workable", "Mozn"]]],
  ["msf", [["bamboohr", "The Milk Shake Factory"], ["recruitee", "MSF International"]]],
  ["noah", [["bamboohr", "Noah"], ["greenhouse", "North Oatlands Animal Hospital"]]],
  ["nucleus", [["bamboohr", "Nucleus"], ["greenhouse", "Nucleus Global"]]],
  ["nve", [["greenhouse", "NVE Experience Agency"], ["rippling", "Nve"]]],
  ["ocs", [["greenhouse", "Opportunity Charter School"], ["teamtailor", "OCS"]]],
  ["oneapp", [["ashby", "OnePay"], ["pinpoint", "OneApp, Inc. | OneApp, Inc."]]],
  ["pdq", [["greenhouse", "PDQ Doors"], ["rippling", "Pdq"]]],
  ["phoenix", [["ashby", "Phoenix"], ["personio", "Phoenix"]]],
  ["playonsports", [["greenhouse", "PlayOn! Sports"], ["lever", "PlayOn"]]],
  ["ppmi", [["bamboohr", "Ppmi"], ["lever", "Planned Parenthood of Michigan"]]],
  ["proof", [["greenhouse", "Proof"], ["lever", "Proof"]]],
  ["proxima", [["ashby", "Proxima"], ["teamtailor", "Proxima"]]],
  ["psv", [["recruitee", "PSV"], ["teamtailor", "PSV"]]],
  ["pubnub", [["greenhouse", "PubNub"], ["pinpoint", "Pubnub"]]],
  ["pulse", [["ashby", "Pulse"], ["greenhouse", "Pulse Healthcare"]]],
  ["pylon", [["ashby", "Pylon"], ["teamtailor", "Pylon-konserni"]]],
  ["raft", [["bamboohr", "Raft"], ["greenhouse", "Raft Company Website"]]],
  ["realeyes", [["bamboohr", "Realeyes"], ["personio", "Realeyes"]]],
  ["rebtel", [["greenhouse", "Majority"], ["teamtailor", "Rebtel"]]],
  ["rebuy", [["ashby", "Rebuy, Inc."], ["recruitee", "rebuy"]]],
  ["roadrunner", [["ashby", "Roadrunner"], ["greenhouse", "RoadRunner Recycling Inc."]]],
  ["rubrik", [["greenhouse", "Rubrik Job Board"], ["teamtailor", "Rubrik"]]],
  ["rumble", [["greenhouse", "Rumble"], ["personio", "Rumble"]]],
  ["safe", [["ashby", "Safe Software"], ["lever", "Safe"]]],
  ["samsara", [["greenhouse", "Samsara"], ["pinpoint", "Samsara"]]],
  ["sans", [["bamboohr", "SANS Institute"], ["pinpoint", "Sans"]]],
  ["seccl", [["ashby", "Seccl"], ["pinpoint", "Seccl"]]],
  ["sedna", [["greenhouse", "Sedna"], ["pinpoint", "Sedna"]]],
  ["sideinc", [["lever", "Sideinc"], ["workable", "Side"]]],
  ["sui", [["bamboohr", "Sui"], ["pinpoint", "Sui"]]],
  ["sunday", [["ashby", "Sunday Robotics"], ["breezy", "Sunday"]]],
  ["sunrise", [["ashby", "Sunrise"], ["greenhouse", "Sunrise Management"]]],
  ["sweep", [["ashby", "Sweep"], ["teamtailor", "SWEEP"]]],
  ["switchboard", [["ashby", "Switchboard"], ["teamtailor", "Switchboard LGBTQIA+"]]],
  ["tdg", [["bamboohr", "Thinkdigital group"], ["greenhouse", "The Dermatology Group"]]],
  ["teamlewis", [["bamboohr", "Teamlewis"], ["teamtailor", "TEAM LEWIS"]]],
  ["teneo", [["greenhouse", "Teneo"], ["pinpoint", "Teneo"]]],
  ["tenstorrent", [["greenhouse", "Tenstorrent"], ["pinpoint", "Tenstorrent"]]],
  ["teya", [["ashby", "Teya"], ["pinpoint", "Teya"]]],
  ["tpg", [["bamboohr", "The Property Group"], ["personio", "Tpg"]]],
  ["tradinghub", [["ashby", "TradingHub"], ["pinpoint", "Tradinghub"]]],
  ["ultralytics", [["ashby", "Ultralytics"], ["personio", "Ultralytics"]]],
  ["upguard", [["ashby", "UpGuard Inc."], ["lever", "Upguard"]]],
  ["vacancies", [["lever", "Vacancies"], ["recruitee", "Arc"]]],
  ["veo", [["lever", "Veo"], ["teamtailor", "VEO"]]],
  ["versapay", [["lever", "Versapay"], ["pinpoint", "Versapay"]]],
  ["vgroup", [["pinpoint", "Vgroup"], ["workable", "V Group"]]],
  ["victory", [["bamboohr", "Victory"], ["breezy", "Victory"]]],
  ["vmax", [["ashby", "Vmax AI Corp"], ["greenhouse", "Vmax"]]],
  ["wakam", [["greenhouse", "Wakam"], ["teamtailor", "Wakam"]]],
  ["watershed", [["ashby", "Watershed"], ["greenhouse", "Watershed Informatics"]]],
];

const BY_TOKEN: ReadonlyMap<string, CollidedBoard[]> = new Map(
  ROWS.map(([token, boards]) => [token, boards.map(([source, name]) => ({ source, name }))]),
);

/** The rows as generated, for the guard. */
export const BOARD_COLLISION_ROWS = ROWS;

/** The boards behind a token two hiring systems carry, or null for every other token. */
export function collidedBoards(token: string | null | undefined): CollidedBoard[] | null {
  return typeof token === "string" ? BY_TOKEN.get(token) ?? null : null;
}

/** True when two hiring systems carry this token, so no employer-level fact may be shown for it. */
export function isCollidedToken(token: string | null | undefined): boolean {
  return typeof token === "string" && BY_TOKEN.has(token);
}
