/**
 * SPC Outlook Fetcher
 *
 * Fetches official SPC convective outlook data from NOAA sources.
 * Uses point-in-polygon to determine risk category for each city.
 */

// SPC GeoJSON URLs (official sources)
const SPC_GEOJSON_URLS = {
  day1: 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson',
  day2: 'https://www.spc.noaa.gov/products/outlook/day2otlk_cat.lyr.geojson',
  day3: 'https://www.spc.noaa.gov/products/outlook/day3otlk_cat.lyr.geojson',
};

// Fallback: NOAA ArcGIS MapServer
const SPC_ARCGIS_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer';
const SPC_ARCGIS_LAYERS = {
  day1: 1,  // Day 1 Convective Outlook
  day2: 9,  // Day 2 Convective Outlook
  day3: 17, // Day 3 Convective Outlook
};

export type SPCCategory = 'HIGH' | 'MDT' | 'ENH' | 'SLGT' | 'MRGL' | 'TSTM' | 'NONE';

export interface SPCLookupResult {
  category: SPCCategory;
  points: number;
  source_url: string;
  valid_time: string | null;
  status: 'ok' | 'no_features' | 'fetch_failed' | 'outside_coverage';
  debug?: string;
}

export interface SPCFeature {
  type: 'Feature';
  properties: {
    DN?: number;
    LABEL?: string;
    LABEL2?: string;
    stroke?: string;
    fill?: string;
    VALID?: string;
    EXPIRE?: string;
    ISSUE?: string;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface SPCGeoJSON {
  type: 'FeatureCollection';
  features: SPCFeature[];
}

// Category ranking (higher = more severe)
const CATEGORY_RANK: Record<string, { category: SPCCategory; points: number }> = {
  'HIGH': { category: 'HIGH', points: 8.0 },
  'MDT': { category: 'MDT', points: 6.0 },
  'ENH': { category: 'ENH', points: 4.0 },
  'SLGT': { category: 'SLGT', points: 2.0 },
  'MRGL': { category: 'MRGL', points: 1.2 },
  'TSTM': { category: 'TSTM', points: 0.3 },
};

// Map DN values to categories (SPC uses these in GeoJSON)
const DN_TO_CATEGORY: Record<number, string> = {
  2: 'TSTM',
  3: 'MRGL',
  4: 'SLGT',
  5: 'ENH',
  6: 'MDT',
  8: 'HIGH',
};

// Cache for SPC data (TTL: 15 minutes)
interface CacheEntry {
  data: SPCGeoJSON;
  fetchedAt: number;
  sourceUrl: string;
}

const spcCache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch SPC outlook GeoJSON for a specific day
 */
async function fetchSPCGeoJSON(day: 1 | 2 | 3): Promise<{ data: SPCGeoJSON | null; sourceUrl: string; error?: string }> {
  const cacheKey = `day${day}`;
  const cached = spcCache.get(cacheKey);

  // Return cached if still valid
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return { data: cached.data, sourceUrl: cached.sourceUrl };
  }

  const dayKey = `day${day}` as keyof typeof SPC_GEOJSON_URLS;
  const primaryUrl = SPC_GEOJSON_URLS[dayKey];

  // Try primary GeoJSON source
  try {
    const response = await fetch(primaryUrl, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 900 }, // 15 min cache
    });

    if (response.ok) {
      const data = await response.json() as SPCGeoJSON;
      if (data.features && data.features.length > 0) {
        spcCache.set(cacheKey, { data, fetchedAt: Date.now(), sourceUrl: primaryUrl });
        return { data, sourceUrl: primaryUrl };
      }
      // Empty features - might be quiet day
      return { data, sourceUrl: primaryUrl };
    }
  } catch (err) {
    console.warn(`SPC GeoJSON fetch failed for day ${day}:`, err);
  }

  // Fallback to ArcGIS MapServer
  const arcgisUrl = `${SPC_ARCGIS_BASE}/${SPC_ARCGIS_LAYERS[dayKey]}/query?where=1%3D1&outFields=*&f=geojson`;

  try {
    const response = await fetch(arcgisUrl, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 900 },
    });

    if (response.ok) {
      const data = await response.json() as SPCGeoJSON;
      if (data.features) {
        spcCache.set(cacheKey, { data, fetchedAt: Date.now(), sourceUrl: arcgisUrl });
        return { data, sourceUrl: arcgisUrl };
      }
    }
  } catch (err) {
    console.warn(`SPC ArcGIS fallback failed for day ${day}:`, err);
  }

  return { data: null, sourceUrl: primaryUrl, error: 'All fetch attempts failed' };
}

/**
 * Ray-casting algorithm for point-in-polygon
 */
function pointInPolygon(lat: number, lon: number, polygon: number[][]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0]; // longitude
    const yi = polygon[i][1]; // latitude
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if point is in a polygon or multipolygon
 */
function pointInGeometry(lat: number, lon: number, geometry: SPCFeature['geometry']): boolean {
  if (geometry.type === 'Polygon') {
    // First ring is exterior, rest are holes
    const coords = geometry.coordinates as number[][][];
    if (!pointInPolygon(lat, lon, coords[0])) return false;
    // Check if in any hole
    for (let i = 1; i < coords.length; i++) {
      if (pointInPolygon(lat, lon, coords[i])) return false;
    }
    return true;
  } else if (geometry.type === 'MultiPolygon') {
    const coords = geometry.coordinates as number[][][][];
    for (const polygon of coords) {
      if (pointInPolygon(lat, lon, polygon[0])) {
        // Check holes
        let inHole = false;
        for (let i = 1; i < polygon.length; i++) {
          if (pointInPolygon(lat, lon, polygon[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }
  return false;
}

/**
 * Get category from feature properties
 */
function getCategoryFromFeature(feature: SPCFeature): string | null {
  const props = feature.properties;

  // Try LABEL first (most common)
  if (props.LABEL) {
    const label = props.LABEL.toUpperCase();
    if (label in CATEGORY_RANK) return label;
  }

  // Try LABEL2
  if (props.LABEL2) {
    const label = props.LABEL2.toUpperCase();
    if (label in CATEGORY_RANK) return label;
  }

  // Try DN value
  if (props.DN && props.DN in DN_TO_CATEGORY) {
    return DN_TO_CATEGORY[props.DN];
  }

  return null;
}

/**
 * Lookup SPC category for a specific city and day
 */
export async function getSPCForCity(
  cityId: string,
  lat: number,
  lon: number,
  day: 1 | 2 | 3
): Promise<SPCLookupResult> {
  const { data, sourceUrl, error } = await fetchSPCGeoJSON(day);

  if (error || !data) {
    return {
      category: 'NONE',
      points: 0,
      source_url: sourceUrl,
      valid_time: null,
      status: 'fetch_failed',
      debug: error,
    };
  }

  if (!data.features || data.features.length === 0) {
    return {
      category: 'NONE',
      points: 0,
      source_url: sourceUrl,
      valid_time: null,
      status: 'no_features',
    };
  }

  // Find the highest-risk polygon containing this point
  let highestCategory: SPCCategory = 'NONE';
  let highestPoints = 0;
  let validTime: string | null = null;

  for (const feature of data.features) {
    if (!feature.geometry) continue;

    if (pointInGeometry(lat, lon, feature.geometry)) {
      const categoryStr = getCategoryFromFeature(feature);
      if (categoryStr && categoryStr in CATEGORY_RANK) {
        const catInfo = CATEGORY_RANK[categoryStr];
        if (catInfo.points > highestPoints) {
          highestCategory = catInfo.category;
          highestPoints = catInfo.points;
          validTime = feature.properties.VALID || feature.properties.ISSUE || null;
        }
      }
    }
  }

  if (highestCategory === 'NONE') {
    return {
      category: 'NONE',
      points: 0,
      source_url: sourceUrl,
      valid_time: validTime,
      status: 'outside_coverage',
    };
  }

  return {
    category: highestCategory,
    points: highestPoints,
    source_url: sourceUrl,
    valid_time: validTime,
    status: 'ok',
  };
}

/**
 * Batch lookup for multiple cities (more efficient)
 */
export async function getSPCForCities(
  cities: Array<{ cityId: string; lat: number; lon: number }>,
  day: 1 | 2 | 3
): Promise<Map<string, SPCLookupResult>> {
  const results = new Map<string, SPCLookupResult>();
  const { data, sourceUrl, error } = await fetchSPCGeoJSON(day);

  if (error || !data) {
    // Return fetch_failed for all cities
    for (const city of cities) {
      results.set(city.cityId, {
        category: 'NONE',
        points: 0,
        source_url: sourceUrl,
        valid_time: null,
        status: 'fetch_failed',
        debug: error,
      });
    }
    return results;
  }

  if (!data.features || data.features.length === 0) {
    // No features - quiet day
    for (const city of cities) {
      results.set(city.cityId, {
        category: 'NONE',
        points: 0,
        source_url: sourceUrl,
        valid_time: null,
        status: 'no_features',
      });
    }
    return results;
  }

  // Check each city against all features
  for (const city of cities) {
    let highestCategory: SPCCategory = 'NONE';
    let highestPoints = 0;
    let validTime: string | null = null;

    for (const feature of data.features) {
      if (!feature.geometry) continue;

      if (pointInGeometry(city.lat, city.lon, feature.geometry)) {
        const categoryStr = getCategoryFromFeature(feature);
        if (categoryStr && categoryStr in CATEGORY_RANK) {
          const catInfo = CATEGORY_RANK[categoryStr];
          if (catInfo.points > highestPoints) {
            highestCategory = catInfo.category;
            highestPoints = catInfo.points;
            validTime = feature.properties.VALID || feature.properties.ISSUE || null;
          }
        }
      }
    }

    results.set(city.cityId, {
      category: highestCategory,
      points: highestPoints,
      source_url: sourceUrl,
      valid_time: validTime,
      status: highestCategory === 'NONE' ? 'outside_coverage' : 'ok',
    });
  }

  return results;
}

/**
 * Clear cache (for testing)
 */
export function clearSPCCache(): void {
  spcCache.clear();
}
