// THE BOARD'S CITY TABLE, BY NAME ONLY (connect W1/W3, 2026-11-08).
//
// job-board/normalize.ts holds CITY_COUNTRY, the bare city names its country
// reader and its own query lift (job-board/query-place.ts knownPlace) treat as
// places. agent-mcp reads a query before the board does, so it needs the same
// list of names to decide that "en Madrid" or "à Paris" names a place; it
// cannot import the board's normalizer (a second function's whole module
// graph), so the names are mirrored here. Only the names: a lifted city goes
// to the board's location filter, never to its country filter, because the
// country column is strict equality and a city names no single country.
//
// src/test/a-spanish-french-german-request-keeps-its-place.test.ts reads
// normalize.ts and fails when the two lists differ in either direction.
//
// Pure: no I/O.

/** Every bare city name job-board's CITY_COUNTRY table carries, lower case. */
export const KNOWN_CITIES: ReadonlySet<string> = new Set([
  "aarhus", "aberdeen", "abu dhabi", "abuja", "adelaide", "ahmedabad", "al khobar", "albuquerque",
  "alexandria", "amsterdam", "ankara", "antwerp", "antwerpen", "astana", "atlanta", "auckland", "austin",
  "baltimore", "bandung", "bangalore", "bangkok", "barcelona", "barranquilla", "basel", "beijing", "belfast",
  "belo horizonte", "bengaluru", "bergen", "berlin", "bern", "bilbao", "bogota", "boise", "bologna",
  "bordeaux", "boston", "braga", "brasilia", "bremen", "brighton", "brisbane", "bristol", "brno", "brooklyn",
  "brussels", "bruxelles", "buenos aires", "buffalo", "busan", "cairo", "calgary", "cali", "cambridge",
  "campinas", "canberra", "cape town", "cardiff", "cdmx", "cebu", "cebu city", "chandigarh", "charlotte",
  "chengdu", "chennai", "chiang mai", "chicago", "christchurch", "cincinnati", "ciudad de mexico",
  "cleveland", "coimbatore", "cologne", "columbus", "copenhagen", "cork", "coventry", "curitiba",
  "cyberjaya", "da nang", "dallas", "dammam", "delhi", "den haag", "denver", "des moines", "detroit", "doha",
  "dortmund", "dresden", "dubai", "dublin", "duesseldorf", "durban", "dusseldorf", "edinburgh", "edmonton",
  "eindhoven", "el paso", "espoo", "essen", "firenze", "florence", "fort worth", "fortaleza", "frankfurt",
  "fukuoka", "galway", "gdansk", "geneva", "geneve", "gent", "ghent", "glasgow", "gold coast", "goteborg",
  "gothenburg", "graz", "grenoble", "guadalajara", "guangzhou", "gurgaon", "gurugram", "haifa", "hamburg",
  "hangzhou", "hannover", "hanoi", "helsinki", "heredia", "herzliya", "ho chi minh city", "hong kong",
  "honolulu", "houston", "hsinchu", "hyderabad", "incheon", "indianapolis", "indore", "istanbul", "izmir",
  "jaipur", "jakarta", "jeddah", "jersey city", "jerusalem", "johannesburg", "johor bahru", "kansas city",
  "kaohsiung", "karlsruhe", "katowice", "kobenhavn", "kochi", "koeln", "kolkata", "krakow", "kuala lumpur",
  "kuwait city", "kyoto", "lagos", "las vegas", "lausanne", "leeds", "leicester", "leipzig", "lille", "lima",
  "limerick", "linz", "lisboa", "lisbon", "liverpool", "lodz", "london", "los angeles", "louisville",
  "lucknow", "lyon", "madrid", "makati", "malaga", "malmo", "manama", "manchester", "manila", "mannheim",
  "marseille", "medellin", "melbourne", "memphis", "mexico city", "miami", "milan", "milano",
  "milton keynes", "milwaukee", "minneapolis", "mississauga", "monterrey", "montevideo", "montpellier",
  "montreal", "muenchen", "mumbai", "munich", "muscat", "mysuru", "nagoya", "nagpur", "nairobi", "nanjing",
  "nantes", "naples", "napoli", "nashville", "new delhi", "new york", "new york city", "newark", "nice",
  "noida", "nottingham", "nuernberg", "nuremberg", "nyc", "oklahoma city", "omaha", "orlando", "osaka",
  "oslo", "ottawa", "oxford", "paris", "pasig", "penang", "perth", "petaling jaya", "philadelphia",
  "phoenix", "pittsburgh", "portland", "porto", "porto alegre", "poznan", "prague", "praha", "pretoria",
  "pune", "queretaro", "quezon city", "raleigh", "reading", "recife", "rennes", "rio de janeiro", "riyadh",
  "roma", "rome", "rosario", "rotterdam", "sacramento", "saint louis", "salt lake city", "salzburg",
  "san antonio", "san diego", "san francisco", "sandton", "santiago", "sao paulo", "seattle", "seoul",
  "sevilla", "seville", "shanghai", "sharjah", "sheffield", "shenzhen", "singapore", "southampton",
  "st. louis", "stavanger", "stockholm", "strasbourg", "stuttgart", "surabaya", "suzhou", "sydney", "taguig",
  "taichung", "taipei", "tampa", "tampere", "tel aviv", "the hague", "thiruvananthapuram", "tianjin",
  "tijuana", "tokyo", "torino", "toronto", "tunis", "toulouse", "trondheim", "tucson", "turin", "utrecht",
  "vadodara", "vancouver", "vienna", "warsaw", "warszawa", "washington dc", "wellington", "wien", "winnipeg",
  "wroclaw", "wuhan", "yokohama", "zaragoza", "zuerich", "zurich",
]);
