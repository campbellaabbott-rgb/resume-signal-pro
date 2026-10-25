/**
 * COMMUTE RINGS FOR THE 24 DEV RÉSUMÉS' HOMES, AS metro_ring WOULD ANSWER THEM.
 *
 * Production reads geo_places (GeoNames cities5000, 20261016100000) through
 * metro_ring (20261016101000). The bench has no GeoNames table, so the offline
 * client answers metro_ring from these: the Requirements-First prototype's
 * hand-written rings (scratchpad match-acc-1012/proto/rings.ts, "written from
 * geography", about 40 km), with each place's OWN region added so a ring that
 * crosses a state line names the state each place is in (Vancouver WA in the
 * Portland ring, Camden NJ in the Philadelphia ring).
 *
 * WHAT THIS MEANS FOR THE NUMBERS. The offline P@10 assumes metro_ring returns
 * a ring about as good as these. A home the profile misreads, or a city not
 * listed here, gets no ring and the engine falls back to the city alone, as it
 * does in production before the GeoNames rows apply. The prototype baseline was
 * measured with these same rings, so the comparison with it is like for like.
 * The §6.2 recall check of the real ring is a separate, live measurement.
 */
export interface RingPlace { name: string; region: string | null; region_name: string | null; country: string }

const NAMES: Record<string, string> = {
  TX: "Texas", ON: "Ontario", WA: "Washington", AZ: "Arizona", IL: "Illinois", OH: "Ohio", GA: "Georgia", NY: "New York",
  NJ: "New Jersey", NC: "North Carolina", SC: "South Carolina", MA: "Massachusetts", CO: "Colorado", OR: "Oregon",
  QLD: "Queensland", PA: "Pennsylvania", DE: "Delaware", CA: "California", MN: "Minnesota",
};
/** "Vancouver@WA" names a place in another region than the ring's home. */
const ring = (country: string, region: string | null, places: string[]): RingPlace[] => places.map((p) => {
  const [name, own] = p.split("@");
  const r = own ?? region;
  return { name, region: r, region_name: r ? NAMES[r] ?? null : country === "GB" ? "England" : null, country };
});

/** Keyed "city|REGION|CC" (city lower-case; REGION empty where the board's locations carry none). */
export const DEV_RINGS: Record<string, RingPlace[]> = {
  "austin|TX|US": ring("US", "TX", ["Austin", "Round Rock", "Cedar Park", "Georgetown", "Pflugerville", "Leander", "San Marcos", "Kyle", "Buda", "Hutto"]),
  "toronto|ON|CA": ring("CA", "ON", ["Toronto", "Mississauga", "Brampton", "Markham", "Vaughan", "Richmond Hill", "Oakville", "North York", "Scarborough", "Etobicoke", "Pickering", "Ajax", "Concord"]),
  "seattle|WA|US": ring("US", "WA", ["Seattle", "Bellevue", "Redmond", "Kirkland", "Bothell", "Renton", "Tukwila", "Kent", "Everett", "Lynnwood", "Issaquah", "Sammamish"]),
  "phoenix|AZ|US": ring("US", "AZ", ["Phoenix", "Scottsdale", "Tempe", "Mesa", "Chandler", "Glendale", "Gilbert", "Peoria", "Goodyear", "Avondale", "Surprise"]),
  "chicago|IL|US": ring("US", "IL", ["Chicago", "Evanston", "Oak Park", "Oak Lawn", "Cicero", "Skokie", "Des Plaines", "Park Ridge", "Maywood", "Hinsdale", "Elmhurst", "Schaumburg", "Arlington Heights", "Downers Grove", "Oak Brook", "Naperville", "Joliet", "Rosemont", "Northbrook", "Lombard"]),
  "manchester||GB": ring("GB", null, ["Manchester", "Salford", "Stockport", "Trafford", "Oldham", "Bolton", "Bury", "Rochdale", "Wigan", "Tameside", "Ashton-under-Lyne", "Wythenshawe", "Altrincham", "Warrington", "Stepping Hill", "Macclesfield"]),
  "columbus|OH|US": ring("US", "OH", ["Columbus", "Westerville", "Dublin", "Hilliard", "Grove City", "Gahanna", "Reynoldsburg", "Upper Arlington", "Worthington", "Whitehall", "Bexley", "Obetz", "Groveport"]),
  "atlanta|GA|US": ring("US", "GA", ["Atlanta", "Decatur", "Marietta", "Smyrna", "Sandy Springs", "Dunwoody", "Brookhaven", "East Point", "College Park", "Chamblee", "Tucker", "Doraville", "Roswell", "Alpharetta", "Kennesaw", "Stone Mountain", "Lithonia", "Norcross"]),
  "dallas|TX|US": ring("US", "TX", ["Dallas", "Irving", "Plano", "Garland", "Mesquite", "Richardson", "Carrollton", "Grand Prairie", "Arlington", "Frisco", "Addison", "Lewisville", "Fort Worth", "Rowlett", "DeSoto", "Duncanville"]),
  "new york|NY|US": ring("US", "NY", ["New York", "Manhattan", "Brooklyn", "Queens", "Bronx", "Long Island City", "Jersey City@NJ", "Hoboken@NJ", "Newark@NJ", "Staten Island", "White Plains", "Yonkers"]),
  "charlotte|NC|US": ring("US", "NC", ["Charlotte", "Matthews", "Huntersville", "Concord", "Cornelius", "Mooresville", "Gastonia", "Pineville", "Fort Mill@SC", "Rock Hill@SC", "Mint Hill", "Indian Trail"]),
  "boston|MA|US": ring("US", "MA", ["Boston", "Cambridge", "Somerville", "Brookline", "Newton", "Waltham", "Quincy", "Medford", "Burlington", "Needham", "Woburn", "Watertown", "Lexington", "Chelsea", "Everett"]),
  "denver|CO|US": ring("US", "CO", ["Denver", "Aurora", "Lakewood", "Englewood", "Centennial", "Littleton", "Westminster", "Arvada", "Thornton", "Greenwood Village", "Broomfield", "Golden", "Highlands Ranch", "Lone Tree", "Boulder"]),
  "portland|OR|US": ring("US", "OR", ["Portland", "Beaverton", "Hillsboro", "Lake Oswego", "Tigard", "Gresham", "Vancouver@WA", "Milwaukie", "Tualatin", "Wilsonville", "Oregon City", "Clackamas"]),
  "houston|TX|US": ring("US", "TX", ["Houston", "Pasadena", "Sugar Land", "Katy", "Pearland", "The Woodlands", "Spring", "Humble", "Missouri City", "Stafford", "Bellaire", "Cypress", "Baytown", "League City", "Tomball", "Conroe"]),
  "brisbane|QLD|AU": ring("AU", "QLD", ["Brisbane", "Ipswich", "Logan", "Redcliffe", "Moreton Bay", "Caboolture", "Springwood", "Eagle Farm", "Pinkenba", "Gold Coast", "Toowoomba", "Sunshine Coast", "Redbank", "Acacia Ridge", "Rocklea", "Murarrie", "Brendale", "Yatala", "Narangba", "Wacol"]),
  "philadelphia|PA|US": ring("US", "PA", ["Philadelphia", "Camden@NJ", "Cherry Hill@NJ", "King of Prussia", "Norristown", "Conshohocken", "Bensalem", "Upper Darby", "Media", "Chester", "Bala Cynwyd", "Plymouth Meeting", "Horsham", "Malvern", "Wayne"]),
  "sacramento|CA|US": ring("US", "CA", ["Sacramento", "Elk Grove", "Roseville", "Folsom", "Rancho Cordova", "Citrus Heights", "West Sacramento", "Davis", "Natomas", "Rocklin", "Carmichael", "Antelope", "Woodland", "Lincoln", "Galt"]),
  "raleigh|NC|US": ring("US", "NC", ["Raleigh", "Durham", "Cary", "Apex", "Wake Forest", "Garner", "Morrisville", "Holly Springs", "Fuquay-Varina", "Knightdale", "Chapel Hill", "Research Triangle Park", "Wendell", "Zebulon", "Rolesville", "Wake County"]),
  "minneapolis|MN|US": ring("US", "MN", ["Minneapolis", "St. Paul", "Saint Paul", "Bloomington", "Eden Prairie", "Edina", "Plymouth", "Minnetonka", "St. Louis Park", "Maple Grove", "Eagan", "Roseville", "Brooklyn Park", "Golden Valley", "Richfield"]),
  "san jose|CA|US": ring("US", "CA", ["San Jose", "Santa Clara", "Sunnyvale", "Mountain View", "Palo Alto", "Milpitas", "Cupertino", "Campbell", "Fremont", "Los Gatos", "Menlo Park", "Redwood City"]),
  "pittsburgh|PA|US": ring("US", "PA", ["Pittsburgh", "Cranberry Township", "Canonsburg", "Monroeville", "Wexford", "Bethel Park", "McKeesport", "Coraopolis", "Moon Township", "Sewickley", "Bridgeville", "Carnegie", "Greensburg"]),
  "san diego|CA|US": ring("US", "CA", ["San Diego", "La Jolla", "Carlsbad", "Chula Vista", "Escondido", "Oceanside", "El Cajon", "Poway", "Del Mar", "Encinitas", "National City", "Santee", "San Marcos", "Vista", "Sorrento Valley", "Torrey Pines"]),
};

/** metro_ring's answer for a home, or [] when the bench has no ring for it (the engine then searches the city alone). */
export function ringFor(city: string | null | undefined, region: string | null | undefined, country: string | null | undefined, max = 20): RingPlace[] {
  if (!city || !country) return [];
  const c = city.trim().toLowerCase();
  const cc = country.trim().toUpperCase();
  const r = (region ?? "").trim().toUpperCase();
  const exact = DEV_RINGS[`${c}|${r}|${cc}`];
  if (exact) return exact.slice(0, max);
  // metro_ring's own rule: the region narrows the centre only when given; a ring keyed without a region matches any.
  const loose = Object.entries(DEV_RINGS).filter(([k]) => {
    const [kc, kr, kcc] = k.split("|");
    return kc === c && kcc === cc && (!r || !kr || kr === r || (NAMES[kr] ?? "").toUpperCase() === r);
  });
  return loose.length === 1 ? loose[0][1].slice(0, max) : [];
}
