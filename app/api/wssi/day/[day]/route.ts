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

// Map WSSI categories to custom risk labels
const WSSI_TO_RISK_MAP: Record<string, string> = {
  'elevated': 'Marginal Risk',
  'winter weather area': 'Marginal Risk',
  'minor': 'Slight Risk',
  'minor impacts': 'Slight Risk',
  'moderate': 'Enhanced Risk',
  'moderate impacts': 'Enhanced Risk',
  'major': 'Moderate Risk',
  'major impacts': 'Moderate Risk',
  'extreme': 'High Risk',
  'extreme impacts': 'High Risk',
};

// Risk colors
const RISK_COLORS: Record<string, string> = {
  'Marginal Risk': '#60A5FA',
  'Slight Risk': '#2563EB',
  'Enhanced Risk': '#7C3AED',
  'Moderate Risk': '#A21CAF',
  'High Risk': '#DC2626',
};

// Risk order for sorting (lowest to highest)
const RISK_ORDER: Record<string, number> = {
  'Marginal Risk': 1,
  'Slight Risk': 2,
  'Enhanced Risk': 3,
  'Moderate Risk': 4,
  'High Risk': 5,
};

// Cache for processed GeoJSON
const wssiCache = new Map<string, { data: GeoJSON.FeatureCollection; timestamp: number; lastModified: string }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Chaikin smoothing algorithm - smooths polygon edges
 */
function chaikinSmooth(coords: number[][], iterations: number = 2): number[][] {
  if (coords.length < 3) return coords;

  let result = [...coords];

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: number[][] = [];

    for (let i = 0; i < result.length - 1; i++) {
      const p0 = result[i];
      const p1 = result[i + 1];

      // Q = 0.75 * P0 + 0.25 * P1
      const q = [
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
      ];

      // R = 0.25 * P0 + 0.75 * P1
      const r = [
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
      ];

      smoothed.push(q, r);
    }

    // Close the polygon
    if (smoothed.length > 0) {
      smoothed.push(smoothed[0]);
    }

    result = smoothed;
  }

  return result;
}

/**
 * Apply smoothing to a polygon's coordinates
 * Using 4 iterations for very smooth curves
 */
function smoothPolygonCoords(rings: number[][][]): number[][][] {
  return rings.map(ring => chaikinSmooth(ring, 4));
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
 * Extract WSSI impact level from feature properties
 */
function extractImpactLevel(properties: Record<string, unknown>): string {
  // ArcGIS returns 'label' or 'Label' with the impact level
  const possibleProps = ['label', 'Label', 'LABEL', 'name', 'Name', 'idp_wssilabel'];

  for (const prop of possibleProps) {
    if (properties[prop]) {
      const value = String(properties[prop]).toLowerCase().trim();

      // Direct match first
      for (const [wssiLabel, riskLabel] of Object.entries(WSSI_TO_RISK_MAP)) {
        if (value === wssiLabel || value.includes(wssiLabel)) {
          return riskLabel;
        }
      }
    }
  }

  return 'Marginal Risk'; // Default
}

/**
 * Fetch WSSI data from ArcGIS MapServer
 */
async function fetchWSSIFromMapServer(day: number): Promise<{ geojson: GeoJSON.FeatureCollection; lastModified: string }> {
  const layerId = WSSI_LAYER_IDS[day];
  if (!layerId) {
    throw new Error(`Invalid day: ${day}`);
  }

  // Query the layer for all features as GeoJSON
  const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  const response = await fetch(queryUrl, {
    headers: {
      'User-Agent': 'maxvelocitywx.com',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch WSSI data: ${response.status}`);
  }

  const lastModified = response.headers.get('Last-Modified') || new Date().toISOString();
  const data = await response.json() as GeoJSON.FeatureCollection;

  if (!data.features || data.features.length === 0) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      lastModified,
    };
  }

  // Process features: simplify, smooth, and normalize attributes
  const processedFeatures: GeoJSON.Feature[] = [];

  for (const feature of data.features) {
    if (!feature.geometry) continue;

    // Only process Polygon and MultiPolygon geometries
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
      continue;
    }

    try {
      // Step 1: Simplify to remove jagged grid edges (higher tolerance = smoother)
      let simplified = turf.simplify(feature as turf.AllGeoJSON, {
        tolerance: 0.01,
        highQuality: true,
      }) as GeoJSON.Feature;

      // Step 2: Apply buffer trick to round sharp corners (larger buffer = rounder)
      try {
        const bufferedOut = turf.buffer(simplified, 2, { units: 'kilometers' });
        if (bufferedOut) {
          const bufferedIn = turf.buffer(bufferedOut, -2, { units: 'kilometers' });
          if (bufferedIn && bufferedIn.geometry) {
            simplified = bufferedIn as GeoJSON.Feature;
          }
        }
      } catch {
        // Buffer can fail on complex geometries, continue with simplified
      }

      // Step 3: Apply Chaikin smoothing (4 iterations in smoothPolygonCoords)
      const smoothedGeometry = smoothGeometry(simplified.geometry!);

      // Extract and normalize properties
      const originalProperties = (feature.properties || {}) as Record<string, unknown>;
      const originalLabel = String(originalProperties.label || originalProperties.Label || originalProperties.idp_wssilabel || 'Unknown');
      const riskLabel = extractImpactLevel(originalProperties);
      const riskColor = RISK_COLORS[riskLabel] || '#60A5FA';
      const riskOrder = RISK_ORDER[riskLabel] || 1;

      processedFeatures.push({
        type: 'Feature',
        geometry: smoothedGeometry,
        properties: {
          day,
          riskLabel,
          originalLabel,
          riskColor,
          riskOrder,
          validTime: lastModified,
        },
      });
    } catch (err) {
      console.error('Error processing feature:', err);
      // Skip problematic features
    }
  }

  // Sort by risk order (lower risk rendered first, higher risk on top)
  processedFeatures.sort((a, b) =>
    (a.properties?.riskOrder || 0) - (b.properties?.riskOrder || 0)
  );

  return {
    geojson: {
      type: 'FeatureCollection',
      features: processedFeatures,
    },
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

  // Check cache
  const cacheKey = `wssi-day-${day}`;
  const cached = wssiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-WSSI-Last-Modified': cached.lastModified,
      },
    });
  }

  try {
    const { geojson, lastModified } = await fetchWSSIFromMapServer(day);

    // Update cache
    wssiCache.set(cacheKey, {
      data: geojson,
      timestamp: Date.now(),
      lastModified,
    });

    return NextResponse.json(geojson, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-WSSI-Last-Modified': lastModified,
      },
    });
  } catch (error) {
    console.error('Error processing WSSI data:', error);

    // Return empty feature collection on error
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
