/**
 * Headlines Data Fetchers
 *
 * Fetches data from NWS, SPC, WPC, NHC, and real-time observation sources
 * to build the facts bundle for headline generation.
 */

import {
  AlertFact,
  SPCFact,
  SPCMDFact,
  EROFact,
  TropicalFact,
  FactsBundle,
  EventFact,
} from './types';
import { fetchLSRFacts, fetchSignificantLSRFacts } from './lsr-fetcher';
import { fetchStationObsFacts } from './station-obs-fetcher';
import { fetchStormEventsFacts } from './storm-events-fetcher';
import { processEventFacts, getFactsSummary } from './facts-normalizer';

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

/**
 * Fetch active NWS alerts and extract key facts
 */
export async function fetchAlertFacts(): Promise<AlertFact[]> {
  const cacheKey = 'alerts';
  const cached = getCached<AlertFact[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch('https://api.weather.gov/alerts/active', {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch NWS alerts:', response.status);
      return [];
    }

    const data = await response.json();
    const features = data.features || [];

    // Group by event type and severity
    const eventGroups: Map<string, {
      severity: string;
      urgency: string;
      headlines: Set<string>;
      areas: Set<string>;
      states: Set<string>;
      population: number;
      sourceUrl: string;
    }> = new Map();

    for (const feature of features) {
      const props = feature.properties;
      if (!props || props.status === 'Cancel') continue;

      const key = `${props.event}-${props.severity}`;

      if (!eventGroups.has(key)) {
        eventGroups.set(key, {
          severity: props.severity || 'Unknown',
          urgency: props.urgency || 'Unknown',
          headlines: new Set(),
          areas: new Set(),
          states: new Set(),
          population: 0,
          sourceUrl: props.id || 'https://alerts.weather.gov/',
        });
      }

      const group = eventGroups.get(key)!;
      if (props.headline) group.headlines.add(props.headline);

      // Parse area description for states
      const areaDesc = props.areaDesc || '';
      group.areas.add(areaDesc.split(';')[0]?.trim() || 'Unknown');

      // Extract state codes from geocode
      const sameCodes = props.geocode?.SAME || [];
      for (const code of sameCodes) {
        if (typeof code === 'string' && code.length >= 5) {
          const stateCode = code.substring(0, 2);
          const stateName = fipsToState(stateCode);
          if (stateName) group.states.add(stateName);
        }
      }
    }

    const facts: AlertFact[] = [];

    for (const [key, group] of eventGroups) {
      const eventName = key.split('-')[0];
      facts.push({
        event: eventName,
        severity: group.severity,
        urgency: group.urgency,
        headline: Array.from(group.headlines)[0] || null,
        areas: Array.from(group.areas).slice(0, 5),
        states: Array.from(group.states),
        population: group.population,
        source_url: group.sourceUrl,
      });
    }

    // Sort by severity
    const severityOrder = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    facts.sort((a, b) =>
      (severityOrder[a.severity as keyof typeof severityOrder] || 4) -
      (severityOrder[b.severity as keyof typeof severityOrder] || 4)
    );

    const result = facts.slice(0, 20); // Top 20 alert types
    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return [];
  }
}

/**
 * Fetch SPC convective outlooks (Days 1-3)
 */
export async function fetchSPCFacts(): Promise<SPCFact[]> {
  const cacheKey = 'spc';
  const cached = getCached<SPCFact[]>(cacheKey);
  if (cached) return cached;

  const facts: SPCFact[] = [];
  const categoryOrder = ['HIGH', 'MDT', 'ENH', 'SLGT', 'MRGL', 'TSTM'];

  for (const day of [1, 2, 3] as const) {
    try {
      const url = `https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.lyr.geojson`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const features = data.features || [];

      if (features.length === 0) continue;

      // Find max category
      let maxCategory = 'NONE';
      const areas: Set<string> = new Set();

      for (const feature of features) {
        const label = feature.properties?.LABEL || feature.properties?.LABEL2 || '';
        if (categoryOrder.includes(label)) {
          if (categoryOrder.indexOf(label) < categoryOrder.indexOf(maxCategory) || maxCategory === 'NONE') {
            maxCategory = label;
          }
          areas.add(label);
        }
      }

      if (maxCategory !== 'NONE') {
        facts.push({
          day,
          max_category: maxCategory,
          categorical_areas: Array.from(areas),
          source_url: `https://www.spc.noaa.gov/products/outlook/day${day}otlk.html`,
        });
      }
    } catch (error) {
      console.error(`Error fetching SPC Day ${day}:`, error);
    }
  }

  setCache(cacheKey, facts);
  return facts;
}

/**
 * Fetch SPC Mesoscale Discussions
 */
export async function fetchSPCMDFacts(): Promise<SPCMDFact[]> {
  const cacheKey = 'spc-mds';
  const cached = getCached<SPCMDFact[]>(cacheKey);
  if (cached) return cached;

  const facts: SPCMDFact[] = [];

  try {
    // Fetch MD list from SPC
    const url = 'https://www.spc.noaa.gov/products/md/';
    const response = await fetch(url);

    if (!response.ok) return facts;

    const html = await response.text();

    // Parse for active MDs (basic regex parsing)
    const mdMatches = html.match(/md\d{4}\.html/g) || [];
    const uniqueMds = [...new Set(mdMatches)].slice(0, 5);

    for (const mdFile of uniqueMds) {
      const mdNumber = mdFile.replace('md', '').replace('.html', '');
      facts.push({
        md_number: mdNumber,
        concern: 'Severe thunderstorm potential',
        areas: ['See product for details'],
        valid_time: 'Next few hours',
        source_url: `https://www.spc.noaa.gov/products/md/md${mdNumber}.html`,
      });
    }
  } catch (error) {
    console.error('Error fetching SPC MDs:', error);
  }

  setCache(cacheKey, facts);
  return facts;
}

/**
 * Fetch WPC Excessive Rainfall Outlook (Days 1-3)
 */
export async function fetchEROFacts(): Promise<EROFact[]> {
  const cacheKey = 'ero';
  const cached = getCached<EROFact[]>(cacheKey);
  if (cached) return cached;

  const facts: EROFact[] = [];
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
      const areas: Set<string> = new Set();

      for (const feature of features) {
        const label = (feature.properties?.LABEL || feature.properties?.CAT || '').toUpperCase();
        if (categoryOrder.includes(label)) {
          if (categoryOrder.indexOf(label) < categoryOrder.indexOf(maxCategory) || maxCategory === 'NONE') {
            maxCategory = label;
          }
          areas.add(label);
        }
      }

      if (maxCategory !== 'NONE') {
        facts.push({
          day,
          max_category: maxCategory,
          areas: Array.from(areas),
          source_url: `https://www.wpc.ncep.noaa.gov/qpf/ero.php`,
        });
      }
    } catch (error) {
      console.error(`Error fetching ERO Day ${day}:`, error);
    }
  }

  setCache(cacheKey, facts);
  return facts;
}

/**
 * Fetch NHC tropical products
 */
export async function fetchTropicalFacts(): Promise<TropicalFact[]> {
  const cacheKey = 'tropical';
  const cached = getCached<TropicalFact[]>(cacheKey);
  if (cached) return cached;

  const facts: TropicalFact[] = [];

  try {
    // Fetch active storms from NHC
    const urls = [
      'https://www.nhc.noaa.gov/CurrentStorms.json',
      'https://www.nhc.noaa.gov/productexamples/NHC_JSON_Sample.json',
    ];

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) continue;

        const data = await response.json();
        const storms = data.activeStorms || [];

        for (const storm of storms) {
          if (storm.basin === 'at' || storm.basin === 'ep' || storm.basin === 'cp') {
            facts.push({
              system_name: storm.name || 'Unnamed',
              classification: storm.classification || 'Tropical System',
              max_wind: storm.intensity || 0,
              movement: storm.movement || 'Unknown',
              threat_areas: storm.threatenedAreas || ['Gulf Coast', 'Atlantic Coast'],
              source_url: `https://www.nhc.noaa.gov/`,
            });
          }
        }

        if (facts.length > 0) break;
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.error('Error fetching tropical data:', error);
  }

  setCache(cacheKey, facts);
  return facts;
}

/**
 * Fetch all real-time event facts (LSR, station obs, storm events)
 */
export async function fetchAllEventFacts(): Promise<EventFact[]> {
  const cacheKey = 'event-facts';
  const cached = getCached<EventFact[]>(cacheKey);
  if (cached) return cached;

  console.log('[Fetchers] Fetching real-time event facts...');

  // Fetch from all sources in parallel
  const [lsrFacts, stationFacts, stormEventsFacts] = await Promise.all([
    fetchSignificantLSRFacts(),
    fetchStationObsFacts(),
    fetchStormEventsFacts(),
  ]);

  // Process and normalize
  const processedFacts = processEventFacts(lsrFacts, stationFacts, stormEventsFacts);

  // Cache the results
  setCache(cacheKey, processedFacts);

  return processedFacts;
}

/**
 * Build the complete facts bundle for headline generation
 */
export async function buildFactsBundle(): Promise<FactsBundle> {
  console.log('[Fetchers] Building facts bundle...');

  // Fetch all data sources in parallel
  const [alerts, spcOutlooks, spcMds, eroOutlooks, tropical, eventFacts] = await Promise.all([
    fetchAlertFacts(),
    fetchSPCFacts(),
    fetchSPCMDFacts(),
    fetchEROFacts(),
    fetchTropicalFacts(),
    fetchAllEventFacts(),
  ]);

  // Count unique event types
  const topEvents = alerts
    .slice(0, 10)
    .map(a => a.event)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const bundle: FactsBundle = {
    generated_at: new Date().toISOString(),
    event_facts: eventFacts,
    alerts,
    spc_outlooks: spcOutlooks,
    spc_mds: spcMds,
    ero_outlooks: eroOutlooks,
    tropical,
    total_active_alerts: alerts.length,
    total_event_facts: eventFacts.length,
    top_events: topEvents,
  };

  console.log(`[Fetchers] Bundle complete:`);
  console.log(`  - Alerts: ${alerts.length}`);
  console.log(`  - Event Facts: ${eventFacts.length} (${getFactsSummary(eventFacts)})`);
  console.log(`  - SPC Outlooks: ${spcOutlooks.length}`);
  console.log(`  - SPC MDs: ${spcMds.length}`);
  console.log(`  - ERO: ${eroOutlooks.length}`);
  console.log(`  - Tropical: ${tropical.length}`);

  return bundle;
}

/**
 * Convert FIPS state code to state name
 */
function fipsToState(code: string): string | null {
  const fipsMap: Record<string, string> = {
    '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas',
    '06': 'California', '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware',
    '11': 'DC', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii',
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
  return fipsMap[code] || null;
}

/**
 * Clear all caches (for testing)
 */
export function clearHeadlinesCaches(): void {
  cache.clear();
}
