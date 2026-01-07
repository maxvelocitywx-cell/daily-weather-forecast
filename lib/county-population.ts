import countyData from '@/data/county-population.min.json';

interface CountyInfo {
  population: number;
  name: string;
  state: string;
}

// Type the imported data
const countyPopulation = countyData as Record<string, CountyInfo>;

// State FIPS to abbreviation mapping
const stateFipsToAbbr: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI'
};

const stateAbbrToFips: Record<string, string> = Object.fromEntries(
  Object.entries(stateFipsToAbbr).map(([k, v]) => [v, k])
);

/**
 * Get population for a 5-digit county FIPS code
 */
export function getCountyPopulation(fips: string): number {
  const county = countyPopulation[fips];
  return county?.population ?? 0;
}

/**
 * Get county info for a 5-digit county FIPS code
 */
export function getCountyInfo(fips: string): CountyInfo | null {
  return countyPopulation[fips] ?? null;
}

/**
 * Convert SAME code (6-digit) to 5-digit county FIPS
 * SAME format: SSSCCC where SSS is state (leading 0) and CCC is county
 * Example: "005133" -> "05133" (Crawford County, AR)
 */
export function sameToFips(same: string): string | null {
  if (!same || same.length !== 6) return null;
  // Remove leading zero from state portion
  const statePart = same.slice(0, 3);
  const countyPart = same.slice(3);
  const stateNum = parseInt(statePart, 10);
  if (isNaN(stateNum)) return null;
  return stateNum.toString().padStart(2, '0') + countyPart;
}

/**
 * Convert UGC county code to 5-digit county FIPS
 * UGC format: SSC### where SS is state abbr, C indicates county, ### is county FIPS
 * Example: "TXC201" -> "48201" (Harris County, TX)
 */
export function ugcCountyToFips(ugc: string): string | null {
  if (!ugc || ugc.length !== 6) return null;
  const stateAbbr = ugc.slice(0, 2).toUpperCase();
  const typeChar = ugc[2].toUpperCase();
  const countyNum = ugc.slice(3);

  // Only handle county codes (C), not zones (Z)
  if (typeChar !== 'C') return null;

  const stateFips = stateAbbrToFips[stateAbbr];
  if (!stateFips) return null;

  return stateFips + countyNum;
}

/**
 * Parse geocode from alert properties to get county FIPS codes
 */
export function parseGeocode(geocode: { SAME?: string[]; UGC?: string[] }): string[] {
  const fipsSet = new Set<string>();

  // Parse SAME codes (preferred)
  if (geocode.SAME) {
    for (const same of geocode.SAME) {
      const fips = sameToFips(same);
      if (fips && countyPopulation[fips]) {
        fipsSet.add(fips);
      }
    }
  }

  // Parse UGC county codes
  if (geocode.UGC) {
    for (const ugc of geocode.UGC) {
      const fips = ugcCountyToFips(ugc);
      if (fips && countyPopulation[fips]) {
        fipsSet.add(fips);
      }
    }
  }

  return Array.from(fipsSet);
}

/**
 * Calculate total population for a set of county FIPS codes
 */
export function calculatePopulation(fipsCodes: string[]): {
  total: number;
  byState: Record<string, number>;
  topCounties: Array<{ fips: string; name: string; population: number }>;
} {
  const byState: Record<string, number> = {};
  const counties: Array<{ fips: string; name: string; population: number; state: string }> = [];

  for (const fips of fipsCodes) {
    const info = countyPopulation[fips];
    if (info) {
      const stateAbbr = stateFipsToAbbr[info.state] || info.state;
      byState[stateAbbr] = (byState[stateAbbr] || 0) + info.population;
      counties.push({
        fips,
        name: info.name,
        population: info.population,
        state: stateAbbr
      });
    }
  }

  // Sort by population descending
  counties.sort((a, b) => b.population - a.population);

  const total = counties.reduce((sum, c) => sum + c.population, 0);

  return {
    total,
    byState,
    topCounties: counties.slice(0, 5).map(c => ({
      fips: c.fips,
      name: c.name,
      population: c.population
    }))
  };
}

/**
 * Get state abbreviation from FIPS
 */
export function getStateAbbr(stateFips: string): string {
  return stateFipsToAbbr[stateFips] || stateFips;
}

/**
 * Get unique states from county FIPS codes
 */
export function getStatesFromFips(fipsCodes: string[]): string[] {
  const states = new Set<string>();
  for (const fips of fipsCodes) {
    const stateFips = fips.slice(0, 2);
    const abbr = stateFipsToAbbr[stateFips];
    if (abbr) states.add(abbr);
  }
  return Array.from(states).sort();
}
