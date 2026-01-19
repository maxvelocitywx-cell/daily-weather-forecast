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

// Smoothing parameters - ALL VALUES IN METERS
// Pipeline: pre-simplify (light) -> Chaikin smoothing ONLY (no buffer, no post-simplify)
// Goal: FULLY ROUNDED boundaries with NO corners or straight edges
const SMOOTH_PARAMS = {
  overview: {
    // Pre-simplify: VERY LIGHT - just remove duplicate points, not shape
    // 3km was too aggressive and creating jagged edges BEFORE Chaikin could smooth
    preSimplifyMeters: 500,         // 0.5km - minimal, preserves shape for Chaikin
    // Chaikin smoothing iterations (each iteration cuts corners)
    // More iterations = smoother curves, but more vertices
    chaikinIterations: 6,           // 6 iterations for smooth curves
    // NO post-simplify - it destroys the smooth curves
    postSimplifyMeters: 0,          // DISABLED
    minAreaKm2: 50,                 // Reduced from 400 - allow smaller polygons like Major (1296 km²)
  },
  detail: {
    preSimplifyMeters: 500,         // 0.5km - same light pre-simplify
    chaikinIterations: 6,
    postSimplifyMeters: 0,          // DISABLED
    minAreaKm2: 50,                 // Reduced from 400
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
function extractCategory(properties: Record<string, unknown>, debug: boolean = false): WSSICategory | null {
  const possibleProps = ['impact', 'idp_wssilabel', 'label', 'Label', 'LABEL', 'name', 'Name'];

  for (const prop of possibleProps) {
    if (properties[prop]) {
      const value = String(properties[prop]).toLowerCase().trim();

      if (debug) {
        console.log(`[WSSI] extractCategory: prop="${prop}", raw="${properties[prop]}", normalized="${value}"`);
      }

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

      if (debug) {
        console.log(`[WSSI] extractCategory: NO MATCH for value="${value}"`);
      }
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
 * Calculate Euclidean distance between two points in EPSG:3857 (meters)
 */
function distanceMeters(p1: Position, p2: Position): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Interpolate between two points
 */
function interpolatePoint(p1: Position, p2: Position, t: number): Position {
  return [
    p1[0] + (p2[0] - p1[0]) * t,
    p1[1] + (p2[1] - p1[1]) * t,
  ];
}

/**
 * Densify a ring by inserting points along long segments (works in EPSG:3857 meters)
 * This prevents visible straight edges after buffering
 */
function densifyRingMeters(ring: Position[], maxSegmentMeters: number, intervalMeters: number): Position[] {
  if (ring.length < 2) return ring;

  const result: Position[] = [];

  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];

    result.push(p1);

    const dist = distanceMeters(p1, p2);

    if (dist > maxSegmentMeters) {
      // Insert points along this segment
      const numPoints = Math.ceil(dist / intervalMeters) - 1;
      for (let j = 1; j <= numPoints; j++) {
        const t = j / (numPoints + 1);
        result.push(interpolatePoint(p1, p2, t));
      }
    }
  }

  // Add closing point
  result.push(ring[ring.length - 1]);

  return result;
}

/**
 * Densify a geometry by inserting points along long straight segments (EPSG:3857 meters)
 * MUST be called on geometry already in EPSG:3857
 */
function densifyGeometryMeters(geom: Polygon | MultiPolygon, maxSegmentMeters: number, intervalMeters: number): Polygon | MultiPolygon {
  if (geom.type === 'Polygon') {
    const densifiedCoords = geom.coordinates.map(ring =>
      densifyRingMeters(ring, maxSegmentMeters, intervalMeters)
    );
    return { type: 'Polygon', coordinates: densifiedCoords };
  }

  if (geom.type === 'MultiPolygon') {
    const densifiedCoords = geom.coordinates.map(poly =>
      poly.map(ring => densifyRingMeters(ring, maxSegmentMeters, intervalMeters))
    );
    return { type: 'MultiPolygon', coordinates: densifiedCoords };
  }

  return geom;
}

/**
 * Buffer a JSTS geometry (in EPSG:3857 meters)
 * Uses round joins for smooth curves
 */
function jstsBuffer(jstsGeom: ReturnType<typeof geoJsonReader.read>, distanceMeters: number, steps: number): ReturnType<typeof geoJsonReader.read> {
  // JSTS buffer uses quadrantSegments parameter for smoothness
  // More segments = smoother curves
  const quadSegs = Math.max(8, Math.floor(steps / 4));
  return jstsGeom.buffer(distanceMeters, quadSegs);
}

/**
 * Chaikin's corner-cutting algorithm for smoothing a ring
 * Each iteration replaces each edge with two new points at 1/4 and 3/4 positions
 * This creates increasingly smooth curves
 */
function chaikinSmoothRing(ring: Position[], iterations: number): Position[] {
  if (ring.length < 3 || iterations <= 0) return ring;

  let result = ring.slice();

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: Position[] = [];
    const n = result.length;

    // For closed rings, we need to handle wrap-around
    // The last point equals the first, so we iterate through n-1 segments
    for (let i = 0; i < n - 1; i++) {
      const p0 = result[i];
      const p1 = result[i + 1];

      // Q = 3/4 * P0 + 1/4 * P1 (point at 25% along edge)
      const q: Position = [
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
      ];

      // R = 1/4 * P0 + 3/4 * P1 (point at 75% along edge)
      const r: Position = [
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
      ];

      smoothed.push(q, r);
    }

    // Close the ring
    if (smoothed.length > 0) {
      smoothed.push([...smoothed[0]]);
    }

    result = smoothed;
  }

  return result;
}

/**
 * Apply Chaikin smoothing to a polygon geometry
 */
function chaikinSmoothGeometry(geom: Polygon | MultiPolygon, iterations: number): Polygon | MultiPolygon {
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates.map(ring => chaikinSmoothRing(ring, iterations)),
    };
  }

  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map(poly =>
        poly.map(ring => chaikinSmoothRing(ring, iterations))
      ),
    };
  }

  return geom;
}

/**
 * Apply smoothing using Chaikin's corner-cutting algorithm ONLY
 * Pipeline: pre-simplify -> Chaikin smoothing (no buffer, no post-simplify)
 * This keeps polygons valid and produces genuinely smooth curves
 */
function smoothGeometryWithTurf(
  feature: PolygonFeature,
  params: typeof SMOOTH_PARAMS.overview
): PolygonFeature | null {
  try {
    let result = feature;
    const startVertices = countGeometry(feature).vertices;
    console.log(`[WSSI] smoothGeometryWithTurf START: ${startVertices} vertices`);

    // Step 1: PRE-SIMPLIFY (remove grid stair-steps before smoothing)
    const preSimplifyDegrees = params.preSimplifyMeters / 111000;
    try {
      const simplified = turf.simplify(result, {
        tolerance: preSimplifyDegrees,
        highQuality: true,  // Use high quality for better corner preservation
        mutate: false,
      });
      if (simplified?.geometry) {
        result = simplified as PolygonFeature;
      }
    } catch (e) {
      console.warn('[WSSI] Pre-simplify failed:', e);
    }
    console.log(`[WSSI] After pre-simplify: ${countGeometry(result).vertices} vertices`);

    // Step 2: CHAIKIN SMOOTHING - iteratively cut corners for smooth curves
    // This is the ONLY smoothing step - no buffers that can create artifacts
    if (params.chaikinIterations > 0) {
      const smoothedGeom = chaikinSmoothGeometry(
        result.geometry as Polygon | MultiPolygon,
        params.chaikinIterations
      );
      result = { ...result, geometry: smoothedGeom };
      console.log(`[WSSI] After Chaikin (${params.chaikinIterations} iterations): ${countGeometry(result).vertices} vertices`);
    }

    // NO POST-SIMPLIFY - it would destroy the smooth curves we just created

    console.log(`[WSSI] smoothGeometryWithTurf COMPLETE: ${startVertices} -> ${countGeometry(result).vertices} vertices`);
    return result;
  } catch (err) {
    console.error('[WSSI] smoothGeometryWithTurf failed:', err);
    return null;
  }
}

/**
 * Densify a feature in WGS84 coordinates (degrees)
 */
function densifyFeatureWGS84(feature: PolygonFeature, maxSegmentDeg: number, intervalDeg: number): PolygonFeature {
  const geom = feature.geometry;

  const densifyRingWGS84 = (ring: Position[]): Position[] => {
    if (ring.length < 2) return ring;
    const result: Position[] = [];

    for (let i = 0; i < ring.length - 1; i++) {
      const p1 = ring[i];
      const p2 = ring[i + 1];
      result.push(p1);

      // Calculate distance in degrees (rough approximation)
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxSegmentDeg) {
        const numPoints = Math.ceil(dist / intervalDeg) - 1;
        for (let j = 1; j <= numPoints; j++) {
          const t = j / (numPoints + 1);
          result.push([
            p1[0] + (p2[0] - p1[0]) * t,
            p1[1] + (p2[1] - p1[1]) * t,
          ]);
        }
      }
    }
    result.push(ring[ring.length - 1]);
    return result;
  };

  if (geom.type === 'Polygon') {
    return {
      ...feature,
      geometry: {
        type: 'Polygon',
        coordinates: geom.coordinates.map(densifyRingWGS84),
      },
    };
  }

  if (geom.type === 'MultiPolygon') {
    return {
      ...feature,
      geometry: {
        type: 'MultiPolygon',
        coordinates: geom.coordinates.map(poly =>
          poly.map(densifyRingWGS84)
        ),
      },
    };
  }

  return feature;
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
 * Create smooth contours from polygon data using grid interpolation
 * This converts angular county-based polygons into smooth organic blobs
 */
function createSmoothContours(
  bands: Record<WSSICategory, PolygonFeature | null>,
  cellSize: number = 0.1 // degrees - smaller = smoother but slower
): Record<WSSICategory, PolygonFeature | null> {
  console.log(`[WSSI] Creating smooth contours with cellSize=${cellSize}°`);

  // Debug: Log which categories exist in raw data
  console.log(`[WSSI] Raw bands present:`);
  for (const category of CATEGORY_ORDER) {
    const band = bands[category];
    if (band) {
      const area = turf.area(band) / 1_000_000; // km²
      console.log(`  - ${category}: YES (area: ${area.toFixed(0)} km²)`);
    } else {
      console.log(`  - ${category}: NO`);
    }
  }

  // Calculate bounding box of all features
  const allFeatures: PolygonFeature[] = [];
  for (const category of CATEGORY_ORDER) {
    if (bands[category]) allFeatures.push(bands[category]!);
  }

  if (allFeatures.length === 0) {
    return { elevated: null, minor: null, moderate: null, major: null, extreme: null };
  }

  // Get combined bbox with padding
  const fc = turf.featureCollection(allFeatures);
  const bbox = turf.bbox(fc);
  const padding = 0.5; // degrees
  const paddedBbox: [number, number, number, number] = [
    bbox[0] - padding,
    bbox[1] - padding,
    bbox[2] + padding,
    bbox[3] + padding,
  ];

  console.log(`[WSSI] Grid bbox: [${paddedBbox.map(v => v.toFixed(2)).join(', ')}]`);

  // Create a grid of points
  const gridStart = Date.now();
  const grid = turf.pointGrid(paddedBbox, cellSize, { units: 'degrees' });
  console.log(`[WSSI] Created grid with ${grid.features.length} points in ${Date.now() - gridStart}ms`);

  // Category values: elevated=1, minor=2, moderate=3, major=4, extreme=5
  const categoryValue: Record<WSSICategory, number> = {
    elevated: 1,
    minor: 2,
    moderate: 3,
    major: 4,
    extreme: 5,
  };

  // For each point, determine the highest WSSI category it falls in
  const sampleStart = Date.now();
  const valueCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const point of grid.features) {
    let maxValue = 0;

    // Check each category from highest to lowest
    for (const category of [...CATEGORY_ORDER].reverse()) {
      const band = bands[category];
      if (!band) continue;

      try {
        if (turf.booleanPointInPolygon(point, band)) {
          maxValue = Math.max(maxValue, categoryValue[category]);
          break; // Found highest, no need to check lower categories
        }
      } catch {
        // Skip invalid geometries
      }
    }

    point.properties = { ...point.properties, value: maxValue };
    valueCounts[maxValue]++;
  }

  console.log(`[WSSI] Sampled grid in ${Date.now() - sampleStart}ms`);
  console.log(`[WSSI] Grid value distribution:`);
  console.log(`  - 0 (none): ${valueCounts[0]} points`);
  console.log(`  - 1 (elevated): ${valueCounts[1]} points`);
  console.log(`  - 2 (minor): ${valueCounts[2]} points`);
  console.log(`  - 3 (moderate): ${valueCounts[3]} points`);
  console.log(`  - 4 (major): ${valueCounts[4]} points`);
  console.log(`  - 5 (extreme): ${valueCounts[5]} points`);

  // Generate isobands for each category threshold
  const contourStart = Date.now();
  const smoothBands: Record<WSSICategory, PolygonFeature | null> = {
    elevated: null,
    minor: null,
    moderate: null,
    major: null,
    extreme: null,
  };

  // Create isobands: value >= threshold means inside that category
  // elevated: value >= 1, minor: value >= 2, etc.
  const thresholds: [WSSICategory, number, number][] = [
    ['elevated', 0.5, 1.5],   // catches value 1
    ['minor', 1.5, 2.5],      // catches value 2
    ['moderate', 2.5, 3.5],   // catches value 3
    ['major', 3.5, 4.5],      // catches value 4
    ['extreme', 4.5, 5.5],    // catches value 5
  ];

  // Chaikin smoothing for contour coordinates - creates smooth curves from angular isobands
  function chaikinSmoothCoords(coords: number[][], iterations: number = 4): number[][] {
    let result = [...coords];
    for (let iter = 0; iter < iterations; iter++) {
      const smoothed: number[][] = [];
      for (let i = 0; i < result.length - 1; i++) {
        const p0 = result[i];
        const p1 = result[i + 1];
        smoothed.push([
          0.75 * p0[0] + 0.25 * p1[0],
          0.75 * p0[1] + 0.25 * p1[1]
        ]);
        smoothed.push([
          0.25 * p0[0] + 0.75 * p1[0],
          0.25 * p0[1] + 0.75 * p1[1]
        ]);
      }
      // Close the ring
      if (smoothed.length > 0) {
        smoothed.push(smoothed[0]);
      }
      result = smoothed;
    }
    return result;
  }

  for (const [category, minVal, maxVal] of thresholds) {
    try {
      // Use isobands to create filled regions
      const isobands = turf.isobands(grid, [minVal, maxVal], { zProperty: 'value' });

      // Early simplification for performance - reduce vertex count immediately
      for (let i = 0; i < isobands.features.length; i++) {
        try {
          const simplified = turf.simplify(isobands.features[i], { tolerance: 0.05, highQuality: false });
          if (simplified && simplified.geometry) {
            (isobands.features[i] as Feature).geometry = simplified.geometry;
          }
        } catch {
          // Keep original if simplify fails
        }
      }

      console.log(`[WSSI] Isobands for ${category} (${minVal}-${maxVal}): ${isobands.features.length} features`);
      isobands.features.forEach((f, i) => {
        const props = f.properties as { value?: string } | undefined;
        const fArea = f.geometry ? turf.area(f as Feature<Polygon | MultiPolygon>) / 1_000_000 : 0;
        console.log(`  Feature ${i}: value="${props?.value}", area=${fArea.toFixed(0)} km²`);
      });

      if (isobands.features.length > 0) {
        // Find the band that represents this category (value between minVal and maxVal)
        const categoryBand = isobands.features.find(f => {
          const props = f.properties as { value?: string } | undefined;
          return props?.value === `${minVal}-${maxVal}`;
        });

        if (categoryBand && categoryBand.geometry) {
          const initialArea = turf.area(categoryBand as Feature<Polygon | MultiPolygon>) / 1_000_000;
          console.log(`[WSSI] Found ${category} band with initial area: ${initialArea.toFixed(0)} km²`);

          // === STEP 1: Simplify first to reduce vertices ===
          let workingFeature: PolygonFeature = {
            type: 'Feature',
            geometry: categoryBand.geometry as Polygon | MultiPolygon,
            properties: categoryBand.properties || {},
          };

          try {
            const simplified = turf.simplify(workingFeature, { tolerance: 0.1, highQuality: true });
            if (simplified && simplified.geometry) {
              workingFeature = simplified as PolygonFeature;
              console.log(`[WSSI] Simplified ${category} contour`);
            }
          } catch (simplifyErr) {
            console.warn(`[WSSI] Simplify failed for ${category}:`, simplifyErr);
          }

          // === STEP 2: Apply Chaikin smoothing (more iterations for rounder curves) ===
          let smoothedGeom = workingFeature.geometry as Polygon | MultiPolygon;

          if (smoothedGeom.type === 'Polygon') {
            smoothedGeom = {
              type: 'Polygon',
              coordinates: smoothedGeom.coordinates.map(ring => chaikinSmoothCoords(ring, 7)) // 7 iterations
            };
          } else if (smoothedGeom.type === 'MultiPolygon') {
            smoothedGeom = {
              type: 'MultiPolygon',
              coordinates: smoothedGeom.coordinates.map(polygon =>
                polygon.map(ring => chaikinSmoothCoords(ring, 7)) // 7 iterations
              )
            };
          }

          console.log(`[WSSI] Applied Chaikin smoothing (7 iterations) to ${category} contour`);

          // === STEP 3: Remove holes from polygons ===
          if (smoothedGeom.type === 'Polygon') {
            const origRings = smoothedGeom.coordinates.length;
            if (origRings > 1) {
              console.log(`[WSSI] Removing ${origRings - 1} holes from ${category} Polygon`);
              smoothedGeom = {
                type: 'Polygon',
                coordinates: [smoothedGeom.coordinates[0]]
              };
            }
          } else if (smoothedGeom.type === 'MultiPolygon') {
            let totalHolesRemoved = 0;
            smoothedGeom = {
              type: 'MultiPolygon',
              coordinates: smoothedGeom.coordinates.map(polygon => {
                if (polygon.length > 1) {
                  totalHolesRemoved += polygon.length - 1;
                }
                return [polygon[0]];
              })
            };
            if (totalHolesRemoved > 0) {
              console.log(`[WSSI] Removed ${totalHolesRemoved} holes from ${category} MultiPolygon`);
            }
          }

          // === STEP 4: Buffer out then in to round corners (pillow effect) ===
          // Buffer amounts reduced for performance (avoid 504 timeouts)
          // - Low severity (elevated/minor) = moderate buffer for smoothing
          // - High severity (major/extreme) = NO buffer, preserve original shape
          function getBufferAmounts(cat: WSSICategory): { out: number; inAmt: number; minArea: number } | null {
            switch (cat) {
              case 'elevated':
                return { out: 12, inAmt: 10, minArea: 200 }; // Reduced from 25/20 for performance
              case 'minor':
                return { out: 10, inAmt: 8, minArea: 150 };  // Reduced from 20/16 for performance
              case 'moderate':
                return { out: 3, inAmt: 2, minArea: 100 };   // Keep small
              case 'major':
                return null; // No buffer - preserve small polygons
              case 'extreme':
                return null; // No buffer - preserve small polygons
              default:
                return { out: 6, inAmt: 5, minArea: 150 };
            }
          }

          let finalFeature: PolygonFeature = {
            type: 'Feature',
            geometry: smoothedGeom,
            properties: categoryBand.properties || {},
          };

          // Check area BEFORE buffering
          const preBufferArea = turf.area(finalFeature) / 1_000_000; // km²
          const bufferConfig = getBufferAmounts(category);

          // Skip buffer for major/extreme (bufferConfig is null)
          if (!bufferConfig) {
            console.log(`[WSSI] ${category} pre-buffer area: ${preBufferArea.toFixed(0)} km², SKIPPING buffer (high severity category)`);
          } else {
            console.log(`[WSSI] ${category} pre-buffer area: ${preBufferArea.toFixed(0)} km², buffer config: out=${bufferConfig.out}km, in=${bufferConfig.inAmt}km, minArea=${bufferConfig.minArea}km²`);

            // Only apply buffer if polygon is large enough for this category's buffer
            if (preBufferArea > bufferConfig.minArea) {
              try {
                const bufferedOut = turf.buffer(finalFeature, bufferConfig.out, { units: 'kilometers' });
                if (bufferedOut && bufferedOut.geometry) {
                  const bufferedIn = turf.buffer(bufferedOut, -bufferConfig.inAmt, { units: 'kilometers' });
                  if (bufferedIn && bufferedIn.geometry) {
                    const postBufferArea = turf.area(bufferedIn) / 1_000_000;
                    // Only use buffered result if it still has reasonable area (> 10 km²)
                    if (postBufferArea > 10) {
                      finalFeature = {
                        type: 'Feature',
                        geometry: bufferedIn.geometry as Polygon | MultiPolygon,
                        properties: categoryBand.properties || {},
                      };
                      console.log(`[WSSI] Applied buffer rounding to ${category} (${preBufferArea.toFixed(0)} -> ${postBufferArea.toFixed(0)} km²)`);
                    } else {
                      console.log(`[WSSI] Skipped buffer for ${category} - would reduce to ${postBufferArea.toFixed(0)} km²`);
                    }
                  } else {
                    console.log(`[WSSI] Buffer in returned null for ${category}, keeping original`);
                  }
                }
              } catch (bufferErr) {
                console.warn(`[WSSI] Buffer rounding failed for ${category}:`, bufferErr);
                // Keep the smoothed geometry if buffer fails
              }
            } else {
              console.log(`[WSSI] Skipped buffer for ${category} - area ${preBufferArea.toFixed(0)} km² < minArea ${bufferConfig.minArea} km²`);
            }
          }

          // === STEP 5: Fix winding order ===
          try {
            finalFeature = turf.rewind(finalFeature, { reverse: false }) as PolygonFeature;
            console.log(`[WSSI] Fixed winding order for ${category}`);
          } catch (rewindErr) {
            console.warn(`[WSSI] Rewind failed for ${category}:`, rewindErr);
          }

          // Debug: check for zero-area polygons
          const area = turf.area(finalFeature);
          if (area === 0) {
            console.warn(`[WSSI] WARNING: Zero area polygon for ${category}!`);
          } else {
            console.log(`[WSSI] ${category} area: ${(area / 1_000_000).toFixed(0)} km²`);
          }

          smoothBands[category] = finalFeature;
          console.log(`[WSSI] Created isoband for ${category}`);
        }
      }
    } catch (err) {
      console.warn(`[WSSI] Failed to create isoband for ${category}:`, err);
    }
  }

  console.log(`[WSSI] Generated contours in ${Date.now() - contourStart}ms`);

  // Debug: Log detailed contour info to diagnose hollow circle issue
  console.log('[WSSI] Contour geometry details:');
  for (const category of CATEGORY_ORDER) {
    const band = smoothBands[category];
    if (!band || !band.geometry) {
      console.log(`  ${category}: null`);
      continue;
    }
    const geom = band.geometry;
    if (geom.type === 'Polygon') {
      console.log(`  ${category}: Polygon with ${geom.coordinates.length} rings (1=solid, >1=has holes)`);
      geom.coordinates.forEach((ring, i) => {
        console.log(`    ring ${i}: ${ring.length} vertices`);
      });
    } else if (geom.type === 'MultiPolygon') {
      console.log(`  ${category}: MultiPolygon with ${geom.coordinates.length} polygons`);
      geom.coordinates.forEach((poly, pi) => {
        console.log(`    polygon ${pi}: ${poly.length} rings (1=solid, >1=has holes)`);
        poly.forEach((ring, ri) => {
          console.log(`      ring ${ri}: ${ring.length} vertices`);
        });
      });
    }
  }

  return smoothBands;
}

/**
 * Process raw WSSI data into smooth contoured bands
 */
function processWSSIData(
  rawFeatures: Feature[],
  day: number,
  resolution: 'overview' | 'detail',
  lastModified: string
): { geojson: FeatureCollection; metrics: { featureCount: number; vertexCount: number; componentCount: number } } {

  const params = SMOOTH_PARAMS[resolution];

  // Debug: Log raw NOAA feature properties to understand category mapping
  console.log(`[WSSI] Raw NOAA features: ${rawFeatures.length} total`);
  const rawCategoryCounts: Record<string, number> = {};
  const unmappedProps: string[] = [];

  for (const feature of rawFeatures) {
    const props = feature.properties || {};
    // Check all possible category properties
    const possibleValues = [
      props.impact,
      props.idp_wssilabel,
      props.label,
      props.Label,
      props.LABEL,
      props.name,
      props.Name,
    ].filter(Boolean);

    const catValue = possibleValues[0] ? String(possibleValues[0]) : 'UNKNOWN';
    rawCategoryCounts[catValue] = (rawCategoryCounts[catValue] || 0) + 1;

    // Log first few unmapped features
    const category = extractCategory(props as Record<string, unknown>);
    if (!category && unmappedProps.length < 3) {
      unmappedProps.push(JSON.stringify(props).slice(0, 200));
    }
  }

  console.log('[WSSI] Raw NOAA categories found:', rawCategoryCounts);
  if (unmappedProps.length > 0) {
    console.log('[WSSI] Unmapped feature props samples:', unmappedProps);
  }

  // Group features by category
  const featuresByCategory: Record<WSSICategory, PolygonFeature[]> = {
    elevated: [],
    minor: [],
    moderate: [],
    major: [],
    extreme: [],
  };

  let featureIdx = 0;
  for (const feature of rawFeatures) {
    if (!feature.geometry) {
      console.log(`[WSSI] Feature ${featureIdx}: skipped - no geometry`);
      featureIdx++;
      continue;
    }
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
      console.log(`[WSSI] Feature ${featureIdx}: skipped - geometry type ${feature.geometry.type}`);
      featureIdx++;
      continue;
    }

    // Enable debug for first 5 features
    const category = extractCategory((feature.properties || {}) as Record<string, unknown>, featureIdx < 5);
    if (!category) {
      console.log(`[WSSI] Feature ${featureIdx}: skipped - no category match, props: ${JSON.stringify(feature.properties).slice(0, 200)}`);
      featureIdx++;
      continue;
    }

    console.log(`[WSSI] Feature ${featureIdx}: mapped to "${category}"`);
    featuresByCategory[category].push(feature as PolygonFeature);
    featureIdx++;
  }

  console.log(`[WSSI] Features by mapped category: elevated=${featuresByCategory.elevated.length}, minor=${featuresByCategory.minor.length}, moderate=${featuresByCategory.moderate.length}, major=${featuresByCategory.major.length}, extreme=${featuresByCategory.extreme.length}`);

  // Union features within each category (dissolve)
  const rawBands: Record<WSSICategory, PolygonFeature | null> = {
    elevated: safeUnion(featuresByCategory.elevated),
    minor: safeUnion(featuresByCategory.minor),
    moderate: safeUnion(featuresByCategory.moderate),
    major: safeUnion(featuresByCategory.major),
    extreme: safeUnion(featuresByCategory.extreme),
  };

  console.log(`[WSSI] Dissolved bands - elevated:${rawBands.elevated ? 'yes' : 'no'}, minor:${rawBands.minor ? 'yes' : 'no'}, moderate:${rawBands.moderate ? 'yes' : 'no'}, major:${rawBands.major ? 'yes' : 'no'}, extreme:${rawBands.extreme ? 'yes' : 'no'}`);

  // === DIFFERENT APPROACHES FOR DIFFERENT SEVERITY LEVELS ===
  // - Elevated/Minor: Skip isobands, use original NOAA polygons with buffer smoothing
  //   (isobands create isolated circles/artifacts for these large areas)
  // - Moderate/Major/Extreme: Use isobands for more precise contours, or fallback to originals

  // Helper: Chaikin smoothing for coordinates
  const chaikinSmooth = (coords: number[][], iterations: number): number[][] => {
    let result = [...coords];
    for (let iter = 0; iter < iterations; iter++) {
      const smoothed: number[][] = [];
      for (let i = 0; i < result.length - 1; i++) {
        const p0 = result[i];
        const p1 = result[i + 1];
        smoothed.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
        smoothed.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
      }
      if (smoothed.length > 0) smoothed.push(smoothed[0]);
      result = smoothed;
    }
    return result;
  };

  // Helper: Apply Chaikin to a geometry
  const applyChaikinToGeometry = (geom: Polygon | MultiPolygon, iterations: number): Polygon | MultiPolygon => {
    if (geom.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: geom.coordinates.map(ring => chaikinSmooth(ring, iterations))
      };
    } else {
      return {
        type: 'MultiPolygon',
        coordinates: geom.coordinates.map(polygon =>
          polygon.map(ring => chaikinSmooth(ring, iterations))
        )
      };
    }
  };

  // Initialize smoothBands with nulls
  const smoothBands: Record<WSSICategory, PolygonFeature | null> = {
    elevated: null,
    minor: null,
    moderate: null,
    major: null,
    extreme: null,
  };

  // === ELEVATED/MINOR: Use original NOAA polygons with buffer smoothing ===
  // Skip isobands entirely - they create isolated circles/artifacts
  for (const cat of ['elevated', 'minor'] as const) {
    if (rawBands[cat]) {
      console.log(`[WSSI] ${cat}: Using original NOAA polygon with buffer smoothing (skipping isobands)`);
      const original = rawBands[cat]!;

      try {
        // Buffer out then in to smooth jagged county edges
        let smoothed = turf.buffer(original, 8, { units: 'kilometers' });
        if (smoothed && smoothed.geometry) {
          smoothed = turf.buffer(smoothed, -5, { units: 'kilometers' });
        }

        if (smoothed && smoothed.geometry) {
          // Apply Chaikin smoothing
          const smoothedGeom = applyChaikinToGeometry(smoothed.geometry as Polygon | MultiPolygon, 4);

          // Fix winding order
          let smoothedFeature: PolygonFeature = {
            type: 'Feature',
            geometry: smoothedGeom,
            properties: original.properties || {},
          };

          try {
            smoothedFeature = turf.rewind(smoothedFeature, { reverse: false }) as PolygonFeature;
          } catch (e) {
            console.warn(`[WSSI] Rewind failed for ${cat}:`, e);
          }

          const area = turf.area(smoothedFeature) / 1_000_000;
          console.log(`[WSSI] ${cat} smoothed with buffer, area: ${area.toFixed(0)} km²`);
          smoothBands[cat] = smoothedFeature;
        } else {
          // Fallback: just use original with Chaikin
          console.log(`[WSSI] ${cat}: Buffer failed, using original with Chaikin only`);
          const smoothedGeom = applyChaikinToGeometry(original.geometry as Polygon | MultiPolygon, 4);
          smoothBands[cat] = {
            type: 'Feature',
            geometry: smoothedGeom,
            properties: original.properties || {},
          };
        }
      } catch (e) {
        console.warn(`[WSSI] ${cat} smoothing failed, using original:`, e);
        smoothBands[cat] = original;
      }
    }
  }

  // === MODERATE/MAJOR/EXTREME: Use isobands for precise contours ===
  // Only run isobands for these categories (smaller, need precision)
  const cellSize = resolution === 'overview' ? 0.2 : 0.15;
  const isobandCategories: Record<WSSICategory, PolygonFeature | null> = {
    elevated: null, // Already handled above
    minor: null,    // Already handled above
    moderate: rawBands.moderate,
    major: rawBands.major,
    extreme: rawBands.extreme,
  };
  const isobandResults = createSmoothContours(isobandCategories, cellSize);

  // Copy isoband results for moderate/major/extreme
  for (const cat of ['moderate', 'major', 'extreme'] as const) {
    if (isobandResults[cat]) {
      smoothBands[cat] = isobandResults[cat];
    } else if (rawBands[cat]) {
      // Fallback: use original with Chaikin if isobands failed
      console.log(`[WSSI] ${cat} lost in isobands, using original with Chaikin`);
      const original = rawBands[cat]!;
      const smoothedGeom = applyChaikinToGeometry(original.geometry as Polygon | MultiPolygon, 4);
      let smoothedFeature: PolygonFeature = {
        type: 'Feature',
        geometry: smoothedGeom,
        properties: original.properties || {},
      };

      try {
        smoothedFeature = turf.rewind(smoothedFeature, { reverse: false }) as PolygonFeature;
      } catch (e) {
        console.warn(`[WSSI] Rewind failed for ${cat}:`, e);
      }

      smoothBands[cat] = smoothedFeature;
      const area = turf.area(smoothedFeature) / 1_000_000;
      console.log(`[WSSI] ${cat} recovered via direct smoothing, area: ${area.toFixed(0)} km²`);
    }
  }

  // Process each smooth band
  const processedFeatures: Feature[] = [];
  let totalVertices = 0;
  let totalComponents = 0;

  for (const category of CATEGORY_ORDER) {
    const band = smoothBands[category];
    if (!band?.geometry) continue;

    console.log(`[WSSI] Processing ${category}...`);

    // Apply light Chaikin smoothing to further refine the contours
    let smoothedBand: PolygonFeature | null = band;

    if (params.chaikinIterations > 0) {
      const smoothedGeom = chaikinSmoothGeometry(
        band.geometry as Polygon | MultiPolygon,
        Math.min(params.chaikinIterations, 3) // Limit iterations since contours are already smooth
      );
      smoothedBand = { ...band, geometry: smoothedGeom };
    }

    // Remove small fragments
    const fragCleaned = removeSmallFragments(smoothedBand, params.minAreaKm2);
    if (!fragCleaned) {
      console.warn(`[WSSI] Skipping ${category} - too small after smoothing`);
      continue;
    }
    smoothedBand = fragCleaned;

    // NOTE: Removed slow union/merge operation for performance
    // The buffer expansion alone provides smoothing without expensive turf.union calls

    const riskInfo = WSSI_TO_RISK[category];
    const { vertices, components } = countGeometry(smoothedBand);
    totalVertices += vertices;
    totalComponents += components;

    console.log(`[WSSI] ${category}: ${vertices} vertices, ${components} components`);

    processedFeatures.push({
      type: 'Feature',
      geometry: smoothedBand.geometry,
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

  // Log final categories that made it to output
  const finalCategories = processedFeatures.map(f => f.properties?.category).join(', ');
  console.log(`[WSSI] Final output categories: ${finalCategories || 'NONE'}`);
  console.log(`[WSSI] Final feature count: ${processedFeatures.length}, vertices: ${totalVertices}, components: ${totalComponents}`);

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
  console.log(`[WSSI] Fetching from NOAA: ${queryUrl}`);

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

    // === DETAILED DEBUG LOGGING ===
    console.log(`[WSSI] Raw NOAA response: ${rawData.features?.length || 0} features`);

    // Log ALL unique impact values found
    const impactValues = new Set<string>();
    const propertyKeys = new Set<string>();

    for (const feature of rawData.features || []) {
      const props = feature.properties || {};
      // Collect all property keys
      Object.keys(props).forEach(k => propertyKeys.add(k));
      // Collect impact values
      if (props.impact) impactValues.add(String(props.impact));
      if (props.Impact) impactValues.add(String(props.Impact));
      if (props.IMPACT) impactValues.add(String(props.IMPACT));
    }

    console.log(`[WSSI] All property keys in response: ${[...propertyKeys].join(', ')}`);
    console.log(`[WSSI] All unique impact values: ${[...impactValues].join(', ')}`);

    // Log each feature's impact value and geometry type
    for (let i = 0; i < (rawData.features || []).length; i++) {
      const f = rawData.features[i];
      const props = f.properties || {};
      const geomType = f.geometry?.type || 'NO_GEOMETRY';
      const impact = props.impact || props.Impact || props.IMPACT || 'UNKNOWN';
      console.log(`[WSSI] Feature ${i}: impact="${impact}", geometry=${geomType}`);
    }

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
  const debug = searchParams.get('debug') === 'true';

  console.log(`[WSSI] Request: day=${day}, res=${resolution}, debug=${debug}`);

  // === DEBUG ENDPOINT ===
  // Returns raw diagnostic info instead of processed GeoJSON
  if (debug) {
    const layerId = WSSI_LAYER_IDS[day];
    const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

    try {
      const response = await fetch(queryUrl, {
        headers: { 'User-Agent': 'maxvelocitywx.com' },
      });

      if (!response.ok) {
        return NextResponse.json({ error: `NOAA API error: ${response.status}` }, { status: 500 });
      }

      const rawData = await response.json() as FeatureCollection;

      // Collect all unique impact values
      const impactValues = new Set<string>();
      const allPropertyKeys = new Set<string>();

      for (const feature of rawData.features || []) {
        const props = feature.properties || {};
        Object.keys(props).forEach(k => allPropertyKeys.add(k));
        if (props.impact) impactValues.add(String(props.impact));
        if (props.Impact) impactValues.add(String(props.Impact));
        if (props.IMPACT) impactValues.add(String(props.IMPACT));
      }

      // Map each feature to its category
      const mappedCategories: Record<string, number> = {
        elevated: 0,
        minor: 0,
        moderate: 0,
        major: 0,
        extreme: 0,
        unmapped: 0,
      };

      const featureDetails: Array<{
        index: number;
        impact: string;
        mappedCategory: string | null;
        geometryType: string;
        areaKm2: number;
      }> = [];

      for (let i = 0; i < (rawData.features || []).length; i++) {
        const f = rawData.features[i];
        const props = f.properties || {};
        const impact = String(props.impact || props.Impact || props.IMPACT || 'UNKNOWN');
        const category = extractCategory(props as Record<string, unknown>);
        const geomType = f.geometry?.type || 'NO_GEOMETRY';

        let areaKm2 = 0;
        if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
          try {
            areaKm2 = turf.area(f as Feature<Polygon | MultiPolygon>) / 1_000_000;
          } catch {
            areaKm2 = -1;
          }
        }

        if (category) {
          mappedCategories[category]++;
        } else {
          mappedCategories.unmapped++;
        }

        featureDetails.push({
          index: i,
          impact,
          mappedCategory: category,
          geometryType: geomType,
          areaKm2: Math.round(areaKm2),
        });
      }

      return NextResponse.json({
        noaaUrl: queryUrl,
        layerId,
        rawFeatureCount: rawData.features?.length || 0,
        propertyKeys: [...allPropertyKeys],
        uniqueImpactValues: [...impactValues],
        mappedCategories,
        featureDetails,
        sampleFeatureProperties: rawData.features?.[0]?.properties || null,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return NextResponse.json({
        error: 'Failed to fetch NOAA data',
        details: error instanceof Error ? error.message : String(error),
      }, { status: 500 });
    }
  }

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
