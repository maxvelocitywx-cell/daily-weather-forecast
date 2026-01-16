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

// Map to risk labels and colors
const WSSI_TO_RISK: Record<WSSICategory, { label: string; originalLabel: string; color: string; order: number }> = {
  'elevated': { label: 'Marginal Risk', originalLabel: 'Winter Weather Area', color: '#60A5FA', order: 1 },
  'minor': { label: 'Slight Risk', originalLabel: 'Minor Impacts', color: '#2563EB', order: 2 },
  'moderate': { label: 'Enhanced Risk', originalLabel: 'Moderate Impacts', color: '#7C3AED', order: 3 },
  'major': { label: 'Moderate Risk', originalLabel: 'Major Impacts', color: '#A21CAF', order: 4 },
  'extreme': { label: 'High Risk', originalLabel: 'Extreme Impacts', color: '#DC2626', order: 5 },
};

// Smoothing parameters - ULTRA FAST settings
// Skip buffer entirely for overview (just simplify), light buffer for detail
const SMOOTH_PARAMS = {
  overview: {
    preSimplifyTol: 0.05,  // Aggressive pre-simplification
    useBuffer: false,      // SKIP buffer for overview - too slow
    postSimplifyTol: 0.08, // Moderate final simplification
    minAreaKm2: 500,       // Min 500 km²
  },
  detail: {
    preSimplifyTol: 0.015, // Light pre-simplification
    useBuffer: true,       // Only use buffer for detail
    bufferOut: 5,          // Small buffer 5km
    bufferIn: 5,           // Small buffer 5km
    bufferSteps: 6,        // Minimal steps
    postSimplifyTol: 0.02, // Light final simplification
    minAreaKm2: 50,        // Min 50 km²
  },
};

// Cache with processed results
interface CacheEntry {
  overview: FeatureCollection;
  detail: FeatureCollection;
  timestamp: number;
  lastModified: string;
  metrics: {
    overview: { featureCount: number; vertexCount: number; componentCount: number; bytes: number };
    detail: { featureCount: number; vertexCount: number; componentCount: number; bytes: number };
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
 * Count vertices and components in a feature
 */
function countGeometry(feature: PolygonFeature): { vertices: number; components: number } {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    return {
      vertices: geom.coordinates.reduce((sum, ring) => sum + ring.length, 0),
      components: 1,
    };
  } else if (geom.type === 'MultiPolygon') {
    return {
      vertices: geom.coordinates.reduce((sum, poly) =>
        sum + poly.reduce((s, ring) => s + ring.length, 0), 0),
      components: geom.coordinates.length,
    };
  }
  return { vertices: 0, components: 0 };
}

/**
 * Remove small polygon fragments from a MultiPolygon
 */
function removeSmallFragments(feature: PolygonFeature, minAreaKm2: number): PolygonFeature | null {
  const geom = feature.geometry;
  const minAreaM2 = minAreaKm2 * 1_000_000;

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
    // Use turf.union with feature collection
    const fc = turf.featureCollection(features);
    const result = turf.union(fc as Parameters<typeof turf.union>[0]);
    return result as PolygonFeature | null;
  } catch {
    // Fallback: try iterative union
    try {
      let result = features[0];
      for (let i = 1; i < features.length; i++) {
        try {
          const fc = turf.featureCollection([result, features[i]]);
          const unioned = turf.union(fc as Parameters<typeof turf.union>[0]);
          if (unioned) result = unioned as PolygonFeature;
        } catch {
          // Skip failed unions
        }
      }
      return result;
    } catch {
      return features[0];
    }
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
 * Apply morphological smoothing: buffer out then buffer in
 * This eliminates jagged stair-step edges
 */
function morphologicalSmooth(
  feature: PolygonFeature,
  bufferOutKm: number,
  bufferInKm: number,
  steps: number
): PolygonFeature | null {
  try {
    // Buffer OUT (dilate) - expands the polygon, filling in jagged edges
    const bufferedOut = turf.buffer(feature, bufferOutKm, {
      units: 'kilometers',
      steps: steps,
    });

    if (!bufferedOut?.geometry) return feature;

    // Buffer IN (erode) - contracts back, now with smooth edges
    const bufferedIn = turf.buffer(bufferedOut, -bufferInKm, {
      units: 'kilometers',
      steps: steps,
    });

    if (!bufferedIn?.geometry) return feature;

    return bufferedIn as PolygonFeature;
  } catch (err) {
    console.warn('[WSSI] Smoothing failed, using original:', err);
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
): { geojson: FeatureCollection; metrics: { featureCount: number; vertexCount: number; componentCount: number } } {

  const params = SMOOTH_PARAMS[resolution];

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

  // Process each band: PRE-simplify -> smooth -> POST-simplify -> remove fragments
  // Key: simplify BEFORE buffer to drastically reduce vertex count
  const processedFeatures: Feature[] = [];
  let totalVertices = 0;
  let totalComponents = 0;

  for (const category of CATEGORY_ORDER) {
    let band = exclusiveBands[category];
    if (!band?.geometry) continue;

    // Step 1: PRE-SIMPLIFY aggressively to reduce vertices BEFORE buffer
    // This is critical for performance - buffer ops are O(n²) on vertices
    try {
      const preSimplified = turf.simplify(band, {
        tolerance: params.preSimplifyTol,
        highQuality: false, // Fast mode for pre-simplification
        mutate: false,
      });
      if (preSimplified?.geometry) {
        band = preSimplified as PolygonFeature;
      }
    } catch {
      // Continue with original
    }

    // Step 2: Morphological smoothing (buffer out then in) - ONLY for detail
    // Skip for overview to avoid timeout
    if ('useBuffer' in params && params.useBuffer && 'bufferOut' in params) {
      const smoothed = morphologicalSmooth(
        band,
        params.bufferOut as number,
        params.bufferIn as number,
        params.bufferSteps as number
      );
      if (smoothed) {
        band = smoothed;
      }
    }

    // Step 3: POST-SIMPLIFY the smoothed geometry
    try {
      const postSimplified = turf.simplify(band, {
        tolerance: params.postSimplifyTol,
        highQuality: true, // High quality for final output
        mutate: false,
      });
      if (postSimplified?.geometry) {
        band = postSimplified as PolygonFeature;
      }
    } catch {
      // Keep unsimplified if it fails
    }

    // Step 4: Remove small fragments
    const cleaned = removeSmallFragments(band, params.minAreaKm2);
    if (!cleaned) continue;
    band = cleaned;

    // Step 5: Final area check
    try {
      const finalArea = turf.area(band);
      if (finalArea < params.minAreaKm2 * 1_000_000) continue;
    } catch {
      continue;
    }

    const riskInfo = WSSI_TO_RISK[category];
    const { vertices, components } = countGeometry(band);
    totalVertices += vertices;
    totalComponents += components;

    processedFeatures.push({
      type: 'Feature',
      geometry: band.geometry,
      properties: {
        day,
        category,
        riskLabel: riskInfo.label,
        originalLabel: riskInfo.originalLabel,
        riskColor: riskInfo.color,
        riskOrder: riskInfo.order,
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
    metrics: { featureCount: processedFeatures.length, vertexCount: totalVertices, componentCount: totalComponents },
  };
}

/**
 * Fetch raw data from NOAA
 */
async function fetchRawWSSI(day: number): Promise<{ features: Feature[]; lastModified: string }> {
  const layerId = WSSI_LAYER_IDS[day];
  if (!layerId) throw new Error(`Invalid day: ${day}`);

  const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

  try {
    const response = await fetch(queryUrl, {
      headers: { 'User-Agent': 'maxvelocitywx.com' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`NOAA API error: ${response.status}`);
    }

    const lastModified = response.headers.get('Last-Modified') || new Date().toISOString();
    const rawData = await response.json() as FeatureCollection;

    return {
      features: rawData.features || [],
      lastModified,
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('NOAA API timeout - try again');
    }
    throw error;
  }
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
    const metrics = resolution === 'detail' ? cached.metrics.detail : cached.metrics.overview;

    return new NextResponse(JSON.stringify(geojson), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
        'X-WSSI-Last-Modified': cached.lastModified,
        'X-WSSI-Features': String(metrics.featureCount),
        'X-WSSI-Vertices': String(metrics.vertexCount),
        'X-WSSI-Components': String(metrics.componentCount),
        'X-WSSI-Bytes': String(metrics.bytes),
        'X-WSSI-Resolution': resolution,
        'X-WSSI-Cached': 'true',
      },
    });
  }

  try {
    console.log(`[WSSI] Processing day ${day}...`);
    const startTime = Date.now();

    // Fetch raw data
    const { features, lastModified } = await fetchRawWSSI(day);
    console.log(`[WSSI] Fetched ${features.length} raw features in ${Date.now() - startTime}ms`);

    if (features.length === 0) {
      const emptyResult: FeatureCollection = { type: 'FeatureCollection', features: [] };
      return NextResponse.json(emptyResult, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
          'X-WSSI-Last-Modified': lastModified,
          'X-WSSI-Features': '0',
          'X-WSSI-Vertices': '0',
          'X-WSSI-Components': '0',
          'X-WSSI-Bytes': '0',
        },
      });
    }

    // Process both resolutions
    const processStart = Date.now();
    const overviewResult = processWSSIData(features, day, 'overview', lastModified);
    const detailResult = processWSSIData(features, day, 'detail', lastModified);
    console.log(`[WSSI] Processing took ${Date.now() - processStart}ms`);

    const overviewPayload = JSON.stringify(overviewResult.geojson);
    const detailPayload = JSON.stringify(detailResult.geojson);

    // Cache both versions
    wssiCache.set(cacheKey, {
      overview: overviewResult.geojson,
      detail: detailResult.geojson,
      timestamp: Date.now(),
      lastModified,
      metrics: {
        overview: { ...overviewResult.metrics, bytes: overviewPayload.length },
        detail: { ...detailResult.metrics, bytes: detailPayload.length },
      },
    });

    const totalTime = Date.now() - startTime;
    console.log(`[WSSI] Day ${day} complete in ${totalTime}ms`);
    console.log(`[WSSI]   Overview: ${overviewResult.metrics.featureCount}f, ${overviewResult.metrics.vertexCount}v, ${overviewResult.metrics.componentCount}c, ${(overviewPayload.length / 1024).toFixed(1)}KB`);
    console.log(`[WSSI]   Detail: ${detailResult.metrics.featureCount}f, ${detailResult.metrics.vertexCount}v, ${detailResult.metrics.componentCount}c, ${(detailPayload.length / 1024).toFixed(1)}KB`);

    // Return requested resolution
    const resultGeojson = resolution === 'detail' ? detailResult.geojson : overviewResult.geojson;
    const resultMetrics = resolution === 'detail'
      ? { ...detailResult.metrics, bytes: detailPayload.length }
      : { ...overviewResult.metrics, bytes: overviewPayload.length };
    const payload = resolution === 'detail' ? detailPayload : overviewPayload;

    return new NextResponse(payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
        'X-WSSI-Last-Modified': lastModified,
        'X-WSSI-Features': String(resultMetrics.featureCount),
        'X-WSSI-Vertices': String(resultMetrics.vertexCount),
        'X-WSSI-Components': String(resultMetrics.componentCount),
        'X-WSSI-Bytes': String(resultMetrics.bytes),
        'X-WSSI-Resolution': resolution,
        'X-WSSI-Processing-Time': String(totalTime),
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
          'Cache-Control': 'public, max-age=30',
        },
      }
    );
  }
}
