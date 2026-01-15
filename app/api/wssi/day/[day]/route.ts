import { NextRequest, NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import * as togeojson from '@mapbox/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import * as turf from '@turf/turf';

export const runtime = 'nodejs';
export const revalidate = 300; // 5 minute cache

// WSSI KMZ URLs - Overall Winter Storm Impacts only
const WSSI_KMZ_URLS: Record<number, string> = {
  1: 'https://www.wpc.ncep.noaa.gov/wwd/wssi/gis/kmz/wssi_overall_day1.kmz',
  2: 'https://www.wpc.ncep.noaa.gov/wwd/wssi/gis/kmz/wssi_overall_day2.kmz',
  3: 'https://www.wpc.ncep.noaa.gov/wwd/wssi/gis/kmz/wssi_overall_day3.kmz',
};

// Map WSSI categories to custom risk labels
const WSSI_TO_RISK_MAP: Record<string, string> = {
  'winter weather area': 'Marginal Risk',
  'minor impacts': 'Slight Risk',
  'minor': 'Slight Risk',
  'moderate impacts': 'Enhanced Risk',
  'moderate': 'Enhanced Risk',
  'major impacts': 'Moderate Risk',
  'major': 'Moderate Risk',
  'extreme impacts': 'High Risk',
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
 * Extract WSSI impact level from feature properties
 */
function extractImpactLevel(properties: Record<string, unknown>): string {
  // Try various property names that might contain the impact level
  const possibleProps = ['name', 'Name', 'description', 'Description', 'styleUrl', 'WSSI', 'Impact', 'Level'];

  for (const prop of possibleProps) {
    if (properties[prop]) {
      const value = String(properties[prop]).toLowerCase();

      for (const [wssiLabel, riskLabel] of Object.entries(WSSI_TO_RISK_MAP)) {
        if (value.includes(wssiLabel)) {
          return riskLabel;
        }
      }
    }
  }

  // Try to extract from styleUrl (common in KML)
  if (properties.styleUrl) {
    const styleUrl = String(properties.styleUrl).toLowerCase();
    if (styleUrl.includes('extreme')) return 'High Risk';
    if (styleUrl.includes('major')) return 'Moderate Risk';
    if (styleUrl.includes('moderate')) return 'Enhanced Risk';
    if (styleUrl.includes('minor')) return 'Slight Risk';
    if (styleUrl.includes('winter') || styleUrl.includes('elevated')) return 'Marginal Risk';
  }

  return 'Marginal Risk'; // Default
}

/**
 * Process KMZ file and return smoothed GeoJSON
 */
async function processWSSIKmz(day: number): Promise<{ geojson: GeoJSON.FeatureCollection; lastModified: string }> {
  const url = WSSI_KMZ_URLS[day];
  if (!url) {
    throw new Error(`Invalid day: ${day}`);
  }

  // Fetch KMZ file
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'maxvelocitywx.com',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch WSSI KMZ: ${response.status}`);
  }

  const lastModified = response.headers.get('Last-Modified') || new Date().toISOString();
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Unzip KMZ
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  let kmlContent: string | null = null;
  for (const entry of entries) {
    if (entry.entryName.endsWith('.kml')) {
      kmlContent = entry.getData().toString('utf8');
      break;
    }
  }

  if (!kmlContent) {
    throw new Error('No KML file found in KMZ');
  }

  // Parse KML to GeoJSON
  const parser = new DOMParser();
  const kmlDoc = parser.parseFromString(kmlContent, 'text/xml');
  const geojson = togeojson.kml(kmlDoc) as GeoJSON.FeatureCollection;

  // Process features: simplify, smooth, and normalize attributes
  const processedFeatures: GeoJSON.Feature[] = [];

  for (const feature of geojson.features) {
    if (!feature.geometry) continue;

    // Only process Polygon and MultiPolygon geometries
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
      continue;
    }

    try {
      // Step 1: Simplify to remove jagged grid edges
      let simplified = turf.simplify(feature as turf.AllGeoJSON, {
        tolerance: 0.005, // Adjust tolerance for smoothness
        highQuality: true,
      }) as GeoJSON.Feature;

      // Step 2: Apply buffer trick to round sharp corners
      // Buffer out slightly, then back in
      try {
        const bufferedOut = turf.buffer(simplified, 0.5, { units: 'kilometers' });
        if (bufferedOut) {
          const bufferedIn = turf.buffer(bufferedOut, -0.5, { units: 'kilometers' });
          if (bufferedIn && bufferedIn.geometry) {
            simplified = bufferedIn as GeoJSON.Feature;
          }
        }
      } catch {
        // Buffer can fail on complex geometries, continue with simplified
      }

      // Step 3: Apply Chaikin smoothing
      const smoothedGeometry = smoothGeometry(simplified.geometry!);

      // Extract and normalize properties
      const originalProperties = feature.properties || {};
      const originalLabel = String(originalProperties.name || originalProperties.Name || 'Unknown');
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
    const { geojson, lastModified } = await processWSSIKmz(day);

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
