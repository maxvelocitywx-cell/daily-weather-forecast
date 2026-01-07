/**
 * Verified Facts Fetchers
 *
 * Fetches data from NWS, IEM, and station observations, producing
 * strictly validated VerifiedFact objects. Every fact has:
 * - A unique ID
 * - Required source tracking (source_name, source_url)
 * - Validated location with state/place
 * - Proper confidence label based on source type
 *
 * VALIDATION RULES:
 * - "Measured" ONLY for station observations with station_id
 * - "Reported" for LSR data
 * - "High"/"Medium" for NWS alerts and outlooks
 * - All numeric values must come directly from source data
 * - Geographic data must match station metadata where applicable
 */

import {
  VerifiedFact,
  FactSource,
  ConfidenceLabel,
  FactsBundle,
  STATION_METADATA,
} from './types';

const USER_AGENT = 'maxvelocitywx.com (contact@maxvelocitywx.com)';

// Cache to avoid hammering endpoints
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache: Map<string, CacheEntry<unknown>> = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) {
    return entry.data as T;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

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

// FIPS to state name
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas',
  '06': 'California', '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware',
  '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii',
  '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa',
  '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana', '23': 'Maine',
  '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota',
  '28': 'Mississippi', '29': 'Missouri', '30': 'Montana', '31': 'Nebraska',
  '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey', '35': 'New Mexico',
  '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio',
  '40': 'Oklahoma', '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island',
  '45': 'South Carolina', '46': 'South Dakota', '47': 'Tennessee', '48': 'Texas',
  '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington',
  '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming',
};

const STATE_ABBREVS: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([abbrev, name]) => [name, abbrev])
);

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a VerifiedFact has all required fields
 */
function validateFact(fact: Partial<VerifiedFact>): ValidationResult {
  if (!fact.id) return { valid: false, reason: 'Missing id' };
  if (!fact.source) return { valid: false, reason: 'Missing source' };
  if (!fact.source_name) return { valid: false, reason: 'Missing source_name' };
  if (!fact.source_url) return { valid: false, reason: 'Missing source_url' };
  if (!fact.event_type) return { valid: false, reason: 'Missing event_type' };
  if (!fact.timestamp_utc) return { valid: false, reason: 'Missing timestamp_utc' };
  if (!fact.confidence) return { valid: false, reason: 'Missing confidence' };

  // Validate location
  if (!fact.location) return { valid: false, reason: 'Missing location' };
  if (!fact.location.state) return { valid: false, reason: 'Missing location.state' };
  if (!fact.location.state_abbrev) return { valid: false, reason: 'Missing location.state_abbrev' };
  if (!fact.location.place) return { valid: false, reason: 'Missing location.place' };

  // "Measured" confidence requires station_id
  if (fact.confidence === 'Measured' && !fact.station_id) {
    return { valid: false, reason: 'Measured confidence requires station_id' };
  }

  // If station_id is present, verify it matches our metadata
  if (fact.station_id && STATION_METADATA[fact.station_id]) {
    const meta = STATION_METADATA[fact.station_id];
    if (fact.location.state !== meta.state) {
      return {
        valid: false,
        reason: `Station ${fact.station_id} state mismatch: ${fact.location.state} vs ${meta.state}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Generate a unique fact ID
 */
function generateFactId(source: FactSource, suffix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${source}-${suffix}-${timestamp}-${random}`;
}

// ============================================================================
// NWS ALERTS FETCHER
// ============================================================================

interface NWSAlertProperties {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  status: string;
  headline: string | null;
  description: string;
  areaDesc: string;
  senderName: string;
  onset: string;
  expires: string;
  geocode?: {
    SAME?: string[];
    UGC?: string[];
  };
}

interface NWSAlertFeature {
  properties: NWSAlertProperties;
  geometry: {
    type: string;
    coordinates?: number[] | number[][] | number[][][];
  } | null;
}

/**
 * Fetch active NWS alerts and convert to VerifiedFacts
 */
export async function fetchAlertFacts(): Promise<VerifiedFact[]> {
  const cacheKey = 'verified-alerts';
  const cached = getCached<VerifiedFact[]>(cacheKey);
  if (cached) return cached;

  const rejectionReasons: string[] = [];

  try {
    const response = await fetch('https://api.weather.gov/alerts/active', {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      console.error('[Verified Fetcher] Failed to fetch NWS alerts:', response.status);
      return [];
    }

    const data = await response.json();
    const features: NWSAlertFeature[] = data.features || [];

    const facts: VerifiedFact[] = [];

    for (const feature of features) {
      const props = feature.properties;
      if (!props || props.status === 'Cancel') continue;

      // Extract state from areaDesc or geocode
      let state = '';
      let stateAbbrev = '';
      const sameCodes = props.geocode?.SAME || [];

      for (const code of sameCodes) {
        if (typeof code === 'string' && code.length >= 5) {
          const fipsCode = code.substring(0, 2);
          const stateName = FIPS_TO_STATE[fipsCode];
          if (stateName) {
            state = stateName;
            stateAbbrev = STATE_ABBREVS[stateName] || '';
            break;
          }
        }
      }

      // Fallback: parse from areaDesc (e.g., "Harris; Fort Bend; TX")
      if (!state && props.areaDesc) {
        const parts = props.areaDesc.split(';').map(p => p.trim());
        for (const part of parts) {
          if (STATE_NAMES[part]) {
            state = STATE_NAMES[part];
            stateAbbrev = part;
            break;
          }
        }
      }

      if (!state) {
        rejectionReasons.push(`Alert ${props.id}: Could not determine state`);
        continue;
      }

      // Extract place from areaDesc
      const areaDescParts = props.areaDesc.split(';').map(p => p.trim());
      const place = areaDescParts[0] || 'Multiple areas';

      // Determine confidence based on alert type
      let confidence: ConfidenceLabel = 'High';
      if (props.certainty === 'Possible' || props.urgency === 'Future') {
        confidence = 'Medium';
      }

      const fact: VerifiedFact = {
        id: generateFactId('nws_alert', props.id.split('/').pop() || 'unknown'),
        source: 'nws_alert',
        source_name: props.senderName || 'NWS',
        source_url: props.id,
        confidence,
        event_type: props.event,
        location: {
          state,
          state_abbrev: stateAbbrev,
          place,
        },
        timestamp_utc: props.onset || new Date().toISOString(),
        alert_id: props.id,
        sender_name: props.senderName,
        area_desc: props.areaDesc,
        raw_excerpt: props.headline || undefined,
      };

      const validation = validateFact(fact);
      if (validation.valid) {
        facts.push(fact);
      } else {
        rejectionReasons.push(`Alert ${props.id}: ${validation.reason}`);
      }
    }

    console.log(`[Verified Fetcher] Alerts: ${facts.length} valid, ${rejectionReasons.length} rejected`);
    if (rejectionReasons.length > 0) {
      console.log('[Verified Fetcher] Alert rejection samples:', rejectionReasons.slice(0, 3));
    }

    setCache(cacheKey, facts);
    return facts;
  } catch (error) {
    console.error('[Verified Fetcher] Error fetching alerts:', error);
    return [];
  }
}

// ============================================================================
// IEM LSR FETCHER
// ============================================================================

interface IEMLSRProperties {
  valid: string;
  type: string;
  magnitude: number | null;
  unit: string | null;
  city: string;
  county: string;
  state: string;
  source: string;
  remark: string;
  wfo: string;
  typetext: string;
}

interface IEMLSRFeature {
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: IEMLSRProperties;
}

// LSR type to event_type mapping
const LSR_EVENT_TYPES: Record<string, string> = {
  'T': 'Thunderstorm Wind Gust',
  'G': 'Wind Gust',
  'D': 'Wind Damage',
  'M': 'Marine Thunderstorm Wind',
  'F': 'Funnel Cloud',
  'N': 'Tornado',
  'H': 'Hail',
  'A': 'Large Hail',
  'O': 'Flash Flood',
  'R': 'Flood',
  'S': 'Snow',
  'I': 'Ice Storm',
  'Z': 'Freezing Rain',
  'B': 'Blizzard',
  'L': 'Lightning',
  'E': 'Debris Flow',
  'U': 'Damage',
};

/**
 * Fetch Local Storm Reports from IEM and convert to VerifiedFacts
 */
export async function fetchLSRFacts(): Promise<VerifiedFact[]> {
  const cacheKey = 'verified-lsr';
  const cached = getCached<VerifiedFact[]>(cacheKey);
  if (cached) return cached;

  const rejectionReasons: string[] = [];

  try {
    const url = 'https://mesonet.agron.iastate.edu/geojson/lsr.php?inc_ap=no';
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      console.error('[Verified Fetcher] Failed to fetch LSR:', response.status);
      return [];
    }

    const data = await response.json();
    const features: IEMLSRFeature[] = data.features || [];

    const facts: VerifiedFact[] = [];

    for (const feature of features) {
      const props = feature.properties;
      const coords = feature.geometry?.coordinates;

      if (!coords || !props.valid) {
        rejectionReasons.push('LSR: Missing coordinates or timestamp');
        continue;
      }

      const stateAbbrev = props.state;
      const state = STATE_NAMES[stateAbbrev];
      if (!state) {
        rejectionReasons.push(`LSR: Unknown state ${stateAbbrev}`);
        continue;
      }

      const eventType = LSR_EVENT_TYPES[props.type] || props.typetext || 'Unknown';

      // Build place name
      let place = props.city || 'Unknown';
      if (props.county) {
        place = `${place}, ${props.county} County`;
      }

      // Build source URL
      const reportTime = new Date(props.valid);
      const dateStr = reportTime.toISOString().split('T')[0].replace(/-/g, '');
      const sourceUrl = `https://mesonet.agron.iastate.edu/lsr/#${props.wfo}/${dateStr}`;

      // Determine units
      let units: string | undefined;
      if (props.unit) {
        if (props.unit === 'MPH' || props.unit === 'mph') units = 'mph';
        else if (props.unit === 'INCH' || props.unit === 'inch' || props.unit === 'IN') units = 'inches';
        else if (props.unit !== 'UNK') units = props.unit.toLowerCase();
      }

      const fact: VerifiedFact = {
        id: generateFactId('lsr', `${props.wfo}-${coords[0].toFixed(2)}-${coords[1].toFixed(2)}`),
        source: 'lsr',
        source_name: `IEM LSR (${props.wfo})`,
        source_url: sourceUrl,
        confidence: 'Reported',
        event_type: eventType,
        magnitude: props.magnitude !== null ? props.magnitude : undefined,
        units,
        location: {
          state,
          state_abbrev: stateAbbrev,
          place,
          lat: coords[1],
          lon: coords[0],
        },
        timestamp_utc: props.valid,
        raw_excerpt: props.remark || undefined,
      };

      const validation = validateFact(fact);
      if (validation.valid) {
        facts.push(fact);
      } else {
        rejectionReasons.push(`LSR ${props.wfo}: ${validation.reason}`);
      }
    }

    console.log(`[Verified Fetcher] LSR: ${facts.length} valid, ${rejectionReasons.length} rejected`);

    setCache(cacheKey, facts);
    return facts;
  } catch (error) {
    console.error('[Verified Fetcher] Error fetching LSR:', error);
    return [];
  }
}

/**
 * Get significant LSR reports (high-impact events only)
 */
export async function fetchSignificantLSRFacts(): Promise<VerifiedFact[]> {
  const allFacts = await fetchLSRFacts();

  return allFacts.filter(fact => {
    const eventLower = fact.event_type.toLowerCase();

    // Always include tornado reports
    if (eventLower.includes('tornado') || eventLower.includes('funnel')) return true;

    // Include significant wind (>=70 mph)
    if (eventLower.includes('wind') && fact.magnitude !== undefined) {
      if (fact.magnitude >= 70) return true;
    }

    // Include significant hail (>=1.00")
    if (eventLower.includes('hail') && fact.magnitude !== undefined) {
      if (fact.magnitude >= 1.0) return true;
    }

    // Include flash flood reports
    if (eventLower.includes('flash flood')) return true;

    // Include significant snowfall (>=6")
    if (eventLower.includes('snow') && fact.magnitude !== undefined) {
      if (fact.magnitude >= 6) return true;
    }

    // Include damage reports
    if (eventLower.includes('damage')) return true;

    return false;
  });
}

// ============================================================================
// STATION OBSERVATIONS FETCHER
// ============================================================================

interface NWSObservationProperties {
  timestamp: string;
  rawMessage: string;
  textDescription: string;
  temperature: { value: number | null; unitCode: string };
  windSpeed: { value: number | null; unitCode: string };
  windGust: { value: number | null; unitCode: string };
  heatIndex: { value: number | null; unitCode: string };
  windChill: { value: number | null; unitCode: string };
}

interface NWSObservation {
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: NWSObservationProperties;
}

function cToF(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

function msToMph(ms: number): number {
  return Math.round(ms * 2.237);
}

/**
 * Fetch a single station observation
 */
async function fetchStationObs(stationId: string): Promise<NWSObservation | null> {
  try {
    const url = `https://api.weather.gov/stations/${stationId}/observations/latest`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetch station observations and convert to VerifiedFacts
 * ONLY produces "Measured" confidence facts with station_id
 */
export async function fetchStationObsFacts(): Promise<VerifiedFact[]> {
  const cacheKey = 'verified-station-obs';
  const cached = getCached<VerifiedFact[]>(cacheKey);
  if (cached) return cached;

  const facts: VerifiedFact[] = [];
  const rejectionReasons: string[] = [];

  // Only fetch from stations in our verified metadata
  const stationIds = Object.keys(STATION_METADATA);

  // Batch requests
  const batchSize = 10;
  for (let i = 0; i < stationIds.length; i += batchSize) {
    const batch = stationIds.slice(i, i + batchSize);

    const promises = batch.map(async (stationId) => {
      const obs = await fetchStationObs(stationId);
      if (!obs?.properties?.timestamp) return [];

      const meta = STATION_METADATA[stationId];
      const props = obs.properties;
      const coords = obs.geometry?.coordinates;

      if (!coords) return [];

      const extractedFacts: VerifiedFact[] = [];

      // Check for significant wind gusts (>=50 mph)
      if (props.windGust?.value !== null && props.windGust?.value !== undefined) {
        const gustMph = msToMph(props.windGust.value);
        if (gustMph >= 50) {
          const fact: VerifiedFact = {
            id: generateFactId('station_obs', `${stationId}-gust`),
            source: 'station_obs',
            source_name: `NWS ASOS (${stationId})`,
            source_url: `https://api.weather.gov/stations/${stationId}/observations/latest`,
            confidence: 'Measured',
            event_type: 'Wind Gust',
            magnitude: gustMph,
            units: 'mph',
            location: {
              state: meta.state,
              state_abbrev: meta.state_abbrev,
              place: meta.city,
              lat: meta.lat,
              lon: meta.lon,
            },
            timestamp_utc: props.timestamp,
            station_id: stationId,
            raw_excerpt: props.rawMessage || undefined,
          };

          const validation = validateFact(fact);
          if (validation.valid) {
            extractedFacts.push(fact);
          } else {
            rejectionReasons.push(`Station ${stationId} gust: ${validation.reason}`);
          }
        }
      }

      // Check for extreme heat (heat index >= 105°F)
      if (props.heatIndex?.value !== null && props.heatIndex?.value !== undefined) {
        const heatIndexF = cToF(props.heatIndex.value);
        if (heatIndexF >= 105) {
          const fact: VerifiedFact = {
            id: generateFactId('station_obs', `${stationId}-heat`),
            source: 'station_obs',
            source_name: `NWS ASOS (${stationId})`,
            source_url: `https://api.weather.gov/stations/${stationId}/observations/latest`,
            confidence: 'Measured',
            event_type: 'Extreme Heat Index',
            magnitude: heatIndexF,
            units: '°F',
            location: {
              state: meta.state,
              state_abbrev: meta.state_abbrev,
              place: meta.city,
              lat: meta.lat,
              lon: meta.lon,
            },
            timestamp_utc: props.timestamp,
            station_id: stationId,
            raw_excerpt: `Heat index: ${heatIndexF}°F`,
          };

          const validation = validateFact(fact);
          if (validation.valid) {
            extractedFacts.push(fact);
          } else {
            rejectionReasons.push(`Station ${stationId} heat: ${validation.reason}`);
          }
        }
      }

      // Check for extreme cold (wind chill <= -20°F)
      if (props.windChill?.value !== null && props.windChill?.value !== undefined) {
        const windChillF = cToF(props.windChill.value);
        if (windChillF <= -20) {
          const fact: VerifiedFact = {
            id: generateFactId('station_obs', `${stationId}-cold`),
            source: 'station_obs',
            source_name: `NWS ASOS (${stationId})`,
            source_url: `https://api.weather.gov/stations/${stationId}/observations/latest`,
            confidence: 'Measured',
            event_type: 'Extreme Wind Chill',
            magnitude: windChillF,
            units: '°F',
            location: {
              state: meta.state,
              state_abbrev: meta.state_abbrev,
              place: meta.city,
              lat: meta.lat,
              lon: meta.lon,
            },
            timestamp_utc: props.timestamp,
            station_id: stationId,
            raw_excerpt: `Wind chill: ${windChillF}°F`,
          };

          const validation = validateFact(fact);
          if (validation.valid) {
            extractedFacts.push(fact);
          } else {
            rejectionReasons.push(`Station ${stationId} cold: ${validation.reason}`);
          }
        }
      }

      return extractedFacts;
    });

    const results = await Promise.all(promises);
    for (const result of results) {
      facts.push(...result);
    }
  }

  console.log(`[Verified Fetcher] Station Obs: ${facts.length} valid, ${rejectionReasons.length} rejected`);

  setCache(cacheKey, facts);
  return facts;
}

// ============================================================================
// SPC OUTLOOK FETCHER
// ============================================================================

interface SPCFeatureProperties {
  LABEL?: string;
  LABEL2?: string;
}

interface SPCFeature {
  properties: SPCFeatureProperties;
}

/**
 * Fetch SPC convective outlooks and convert to VerifiedFacts
 */
export async function fetchSPCFacts(): Promise<VerifiedFact[]> {
  const cacheKey = 'verified-spc';
  const cached = getCached<VerifiedFact[]>(cacheKey);
  if (cached) return cached;

  const facts: VerifiedFact[] = [];
  const categoryOrder = ['HIGH', 'MDT', 'ENH', 'SLGT', 'MRGL', 'TSTM'];

  for (const day of [1, 2, 3] as const) {
    try {
      const url = `https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.lyr.geojson`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const features: SPCFeature[] = data.features || [];

      if (features.length === 0) continue;

      // Find max category
      let maxCategory = 'NONE';
      for (const feature of features) {
        const label = feature.properties?.LABEL || feature.properties?.LABEL2 || '';
        if (categoryOrder.includes(label)) {
          if (categoryOrder.indexOf(label) < categoryOrder.indexOf(maxCategory) || maxCategory === 'NONE') {
            maxCategory = label;
          }
        }
      }

      if (maxCategory !== 'NONE' && maxCategory !== 'TSTM') {
        const fact: VerifiedFact = {
          id: generateFactId('spc_outlook', `day${day}-${maxCategory}`),
          source: 'spc_outlook',
          source_name: 'Storm Prediction Center',
          source_url: `https://www.spc.noaa.gov/products/outlook/day${day}otlk.html`,
          confidence: 'Medium',
          event_type: `Day ${day} Convective Outlook`,
          location: {
            state: 'Multiple States',
            state_abbrev: 'US',
            place: `${maxCategory} Risk Area`,
          },
          timestamp_utc: new Date().toISOString(),
          raw_excerpt: `Maximum categorical risk: ${maxCategory}`,
        };

        const validation = validateFact(fact);
        if (validation.valid) {
          facts.push(fact);
        }
      }
    } catch (error) {
      console.error(`[Verified Fetcher] Error fetching SPC Day ${day}:`, error);
    }
  }

  setCache(cacheKey, facts);
  return facts;
}

// ============================================================================
// WPC ERO FETCHER
// ============================================================================

/**
 * Fetch WPC Excessive Rainfall Outlooks and convert to VerifiedFacts
 */
export async function fetchEROFacts(): Promise<VerifiedFact[]> {
  const cacheKey = 'verified-ero';
  const cached = getCached<VerifiedFact[]>(cacheKey);
  if (cached) return cached;

  const facts: VerifiedFact[] = [];
  const categoryOrder = ['HIGH', 'MDT', 'SLGT', 'MRGL'];

  for (const day of [1, 2, 3] as const) {
    try {
      const url = `https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero_${day}.geojson`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const features = data.features || [];

      if (features.length === 0) continue;

      // Find max category
      let maxCategory = 'NONE';
      for (const feature of features) {
        const label = (feature.properties?.LABEL || feature.properties?.CAT || '').toUpperCase();
        if (categoryOrder.includes(label)) {
          if (categoryOrder.indexOf(label) < categoryOrder.indexOf(maxCategory) || maxCategory === 'NONE') {
            maxCategory = label;
          }
        }
      }

      if (maxCategory !== 'NONE') {
        const fact: VerifiedFact = {
          id: generateFactId('wpc_ero', `day${day}-${maxCategory}`),
          source: 'wpc_ero',
          source_name: 'Weather Prediction Center',
          source_url: 'https://www.wpc.ncep.noaa.gov/qpf/ero.php',
          confidence: 'Medium',
          event_type: `Day ${day} Excessive Rainfall Outlook`,
          location: {
            state: 'Multiple States',
            state_abbrev: 'US',
            place: `${maxCategory} Risk Area`,
          },
          timestamp_utc: new Date().toISOString(),
          raw_excerpt: `Maximum risk: ${maxCategory}`,
        };

        const validation = validateFact(fact);
        if (validation.valid) {
          facts.push(fact);
        }
      }
    } catch (error) {
      console.error(`[Verified Fetcher] Error fetching ERO Day ${day}:`, error);
    }
  }

  setCache(cacheKey, facts);
  return facts;
}

// ============================================================================
// FACTS BUNDLE BUILDER
// ============================================================================

/**
 * Build a complete FactsBundle with validation statistics
 */
export async function buildVerifiedFactsBundle(): Promise<FactsBundle> {
  console.log('[Verified Fetcher] Building verified facts bundle...');

  const startTime = Date.now();

  // Fetch all sources in parallel
  const [alertFacts, lsrFacts, stationFacts, spcFacts, eroFacts] = await Promise.all([
    fetchAlertFacts(),
    fetchSignificantLSRFacts(),
    fetchStationObsFacts(),
    fetchSPCFacts(),
    fetchEROFacts(),
  ]);

  // Combine all facts
  const allFacts = [...alertFacts, ...lsrFacts, ...stationFacts, ...spcFacts, ...eroFacts];

  // Create fact_ids Set for validation lookup
  const factIds = new Set(allFacts.map(f => f.id));

  const bundle: FactsBundle = {
    generated_at: new Date().toISOString(),
    facts: allFacts,
    fact_ids: factIds,
    counts: {
      alerts: alertFacts.length,
      lsr: lsrFacts.length,
      station_obs: stationFacts.length,
      spc: spcFacts.length,
      wpc: eroFacts.length,
      nhc: 0, // TODO: Add NHC tropical fetcher
    },
    validation: {
      total_fetched: allFacts.length,
      passed: allFacts.length,
      rejected: 0, // Rejections happen during fetch, not post-bundle
      rejection_reasons: [],
    },
  };

  const elapsed = Date.now() - startTime;
  console.log(`[Verified Fetcher] Bundle complete in ${elapsed}ms:`);
  console.log(`  - Alerts: ${alertFacts.length}`);
  console.log(`  - LSR: ${lsrFacts.length}`);
  console.log(`  - Station Obs: ${stationFacts.length}`);
  console.log(`  - SPC: ${spcFacts.length}`);
  console.log(`  - ERO: ${eroFacts.length}`);
  console.log(`  - Total: ${allFacts.length}`);

  return bundle;
}

/**
 * Clear all verified fact caches
 */
export function clearVerifiedCaches(): void {
  cache.clear();
}
