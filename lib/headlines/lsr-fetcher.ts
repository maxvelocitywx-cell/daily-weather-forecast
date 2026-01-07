/**
 * IEM Local Storm Reports (LSR) Fetcher
 *
 * Fetches real-time storm reports from Iowa Environmental Mesonet.
 * Data includes wind gusts, hail, tornado reports, damage, snowfall, etc.
 *
 * Source: https://mesonet.agron.iastate.edu/geojson/lsr.php
 */

import { EventFact, EventFactType, EventFactConfidence } from './types';

const USER_AGENT = 'maxvelocitywx.com (contact@maxvelocitywx.com)';

// Cache for LSR data (poll no faster than every 2-5 minutes)
interface CacheEntry {
  data: EventFact[];
  fetchedAt: number;
}

let lsrCache: CacheEntry | null = null;
const LSR_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// IEM LSR type codes to our EventFactType mapping
const LSR_TYPE_MAP: Record<string, EventFactType> = {
  // Wind events
  'T': 'wind_gust',          // Thunderstorm wind gust
  'G': 'wind_gust',          // Wind gust (non-tstorm)
  'D': 'wind_gust',          // Wind damage
  'M': 'wind_gust',          // Marine thunderstorm wind
  // Tornado events
  'F': 'tornado_report',     // Funnel cloud
  'N': 'tornado_report',     // Tornado (wall cloud)
  // Hail
  'H': 'hail',               // Hail
  'A': 'hail',               // Large hail
  // Flooding
  'O': 'flash_flood',        // Flash flood
  'R': 'flood',              // Flood
  // Winter weather
  'S': 'snowfall',           // Snow
  'I': 'ice_accumulation',   // Ice storm
  'Z': 'ice_accumulation',   // Freezing rain
  'B': 'snowfall',           // Blizzard
  // Other
  'L': 'lightning',          // Lightning
  'E': 'damage',             // Debris flow
  'U': 'damage',             // Damage
  'C': 'other',              // Dense fog
  'W': 'other',              // Water spout
  'X': 'other',              // Other
};

// States abbreviation to full name
const STATE_NAMES: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
};

interface IEMLSRFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    valid: string;           // ISO timestamp
    type: string;            // LSR type code
    magnitude: number | null;
    unit: string | null;     // MPH, INCH, etc.
    city: string;
    county: string;
    state: string;           // State abbreviation
    source: string;          // Reporter source
    remark: string;
    wfo: string;             // Weather Forecast Office
    typetext: string;        // Human-readable type
    // URL for this specific report
    uri?: string;
  };
}

interface IEMLSRResponse {
  type: 'FeatureCollection';
  features: IEMLSRFeature[];
  generation_time: string;
}

/**
 * Fetch Local Storm Reports from IEM (past 24 hours)
 */
export async function fetchLSRFacts(): Promise<EventFact[]> {
  // Check cache first
  if (lsrCache && Date.now() - lsrCache.fetchedAt < LSR_CACHE_TTL) {
    return lsrCache.data;
  }

  try {
    // IEM LSR GeoJSON endpoint - past 24 hours
    const url = 'https://mesonet.agron.iastate.edu/geojson/lsr.php?inc_ap=no';

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch IEM LSR data: ${response.status}`);
      return lsrCache?.data || [];
    }

    const data: IEMLSRResponse = await response.json();
    const features = data.features || [];

    console.log(`[LSR Fetcher] Retrieved ${features.length} reports`);

    // Convert to EventFacts
    const facts: EventFact[] = [];

    for (const feature of features) {
      const props = feature.properties;
      const coords = feature.geometry?.coordinates;

      if (!coords || !props.valid) continue;

      const eventType = LSR_TYPE_MAP[props.type] || 'other';
      const stateName = STATE_NAMES[props.state] || props.state;

      // Build location name
      let locationName = props.city || 'Unknown';
      if (props.county) {
        locationName = `${locationName}, ${props.county} County`;
      }

      // Determine units based on type
      let units: string | null = null;
      let magnitude: number | string | null = props.magnitude;

      if (props.unit) {
        if (props.unit === 'MPH' || props.unit === 'mph') {
          units = 'mph';
        } else if (props.unit === 'INCH' || props.unit === 'inch' || props.unit === 'IN') {
          units = 'inches';
        } else if (props.unit === 'UNK') {
          units = null;
        } else {
          units = props.unit.toLowerCase();
        }
      }

      // Build source URL - IEM has a per-report URL pattern
      const reportTime = new Date(props.valid);
      const dateStr = reportTime.toISOString().split('T')[0].replace(/-/g, '');
      const sourceUrl = `https://mesonet.agron.iastate.edu/lsr/#${props.wfo}/${dateStr}`;

      facts.push({
        id: `lsr-${props.wfo}-${props.valid}-${coords[0].toFixed(2)}-${coords[1].toFixed(2)}`,
        type: eventType,
        magnitude,
        units,
        location_name: locationName,
        lat: coords[1],
        lon: coords[0],
        state: stateName,
        timestamp_utc: props.valid,
        source_name: `IEM LSR (${props.wfo})`,
        source_url: sourceUrl,
        confidence: 'reported' as EventFactConfidence,
        remarks: props.remark || undefined,
      });
    }

    // Cache the results
    lsrCache = { data: facts, fetchedAt: Date.now() };

    return facts;
  } catch (error) {
    console.error('Error fetching LSR data:', error);
    return lsrCache?.data || [];
  }
}

/**
 * Get significant LSR reports (high-impact events)
 * Filters for tornado reports, significant hail (>=1"), and high winds (>=58 mph)
 */
export async function fetchSignificantLSRFacts(): Promise<EventFact[]> {
  const allFacts = await fetchLSRFacts();

  return allFacts.filter(fact => {
    // Always include tornado reports
    if (fact.type === 'tornado_report') return true;

    // Include significant wind (>=58 kt / ~67 mph for severe threshold, or >= 70 mph)
    if (fact.type === 'wind_gust' && fact.magnitude !== null) {
      const mag = typeof fact.magnitude === 'number' ? fact.magnitude : parseFloat(String(fact.magnitude));
      if (!isNaN(mag) && mag >= 70) return true;
    }

    // Include significant hail (>=1.00")
    if (fact.type === 'hail' && fact.magnitude !== null) {
      const mag = typeof fact.magnitude === 'number' ? fact.magnitude : parseFloat(String(fact.magnitude));
      if (!isNaN(mag) && mag >= 1.0) return true;
    }

    // Include flash flood reports
    if (fact.type === 'flash_flood') return true;

    // Include significant snowfall (>=6")
    if (fact.type === 'snowfall' && fact.magnitude !== null) {
      const mag = typeof fact.magnitude === 'number' ? fact.magnitude : parseFloat(String(fact.magnitude));
      if (!isNaN(mag) && mag >= 6) return true;
    }

    // Include damage reports
    if (fact.type === 'damage') return true;

    return false;
  });
}

/**
 * Clear LSR cache
 */
export function clearLSRCache(): void {
  lsrCache = null;
}
