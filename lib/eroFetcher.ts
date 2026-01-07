/**
 * WPC Excessive Rainfall Outlook (ERO) Fetcher
 *
 * Fetches official WPC ERO data from NOAA sources.
 * Uses point-in-polygon to determine risk category for each city.
 *
 * Data source (authoritative, supports Day 1-5):
 * https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer
 * Layers: Day 1 = 0, Day 2 = 1, Day 3 = 2, Day 4 = 3, Day 5 = 4
 *
 * DN values: 1 = MRGL, 2 = SLGT, 3 = MDT, 4 = HIGH
 */

// Primary source: WPC Precip Hazards MapServer (Days 1-5)
const ERO_PRECIP_HAZARDS_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer';
const ERO_PRECIP_HAZARDS_LAYERS: Record<number, number> = {
  1: 0,  // Day 1 ERO
  2: 1,  // Day 2 ERO
  3: 2,  // Day 3 ERO
  4: 3,  // Day 4 ERO
  5: 4,  // Day 5 ERO
};

// Fallback for Days 1-3: WPC ERO GeoJSON URLs
const ERO_GEOJSON_URLS = {
  day1: 'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero_1.geojson',
  day2: 'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero_2.geojson',
  day3: 'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero_3.geojson',
};

// Secondary fallback: NOAA ArcGIS MapServer (Days 1-3 only)
const ERO_ARCGIS_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_ero/MapServer';
const ERO_ARCGIS_LAYERS = {
  day1: 1,  // Day 1 ERO
  day2: 5,  // Day 2 ERO
  day3: 9,  // Day 3 ERO
};

export type EROCategory = 'HIGH' | 'MDT' | 'SLGT' | 'MRGL' | 'NONE';

export interface EROLookupResult {
  category: EROCategory;
  points: number;
  source_url: string;
  valid_time: string | null;
  status: 'ok' | 'no_features' | 'fetch_failed' | 'outside_coverage';
  debug?: string;
}

export interface EROFeature {
  type: 'Feature';
  properties: {
    DN?: number;
    dn?: number;  // lowercase from WPC precip hazards MapServer
    LABEL?: string;
    LABEL2?: string;
    CAT?: string;
    CATEGORY?: string;
    VALID?: string;
    EXPIRE?: string;
    ISSUE?: string;
    issue_time?: string;  // from WPC precip hazards MapServer
    valid_time?: string;  // from WPC precip hazards MapServer
    product?: string;     // from WPC precip hazards MapServer
    stroke?: string;
    fill?: string;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface EROGeoJSON {
  type: 'FeatureCollection';
  features: EROFeature[];
}

// Category ranking (higher = more severe)
const CATEGORY_RANK: Record<string, { category: EROCategory; points: number }> = {
  'HIGH': { category: 'HIGH', points: 5.5 },
  'MDT': { category: 'MDT', points: 4.0 },
  'MODERATE': { category: 'MDT', points: 4.0 },
  'SLGT': { category: 'SLGT', points: 2.5 },
  'SLIGHT': { category: 'SLGT', points: 2.5 },
  'MRGL': { category: 'MRGL', points: 1.0 },
  'MARGINAL': { category: 'MRGL', points: 1.0 },
};

// Map DN values to categories (WPC uses these in GeoJSON)
const DN_TO_CATEGORY: Record<number, string> = {
  1: 'MRGL',
  2: 'SLGT',
  3: 'MDT',
  4: 'HIGH',
};

// Cache for ERO data (TTL: 15 minutes)
interface CacheEntry {
  data: EROGeoJSON;
  fetchedAt: number;
  sourceUrl: string;
}

const eroCache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch WPC ERO GeoJSON for a specific day (1-5)
 * Primary source: WPC Precip Hazards MapServer (Days 1-5)
 * Fallback: WPC GeoJSON and ArcGIS MapServer (Days 1-3 only)
 */
async function fetchEROGeoJSON(day: 1 | 2 | 3 | 4 | 5): Promise<{ data: EROGeoJSON | null; sourceUrl: string; error?: string }> {
  const cacheKey = `day${day}`;
  const cached = eroCache.get(cacheKey);

  // Return cached if still valid
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return { data: cached.data, sourceUrl: cached.sourceUrl };
  }

  // Primary source: WPC Precip Hazards MapServer (supports Days 1-5)
  const layerId = ERO_PRECIP_HAZARDS_LAYERS[day];
  const primaryUrl = `${ERO_PRECIP_HAZARDS_BASE}/${layerId}/query?where=1%3D1&outFields=dn,issue_time,valid_time,product&f=geojson&outSR=4326`;

  try {
    const response = await fetch(primaryUrl, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 900 }, // 15 min cache
    });

    if (response.ok) {
      const data = await response.json() as EROGeoJSON;
      if (data.features && data.features.length > 0) {
        eroCache.set(cacheKey, { data, fetchedAt: Date.now(), sourceUrl: primaryUrl });
        return { data, sourceUrl: primaryUrl };
      }
      // Empty features - might be quiet day, still valid
      if (data.features) {
        eroCache.set(cacheKey, { data, fetchedAt: Date.now(), sourceUrl: primaryUrl });
        return { data, sourceUrl: primaryUrl };
      }
    }
  } catch (err) {
    console.warn(`WPC ERO Precip Hazards fetch failed for day ${day}:`, err);
  }

  // Fallback 1: WPC GeoJSON (Days 1-3 only)
  if (day <= 3) {
    const dayKey = `day${day}` as keyof typeof ERO_GEOJSON_URLS;
    const geojsonUrl = ERO_GEOJSON_URLS[dayKey];

    try {
      const response = await fetch(geojsonUrl, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 900 },
      });

      if (response.ok) {
        const data = await response.json() as EROGeoJSON;
        if (data.features && data.features.length > 0) {
          eroCache.set(cacheKey, { data, fetchedAt: Date.now(), sourceUrl: geojsonUrl });
          return { data, sourceUrl: geojsonUrl };
        }
        // Empty features - might be quiet day
        if (data.features) {
          return { data, sourceUrl: geojsonUrl };
        }
      }
    } catch (err) {
      console.warn(`WPC ERO GeoJSON fetch failed for day ${day}:`, err);
    }

    // Fallback 2: ArcGIS MapServer (Days 1-3 only)
    const arcgisUrl = `${ERO_ARCGIS_BASE}/${ERO_ARCGIS_LAYERS[dayKey]}/query?where=1%3D1&outFields=*&f=geojson`;

    try {
      const response = await fetch(arcgisUrl, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 900 },
      });

      if (response.ok) {
        const data = await response.json() as EROGeoJSON;
        if (data.features) {
          eroCache.set(cacheKey, { data, fetchedAt: Date.now(), sourceUrl: arcgisUrl });
          return { data, sourceUrl: arcgisUrl };
        }
      }
    } catch (err) {
      console.warn(`WPC ERO ArcGIS fallback failed for day ${day}:`, err);
    }
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
function pointInGeometry(lat: number, lon: number, geometry: EROFeature['geometry']): boolean {
  if (geometry.type === 'Polygon') {
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
function getCategoryFromFeature(feature: EROFeature): string | null {
  const props = feature.properties;

  // Try LABEL first
  if (props.LABEL) {
    const label = props.LABEL.toUpperCase();
    if (label in CATEGORY_RANK) return label;
  }

  // Try CAT
  if (props.CAT) {
    const cat = props.CAT.toUpperCase();
    if (cat in CATEGORY_RANK) return cat;
  }

  // Try CATEGORY
  if (props.CATEGORY) {
    const cat = props.CATEGORY.toUpperCase();
    if (cat in CATEGORY_RANK) return cat;
  }

  // Try DN value (uppercase - old format)
  if (props.DN && props.DN in DN_TO_CATEGORY) {
    return DN_TO_CATEGORY[props.DN];
  }

  // Try dn value (lowercase - WPC precip hazards MapServer format)
  if (props.dn && props.dn in DN_TO_CATEGORY) {
    return DN_TO_CATEGORY[props.dn];
  }

  return null;
}

/**
 * Lookup ERO category for a specific city and day (Days 1-5)
 */
export async function getEROForCity(
  cityId: string,
  lat: number,
  lon: number,
  day: 1 | 2 | 3 | 4 | 5
): Promise<EROLookupResult> {
  const { data, sourceUrl, error } = await fetchEROGeoJSON(day);

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
  let highestCategory: EROCategory = 'NONE';
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
          // Check both uppercase (old format) and lowercase (WPC precip hazards MapServer)
          validTime = feature.properties.VALID || feature.properties.ISSUE ||
                      feature.properties.valid_time || feature.properties.issue_time || null;
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
 * Batch lookup for multiple cities (more efficient) - Days 1-5
 */
export async function getEROForCities(
  cities: Array<{ cityId: string; lat: number; lon: number }>,
  day: 1 | 2 | 3 | 4 | 5
): Promise<Map<string, EROLookupResult>> {
  const results = new Map<string, EROLookupResult>();
  const { data, sourceUrl, error } = await fetchEROGeoJSON(day);

  if (error || !data) {
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

  for (const city of cities) {
    let highestCategory: EROCategory = 'NONE';
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
            // Check both uppercase (old format) and lowercase (WPC precip hazards MapServer)
            validTime = feature.properties.VALID || feature.properties.ISSUE ||
                        feature.properties.valid_time || feature.properties.issue_time || null;
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
export function clearEROCache(): void {
  eroCache.clear();
}
