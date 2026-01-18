import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { kv } from '@vercel/kv';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JSTS ESM imports
import { GeoJSONReader, GeoJSONWriter } from 'jsts/org/locationtech/jts/io';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JSTS ESM imports
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JSTS ESM imports
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Timing helper
function logTiming(label: string, startTime: number) {
  const elapsed = Date.now() - startTime;
  console.log(`[WSSI] ${label}: ${elapsed}ms`);
  return elapsed;
}

// JSTS reader/writer for geometry validation
const geometryFactory = new GeometryFactory();
const geoJsonReader = new GeoJSONReader(geometryFactory);
const geoJsonWriter = new GeoJSONWriter();

// Geometry limits to prevent Mapbox triangulation failures
// CRITICAL: These values must be aggressive to prevent diagonal triangles
const MAX_VERTICES_PER_FEATURE = 15000; // Reduced from 50k - Mapbox struggles with complex polygons
const MIN_HOLE_AREA_KM2 = 200; // Remove holes smaller than 200 km² (increased from 100)

// Hard simplification tolerances in METERS (EPSG:3857)
// CRITICAL: Must be large enough to cap vertex count
const SIMPLIFY_TOLERANCE_METERS = {
  overview: 25000, // 25km - very aggressive for national view
  detail: 8000,    // 8km - moderate for zoomed view
};

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

// Smoothing parameters - CURVED edges, not lines
// Heavy pre-simplification + high buffer steps = smooth curves that compute fast
// The key is simplifying BEFORE buffering, then using many buffer segments
const SMOOTH_PARAMS = {
  // Use same params for both resolutions to ensure consistent appearance at all zooms
  overview: {
    preSimplifyTol: 0.03,   // Heavy pre-simplification - reduces points before expensive buffer
    useBuffer: true,        // USE buffer for curved edges
    bufferOut: 60,          // 60km buffer out (~37 miles) - creates curved edges
    bufferIn: 55,           // 55km buffer in - net 5km expansion
    bufferSteps: 48,        // HIGH step count - more segments = smoother curves
    postSimplifyTol: 0.001, // Minimal post-simplification to keep curves smooth
    minAreaKm2: 500,        // Min 500 km² to remove small features
  },
  detail: {
    preSimplifyTol: 0.03,   // Same as overview for consistency
    useBuffer: true,        // Use buffer for curved edges
    bufferOut: 60,          // Same as overview
    bufferIn: 55,           // Same as overview
    bufferSteps: 48,        // Same high step count for curves
    postSimplifyTol: 0.001, // Same minimal simplification
    minAreaKm2: 500,        // Same min area
  },
};

// KV cache key format: wssi:{day}:{res}:{lastModified}
// Lock key format: wssi:lock:{day}:{res}
const KV_CACHE_TTL = 15 * 60; // 15 minutes in seconds
const LOCK_TTL = 60; // 60 seconds lock timeout

interface KVCacheEntry {
  geojson: FeatureCollection;
  metrics: {
    featureCount: number;
    vertexCount: number;
    componentCount: number;
    bytes: number;
  };
  lastModified: string;
  timestamp: number;
}

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
 * This eliminates jagged stair-step edges and fills small gaps
 * Using asymmetric buffer (more out than in) creates slight overlap between bands
 */
function morphologicalSmooth(
  feature: PolygonFeature,
  bufferOutKm: number,
  bufferInKm: number,
  steps: number
): PolygonFeature | null {
  try {
    console.log(`[WSSI] morphologicalSmooth: out=${bufferOutKm}km, in=${bufferInKm}km, steps=${steps}`);

    // Buffer OUT (dilate) - expands the polygon, filling in jagged edges and small gaps
    const bufferedOut = turf.buffer(feature, bufferOutKm, {
      units: 'kilometers',
      steps: steps,
    });

    if (!bufferedOut?.geometry) {
      console.warn('[WSSI] morphologicalSmooth: buffer out returned null');
      return feature;
    }

    // Buffer IN (erode) - contracts back, now with smooth edges
    // Using less than bufferOut creates net expansion for overlap
    const bufferedIn = turf.buffer(bufferedOut, -bufferInKm, {
      units: 'kilometers',
      steps: steps,
    });

    if (!bufferedIn?.geometry) {
      console.warn('[WSSI] morphologicalSmooth: buffer in returned null');
      return feature;
    }

    const beforeVerts = countGeometry(feature).vertices;
    const afterVerts = countGeometry(bufferedIn as PolygonFeature).vertices;
    console.log(`[WSSI] morphologicalSmooth: ${beforeVerts} -> ${afterVerts} vertices`);

    return bufferedIn as PolygonFeature;
  } catch (err) {
    console.warn('[WSSI] Smoothing failed, using original:', err);
    return feature;
  }
}

/**
 * Convert WGS84 (EPSG:4326) to Web Mercator (EPSG:3857)
 */
function toWebMercator(lon: number, lat: number): [number, number] {
  const x = lon * 20037508.34 / 180;
  let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  y = y * 20037508.34 / 180;
  return [x, y];
}

/**
 * Convert Web Mercator (EPSG:3857) to WGS84 (EPSG:4326)
 */
function toWGS84(x: number, y: number): [number, number] {
  const lon = x * 180 / 20037508.34;
  let lat = y * 180 / 20037508.34;
  lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
  return [lon, lat];
}

/**
 * Reproject a ring of coordinates
 */
function reprojectRing(ring: Position[], toMercator: boolean): Position[] {
  return ring.map(coord => {
    if (toMercator) {
      return toWebMercator(coord[0], coord[1]);
    } else {
      return toWGS84(coord[0], coord[1]);
    }
  });
}

/**
 * Reproject entire geometry
 */
function reprojectGeometry(geom: Polygon | MultiPolygon, toMercator: boolean): Polygon | MultiPolygon {
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates.map(ring => reprojectRing(ring, toMercator)),
    };
  } else {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map(poly =>
        poly.map(ring => reprojectRing(ring, toMercator))
      ),
    };
  }
}

/**
 * Make geometry valid using JSTS buffer(0) trick
 */
function makeValid(feature: PolygonFeature): PolygonFeature | null {
  try {
    const jstsGeom = geoJsonReader.read(feature.geometry);

    // buffer(0) is a classic trick to fix self-intersections
    let validGeom = jstsGeom.buffer(0);

    // If still invalid, try more aggressive repair
    if (!validGeom.isValid()) {
      // Use convex hull as fallback (loses detail but guaranteed valid)
      validGeom = jstsGeom.convexHull();
    }

    if (validGeom.isEmpty()) return null;

    const validGeoJson = geoJsonWriter.write(validGeom);

    // Ensure we have a Polygon or MultiPolygon
    if (validGeoJson.type !== 'Polygon' && validGeoJson.type !== 'MultiPolygon') {
      return null;
    }

    return {
      ...feature,
      geometry: validGeoJson as Polygon | MultiPolygon,
    };
  } catch (err) {
    console.warn('[WSSI] makeValid failed:', err);
    return feature; // Return original if validation fails
  }
}

/**
 * Remove small interior holes from polygons
 */
function filterSmallHoles(feature: PolygonFeature): PolygonFeature {
  const minHoleAreaM2 = MIN_HOLE_AREA_KM2 * 1_000_000;
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    // First ring is exterior, rest are holes
    if (geom.coordinates.length <= 1) return feature;

    const filteredRings = [geom.coordinates[0]]; // Keep exterior

    for (let i = 1; i < geom.coordinates.length; i++) {
      try {
        const holePolygon = turf.polygon([geom.coordinates[i]]);
        const holeArea = turf.area(holePolygon);
        if (holeArea >= minHoleAreaM2) {
          filteredRings.push(geom.coordinates[i]);
        }
      } catch {
        // Skip invalid holes
      }
    }

    return {
      ...feature,
      geometry: { type: 'Polygon', coordinates: filteredRings },
    };
  }

  if (geom.type === 'MultiPolygon') {
    const filteredPolygons = geom.coordinates.map(poly => {
      if (poly.length <= 1) return poly;

      const filteredRings = [poly[0]]; // Keep exterior

      for (let i = 1; i < poly.length; i++) {
        try {
          const holePolygon = turf.polygon([poly[i]]);
          const holeArea = turf.area(holePolygon);
          if (holeArea >= minHoleAreaM2) {
            filteredRings.push(poly[i]);
          }
        } catch {
          // Skip invalid holes
        }
      }

      return filteredRings;
    });

    return {
      ...feature,
      geometry: { type: 'MultiPolygon', coordinates: filteredPolygons },
    };
  }

  return feature;
}

/**
 * Hard simplify in EPSG:3857 with meter-based tolerance
 * This guarantees bounded vertex count
 */
function hardSimplify(feature: PolygonFeature, toleranceMeters: number): PolygonFeature {
  try {
    // Reproject to Web Mercator
    const mercatorGeom = reprojectGeometry(feature.geometry, true);
    const mercatorFeature: PolygonFeature = {
      ...feature,
      geometry: mercatorGeom,
    };

    // Simplify with preserveTopology using JSTS for better results
    const jstsGeom = geoJsonReader.read(mercatorGeom);
    const simplifier = new TopologyPreservingSimplifier(jstsGeom);
    simplifier.setDistanceTolerance(toleranceMeters);
    const simplified = simplifier.getResultGeometry();

    if (simplified.isEmpty()) {
      // Fallback: use turf simplify
      const turfSimplified = turf.simplify(mercatorFeature, {
        tolerance: toleranceMeters / 111000, // Convert meters to degrees approx
        highQuality: true,
        mutate: false,
      });

      if (turfSimplified?.geometry) {
        const wgs84Geom = reprojectGeometry(turfSimplified.geometry as Polygon | MultiPolygon, false);
        return { ...feature, geometry: wgs84Geom };
      }
      return feature;
    }

    const simplifiedGeoJson = geoJsonWriter.write(simplified);

    if (simplifiedGeoJson.type !== 'Polygon' && simplifiedGeoJson.type !== 'MultiPolygon') {
      return feature;
    }

    // Reproject back to WGS84
    const wgs84Geom = reprojectGeometry(simplifiedGeoJson as Polygon | MultiPolygon, false);

    return {
      ...feature,
      geometry: wgs84Geom,
    };
  } catch (err) {
    console.warn('[WSSI] hardSimplify failed:', err);
    return feature;
  }
}

/**
 * Ensure vertex count is under limit by increasing simplification if needed
 */
function enforceVertexLimit(feature: PolygonFeature, resolution: 'overview' | 'detail'): PolygonFeature {
  let result = feature;
  let tolerance = SIMPLIFY_TOLERANCE_METERS[resolution];
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const { vertices } = countGeometry(result);

    if (vertices <= MAX_VERTICES_PER_FEATURE) {
      return result;
    }

    console.log(`[WSSI] Vertex count ${vertices} exceeds ${MAX_VERTICES_PER_FEATURE}, increasing tolerance to ${tolerance * 1.5}m`);
    tolerance *= 1.5;
    result = hardSimplify(result, tolerance);
    attempts++;
  }

  // If still too many vertices after max attempts, use very aggressive simplification
  console.warn(`[WSSI] Could not reduce vertices under limit after ${maxAttempts} attempts`);
  return hardSimplify(result, tolerance * 2);
}

/**
 * FINAL GEOMETRY SANITIZATION
 * Applies all fixes to ensure Mapbox can render without triangulation failures
 */
function sanitizeGeometry(feature: PolygonFeature, resolution: 'overview' | 'detail'): PolygonFeature | null {
  const startVertices = countGeometry(feature).vertices;
  console.log(`[WSSI] sanitizeGeometry START: ${startVertices} vertices, resolution=${resolution}`);

  try {
    // Step 1: Make geometry valid using JSTS
    let result = makeValid(feature);
    if (!result) {
      console.warn('[WSSI] sanitizeGeometry: makeValid returned null');
      return null;
    }
    console.log(`[WSSI] After makeValid: ${countGeometry(result).vertices} vertices`);

    // Step 2: Filter small holes
    result = filterSmallHoles(result);
    console.log(`[WSSI] After filterSmallHoles: ${countGeometry(result).vertices} vertices`);

    // Step 3: Hard simplify in EPSG:3857 with meter tolerance
    const tolerance = SIMPLIFY_TOLERANCE_METERS[resolution];
    console.log(`[WSSI] Applying hardSimplify with tolerance ${tolerance}m`);
    result = hardSimplify(result, tolerance);
    console.log(`[WSSI] After hardSimplify: ${countGeometry(result).vertices} vertices`);

    // Step 4: Make valid again after simplification (can introduce issues)
    result = makeValid(result);
    if (!result) {
      console.warn('[WSSI] sanitizeGeometry: makeValid after simplify returned null');
      return null;
    }

    // Step 5: Enforce vertex limit
    result = enforceVertexLimit(result, resolution);
    const finalVertices = countGeometry(result).vertices;
    console.log(`[WSSI] After enforceVertexLimit: ${finalVertices} vertices`);

    // Step 6: Final validation
    result = makeValid(result);
    if (!result) {
      console.warn('[WSSI] sanitizeGeometry: final makeValid returned null');
      return null;
    }

    // Verify we have valid geometry type
    const geomType = result.geometry.type;
    if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') {
      console.warn(`[WSSI] sanitizeGeometry: invalid geometry type ${geomType}`);
      return null;
    }

    console.log(`[WSSI] sanitizeGeometry COMPLETE: ${startVertices} -> ${finalVertices} vertices`);
    return result;
  } catch (err) {
    console.error('[WSSI] sanitizeGeometry failed:', err);
    return null;
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
  // NO SUBTRACTION - keep full extents so bands overlap naturally
  // Higher severity bands render on top of lower severity bands
  const bands: Record<WSSICategory, PolygonFeature | null> = {
    elevated: safeUnion(featuresByCategory.elevated),
    minor: safeUnion(featuresByCategory.minor),
    moderate: safeUnion(featuresByCategory.moderate),
    major: safeUnion(featuresByCategory.major),
    extreme: safeUnion(featuresByCategory.extreme),
  };

  console.log(`[WSSI] Dissolved bands - elevated:${bands.elevated ? 'yes' : 'no'}, minor:${bands.minor ? 'yes' : 'no'}, moderate:${bands.moderate ? 'yes' : 'no'}, major:${bands.major ? 'yes' : 'no'}, extreme:${bands.extreme ? 'yes' : 'no'}`);

  // Process each band with full geometry sanitization pipeline
  const processedFeatures: Feature[] = [];
  let totalVertices = 0;
  let totalComponents = 0;

  for (const category of CATEGORY_ORDER) {
    let band = bands[category];
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

    // Step 3: Remove small fragments early
    const fragCleaned = removeSmallFragments(band, params.minAreaKm2);
    if (!fragCleaned) continue;
    band = fragCleaned;

    // Step 4: MANDATORY GEOMETRY SANITIZATION
    // This is critical to prevent Mapbox triangulation failures
    const sanitized = sanitizeGeometry(band, resolution);
    if (!sanitized) {
      console.warn(`[WSSI] Skipping ${category} - sanitization returned null`);
      continue;
    }
    band = sanitized;

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

    console.log(`[WSSI] ${category}: ${vertices} vertices, ${components} components`);

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
 * HEAD request to get Last-Modified without downloading data
 */
async function getLastModified(day: number): Promise<string> {
  const layerId = WSSI_LAYER_IDS[day];
  if (!layerId) throw new Error(`Invalid day: ${day}`);

  const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  try {
    const response = await fetch(queryUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'maxvelocitywx.com' },
    });

    // ArcGIS might not support HEAD, use Date header or generate key
    const lastModified = response.headers.get('Last-Modified')
      || response.headers.get('Date')
      || new Date().toISOString();

    return lastModified;
  } catch {
    // Fallback: use current timestamp rounded to 15 min for cache coherency
    const now = Date.now();
    const rounded = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
    return new Date(rounded).toISOString();
  }
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

    const lastModified = response.headers.get('Last-Modified')
      || response.headers.get('Date')
      || new Date().toISOString();
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
  const totalStart = Date.now();
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

  console.log(`[WSSI] Request: day=${day}, res=${resolution}`);

  try {
    // Step 1: Get Last-Modified to build cache key
    const headStart = Date.now();
    const lastModified = await getLastModified(day);
    // Sanitize lastModified for use in cache key (remove colons, spaces)
    const lastModKey = lastModified.replace(/[:\s]/g, '-').substring(0, 24);
    logTiming('HEAD request', headStart);

    const cacheKey = `wssi:${day}:${resolution}:${lastModKey}`;
    const lockKey = `wssi:lock:${day}:${resolution}`;
    console.log(`[WSSI] Cache key: ${cacheKey}`);

    // Step 2: Check KV cache
    const cacheStart = Date.now();
    let cached: KVCacheEntry | null = null;
    try {
      cached = await kv.get<KVCacheEntry>(cacheKey);
    } catch (kvErr) {
      console.warn('[WSSI] KV get error (continuing):', kvErr);
    }
    logTiming('KV cache check', cacheStart);

    // Return cached data if valid
    if (cached) {
      console.log(`[WSSI] Cache HIT - returning cached data`);
      logTiming('TOTAL (cached)', totalStart);

      return new NextResponse(JSON.stringify(cached.geojson), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
          'X-WSSI-Last-Modified': cached.lastModified,
          'X-WSSI-Features': String(cached.metrics.featureCount),
          'X-WSSI-Vertices': String(cached.metrics.vertexCount),
          'X-WSSI-Components': String(cached.metrics.componentCount),
          'X-WSSI-Bytes': String(cached.metrics.bytes),
          'X-WSSI-Resolution': resolution,
          'X-WSSI-Cached': 'true',
        },
      });
    }

    console.log(`[WSSI] Cache MISS - checking lock`);

    // Step 3: Check for existing lock (another request is computing)
    const lockStart = Date.now();
    let lockExists = false;
    try {
      lockExists = await kv.exists(lockKey) === 1;
    } catch (kvErr) {
      console.warn('[WSSI] KV lock check error (continuing):', kvErr);
    }
    logTiming('Lock check', lockStart);

    if (lockExists) {
      console.log(`[WSSI] Lock exists - returning 202 Building`);
      return NextResponse.json(
        { status: 'building', message: 'Data is being computed, please retry in 2-3 seconds' },
        {
          status: 202,
          headers: {
            'Retry-After': '3',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    // Step 4: Set lock to prevent stampede
    const setLockStart = Date.now();
    try {
      await kv.set(lockKey, '1', { ex: LOCK_TTL });
    } catch (kvErr) {
      console.warn('[WSSI] KV lock set error (continuing):', kvErr);
    }
    logTiming('Set lock', setLockStart);

    console.log(`[WSSI] Processing day ${day} (${resolution})...`);

    // Step 5: Fetch raw data from NOAA
    const fetchStart = Date.now();
    const { features, lastModified: fetchedLastMod } = await fetchRawWSSI(day);
    logTiming('NOAA fetch', fetchStart);
    console.log(`[WSSI] Fetched ${features.length} raw features`);

    if (features.length === 0) {
      // Clear lock
      try { await kv.del(lockKey); } catch { /* ignore */ }

      const emptyResult: FeatureCollection = { type: 'FeatureCollection', features: [] };
      return NextResponse.json(emptyResult, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
          'X-WSSI-Last-Modified': fetchedLastMod,
          'X-WSSI-Features': '0',
          'X-WSSI-Vertices': '0',
          'X-WSSI-Components': '0',
          'X-WSSI-Bytes': '0',
        },
      });
    }

    // Step 6: Process ONLY the requested resolution (not both)
    const processStart = Date.now();
    const result = processWSSIData(features, day, resolution, fetchedLastMod);
    logTiming('Processing', processStart);

    const payload = JSON.stringify(result.geojson);
    const metrics = { ...result.metrics, bytes: payload.length };

    console.log(`[WSSI] ${resolution}: ${metrics.featureCount}f, ${metrics.vertexCount}v, ${metrics.componentCount}c, ${(metrics.bytes / 1024).toFixed(1)}KB`);

    // Step 7: Store in KV cache
    const storeStart = Date.now();
    const cacheEntry: KVCacheEntry = {
      geojson: result.geojson,
      metrics,
      lastModified: fetchedLastMod,
      timestamp: Date.now(),
    };
    try {
      await kv.set(cacheKey, cacheEntry, { ex: KV_CACHE_TTL });
    } catch (kvErr) {
      console.warn('[WSSI] KV store error (continuing):', kvErr);
    }
    logTiming('KV store', storeStart);

    // Step 8: Clear lock
    try { await kv.del(lockKey); } catch { /* ignore */ }

    const totalTime = logTiming('TOTAL', totalStart);
    console.log(`[WSSI] Day ${day} (${resolution}) complete`);

    return new NextResponse(payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
        'X-WSSI-Last-Modified': fetchedLastMod,
        'X-WSSI-Features': String(metrics.featureCount),
        'X-WSSI-Vertices': String(metrics.vertexCount),
        'X-WSSI-Components': String(metrics.componentCount),
        'X-WSSI-Bytes': String(metrics.bytes),
        'X-WSSI-Resolution': resolution,
        'X-WSSI-Processing-Time': String(totalTime),
        'X-WSSI-Cached': 'false',
      },
    });
  } catch (error) {
    console.error('[WSSI] Error:', error);

    // Try to clear lock on error
    try {
      const lastModKey = new Date().toISOString().replace(/[:\s]/g, '-').substring(0, 24);
      await kv.del(`wssi:lock:${day}:${resolution}`);
    } catch { /* ignore */ }

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
