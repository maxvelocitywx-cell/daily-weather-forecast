/**
 * NWS Station Observations Fetcher
 *
 * Fetches latest observations from NWS stations to get MEASURED
 * wind gusts, temperatures, and other conditions.
 *
 * Source: https://api.weather.gov/stations/{ID}/observations/latest
 */

import { EventFact, EventFactType } from './types';

const USER_AGENT = 'maxvelocitywx.com (contact@maxvelocitywx.com)';

// Cache for station observations
interface CacheEntry {
  data: EventFact[];
  fetchedAt: number;
}

let stationObsCache: CacheEntry | null = null;
const STATION_OBS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Key US stations known for significant weather (ASOS/AWOS)
// These are a sampling of major airports and weather stations
const SIGNIFICANT_STATIONS = [
  // Major metros that often see significant weather
  { id: 'KORD', name: 'Chicago O\'Hare', state: 'Illinois' },
  { id: 'KDFW', name: 'Dallas/Fort Worth', state: 'Texas' },
  { id: 'KDEN', name: 'Denver', state: 'Colorado' },
  { id: 'KJFK', name: 'New York JFK', state: 'New York' },
  { id: 'KLAX', name: 'Los Angeles', state: 'California' },
  { id: 'KATL', name: 'Atlanta', state: 'Georgia' },
  { id: 'KMIA', name: 'Miami', state: 'Florida' },
  { id: 'KSEA', name: 'Seattle', state: 'Washington' },
  { id: 'KPHX', name: 'Phoenix', state: 'Arizona' },
  { id: 'KLAS', name: 'Las Vegas', state: 'Nevada' },
  // Tornado Alley
  { id: 'KOKC', name: 'Oklahoma City', state: 'Oklahoma' },
  { id: 'KTUL', name: 'Tulsa', state: 'Oklahoma' },
  { id: 'KICT', name: 'Wichita', state: 'Kansas' },
  { id: 'KOMA', name: 'Omaha', state: 'Nebraska' },
  { id: 'KDAL', name: 'Dallas Love Field', state: 'Texas' },
  { id: 'KLIT', name: 'Little Rock', state: 'Arkansas' },
  { id: 'KMCI', name: 'Kansas City', state: 'Missouri' },
  // Gulf Coast
  { id: 'KMSY', name: 'New Orleans', state: 'Louisiana' },
  { id: 'KHOU', name: 'Houston Hobby', state: 'Texas' },
  { id: 'KIAH', name: 'Houston Intercontinental', state: 'Texas' },
  { id: 'KTPA', name: 'Tampa', state: 'Florida' },
  // Southeast
  { id: 'KCLT', name: 'Charlotte', state: 'North Carolina' },
  { id: 'KRDU', name: 'Raleigh-Durham', state: 'North Carolina' },
  { id: 'KBNA', name: 'Nashville', state: 'Tennessee' },
  { id: 'KMEM', name: 'Memphis', state: 'Tennessee' },
  // Mountain West
  { id: 'KSLC', name: 'Salt Lake City', state: 'Utah' },
  { id: 'KABQ', name: 'Albuquerque', state: 'New Mexico' },
  // Upper Midwest
  { id: 'KMSP', name: 'Minneapolis', state: 'Minnesota' },
  { id: 'KDTW', name: 'Detroit', state: 'Michigan' },
  { id: 'KCLE', name: 'Cleveland', state: 'Ohio' },
  // Northeast
  { id: 'KBOS', name: 'Boston', state: 'Massachusetts' },
  { id: 'KPHL', name: 'Philadelphia', state: 'Pennsylvania' },
  { id: 'KDCA', name: 'Washington DC', state: 'District of Columbia' },
  { id: 'KBWI', name: 'Baltimore', state: 'Maryland' },
];

interface NWSObservation {
  '@id': string;
  '@type': string;
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    timestamp: string;
    rawMessage: string;
    textDescription: string;
    icon: string;
    presentWeather: Array<{ intensity: string; weather: string }>;
    temperature: { value: number | null; unitCode: string };
    dewpoint: { value: number | null; unitCode: string };
    windDirection: { value: number | null; unitCode: string };
    windSpeed: { value: number | null; unitCode: string };
    windGust: { value: number | null; unitCode: string };
    barometricPressure: { value: number | null; unitCode: string };
    visibility: { value: number | null; unitCode: string };
    maxTemperatureLast24Hours: { value: number | null; unitCode: string };
    minTemperatureLast24Hours: { value: number | null; unitCode: string };
    heatIndex: { value: number | null; unitCode: string };
    windChill: { value: number | null; unitCode: string };
  };
}

/**
 * Convert Celsius to Fahrenheit
 */
function cToF(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

/**
 * Convert m/s to mph
 */
function msToMph(ms: number): number {
  return Math.round(ms * 2.237);
}

/**
 * Fetch latest observation from a single station
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

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data as NWSObservation;
  } catch {
    return null;
  }
}

/**
 * Fetch observations from key stations and extract significant events
 */
export async function fetchStationObsFacts(): Promise<EventFact[]> {
  // Check cache first
  if (stationObsCache && Date.now() - stationObsCache.fetchedAt < STATION_OBS_CACHE_TTL) {
    return stationObsCache.data;
  }

  const facts: EventFact[] = [];

  // Fetch observations in parallel (batched to avoid overwhelming API)
  const batchSize = 10;
  const batches: typeof SIGNIFICANT_STATIONS[] = [];

  for (let i = 0; i < SIGNIFICANT_STATIONS.length; i += batchSize) {
    batches.push(SIGNIFICANT_STATIONS.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    const promises = batch.map(async (station) => {
      const obs = await fetchStationObs(station.id);
      if (!obs?.properties) return null;

      const props = obs.properties;
      const coords = obs.geometry?.coordinates;

      if (!coords || !props.timestamp) return null;

      const extractedFacts: EventFact[] = [];

      // Check for significant wind gusts (>=50 mph is significant, >=70 mph is severe)
      if (props.windGust?.value !== null && props.windGust.value !== undefined) {
        const gustMph = msToMph(props.windGust.value);
        if (gustMph >= 50) {
          extractedFacts.push({
            id: `station-gust-${station.id}-${props.timestamp}`,
            type: 'wind_gust' as EventFactType,
            magnitude: gustMph,
            units: 'mph',
            location_name: station.name,
            lat: coords[1],
            lon: coords[0],
            state: station.state,
            timestamp_utc: props.timestamp,
            source_name: `NWS ASOS (${station.id})`,
            source_url: `https://api.weather.gov/stations/${station.id}/observations/latest`,
            confidence: 'measured',
          });
        }
      }

      // Check for extreme heat (heat index >= 105°F)
      if (props.heatIndex?.value !== null && props.heatIndex.value !== undefined) {
        const heatIndexF = cToF(props.heatIndex.value);
        if (heatIndexF >= 105) {
          extractedFacts.push({
            id: `station-heat-${station.id}-${props.timestamp}`,
            type: 'temperature_extreme' as EventFactType,
            magnitude: heatIndexF,
            units: '°F heat index',
            location_name: station.name,
            lat: coords[1],
            lon: coords[0],
            state: station.state,
            timestamp_utc: props.timestamp,
            source_name: `NWS ASOS (${station.id})`,
            source_url: `https://api.weather.gov/stations/${station.id}/observations/latest`,
            confidence: 'measured',
            remarks: 'Dangerous heat index',
          });
        }
      }

      // Check for extreme cold (wind chill <= -20°F)
      if (props.windChill?.value !== null && props.windChill.value !== undefined) {
        const windChillF = cToF(props.windChill.value);
        if (windChillF <= -20) {
          extractedFacts.push({
            id: `station-cold-${station.id}-${props.timestamp}`,
            type: 'temperature_extreme' as EventFactType,
            magnitude: windChillF,
            units: '°F wind chill',
            location_name: station.name,
            lat: coords[1],
            lon: coords[0],
            state: station.state,
            timestamp_utc: props.timestamp,
            source_name: `NWS ASOS (${station.id})`,
            source_url: `https://api.weather.gov/stations/${station.id}/observations/latest`,
            confidence: 'measured',
            remarks: 'Dangerous wind chill',
          });
        }
      }

      return extractedFacts;
    });

    const results = await Promise.all(promises);
    for (const result of results) {
      if (result) {
        facts.push(...result);
      }
    }
  }

  console.log(`[Station Obs Fetcher] Found ${facts.length} significant observations`);

  // Cache the results
  stationObsCache = { data: facts, fetchedAt: Date.now() };

  return facts;
}

/**
 * Clear station observations cache
 */
export function clearStationObsCache(): void {
  stationObsCache = null;
}
