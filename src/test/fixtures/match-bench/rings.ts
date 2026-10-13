/**
 * THE BENCH'S COMMUTE RINGS, until the GeoNames seed lands.
 *
 * The accuracy prototype wrote a ring of places within about 40 km of each
 * bench city by hand (2026-10-12). Production rings come from geo_places,
 * seeded from GeoNames by scripts/match-bench/build-geo-seed.mjs; that seed is
 * not in the repository yet (the download is an owner step). So the bench
 * seeds geo_places with the prototype's rings: every member sits at its
 * centre's coordinates with a population that falls in the listed order, so
 * the shipped metro_ring returns exactly the hand-written ring. Members across
 * a border carry their own region (Jersey City, NJ in the New York ring;
 * Vancouver, WA in the Portland ring), as GeoNames rows would.
 *
 * Re-run the bench after the seed: its rings are the ones readers get.
 */
export interface BenchRing { center: string; region: string; regionName: string; country: string; lat: number; lon: number; members: Array<string | [string, string, string]> }

export const BENCH_RINGS: BenchRing[] = [
  { center: "Austin", region: "TX", regionName: "Texas", country: "US", lat: 30.2672, lon: -97.7431, members: ["Round Rock", "Cedar Park", "Georgetown", "Pflugerville", "Leander", "San Marcos", "Kyle", "Buda", "Hutto"] },
  { center: "Toronto", region: "ON", regionName: "Ontario", country: "CA", lat: 43.6532, lon: -79.3832, members: ["Mississauga", "Brampton", "Markham", "Vaughan", "Richmond Hill", "Oakville", "North York", "Scarborough", "Etobicoke", "Pickering", "Ajax", "Concord"] },
  { center: "Seattle", region: "WA", regionName: "Washington", country: "US", lat: 47.6062, lon: -122.3321, members: ["Bellevue", "Redmond", "Kirkland", "Bothell", "Renton", "Tukwila", "Kent", "Everett", "Lynnwood", "Issaquah", "Sammamish"] },
  { center: "Phoenix", region: "AZ", regionName: "Arizona", country: "US", lat: 33.4484, lon: -112.074, members: ["Scottsdale", "Tempe", "Mesa", "Chandler", "Glendale", "Gilbert", "Peoria", "Goodyear", "Avondale", "Surprise"] },
  { center: "Chicago", region: "IL", regionName: "Illinois", country: "US", lat: 41.8781, lon: -87.6298, members: ["Evanston", "Oak Park", "Oak Lawn", "Cicero", "Skokie", "Des Plaines", "Park Ridge", "Maywood", "Hinsdale", "Elmhurst", "Schaumburg", "Arlington Heights", "Downers Grove", "Oak Brook", "Naperville", "Joliet", "Rosemont", "Northbrook", "Lombard"] },
  { center: "Manchester", region: "ENG", regionName: "England", country: "GB", lat: 53.4808, lon: -2.2426, members: ["Salford", "Stockport", "Trafford", "Oldham", "Bolton", "Bury", "Rochdale", "Wigan", "Tameside", "Ashton-under-Lyne", "Wythenshawe", "Altrincham", "Warrington", "Stepping Hill", "Macclesfield"] },
  { center: "Columbus", region: "OH", regionName: "Ohio", country: "US", lat: 39.9612, lon: -82.9988, members: ["Westerville", "Dublin", "Hilliard", "Grove City", "Gahanna", "Reynoldsburg", "Upper Arlington", "Worthington", "Whitehall", "Bexley", "Obetz", "Groveport"] },
  { center: "Atlanta", region: "GA", regionName: "Georgia", country: "US", lat: 33.749, lon: -84.388, members: ["Decatur", "Marietta", "Smyrna", "Sandy Springs", "Dunwoody", "Brookhaven", "East Point", "College Park", "Chamblee", "Tucker", "Doraville", "Roswell", "Alpharetta", "Kennesaw", "Stone Mountain", "Lithonia", "Norcross"] },
  { center: "Dallas", region: "TX", regionName: "Texas", country: "US", lat: 32.7767, lon: -96.797, members: ["Irving", "Plano", "Garland", "Mesquite", "Richardson", "Carrollton", "Grand Prairie", "Arlington", "Frisco", "Addison", "Lewisville", "Fort Worth", "Rowlett", "DeSoto", "Duncanville"] },
  { center: "New York", region: "NY", regionName: "New York", country: "US", lat: 40.7128, lon: -74.006, members: ["Manhattan", "Brooklyn", "Queens", "Bronx", "Long Island City", ["Jersey City", "NJ", "New Jersey"], ["Hoboken", "NJ", "New Jersey"], ["Newark", "NJ", "New Jersey"], "Staten Island", "White Plains", "Yonkers"] },
  { center: "Charlotte", region: "NC", regionName: "North Carolina", country: "US", lat: 35.2271, lon: -80.8431, members: ["Matthews", "Huntersville", "Concord", "Cornelius", "Mooresville", "Gastonia", "Pineville", ["Fort Mill", "SC", "South Carolina"], ["Rock Hill", "SC", "South Carolina"], "Mint Hill", "Indian Trail"] },
  { center: "Boston", region: "MA", regionName: "Massachusetts", country: "US", lat: 42.3601, lon: -71.0589, members: ["Cambridge", "Somerville", "Brookline", "Newton", "Waltham", "Quincy", "Medford", "Burlington", "Needham", "Woburn", "Watertown", "Lexington", "Chelsea", "Everett"] },
  { center: "Denver", region: "CO", regionName: "Colorado", country: "US", lat: 39.7392, lon: -104.9903, members: ["Aurora", "Lakewood", "Englewood", "Centennial", "Littleton", "Westminster", "Arvada", "Thornton", "Greenwood Village", "Broomfield", "Golden", "Highlands Ranch", "Lone Tree", "Boulder"] },
  { center: "Portland", region: "OR", regionName: "Oregon", country: "US", lat: 45.5152, lon: -122.6784, members: ["Beaverton", "Hillsboro", "Lake Oswego", "Tigard", "Gresham", ["Vancouver", "WA", "Washington"], "Milwaukie", "Tualatin", "Wilsonville", "Oregon City", "Clackamas"] },
  { center: "Houston", region: "TX", regionName: "Texas", country: "US", lat: 29.7604, lon: -95.3698, members: ["Pasadena", "Sugar Land", "Katy", "Pearland", "The Woodlands", "Spring", "Humble", "Missouri City", "Stafford", "Bellaire", "Cypress", "Baytown", "League City", "Tomball", "Conroe"] },
  { center: "Brisbane", region: "QLD", regionName: "Queensland", country: "AU", lat: -27.4698, lon: 153.0251, members: ["Ipswich", "Logan", "Redcliffe", "Moreton Bay", "Caboolture", "Springwood", "Eagle Farm", "Pinkenba", "Gold Coast", "Toowoomba", "Sunshine Coast", "Redbank", "Acacia Ridge", "Rocklea", "Murarrie", "Brendale", "Yatala", "Narangba", "Wacol"] },
  { center: "Philadelphia", region: "PA", regionName: "Pennsylvania", country: "US", lat: 39.9526, lon: -75.1652, members: [["Camden", "NJ", "New Jersey"], ["Cherry Hill", "NJ", "New Jersey"], "King of Prussia", "Norristown", "Conshohocken", "Bensalem", "Upper Darby", "Media", "Chester", "Bala Cynwyd", "Plymouth Meeting", "Horsham", "Malvern", "Wayne"] },
  { center: "Sacramento", region: "CA", regionName: "California", country: "US", lat: 38.5816, lon: -121.4944, members: ["Elk Grove", "Roseville", "Folsom", "Rancho Cordova", "Citrus Heights", "West Sacramento", "Davis", "Natomas", "Rocklin", "Carmichael", "Antelope", "Woodland", "Lincoln", "Galt"] },
  { center: "Raleigh", region: "NC", regionName: "North Carolina", country: "US", lat: 35.7796, lon: -78.6382, members: ["Durham", "Cary", "Apex", "Wake Forest", "Garner", "Morrisville", "Holly Springs", "Fuquay-Varina", "Knightdale", "Chapel Hill", "Research Triangle Park", "Wendell", "Zebulon", "Rolesville", "Wake County"] },
  { center: "Minneapolis", region: "MN", regionName: "Minnesota", country: "US", lat: 44.9778, lon: -93.265, members: ["St. Paul", "Saint Paul", "Bloomington", "Eden Prairie", "Edina", "Plymouth", "Minnetonka", "St. Louis Park", "Maple Grove", "Eagan", "Roseville", "Brooklyn Park", "Golden Valley", "Richfield"] },
  { center: "San Jose", region: "CA", regionName: "California", country: "US", lat: 37.3382, lon: -121.8863, members: ["Santa Clara", "Sunnyvale", "Mountain View", "Palo Alto", "Milpitas", "Cupertino", "Campbell", "Fremont", "Los Gatos", "Menlo Park", "Redwood City"] },
  { center: "Pittsburgh", region: "PA", regionName: "Pennsylvania", country: "US", lat: 40.4406, lon: -79.9959, members: ["Cranberry Township", "Canonsburg", "Monroeville", "Wexford", "Bethel Park", "McKeesport", "Coraopolis", "Moon Township", "Sewickley", "Bridgeville", "Carnegie", "Greensburg"] },
  { center: "San Diego", region: "CA", regionName: "California", country: "US", lat: 32.7157, lon: -117.1611, members: ["La Jolla", "Carlsbad", "Chula Vista", "Escondido", "Oceanside", "El Cajon", "Poway", "Del Mar", "Encinitas", "National City", "Santee", "San Marcos", "Vista", "Sorrento Valley", "Torrey Pines"] },
];

/** geo_places rows for the bench rings: [name, region, regionName, country, lat, lon, population]. */
export function benchPlaces(): Array<[string, string, string, string, number, number, number]> {
  const out: Array<[string, string, string, string, number, number, number]> = [];
  for (const r of BENCH_RINGS) {
    out.push([r.center, r.region, r.regionName, r.country, r.lat, r.lon, 5_000_000]);
    r.members.forEach((m, i) => {
      const [name, region, regionName] = typeof m === "string" ? [m, r.region, r.regionName] : m;
      out.push([name, region, regionName, r.country, r.lat, r.lon, 1_000_000 - i * 1_000]);
    });
  }
  return out;
}
