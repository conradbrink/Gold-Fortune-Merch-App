/**
 * Where a store actually is.
 *
 * Built against the real 215-row estate, where three things are true and all
 * three will bite an import that trusts the spreadsheet:
 *
 * 1. **The City column is often a postal address, not a location.** Ten stores
 *    in the source file carry "Gaborone" because that is where the group's
 *    Private Bag is — "Sefalana Liquor Serowe" is in Serowe, 250 km away.
 *    So the *branch name* is consulted first, the street address second, and
 *    the City column last. Name won on 141 of 202 resolved rows.
 * 2. **Town names appear as street names.** "Plot 543, New Lobatse Road" is in
 *    Gaborone. Matching "Lobatse" there moves the store 70 km, and it is the
 *    single most dangerous false positive in this data — hence `stripStreets`.
 * 3. **Gaborone suburbs and malls sit in the City column as if they were
 *    towns** (Broadhurst, Phakalane, Bontleng, Game City). They fold into
 *    Gaborone, or a rep's day looks like it spans four towns when it covers
 *    four suburbs.
 *
 * Deliberately a fixed gazetteer rather than a fuzzy match: a store's town
 * drives who visits it and on which day, so a wrong answer is worse than no
 * answer. Anything unmatched is surfaced for a human instead of guessed at.
 */

/** Distinct places a rep would treat as separate destinations. */
const TOWNS = [
  "Gaborone", "Francistown", "Molepolole", "Serowe", "Selebi Phikwe", "Maun",
  "Kanye", "Mahalapye", "Mogoditshane", "Mochudi", "Lobatse", "Palapye",
  "Ramotswa", "Tlokweng", "Letlhakane", "Jwaneng", "Tonota", "Kasane", "Orapa",
  "Moshupa", "Nata", "Gumare", "Shakawe", "Tsabong", "Ghanzi", "Masunga",
  "Tutume", "Gweta", "Pandamatenga", "Kang", "Thamaga", "Gabane", "Kopong",
  "Letlhakeng", "Metsimotlhabe", "Mmopane", "Pilane", "Morwa", "Oodi", "Bokaa",
  "Shoshong", "Pitsane", "Sepopa", "Kazungula", "Tati Siding", "Thebephatswa",
  // Surfaced only after the T/A trading name was extracted — the legal-entity
  // column hid them entirely.
  "Bobonong", "Molapowabojang",
];

/**
 * Spelling variants, and suburbs/malls that are not separate destinations.
 *
 * The misspellings are all present in the real file — `Molopolole`,
 * `Franscistown`, `Gabarone`, `Brodhurst` — and each would otherwise become
 * its own phantom town in the planner's city grouping.
 */
const ALIASES: Record<string, string> = {
  // Misspellings as they actually occur in the source data.
  molopolole: "Molepolole",
  franscistown: "Francistown",
  "f.town": "Francistown",
  ftown: "Francistown",
  gabarone: "Gaborone",
  brodhurst: "Gaborone",
  sepupa: "Sepopa",
  "selibe phikwe": "Selebi Phikwe",
  phikwe: "Selebi Phikwe",
  "thebephatswa air base": "Thebephatswa",
  // A Francistown area, not the separate village of Tati Siding — which stays
  // distinct because longest-match runs the TOWNS list first.
  "tati town": "Francistown",
  "white city": "Francistown",

  // Gaborone suburbs, malls and landmarks.
  gabs: "Gaborone",
  gwest: "Gaborone",
  "g west": "Gaborone",
  "gaborone west": "Gaborone",
  "gaborone north": "Gaborone",
  broadhurst: "Gaborone",
  bontleng: "Gaborone",
  phakalane: "Gaborone",
  "game city": "Gaborone",
  gamecity: "Gaborone",
  fairgrounds: "Gaborone",
  fairground: "Gaborone",
  riverwalk: "Gaborone",
  kgale: "Gaborone",
  "molapo crossing": "Gaborone",
  westgate: "Gaborone",
  northgate: "Gaborone",
  "north gate": "Gaborone",
  "rail park": "Gaborone",
  "main mall": "Gaborone",
  mainmall: "Gaborone",
  setlhoa: "Gaborone",
  nkoyaphiri: "Gaborone",
  mmamashia: "Gaborone",
  maruapula: "Gaborone",
  "maru a pula": "Gaborone",
  "bbs mall": "Gaborone",
  southring: "Gaborone",
  bonnington: "Gaborone",
  middlestar: "Gaborone",
  "glenn valley": "Gaborone",
  "block 3": "Gaborone",
  "block 5": "Gaborone",
  "block 6": "Gaborone",
  "block 8": "Gaborone",

  // Landmarks that belong to a neighbouring village, not to Gaborone.
  "border gate": "Tlokweng",
  hillview: "Mogoditshane",
};

/** Which field the town came from — shown in the preview so it can be judged. */
export type TownSource = "name" | "address" | "city" | null;

export type DerivedTown = {
  town: string | null;
  source: TownSource;
  /**
   * The City column said something different. Almost always a postal address,
   * but it is the manager's call, so it is flagged rather than hidden.
   */
  conflict: boolean;
  /** What the City column resolved to, when it disagrees. */
  columnTown: string | null;
};

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Removes "<word> Road", "<word> Street" and friends.
 *
 * Must run *before* town matching and must remove the whole pair — an earlier
 * version stripped the bare suffix first, which destroyed the very pattern
 * this needs to see and let "New Lobatse Road" keep matching Lobatse.
 */
function stripStreets(text: string): string {
  const suffixes = ["road", "rd", "street", "drive", "way", "highway", "bypass", "avenue"];
  let out = text;
  for (const suffix of suffixes) {
    out = out.replace(new RegExp(` ([a-z]+) ${suffix} `, "g"), " ");
  }
  return out;
}

/** Longest match wins, so "Tati Siding" beats "Tati" and "Selebi Phikwe" holds together. */
const TOWNS_BY_LENGTH = [...TOWNS].sort((a, b) => b.length - a.length);
const ALIASES_BY_LENGTH = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

/** The town named in one field, or null. */
export function findTown(text: string | null | undefined): string | null {
  if (!text) return null;
  const haystack = stripStreets(normalise(text));
  for (const town of TOWNS_BY_LENGTH) {
    if (haystack.includes(` ${town.toLowerCase()} `)) return town;
  }
  for (const alias of ALIASES_BY_LENGTH) {
    if (haystack.includes(` ${alias} `)) return ALIASES[alias];
  }
  return null;
}

/**
 * Resolves a store's town from everything the row offers.
 *
 * Order is the whole point: name, then address, then the City column. See the
 * file header for why the obvious order is the wrong one.
 */
export function deriveTown(
  name: string,
  address: string | null | undefined,
  city: string | null | undefined
): DerivedTown {
  // QuickBooks "Parent:Child" — the child is the branch, and the parent is the
  // chain, which never carries a location.
  const branch = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;

  const fromName = findTown(branch);
  const fromAddress = findTown(address);
  const fromCity = findTown(city);

  const town = fromName ?? fromAddress ?? fromCity;
  const source: TownSource = fromName
    ? "name"
    : fromAddress
      ? "address"
      : fromCity
        ? "city"
        : null;

  return {
    town,
    source,
    conflict: Boolean(fromCity && town && fromCity !== town),
    columnTown: fromCity,
  };
}

/** Every town the gazetteer knows, for the manual-correction dropdown. */
export function knownTowns(): string[] {
  return [...TOWNS].sort((a, b) => a.localeCompare(b));
}
