import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

// Simplification tolerances (in degrees, ~111km per degree at equator)
// overview: ~10km tolerance, detail: ~2km tolerance
const SIMPLIFY_TOLERANCE = {
  overview: 0.1,   // ~11km - aggressive for national view
  detail: 0.02,    // ~2.2km - lighter for zoomed view
};

// Minimum area thresholds (in square meters)
const MIN_AREA = {
  overview: 100_000_000, // 100 km² - drop small islands
  detail: 25_000_000,    // 25 km²
};

// Buffer for smoothing (in km) - small to avoid huge polygon bloat
const SMOOTH_BUFFER_KM = 8;

// Cache with processed results
interface CacheEntry {
  overview: FeatureCollection;
  detail: FeatureCollection;
  timestamp: number;
  lastModified: string;
  metrics: {
    featureCount: number;
    vertexCount: number;
    payloadBytes: number;
  };
}
const wssiCache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

type PolygonFeature = Feature<Polygon | MultiPolygon>;

/**
 * Extract WSSI category from feature properties
 */
function extractCategory(properties: Record<string, unknown>): WSSICategory | null {
  const possibleProps = ['impact', 'idp_wssilabel', 'label', 'Label', 'LABEL', 'name', 'Name'];

  for (const prop of possibleProps) {
    if (properties[prop]) {
      const value = String(properties[prop]).toLowerCase().trim();

      if (value === 'extreme' || value === 'extreme impacts') return 'extreme';
      if (value === 'major' || value === 'major impacts') return 'major';
      if (value === 'moderate' || value === 'moderate impacts') return 'moderate';
      if (value === 'minor' || value === 'minor impacts') return 'minor';
      if (value === 'elevated' || value === 'winter weather area') return 'elevated';

      if (value.includes('extreme')) return 'extreme';
      if (value.includes('major')) return 'major';
      if (value.includes('moderate')) return 'moderate';
      if (value.includes('minor')) return 'minor';
      if (value.includes('elevated') || value.includes('winter weather')) return 'elevated';
    }
  }

  return null;
}

/**
 * Count vertices in a feature
 */
function countVertices(feature: PolygonFeature): number {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    return geom.coordinates.reduce((sum, ring) => sum + ring.length, 0);
  } else if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((sum, poly) =>
      sum + poly.reduce((s, ring) => s + ring.length, 0), 0);
  }
  return 0;
}

/**
 * Remove small polygon fragments from a MultiPolygon
 */
function removeSmallFragments(feature: PolygonFeature, minAreaM2: number): PolygonFeature | null {
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    try {
      const area = turf.area(feature);
      if (area < minAreaM2) return null;
    } catch {
      // Keep if area calc fails
    }
    return feature;
  }

  if (geom.type === 'MultiPolygon') {
    const validPolygons: Position[][][] = [];

    for (const polygon of geom.coordinates) {
      try {
        const polyFeature = turf.polygon(polygon);
        const area = turf.area(polyFeature);
        if (area >= minAreaM2) {
          validPolygons.push(polygon);
        }
      } catch {
        // Skip invalid polygons
      }
    }

    if (validPolygons.length === 0) return null;
    if (validPolygons.length === 1) {
      return {
        ...feature,
        geometry: { type: 'Polygon', coordinates: validPolygons[0] },
      };
    }
    return {
      ...feature,
      geometry: { type: 'MultiPolygon', coordinates: validPolygons },
    };
  }

  return feature;
}

/**
 * Safe union of features with error handling
 */
function safeUnion(features: PolygonFeature[]): PolygonFeature | null {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0];

  try {
    let result = features[0];

    for (let i = 1; i < features.length; i++) {
      try {
        const fc = turf.featureCollection([result, features[i]]);
        const unioned = turf.union(fc as Parameters<typeof turf.union>[0]);
        if (unioned) {
          result = unioned as PolygonFeature;
        }
      } catch {
        // Skip failed unions
      }
    }

    return result;
  } catch {
    return features[0];
  }
}

/**
 * Safe difference of features
 */
function safeDifference(a: PolygonFeature | null, b: PolygonFeature | null): PolygonFeature | null {
  if (!a) return null;
  if (!b) return a;

  try {
    const fc = turf.featureCollection([a, b]);
    const result = turf.difference(fc as Parameters<typeof turf.difference>[0]);
    return result as PolygonFeature | null;
  } catch {
    return a;
  }
}

/**
 * Light morphological smoothing - buffer out then in
 */
function smoothPolygon(feature: PolygonFeature, bufferKm: number): PolygonFeature | null {
  try {
    const bufferedOut = turf.buffer(feature, bufferKm, { units: 'kilometers', steps: 8 });
    if (!bufferedOut?.geometry) return feature;

    const bufferedIn = turf.buffer(bufferedOut as PolygonFeature, -bufferKm, { units: 'kilometers', steps: 8 });
    if (!bufferedIn?.geometry) return feature;

    return bufferedIn as PolygonFeature;
  } catch {
    return feature;
  }
}

/**
 * Process raw WSSI data into dissolved, simplified exclusive bands
 */
function processWSSIData(
  rawFeatures: Feature[],
  day: number,
  resolution: 'overview' | 'detail',
  lastModified: string
): { geojson: FeatureCollection; metrics: { featureCount: number; vertexCount: number } } {

  const tolerance = SIMPLIFY_TOLERANCE[resolution];
  const minArea = MIN_AREA[resolution];

  // Group features by category
  const featuresByCategory: Record<WSSICategory, PolygonFeature[]> = {
    elevated: [],
    minor: [],
    moderate: [],
    major: [],
    extreme: [],
  };

  for (const feature of rawFeatures) {
    if (!feature.geometry) continue;
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;

    const category = extractCategory((feature.properties || {}) as Record<string, unknown>);
    if (!category) continue;

    featuresByCategory[category].push(feature as PolygonFeature);
  }

  // Union features within each category (dissolve)
  const unionedByCategory: Record<WSSICategory, PolygonFeature | null> = {
    elevated: safeUnion(featuresByCategory.elevated),
    minor: safeUnion(featuresByCategory.minor),
    moderate: safeUnion(featuresByCategory.moderate),
    major: safeUnion(featuresByCategory.major),
    extreme: safeUnion(featuresByCategory.extreme),
  };

  // Build exclusive bands (subtract higher severity from lower)
  const bandExtreme = unionedByCategory.extreme;
  const bandMajor = safeDifference(unionedByCategory.major, bandExtreme);
  const majorAndExtreme = safeUnion([bandMajor, bandExtreme].filter(Boolean) as PolygonFeature[]);
  const bandModerate = safeDifference(unionedByCategory.moderate, majorAndExtreme);
  const modMajExt = safeUnion([bandModerate, bandMajor, bandExtreme].filter(Boolean) as PolygonFeature[]);
  const bandMinor = safeDifference(unionedByCategory.minor, modMajExt);
  const minModMajExt = safeUnion([bandMinor, bandModerate, bandMajor, bandExtreme].filter(Boolean) as PolygonFeature[]);
  const bandElevated = safeDifference(unionedByCategory.elevated, minModMajExt);

  const exclusiveBands: Record<WSSICategory, PolygonFeature | null> = {
    elevated: bandElevated,
    minor: bandMinor,
    moderate: bandModerate,
    major: bandMajor,
    extreme: bandExtreme,
  };

  // Process each band: smooth, simplify, remove fragments
  const processedFeatures: Feature[] = [];
  let totalVertices = 0;

  for (const category of CATEGORY_ORDER) {
    let band = exclusiveBands[category];
    if (!band?.geometry) continue;

    // Check minimum total area
    try {
      const area = turf.area(band);
      if (area < minArea) continue;
    } catch {
      continue;
    }

    // Light smoothing (only for overview to reduce jaggedness)
    if (resolution === 'overview') {
      const smoothed = smoothPolygon(band, SMOOTH_BUFFER_KM);
      if (smoothed) band = smoothed;
    }

    // Aggressive simplification
    try {
      const simplified = turf.simplify(band, { tolerance, highQuality: false });
      if (simplified?.geometry) {
        band = simplified as PolygonFeature;
      }
    } catch {
      // Keep unsimplified
    }

    // Remove small fragments
    const cleaned = removeSmallFragments(band, minArea);
    if (!cleaned) continue;
    band = cleaned;

    // Final area check
    try {
      const finalArea = turf.area(band);
      if (finalArea < minArea) continue;
    } catch {
      continue;
    }

    const riskLabel = WSSI_TO_RISK[category];
    const vertices = countVertices(band);
    totalVertices += vertices;

    processedFeatures.push({
      type: 'Feature',
      geometry: band.geometry,
      properties: {
        day,
        category,
        riskLabel,
        originalLabel: WSSI_CATEGORY_LABELS[category],
        riskColor: RISK_COLORS[riskLabel],
        riskOrder: RISK_ORDER[riskLabel],
        validTime: lastModified,
      },
    });
  }

  // Sort by risk order
  processedFeatures.sort((a, b) =>
    (a.properties?.riskOrder || 0) - (b.properties?.riskOrder || 0)
  );

  return {
    geojson: { type: 'FeatureCollection', features: processedFeatures },
    metrics: { featureCount: processedFeatures.length, vertexCount: totalVertices },
  };
}

/**
 * Fetch raw data from NOAA
 */
async function fetchRawWSSI(day: number): Promise<{ features: Feature[]; lastModified: string }> {
  const layerId = WSSI_LAYER_IDS[day];
  if (!layerId) throw new Error(`Invalid day: ${day}`);

  const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  const response = await fetch(queryUrl, {
    headers: { 'User-Agent': 'maxvelocitywx.com' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch WSSI data: ${response.status}`);
  }

  const lastModified = response.headers.get('Last-Modified') || new Date().toISOString();
  const rawData = await response.json() as FeatureCollection;

  return {
    features: rawData.features || [],
    lastModified,
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

  // Get resolution from query param (default: overview for performance)
  const { searchParams } = new URL(request.url);
  const res = searchParams.get('res') as 'overview' | 'detail' | null;
  const resolution = res === 'detail' ? 'detail' : 'overview';

  const cacheKey = `wssi-day-${day}`;
  const cached = wssiCache.get(cacheKey);

  // Return cached data if valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    const geojson = resolution === 'detail' ? cached.detail : cached.overview;
    const payload = JSON.stringify(geojson);

    return new NextResponse(payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
        'X-WSSI-Last-Modified': cached.lastModified,
        'X-WSSI-Features': String(cached.metrics.featureCount),
        'X-WSSI-Vertices': String(cached.metrics.vertexCount),
        'X-WSSI-Bytes': String(cached.metrics.payloadBytes),
        'X-WSSI-Resolution': resolution,
      },
    });
  }

  try {
    console.log(`[WSSI] Processing day ${day}...`);
    const startTime = Date.now();

    // Fetch raw data
    const { features, lastModified } = await fetchRawWSSI(day);
    console.log(`[WSSI] Fetched ${features.length} raw features`);

    if (features.length === 0) {
      const emptyResult: FeatureCollection = { type: 'FeatureCollection', features: [] };
      return NextResponse.json(emptyResult, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
          'X-WSSI-Last-Modified': lastModified,
          'X-WSSI-Features': '0',
          'X-WSSI-Vertices': '0',
        },
      });
    }

    // Process both resolutions
    const overviewResult = processWSSIData(features, day, 'overview', lastModified);
    const detailResult = processWSSIData(features, day, 'detail', lastModified);

    const overviewPayload = JSON.stringify(overviewResult.geojson);

    // Cache both versions
    wssiCache.set(cacheKey, {
      overview: overviewResult.geojson,
      detail: detailResult.geojson,
      timestamp: Date.now(),
      lastModified,
      metrics: {
        featureCount: overviewResult.metrics.featureCount,
        vertexCount: overviewResult.metrics.vertexCount,
        payloadBytes: overviewPayload.length,
      },
    });

    const processingTime = Date.now() - startTime;
    console.log(`[WSSI] Day ${day} processed in ${processingTime}ms`);
    console.log(`[WSSI]   Overview: ${overviewResult.metrics.featureCount} features, ${overviewResult.metrics.vertexCount} vertices, ${(overviewPayload.length / 1024).toFixed(1)} KB`);
    console.log(`[WSSI]   Detail: ${detailResult.metrics.featureCount} features, ${detailResult.metrics.vertexCount} vertices`);

    // Return requested resolution
    const resultGeojson = resolution === 'detail' ? detailResult.geojson : overviewResult.geojson;
    const resultMetrics = resolution === 'detail' ? detailResult.metrics : overviewResult.metrics;
    const payload = JSON.stringify(resultGeojson);

    return new NextResponse(payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
        'X-WSSI-Last-Modified': lastModified,
        'X-WSSI-Features': String(resultMetrics.featureCount),
        'X-WSSI-Vertices': String(resultMetrics.vertexCount),
        'X-WSSI-Bytes': String(payload.length),
        'X-WSSI-Resolution': resolution,
        'X-WSSI-Processing-Time': String(processingTime),
      },
    });
  } catch (error) {
    console.error('[WSSI] Error:', error);

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
