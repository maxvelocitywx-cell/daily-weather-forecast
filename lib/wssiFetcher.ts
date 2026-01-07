/**
 * WPC Winter Storm Severity Index (WSSI) Fetcher
 *
 * Fetches official NOAA WSSI data from the ArcGIS MapServer.
 * Uses point-in-polygon query to determine impact category for each city.
 *
 * WSSI updates every 2 hours.
 * Source: https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer
 */

// WSSI ArcGIS MapServer base URL
const WSSI_ARCGIS_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';

// Layer IDs for Overall Impact
const WSSI_LAYERS = {
  day1: 1,  // Overall_Impact_Day_1
  day2: 2,  // Overall_Impact_Day_2
  day3: 3,  // Overall_Impact_Day_3
};

// Valid WSSI impact categories (from lowest to highest severity)
export type WSSICategory =
  | 'NONE'
  | 'WINTER WEATHER AREA'
  | 'MINOR'
  | 'MODERATE'
  | 'MAJOR'
  | 'EXTREME';

// Shortened display names
export const WSSI_DISPLAY_NAMES: Record<WSSICategory, string> = {
  'NONE': 'None',
  'WINTER WEATHER AREA': 'WWA',
  'MINOR': 'Minor',
  'MODERATE': 'Moderate',
  'MAJOR': 'Major',
  'EXTREME': 'Extreme',
};

// WSSI points mapping (additive to risk score)
// Cap: max 6.0 points
export const WSSI_POINTS: Record<WSSICategory, number> = {
  'NONE': 0.0,
  'WINTER WEATHER AREA': 0.6,
  'MINOR': 1.4,
  'MODERATE': 2.6,
  'MAJOR': 4.0,
  'EXTREME': 5.5,
};

// Category severity order (for determining max)
export const WSSI_ORDER: Record<WSSICategory, number> = {
  'NONE': 0,
  'WINTER WEATHER AREA': 1,
  'MINOR': 2,
  'MODERATE': 3,
  'MAJOR': 4,
  'EXTREME': 5,
};

export interface WSSILookupResult {
  category: WSSICategory;
  points: number;
  source_url: string;
  valid_time: string | null;
  issue_time: string | null;
  status: 'ok' | 'no_intersection' | 'fetch_failed' | 'outside_coverage';
  debug?: string;
}

interface WSSIFeature {
  attributes: {
    impact?: string;
    valid_time?: string;
    issue_time?: string;
    start_time?: string;
    end_time?: string;
    product?: string;
    OBJECTID?: number;
  };
  geometry?: {
    rings?: number[][][];
  };
}

interface WSSIQueryResponse {
  features?: WSSIFeature[];
  error?: {
    code: number;
    message: string;
  };
}

// Cache for WSSI data (TTL: 15 minutes - WSSI updates every 2 hours so this is safe)
interface CacheEntry {
  result: WSSILookupResult;
  fetchedAt: number;
}

const wssiCache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Normalize impact string to WSSICategory
 */
function normalizeImpact(impact: string | undefined): WSSICategory {
  if (!impact) return 'NONE';

  const upper = impact.toUpperCase().trim();

  // Exact matches
  if (upper === 'EXTREME') return 'EXTREME';
  if (upper === 'MAJOR') return 'MAJOR';
  if (upper === 'MODERATE') return 'MODERATE';
  if (upper === 'MINOR') return 'MINOR';
  if (upper === 'WINTER WEATHER AREA' || upper === 'WWA') return 'WINTER WEATHER AREA';

  // Partial matches
  if (upper.includes('EXTREME')) return 'EXTREME';
  if (upper.includes('MAJOR')) return 'MAJOR';
  if (upper.includes('MODERATE')) return 'MODERATE';
  if (upper.includes('MINOR')) return 'MINOR';
  if (upper.includes('WINTER') || upper.includes('WWA')) return 'WINTER WEATHER AREA';

  return 'NONE';
}

/**
 * Build ArcGIS point query URL for WSSI
 */
function buildQueryUrl(layerId: number, lat: number, lon: number): string {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'impact,valid_time,issue_time,start_time,end_time,product',
    returnGeometry: 'false',
    f: 'json',
  });

  return `${WSSI_ARCGIS_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * Query WSSI for a specific city and day using point-in-polygon
 */
async function queryWSIForPoint(
  lat: number,
  lon: number,
  day: 1 | 2 | 3
): Promise<{ result: WSSILookupResult; sourceUrl: string }> {
  const layerId = WSSI_LAYERS[`day${day}` as keyof typeof WSSI_LAYERS];
  const sourceUrl = buildQueryUrl(layerId, lat, lon);

  try {
    const response = await fetch(sourceUrl, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 900 }, // 15 min cache at edge
    });

    if (!response.ok) {
      return {
        result: {
          category: 'NONE',
          points: 0,
          source_url: sourceUrl,
          valid_time: null,
          issue_time: null,
          status: 'fetch_failed',
          debug: `HTTP ${response.status}`,
        },
        sourceUrl,
      };
    }

    const data = await response.json() as WSSIQueryResponse;

    if (data.error) {
      return {
        result: {
          category: 'NONE',
          points: 0,
          source_url: sourceUrl,
          valid_time: null,
          issue_time: null,
          status: 'fetch_failed',
          debug: `API error: ${data.error.message}`,
        },
        sourceUrl,
      };
    }

    if (!data.features || data.features.length === 0) {
      return {
        result: {
          category: 'NONE',
          points: 0,
          source_url: sourceUrl,
          valid_time: null,
          issue_time: null,
          status: 'no_intersection',
        },
        sourceUrl,
      };
    }

    // Find highest severity impact among all intersecting features
    let highestCategory: WSSICategory = 'NONE';
    let highestOrder = 0;
    let validTime: string | null = null;
    let issueTime: string | null = null;

    for (const feature of data.features) {
      const category = normalizeImpact(feature.attributes?.impact);
      const order = WSSI_ORDER[category];

      if (order > highestOrder) {
        highestOrder = order;
        highestCategory = category;
        validTime = feature.attributes?.valid_time || null;
        issueTime = feature.attributes?.issue_time || null;
      }
    }

    return {
      result: {
        category: highestCategory,
        points: WSSI_POINTS[highestCategory],
        source_url: sourceUrl,
        valid_time: validTime,
        issue_time: issueTime,
        status: highestCategory === 'NONE' ? 'no_intersection' : 'ok',
      },
      sourceUrl,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`WSSI query failed for day ${day} at ${lat},${lon}:`, errMsg);

    return {
      result: {
        category: 'NONE',
        points: 0,
        source_url: sourceUrl,
        valid_time: null,
        issue_time: null,
        status: 'fetch_failed',
        debug: errMsg,
      },
      sourceUrl,
    };
  }
}

/**
 * Lookup WSSI category for a specific city and day
 */
export async function getWSIForCity(
  cityId: string,
  lat: number,
  lon: number,
  day: 1 | 2 | 3
): Promise<WSSILookupResult> {
  const cacheKey = `${cityId}-day${day}`;
  const cached = wssiCache.get(cacheKey);

  // Return cached if still valid
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.result;
  }

  const { result } = await queryWSIForPoint(lat, lon, day);

  // Cache the result
  wssiCache.set(cacheKey, { result, fetchedAt: Date.now() });

  return result;
}

/**
 * Batch lookup for multiple cities (more efficient - reuses cache)
 */
export async function getWSIForCities(
  cities: Array<{ cityId: string; lat: number; lon: number }>,
  day: 1 | 2 | 3
): Promise<Map<string, WSSILookupResult>> {
  const results = new Map<string, WSSILookupResult>();
  const uncachedCities: Array<{ cityId: string; lat: number; lon: number }> = [];

  // Check cache first
  for (const city of cities) {
    const cacheKey = `${city.cityId}-day${day}`;
    const cached = wssiCache.get(cacheKey);

    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
      results.set(city.cityId, cached.result);
    } else {
      uncachedCities.push(city);
    }
  }

  // Fetch uncached cities in parallel (with concurrency limit)
  const CONCURRENCY = 10;
  for (let i = 0; i < uncachedCities.length; i += CONCURRENCY) {
    const batch = uncachedCities.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (city) => {
        const { result } = await queryWSIForPoint(city.lat, city.lon, day);
        return { cityId: city.cityId, result };
      })
    );

    for (const { cityId, result } of batchResults) {
      results.set(cityId, result);
      wssiCache.set(`${cityId}-day${day}`, { result, fetchedAt: Date.now() });
    }
  }

  return results;
}

/**
 * Get the highest WSSI category from a set of categories
 */
export function getMaxWSSICategory(categories: WSSICategory[]): WSSICategory {
  let maxCategory: WSSICategory = 'NONE';
  let maxOrder = 0;

  for (const cat of categories) {
    const order = WSSI_ORDER[cat];
    if (order > maxOrder) {
      maxOrder = order;
      maxCategory = cat;
    }
  }

  return maxCategory;
}

/**
 * Clear cache (for testing)
 */
export function clearWSSICache(): void {
  wssiCache.clear();
}
