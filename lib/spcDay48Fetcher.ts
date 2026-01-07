/**
 * SPC Day 4-8 Convective Outlook Fetcher
 *
 * Fetches official SPC Day 4-8 probabilistic convective outlook data.
 * These outlooks represent 15% or 30%+ probability of severe thunderstorms within 25 miles of a point.
 * Valid period: 12Z-12Z for each day.
 * Updates: Daily at 09Z.
 *
 * Primary: SPC GeoJSON files (more reliable)
 * Fallback: NOAA ArcGIS MapServer
 *
 * DN values: 15 = 15% probability (SLGT-equivalent), 30 = 30% probability (ENH-equivalent)
 */

// Primary source: SPC direct GeoJSON URLs (more reliable than ArcGIS)
const SPC_GEOJSON_URLS: Record<number, string> = {
  4: 'https://www.spc.noaa.gov/products/exper/day4-8/day4prob.lyr.geojson',
  5: 'https://www.spc.noaa.gov/products/exper/day4-8/day5prob.lyr.geojson',
  6: 'https://www.spc.noaa.gov/products/exper/day4-8/day6prob.lyr.geojson',
  7: 'https://www.spc.noaa.gov/products/exper/day4-8/day7prob.lyr.geojson',
  8: 'https://www.spc.noaa.gov/products/exper/day4-8/day8prob.lyr.geojson',
};

// Fallback: ArcGIS MapServer base URL
const SPC_ARCGIS_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer';

// Layer IDs for Day 4-8 Probabilistic Outlooks (fallback)
const SPC_DAY48_LAYERS: Record<number, number> = {
  4: 21,  // Day 4 Probabilistic Outlook
  5: 22,  // Day 5 Probabilistic Outlook
  6: 23,  // Day 6 Probabilistic Outlook
  7: 24,  // Day 7 Probabilistic Outlook
  8: 25,  // Day 8 Probabilistic Outlook
};

// Day 4-8 categories based on DN values (15% and 30% areas)
export type SPCDay48Category = 'SLGT' | 'ENH' | 'NONE';

// Map DN values to display categories
// DN 15 = 15% probability -> treat as SLGT-equivalent
// DN 30 = 30% probability -> treat as ENH-equivalent
const DN_TO_CATEGORY: Record<number, SPCDay48Category> = {
  15: 'SLGT',
  30: 'ENH',
};

// Points mapping for Day 4-8 probabilistic outlooks
// Higher than Day 1-3 due to extended forecast uncertainty premium
export const SPC_DAY48_POINTS: Record<SPCDay48Category, number> = {
  'SLGT': 3.5,   // 15% probability (D4-8 Slight)
  'ENH': 5.5,    // 30% probability (D4-8 Enhanced)
  'NONE': 0.0,
};

export interface SPCDay48LookupResult {
  category: SPCDay48Category;
  dn: number | null;          // Raw DN value (15 or 30)
  points: number;
  source_url: string;
  valid_time: string | null;
  issue_time: string | null;
  expire_time: string | null;
  status: 'ok' | 'no_features' | 'fetch_failed' | 'outside_coverage' | 'invalid_day';
  debug?: string;
}

export interface SPCDay48Feature {
  type: 'Feature';
  properties: {
    dn?: number;        // 15 or 30 (lowercase from ArcGIS)
    DN?: number;        // 15 or 30 (uppercase from SPC GeoJSON)
    issue?: string;
    valid?: string;
    expire?: string;
    ISSUE?: string;     // SPC GeoJSON format: "202601050949"
    VALID?: string;     // SPC GeoJSON format: "202601091200"
    EXPIRE?: string;    // SPC GeoJSON format: "202601101200"
    LABEL?: string;     // SPC GeoJSON: "0.15"
    LABEL2?: string;    // SPC GeoJSON: "15% Any Severe Risk"
    stroke?: string;
    fill?: string;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface SPCDay48GeoJSON {
  type: 'FeatureCollection';
  features: SPCDay48Feature[];
}

// Cache for SPC Day 4-8 data (TTL: 30 minutes - longer than Day 1-3 since updates daily at 09Z)
interface CacheEntry {
  data: SPCDay48GeoJSON;
  fetchedAt: number;
  sourceUrl: string;
}

const spcDay48Cache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch SPC Day 4-8 outlook GeoJSON for a specific day
 * Primary: SPC direct GeoJSON (more reliable)
 * Fallback: NOAA ArcGIS MapServer
 */
async function fetchSPCDay48GeoJSON(day: 4 | 5 | 6 | 7 | 8): Promise<{ data: SPCDay48GeoJSON | null; sourceUrl: string; error?: string }> {
  const cacheKey = `day${day}`;
  const cached = spcDay48Cache.get(cacheKey);

  // Return cached if still valid
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return { data: cached.data, sourceUrl: cached.sourceUrl };
  }

  // Primary source: SPC direct GeoJSON
  const spcGeojsonUrl = SPC_GEOJSON_URLS[day];
  if (spcGeojsonUrl) {
    try {
      const response = await fetch(spcGeojsonUrl, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 1800 }, // 30 min cache
      });

      if (response.ok) {
        const data = await response.json() as SPCDay48GeoJSON;
        // SPC GeoJSON may have GeometryCollection for no-risk days - filter to valid geometries
        if (data.features && data.features.length > 0) {
          // Filter out features with empty GeometryCollection (no-risk placeholders)
          const validFeatures = data.features.filter(f =>
            f.geometry &&
            // @ts-expect-error - filter out GeometryCollections
            f.geometry.type !== 'GeometryCollection' &&
            (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          );

          // Create cleaned data with only valid polygon features
          const cleanedData: SPCDay48GeoJSON = {
            type: 'FeatureCollection',
            features: validFeatures as SPCDay48Feature[]
          };

          spcDay48Cache.set(cacheKey, { data: cleanedData, fetchedAt: Date.now(), sourceUrl: spcGeojsonUrl });
          return { data: cleanedData, sourceUrl: spcGeojsonUrl };
        }
      }
    } catch (err) {
      console.warn(`SPC GeoJSON fetch failed for day ${day}:`, err);
    }
  }

  // Fallback: ArcGIS MapServer
  const layerId = SPC_DAY48_LAYERS[day];
  if (!layerId) {
    return { data: null, sourceUrl: spcGeojsonUrl || '', error: `Invalid day: ${day}` };
  }

  const arcgisUrl = `${SPC_ARCGIS_BASE}/${layerId}/query?where=1%3D1&outFields=dn,issue,valid,expire&f=geojson&outSR=4326`;

  try {
    const response = await fetch(arcgisUrl, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 1800 }, // 30 min cache
    });

    if (response.ok) {
      const data = await response.json() as SPCDay48GeoJSON;
      if (data.features) {
        spcDay48Cache.set(cacheKey, { data, fetchedAt: Date.now(), sourceUrl: arcgisUrl });
        return { data, sourceUrl: arcgisUrl };
      }
    }

    return { data: null, sourceUrl: arcgisUrl, error: `HTTP ${response.status}` };
  } catch (err) {
    console.warn(`SPC ArcGIS fallback failed for day ${day}:`, err);
    return { data: null, sourceUrl: arcgisUrl, error: String(err) };
  }
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
function pointInGeometry(lat: number, lon: number, geometry: SPCDay48Feature['geometry']): boolean {
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
 * Get DN value from feature properties (handles case variations)
 */
function getDNFromFeature(feature: SPCDay48Feature): number | null {
  const props = feature.properties;
  const dn = props.dn || props.DN;
  if (typeof dn === 'number' && (dn === 15 || dn === 30)) {
    return dn;
  }
  return null;
}

/**
 * Lookup SPC Day 4-8 category for a specific city and day
 */
export async function getSPCDay48ForCity(
  cityId: string,
  lat: number,
  lon: number,
  day: 4 | 5 | 6 | 7 | 8
): Promise<SPCDay48LookupResult> {
  // Validate day
  if (day < 4 || day > 8) {
    return {
      category: 'NONE',
      dn: null,
      points: 0,
      source_url: '',
      valid_time: null,
      issue_time: null,
      expire_time: null,
      status: 'invalid_day',
      debug: `Day ${day} is not in range 4-8`,
    };
  }

  const { data, sourceUrl, error } = await fetchSPCDay48GeoJSON(day);

  if (error || !data) {
    return {
      category: 'NONE',
      dn: null,
      points: 0,
      source_url: sourceUrl,
      valid_time: null,
      issue_time: null,
      expire_time: null,
      status: 'fetch_failed',
      debug: error,
    };
  }

  if (!data.features || data.features.length === 0) {
    return {
      category: 'NONE',
      dn: null,
      points: 0,
      source_url: sourceUrl,
      valid_time: null,
      issue_time: null,
      expire_time: null,
      status: 'no_features',
    };
  }

  // Find the highest-risk polygon containing this point
  let highestDN: number | null = null;
  let highestCategory: SPCDay48Category = 'NONE';
  let highestPoints = 0;
  let validTime: string | null = null;
  let issueTime: string | null = null;
  let expireTime: string | null = null;

  for (const feature of data.features) {
    if (!feature.geometry) continue;

    if (pointInGeometry(lat, lon, feature.geometry)) {
      const dn = getDNFromFeature(feature);
      if (dn !== null) {
        const category = DN_TO_CATEGORY[dn] || 'NONE';
        const points = SPC_DAY48_POINTS[category];

        if (points > highestPoints) {
          highestDN = dn;
          highestCategory = category;
          highestPoints = points;
          validTime = feature.properties.valid || feature.properties.VALID || null;
          issueTime = feature.properties.issue || feature.properties.ISSUE || null;
          expireTime = feature.properties.expire || feature.properties.EXPIRE || null;
        }
      }
    }
  }

  if (highestCategory === 'NONE') {
    return {
      category: 'NONE',
      dn: null,
      points: 0,
      source_url: sourceUrl,
      valid_time: validTime,
      issue_time: issueTime,
      expire_time: expireTime,
      status: 'outside_coverage',
    };
  }

  return {
    category: highestCategory,
    dn: highestDN,
    points: highestPoints,
    source_url: sourceUrl,
    valid_time: validTime,
    issue_time: issueTime,
    expire_time: expireTime,
    status: 'ok',
  };
}

/**
 * Batch lookup for multiple cities (more efficient - fetches GeoJSON once)
 */
export async function getSPCDay48ForCities(
  cities: Array<{ cityId: string; lat: number; lon: number }>,
  day: 4 | 5 | 6 | 7 | 8
): Promise<Map<string, SPCDay48LookupResult>> {
  const results = new Map<string, SPCDay48LookupResult>();

  // Validate day
  if (day < 4 || day > 8) {
    for (const city of cities) {
      results.set(city.cityId, {
        category: 'NONE',
        dn: null,
        points: 0,
        source_url: '',
        valid_time: null,
        issue_time: null,
        expire_time: null,
        status: 'invalid_day',
        debug: `Day ${day} is not in range 4-8`,
      });
    }
    return results;
  }

  const { data, sourceUrl, error } = await fetchSPCDay48GeoJSON(day);

  if (error || !data) {
    for (const city of cities) {
      results.set(city.cityId, {
        category: 'NONE',
        dn: null,
        points: 0,
        source_url: sourceUrl,
        valid_time: null,
        issue_time: null,
        expire_time: null,
        status: 'fetch_failed',
        debug: error,
      });
    }
    return results;
  }

  if (!data.features || data.features.length === 0) {
    for (const city of cities) {
      results.set(city.cityId, {
        category: 'NONE',
        dn: null,
        points: 0,
        source_url: sourceUrl,
        valid_time: null,
        issue_time: null,
        expire_time: null,
        status: 'no_features',
      });
    }
    return results;
  }

  // Check each city against all features
  for (const city of cities) {
    let highestDN: number | null = null;
    let highestCategory: SPCDay48Category = 'NONE';
    let highestPoints = 0;
    let validTime: string | null = null;
    let issueTime: string | null = null;
    let expireTime: string | null = null;

    for (const feature of data.features) {
      if (!feature.geometry) continue;

      if (pointInGeometry(city.lat, city.lon, feature.geometry)) {
        const dn = getDNFromFeature(feature);
        if (dn !== null) {
          const category = DN_TO_CATEGORY[dn] || 'NONE';
          const points = SPC_DAY48_POINTS[category];

          if (points > highestPoints) {
            highestDN = dn;
            highestCategory = category;
            highestPoints = points;
            validTime = feature.properties.valid || feature.properties.VALID || null;
            issueTime = feature.properties.issue || feature.properties.ISSUE || null;
            expireTime = feature.properties.expire || feature.properties.EXPIRE || null;
          }
        }
      }
    }

    results.set(city.cityId, {
      category: highestCategory,
      dn: highestDN,
      points: highestPoints,
      source_url: sourceUrl,
      valid_time: validTime,
      issue_time: issueTime,
      expire_time: expireTime,
      status: highestCategory === 'NONE' ? 'outside_coverage' : 'ok',
    });
  }

  return results;
}

/**
 * Clear cache (for testing)
 */
export function clearSPCDay48Cache(): void {
  spcDay48Cache.clear();
}

/**
 * Get display label for Day 4-8 category
 */
export function getSPCDay48Label(category: SPCDay48Category, dn: number | null): string {
  if (category === 'NONE') return 'None';
  if (dn === 15) return 'SLGT (D4-8)';
  if (dn === 30) return 'ENH (D4-8)';
  return `${category} (D4-8)`;
}
