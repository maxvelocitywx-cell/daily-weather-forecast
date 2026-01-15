import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';

export const runtime = 'nodejs';
export const revalidate = 300; // 5 minute cache

// ArcGIS MapServer layer IDs for Overall Impact
const WSSI_LAYER_IDS: Record<number, number> = {
  1: 1, // Overall_Impact_Day_1
  2: 2, // Overall_Impact_Day_2
  3: 3, // Overall_Impact_Day_3
};

const MAPSERVER_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';

// WSSI categories in severity order (low to high)
type WSSICategory = 'elevated' | 'minor' | 'moderate' | 'major' | 'extreme';

const CATEGORY_ORDER: WSSICategory[] = ['elevated', 'minor', 'moderate', 'major', 'extreme'];

// Map WSSI categories to display labels
const WSSI_CATEGORY_LABELS: Record<WSSICategory, string> = {
  'elevated': 'Winter Weather Area',
  'minor': 'Minor Impacts',
  'moderate': 'Moderate Impacts',
  'major': 'Major Impacts',
  'extreme': 'Extreme Impacts',
};

// Map to risk labels
const WSSI_TO_RISK: Record<WSSICategory, string> = {
  'elevated': 'Marginal Risk',
  'minor': 'Slight Risk',
  'moderate': 'Enhanced Risk',
  'major': 'Moderate Risk',
  'extreme': 'High Risk',
};

// Risk colors
const RISK_COLORS: Record<string, string> = {
  'Marginal Risk': '#60A5FA',
  'Slight Risk': '#2563EB',
  'Enhanced Risk': '#7C3AED',
  'Moderate Risk': '#A21CAF',
  'High Risk': '#DC2626',
};

// Risk order for sorting
const RISK_ORDER: Record<string, number> = {
  'Marginal Risk': 1,
  'Slight Risk': 2,
  'Enhanced Risk': 3,
  'Moderate Risk': 4,
  'High Risk': 5,
};

// Cache
const wssiCache = new Map<string, { data: GeoJSON.FeatureCollection; timestamp: number; lastModified: string; debug: DebugInfo }>();
const CACHE_TTL = 5 * 60 * 1000;

interface DebugInfo {
  rawCounts: Record<string, number>;
  bandedCounts: Record<string, number>;
  unknownFeatures: number;
  totalFeatures: number;
}

/**
 * Extract WSSI category from feature properties
 * Returns null if category cannot be determined (feature will be omitted)
 */
function extractCategory(properties: Record<string, unknown>): WSSICategory | null {
  // ArcGIS MapServer uses 'impact' field for the category
  const possibleProps = ['impact', 'idp_wssilabel', 'label', 'Label', 'LABEL', 'name', 'Name'];

  for (const prop of possibleProps) {
    if (properties[prop]) {
      const value = String(properties[prop]).toLowerCase().trim();

      // Check for exact matches first
      if (value === 'extreme' || value === 'extreme impacts') return 'extreme';
      if (value === 'major' || value === 'major impacts') return 'major';
      if (value === 'moderate' || value === 'moderate impacts') return 'moderate';
      if (value === 'minor' || value === 'minor impacts') return 'minor';
      if (value === 'elevated' || value === 'winter weather area') return 'elevated';

      // Check for partial matches
      if (value.includes('extreme')) return 'extreme';
      if (value.includes('major')) return 'major';
      if (value.includes('moderate')) return 'moderate';
      if (value.includes('minor')) return 'minor';
      if (value.includes('elevated') || value.includes('winter weather')) return 'elevated';
    }
  }

  // Log unknown and return null - DO NOT default to elevated
  console.warn('Unknown WSSI category for properties:', JSON.stringify(properties));
  return null;
}

/**
 * Chaikin smoothing algorithm
 */
function chaikinSmooth(coords: number[][], iterations: number = 2): number[][] {
  if (coords.length < 3) return coords;

  let result = [...coords];

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: number[][] = [];

    for (let i = 0; i < result.length - 1; i++) {
      const p0 = result[i];
      const p1 = result[i + 1];

      const q = [
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
      ];

      const r = [
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
      ];

      smoothed.push(q, r);
    }

    if (smoothed.length > 0) {
      smoothed.push(smoothed[0]);
    }

    result = smoothed;
  }

  return result;
}

/**
 * Apply smoothing to polygon coordinates
 */
function smoothPolygonCoords(rings: number[][][]): number[][][] {
  return rings.map(ring => chaikinSmooth(ring, 2));
}

/**
 * Smooth a GeoJSON geometry
 */
function smoothGeometry(geometry: GeoJSON.Geometry): GeoJSON.Geometry {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: smoothPolygonCoords(geometry.coordinates as number[][][]),
    };
  } else if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: (geometry.coordinates as number[][][][]).map(polygon =>
        smoothPolygonCoords(polygon)
      ),
    };
  }
  return geometry;
}

/**
 * Union all features in an array into a single MultiPolygon
 */
function unionFeatures(features: GeoJSON.Feature[]): GeoJSON.Feature | null {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0];

  try {
    let result = features[0];
    for (let i = 1; i < features.length; i++) {
      const unioned = turf.union(
        turf.featureCollection([result as turf.Feature<turf.Polygon | turf.MultiPolygon>, features[i] as turf.Feature<turf.Polygon | turf.MultiPolygon>])
      );
      if (unioned) {
        result = unioned as GeoJSON.Feature;
      }
    }
    return result;
  } catch (err) {
    console.error('Error unioning features:', err);
    // Fallback: just return the first feature
    return features[0];
  }
}

/**
 * Subtract geometry B from geometry A
 */
function subtractGeometry(a: GeoJSON.Feature | null, b: GeoJSON.Feature | null): GeoJSON.Feature | null {
  if (!a) return null;
  if (!b) return a;

  try {
    const result = turf.difference(
      turf.featureCollection([a as turf.Feature<turf.Polygon | turf.MultiPolygon>, b as turf.Feature<turf.Polygon | turf.MultiPolygon>])
    );
    return result as GeoJSON.Feature | null;
  } catch (err) {
    console.error('Error subtracting geometry:', err);
    return a;
  }
}

/**
 * Process WSSI data into exclusive bands
 */
async function processWSSIData(day: number): Promise<{ geojson: GeoJSON.FeatureCollection; lastModified: string; debug: DebugInfo }> {
  const layerId = WSSI_LAYER_IDS[day];
  if (!layerId) {
    throw new Error(`Invalid day: ${day}`);
  }

  // Fetch from ArcGIS MapServer
  const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  const response = await fetch(queryUrl, {
    headers: { 'User-Agent': 'maxvelocitywx.com' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch WSSI data: ${response.status}`);
  }

  const lastModified = response.headers.get('Last-Modified') || new Date().toISOString();
  const rawData = await response.json() as GeoJSON.FeatureCollection;

  const debug: DebugInfo = {
    rawCounts: { elevated: 0, minor: 0, moderate: 0, major: 0, extreme: 0 },
    bandedCounts: { elevated: 0, minor: 0, moderate: 0, major: 0, extreme: 0 },
    unknownFeatures: 0,
    totalFeatures: rawData.features?.length || 0,
  };

  if (!rawData.features || rawData.features.length === 0) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      lastModified,
      debug,
    };
  }

  // Step 1: Group features by category
  const featuresByCategory: Record<WSSICategory, GeoJSON.Feature[]> = {
    elevated: [],
    minor: [],
    moderate: [],
    major: [],
    extreme: [],
  };

  for (const feature of rawData.features) {
    if (!feature.geometry) continue;
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;

    const category = extractCategory((feature.properties || {}) as Record<string, unknown>);

    if (category === null) {
      debug.unknownFeatures++;
      continue;
    }

    featuresByCategory[category].push(feature);
    debug.rawCounts[category]++;
  }

  console.log(`[WSSI Day ${day}] Raw counts:`, debug.rawCounts, `Unknown: ${debug.unknownFeatures}`);

  // Step 2: Union features within each category
  const unionedByCategory: Record<WSSICategory, GeoJSON.Feature | null> = {
    elevated: unionFeatures(featuresByCategory.elevated),
    minor: unionFeatures(featuresByCategory.minor),
    moderate: unionFeatures(featuresByCategory.moderate),
    major: unionFeatures(featuresByCategory.major),
    extreme: unionFeatures(featuresByCategory.extreme),
  };

  // Step 3: Build exclusive bands (subtract higher severity from lower)
  // B_Extreme = U_Extreme
  // B_Major = U_Major minus B_Extreme
  // B_Moderate = U_Moderate minus (B_Major ∪ B_Extreme)
  // etc.

  const bandExtreme = unionedByCategory.extreme;

  const bandMajor = subtractGeometry(unionedByCategory.major, bandExtreme);

  const majorAndExtreme = unionFeatures([bandMajor, bandExtreme].filter(Boolean) as GeoJSON.Feature[]);
  const bandModerate = subtractGeometry(unionedByCategory.moderate, majorAndExtreme);

  const modMajExt = unionFeatures([bandModerate, bandMajor, bandExtreme].filter(Boolean) as GeoJSON.Feature[]);
  const bandMinor = subtractGeometry(unionedByCategory.minor, modMajExt);

  const minModMajExt = unionFeatures([bandMinor, bandModerate, bandMajor, bandExtreme].filter(Boolean) as GeoJSON.Feature[]);
  const bandElevated = subtractGeometry(unionedByCategory.elevated, minModMajExt);

  const exclusiveBands: Record<WSSICategory, GeoJSON.Feature | null> = {
    elevated: bandElevated,
    minor: bandMinor,
    moderate: bandModerate,
    major: bandMajor,
    extreme: bandExtreme,
  };

  // Step 4: Smooth and create final features
  const processedFeatures: GeoJSON.Feature[] = [];

  for (const category of CATEGORY_ORDER) {
    const band = exclusiveBands[category];
    if (!band || !band.geometry) continue;

    try {
      // Simplify first
      let processed = turf.simplify(band as turf.AllGeoJSON, {
        tolerance: 0.008,
        highQuality: true,
      }) as GeoJSON.Feature;

      // Buffer trick for rounded corners
      try {
        const bufferedOut = turf.buffer(processed, 1.5, { units: 'kilometers' });
        if (bufferedOut) {
          const bufferedIn = turf.buffer(bufferedOut, -1.5, { units: 'kilometers' });
          if (bufferedIn && bufferedIn.geometry) {
            processed = bufferedIn as GeoJSON.Feature;
          }
        }
      } catch {
        // Continue with simplified if buffer fails
      }

      // Apply Chaikin smoothing
      const smoothedGeometry = smoothGeometry(processed.geometry!);

      const riskLabel = WSSI_TO_RISK[category];
      const originalCategory = WSSI_CATEGORY_LABELS[category];
      const riskColor = RISK_COLORS[riskLabel];
      const riskOrder = RISK_ORDER[riskLabel];

      processedFeatures.push({
        type: 'Feature',
        geometry: smoothedGeometry,
        properties: {
          day,
          category,
          originalCategory,
          riskLabel,
          riskColor,
          riskOrder,
          validTime: lastModified,
        },
      });

      debug.bandedCounts[category] = 1;
    } catch (err) {
      console.error(`Error processing ${category} band:`, err);
    }
  }

  console.log(`[WSSI Day ${day}] Banded counts:`, debug.bandedCounts);

  // Sort by risk order (lower severity first, so higher severity renders on top)
  processedFeatures.sort((a, b) =>
    (a.properties?.riskOrder || 0) - (b.properties?.riskOrder || 0)
  );

  return {
    geojson: {
      type: 'FeatureCollection',
      features: processedFeatures,
    },
    lastModified,
    debug,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ day: string }> }
) {
  const { day: dayStr } = await params;
  const day = parseInt(dayStr, 10);

  if (isNaN(day) || day < 1 || day > 3) {
    return NextResponse.json(
      { error: 'Invalid day parameter. Must be 1, 2, or 3.' },
      { status: 400 }
    );
  }

  // Check for debug parameter
  const showDebug = request.nextUrl.searchParams.get('debug') === 'true';

  // Check cache
  const cacheKey = `wssi-day-${day}`;
  const cached = wssiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    const responseData = showDebug
      ? { ...cached.data, _debug: cached.debug }
      : cached.data;

    return NextResponse.json(responseData, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-WSSI-Last-Modified': cached.lastModified,
      },
    });
  }

  try {
    const { geojson, lastModified, debug } = await processWSSIData(day);

    // Update cache
    wssiCache.set(cacheKey, {
      data: geojson,
      timestamp: Date.now(),
      lastModified,
      debug,
    });

    const responseData = showDebug
      ? { ...geojson, _debug: debug }
      : geojson;

    return NextResponse.json(responseData, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-WSSI-Last-Modified': lastModified,
      },
    });
  } catch (error) {
    console.error('Error processing WSSI data:', error);

    return NextResponse.json(
      {
        type: 'FeatureCollection',
        features: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      }
    );
  }
}
