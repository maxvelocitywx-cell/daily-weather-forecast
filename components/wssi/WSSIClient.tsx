'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Snowflake, Calendar, Info, AlertTriangle, RefreshCw } from 'lucide-react';
import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Risk levels and their colors (in order of severity - low to high)
const RISK_LEVELS = [
  { label: 'Marginal Risk', wssiLabel: 'Winter Weather Area', color: '#60A5FA', category: 'elevated' },
  { label: 'Slight Risk', wssiLabel: 'Minor Impacts', color: '#2563EB', category: 'minor' },
  { label: 'Enhanced Risk', wssiLabel: 'Moderate Impacts', color: '#7C3AED', category: 'moderate' },
  { label: 'Moderate Risk', wssiLabel: 'Major Impacts', color: '#A21CAF', category: 'major' },
  { label: 'High Risk', wssiLabel: 'Extreme Impacts', color: '#DC2626', category: 'extreme' },
];

// Category order for banding (low to high severity)
const CATEGORY_ORDER = ['elevated', 'minor', 'moderate', 'major', 'extreme'] as const;
type WSSICategory = typeof CATEGORY_ORDER[number];

// Available days
const DAYS = [1, 2, 3];

// Type alias for polygon features
type PolygonFeature = Feature<Polygon | MultiPolygon>;

// ============================================================================
// EPSG:3857 (Web Mercator) Projection Functions
// Required for accurate meter-based buffering
// ============================================================================

const EARTH_RADIUS = 6378137; // Earth radius in meters (WGS84)

/**
 * Convert lon/lat (EPSG:4326) to Web Mercator (EPSG:3857) meters
 */
function toWebMercator(lon: number, lat: number): [number, number] {
  const x = lon * (Math.PI / 180) * EARTH_RADIUS;
  const y = Math.log(Math.tan((90 + lat) * (Math.PI / 360))) * EARTH_RADIUS;
  return [x, y];
}

/**
 * Convert Web Mercator (EPSG:3857) meters to lon/lat (EPSG:4326)
 */
function fromWebMercator(x: number, y: number): [number, number] {
  const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (Math.atan(Math.exp(y / EARTH_RADIUS)) * 360 / Math.PI) - 90;
  return [lon, lat];
}

/**
 * Project a ring of coordinates to Web Mercator
 */
function projectRingToMercator(ring: Position[]): Position[] {
  return ring.map(coord => {
    const [x, y] = toWebMercator(coord[0], coord[1]);
    return [x, y];
  });
}

/**
 * Unproject a ring of coordinates from Web Mercator to WGS84
 */
function unprojectRingFromMercator(ring: Position[]): Position[] {
  return ring.map(coord => {
    const [lon, lat] = fromWebMercator(coord[0], coord[1]);
    return [lon, lat];
  });
}

/**
 * Project a Polygon or MultiPolygon to Web Mercator (EPSG:3857)
 */
function projectToMercator(feature: PolygonFeature): PolygonFeature {
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    return {
      ...feature,
      geometry: {
        type: 'Polygon',
        coordinates: geom.coordinates.map(ring => projectRingToMercator(ring)),
      },
    };
  } else {
    return {
      ...feature,
      geometry: {
        type: 'MultiPolygon',
        coordinates: geom.coordinates.map(polygon =>
          polygon.map(ring => projectRingToMercator(ring))
        ),
      },
    };
  }
}

/**
 * Unproject a Polygon or MultiPolygon from Web Mercator to WGS84 (EPSG:4326)
 */
function unprojectFromMercator(feature: PolygonFeature): PolygonFeature {
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    return {
      ...feature,
      geometry: {
        type: 'Polygon',
        coordinates: geom.coordinates.map(ring => unprojectRingFromMercator(ring)),
      },
    };
  } else {
    return {
      ...feature,
      geometry: {
        type: 'MultiPolygon',
        coordinates: geom.coordinates.map(polygon =>
          polygon.map(ring => unprojectRingFromMercator(ring))
        ),
      },
    };
  }
}

interface WSSIFeature {
  type: 'Feature';
  geometry: GeoJSON.Geometry;
  properties: {
    day: number;
    category?: string;
    riskLabel: string;
    originalLabel: string;
    riskColor: string;
    riskOrder: number;
    validTime: string;
  };
}

interface WSSIGeoJSON {
  type: 'FeatureCollection';
  features: WSSIFeature[];
  error?: string;
}

// ============================================================================
// Geometry Validation and Processing Functions
// ============================================================================

// Debug stats for geometry hygiene
interface GeometryStats {
  invalidFixed: number;
  sliversRemoved: number;
  totalProcessed: number;
}

const debugStats: GeometryStats = {
  invalidFixed: 0,
  sliversRemoved: 0,
  totalProcessed: 0,
};

/**
 * Make geometry valid using buffer(0) trick with Turf
 * This fixes self-intersections, invalid rings, etc.
 */
function makeValidTurf(feature: PolygonFeature): PolygonFeature {
  try {
    // Try buffer(0) - the standard GIS trick for fixing invalid polygons
    const fixed = turf.buffer(feature, 0, { units: 'meters' });
    if (fixed?.geometry) {
      debugStats.invalidFixed++;
      return fixed as PolygonFeature;
    }
  } catch {
    // buffer(0) failed, try tiny buffer out then in
    try {
      const buffOut = turf.buffer(feature, 0.001, { units: 'kilometers' });
      if (buffOut?.geometry) {
        const buffIn = turf.buffer(buffOut as PolygonFeature, -0.001, { units: 'kilometers' });
        if (buffIn?.geometry) {
          debugStats.invalidFixed++;
          return buffIn as PolygonFeature;
        }
        return buffOut as PolygonFeature;
      }
    } catch {
      // Return original if all fixes fail
    }
  }
  return feature;
}

/**
 * Remove small polygon slivers/artifacts from a feature
 * Works on projected coordinates (meters)
 * @param feature - Polygon feature (in meters)
 * @param minAreaM2 - Minimum area in square meters (default 5 km²)
 */
function removeSliversFromFeature(feature: PolygonFeature, minAreaM2: number = 5000000): PolygonFeature | null {
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    // Calculate area - for projected coords, this gives m²
    const coords = geom.coordinates[0];
    const area = Math.abs(polygonArea(coords));
    if (area < minAreaM2) {
      debugStats.sliversRemoved++;
      return null;
    }
    return feature;
  }

  if (geom.type === 'MultiPolygon') {
    const validPolygons: number[][][][] = [];
    for (const polygon of geom.coordinates) {
      const coords = polygon[0];
      const area = Math.abs(polygonArea(coords));
      if (area >= minAreaM2) {
        validPolygons.push(polygon);
      } else {
        debugStats.sliversRemoved++;
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
 * Calculate polygon area using shoelace formula
 * Works on any coordinate system (returns area in same units squared)
 */
function polygonArea(coords: number[][]): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    area += coords[i][0] * coords[i + 1][1];
    area -= coords[i + 1][0] * coords[i][1];
  }
  return area / 2;
}

// ============================================================================
// Geometry Processing Functions (Turf-based)
// ============================================================================

/**
 * Make a GeoJSON feature valid using Turf buffer(0)
 */
function makeValid(feature: PolygonFeature): PolygonFeature {
  return makeValidTurf(feature);
}

/**
 * Union all features into a single polygon with validation
 */
function unionFeatures(features: Feature[]): PolygonFeature | null {
  if (features.length === 0) return null;

  try {
    // Validate all input geometries first
    const validFeatures = features.map(f => makeValid(f as PolygonFeature));

    if (validFeatures.length === 1) {
      return validFeatures[0];
    }

    // Use Turf for union
    let result = validFeatures[0];

    for (let i = 1; i < validFeatures.length; i++) {
      try {
        const fc = turf.featureCollection([result, validFeatures[i]]);
        const unioned = turf.union(fc as Parameters<typeof turf.union>[0]);
        if (unioned) {
          result = makeValid(unioned as PolygonFeature);
        }
      } catch {
        // Skip this feature if union fails
      }
    }

    return result;
  } catch (e) {
    console.warn('[WSSI] unionFeatures failed:', e);
  }

  // Fallback to first feature
  return features.length > 0 ? makeValid(features[0] as PolygonFeature) : null;
}

/**
 * Subtract geometry B from geometry A using Turf
 */
function subtractGeometry(a: PolygonFeature | null, b: PolygonFeature | null): PolygonFeature | null {
  if (!a) return null;
  if (!b) return a;

  try {
    const validA = makeValid(a);
    const validB = makeValid(b);

    const fc = turf.featureCollection([validA, validB]);
    const result = turf.difference(fc as Parameters<typeof turf.difference>[0]);

    if (result) {
      return makeValid(result as PolygonFeature);
    }
  } catch (e) {
    console.warn('[WSSI] subtractGeometry failed:', e);
  }

  return a;
}

/**
 * Morphological smoothing using Turf buffer operations in WGS84
 *
 * Pipeline:
 * 1. Make geometry valid
 * 2. Buffer OUT by distance (expands and rounds corners)
 * 3. Buffer IN by same distance (contracts, keeps rounded edges)
 * 4. Light simplification
 *
 * Note: Turf works in WGS84 with kilometer units - it handles the
 * spherical math internally. We use ~25km for primary smoothing.
 */
function morphologicalSmooth(
  feature: PolygonFeature,
  primaryBufferKm: number = 25,
  refinementBufferKm: number = 10
): PolygonFeature | null {
  try {
    debugStats.totalProcessed++;

    // Step 1: Make geometry valid first
    let current = makeValid(feature);

    // Step 2: Primary morphological smoothing - buffer OUT then IN
    // This rounds corners and smooths jagged edges
    try {
      // Buffer OUT (expand) - this rounds all corners
      const bufferedOut = turf.buffer(current, primaryBufferKm, {
        units: 'kilometers',
        steps: 32 // Good resolution for smooth curves
      });

      if (bufferedOut?.geometry) {
        // Buffer IN (contract) by same amount
        const bufferedIn = turf.buffer(bufferedOut as PolygonFeature, -primaryBufferKm, {
          units: 'kilometers',
          steps: 32
        });

        if (bufferedIn?.geometry) {
          current = bufferedIn as PolygonFeature;
        }
      }
    } catch (e) {
      console.warn('[WSSI] Primary buffer failed:', e);
    }

    // Step 3: Refinement pass with smaller buffer (optional)
    if (refinementBufferKm > 0) {
      try {
        const refOut = turf.buffer(current, refinementBufferKm, {
          units: 'kilometers',
          steps: 24
        });
        if (refOut?.geometry) {
          const refIn = turf.buffer(refOut as PolygonFeature, -refinementBufferKm, {
            units: 'kilometers',
            steps: 24
          });
          if (refIn?.geometry) {
            current = refIn as PolygonFeature;
          }
        }
      } catch {
        // Refinement is optional
      }
    }

    // Step 4: Light simplification (preserve curves)
    try {
      const simplified = turf.simplify(current, {
        tolerance: 0.005, // Slightly more aggressive to reduce vertices
        highQuality: true,
      });
      if (simplified?.geometry) {
        current = simplified as PolygonFeature;
      }
    } catch {
      // Keep unsimplified
    }

    return current;
  } catch (e) {
    console.error('[WSSI] Morphological smoothing failed:', e);
    return feature;
  }
}

/**
 * Process raw WSSI data into exclusive, smoothed bands
 * Uses morphological smoothing for SPC/WPC-style rounded boundaries
 */
function processWSSIData(rawData: WSSIGeoJSON): WSSIGeoJSON {
  if (!rawData.features || rawData.features.length === 0) {
    return rawData;
  }

  // Reset debug stats
  debugStats.invalidFixed = 0;
  debugStats.sliversRemoved = 0;
  debugStats.totalProcessed = 0;

  console.log('[WSSI] ========================================');
  console.log('[WSSI] Processing', rawData.features.length, 'raw features');

  // Group features by category
  const featuresByCategory: Record<WSSICategory, Feature[]> = {
    elevated: [],
    minor: [],
    moderate: [],
    major: [],
    extreme: [],
  };

  for (const feature of rawData.features) {
    const category = feature.properties?.category as WSSICategory;
    if (category && featuresByCategory[category]) {
      featuresByCategory[category].push(feature as Feature);
    }
  }

  console.log('[WSSI] Features by category:', Object.fromEntries(
    Object.entries(featuresByCategory).map(([k, v]) => [k, v.length])
  ));

  // Union features within each category (dissolve to single MultiPolygon)
  const unionedByCategory: Record<WSSICategory, PolygonFeature | null> = {
    elevated: unionFeatures(featuresByCategory.elevated),
    minor: unionFeatures(featuresByCategory.minor),
    moderate: unionFeatures(featuresByCategory.moderate),
    major: unionFeatures(featuresByCategory.major),
    extreme: unionFeatures(featuresByCategory.extreme),
  };

  // Build exclusive bands (subtract higher severity from lower)
  // This ensures no overlap between risk levels
  const bandExtreme = unionedByCategory.extreme;
  const bandMajor = subtractGeometry(unionedByCategory.major, bandExtreme);
  const majorAndExtreme = unionFeatures([bandMajor, bandExtreme].filter(Boolean) as Feature[]);
  const bandModerate = subtractGeometry(unionedByCategory.moderate, majorAndExtreme);
  const modMajExt = unionFeatures([bandModerate, bandMajor, bandExtreme].filter(Boolean) as Feature[]);
  const bandMinor = subtractGeometry(unionedByCategory.minor, modMajExt);
  const minModMajExt = unionFeatures([bandMinor, bandModerate, bandMajor, bandExtreme].filter(Boolean) as Feature[]);
  const bandElevated = subtractGeometry(unionedByCategory.elevated, minModMajExt);

  const exclusiveBands: Record<WSSICategory, PolygonFeature | null> = {
    elevated: bandElevated,
    minor: bandMinor,
    moderate: bandModerate,
    major: bandMajor,
    extreme: bandExtreme,
  };

  // Apply morphological smoothing and create final features
  const processedFeatures: WSSIFeature[] = [];

  for (const category of CATEGORY_ORDER) {
    const band = exclusiveBands[category];
    if (!band?.geometry) continue;

    // Check minimum area (skip tiny fragments)
    try {
      const area = turf.area(band);
      if (area < 1000000) {
        console.log(`[WSSI] Skipping ${category} - area too small: ${(area / 1000000).toFixed(2)} km²`);
        continue;
      }
    } catch {
      continue;
    }

    // Apply morphological smoothing with km-based buffers
    // Primary: 25km out/in for major rounding
    // Refinement: 10km out/in for extra smoothness
    console.log(`[WSSI] Smoothing ${category} band...`);
    const smoothed = morphologicalSmooth(band, 25, 10);

    if (!smoothed?.geometry) {
      console.log(`[WSSI] Smoothing failed for ${category}, using original`);
      continue;
    }

    // Verify smoothed geometry still has area
    try {
      const smoothedArea = turf.area(smoothed);
      if (smoothedArea < 500000) {
        console.log(`[WSSI] Smoothed ${category} too small: ${(smoothedArea / 1000000).toFixed(2)} km²`);
        continue;
      }
    } catch {
      // Continue if area check fails
    }

    // Get risk info from RISK_LEVELS
    const riskInfo = RISK_LEVELS.find(r => r.category === category);
    if (!riskInfo) continue;

    processedFeatures.push({
      type: 'Feature',
      geometry: smoothed.geometry,
      properties: {
        day: rawData.features[0]?.properties?.day || 1,
        riskLabel: riskInfo.label,
        originalLabel: riskInfo.wssiLabel,
        riskColor: riskInfo.color,
        riskOrder: CATEGORY_ORDER.indexOf(category) + 1,
        validTime: rawData.features[0]?.properties?.validTime || new Date().toISOString(),
      },
    });

    console.log(`[WSSI] Added ${category} band`);
  }

  // Sort by risk order (lower severity first, so higher severity renders on top)
  processedFeatures.sort((a, b) => (a.properties.riskOrder || 0) - (b.properties.riskOrder || 0));

  // Final debug summary
  console.log('[WSSI] ========================================');
  console.log('[WSSI] GEOMETRY HYGIENE SUMMARY:');
  console.log(`[WSSI]   Invalid geometries fixed: ${debugStats.invalidFixed}`);
  console.log(`[WSSI]   Slivers removed: ${debugStats.sliversRemoved}`);
  console.log(`[WSSI]   Total geometries processed: ${debugStats.totalProcessed}`);
  console.log(`[WSSI]   Final bands: ${processedFeatures.length}`);
  console.log('[WSSI] ========================================');

  return {
    type: 'FeatureCollection',
    features: processedFeatures,
  };
}

export default function WSSIClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const popup = useRef<mapboxgl.Popup | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [wssiData, setWssiData] = useState<Record<number, WSSIGeoJSON>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [processing, setProcessing] = useState<Record<number, boolean>>({});
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use ref to track loading state without causing re-renders
  const loadingRef = useRef<Record<number, boolean>>({});

  // Fetch WSSI data for a specific day
  const fetchWSSIData = useCallback(async (day: number) => {
    // Use ref to check loading state to avoid dependency issues
    if (loadingRef.current[day]) return;

    loadingRef.current[day] = true;
    setLoading(prev => ({ ...prev, [day]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/wssi/day/${day}`);
      const lastModified = response.headers.get('X-WSSI-Last-Modified');

      if (!response.ok) {
        throw new Error(`Failed to fetch WSSI data: ${response.status}`);
      }

      const rawData: WSSIGeoJSON = await response.json();

      if (rawData.error) {
        throw new Error(rawData.error);
      }

      // Set loading to false, switch to processing state
      setLoading(prev => ({ ...prev, [day]: false }));
      setProcessing(prev => ({ ...prev, [day]: true }));

      // Process data client-side (union, band, smooth)
      // Use setTimeout to allow UI to update before heavy processing
      await new Promise<void>(resolve => {
        setTimeout(() => {
          try {
            const processedData = processWSSIData(rawData);
            setWssiData(prev => ({ ...prev, [day]: processedData }));
          } catch (err) {
            console.error('Error processing WSSI data:', err);
            // Fall back to raw data if processing fails
            setWssiData(prev => ({ ...prev, [day]: rawData }));
          }
          resolve();
        }, 10);
      });

      if (lastModified) {
        setLastUpdate(new Date(lastModified).toLocaleString());
      }
    } catch (err) {
      console.error('Error fetching WSSI data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load WSSI data');
    } finally {
      loadingRef.current[day] = false;
      setLoading(prev => ({ ...prev, [day]: false }));
      setProcessing(prev => ({ ...prev, [day]: false }));
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/maxvelocity/cmkew9qqf003y01rxdwxp37k4',
      center: [-98.5, 39.8],
      zoom: 4,
      minZoom: 2,
      maxZoom: 10,
      attributionControl: false,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      'top-right'
    );

    popup.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'wssi-popup',
    });

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      popup.current?.remove();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Fetch initial data when map loads or day changes
  useEffect(() => {
    if (mapLoaded && !wssiData[selectedDay]) {
      fetchWSSIData(selectedDay);
    }
  }, [mapLoaded, selectedDay, wssiData, fetchWSSIData]);

  // Update map layers when data or selected day changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const m = map.current;
    const data = wssiData[selectedDay];

    // Remove existing WSSI layers
    const existingLayers = m.getStyle()?.layers || [];
    for (const layer of existingLayers) {
      if (layer.id.startsWith('wssi-')) {
        m.removeLayer(layer.id);
      }
    }

    // Remove existing WSSI source
    if (m.getSource('wssi-data')) {
      m.removeSource('wssi-data');
    }

    if (!data || data.features.length === 0) return;

    // Find the first symbol layer to insert below
    const firstSymbolId = existingLayers.find(l => l.type === 'symbol')?.id;

    // Add source
    m.addSource('wssi-data', {
      type: 'geojson',
      data: data,
    });

    // Add fill layers for each risk level (sorted by risk order)
    // Layer order: fill (bottom) -> halo outline -> main outline (top)
    for (const risk of RISK_LEVELS) {
      const fillLayerId = `wssi-fill-${risk.label.replace(/\s+/g, '-').toLowerCase()}`;
      const haloLayerId = `wssi-halo-${risk.label.replace(/\s+/g, '-').toLowerCase()}`;
      const outlineLayerId = `wssi-outline-${risk.label.replace(/\s+/g, '-').toLowerCase()}`;

      // Fill layer (bottom)
      m.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: 'wssi-data',
        filter: ['==', ['get', 'riskLabel'], risk.label],
        paint: {
          'fill-color': risk.color,
          'fill-opacity': 0.40,
        },
      }, firstSymbolId);

      // Halo outline layer (below main outline) - white glow effect for organic look
      m.addLayer({
        id: haloLayerId,
        type: 'line',
        source: 'wssi-data',
        filter: ['==', ['get', 'riskLabel'], risk.label],
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': 'rgba(255, 255, 255, 0.32)',
          'line-width': 5, // Wider halo for smoother appearance
          'line-opacity': 1.0,
        },
      }, firstSymbolId);

      // Main outline layer (above halo)
      m.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: 'wssi-data',
        filter: ['==', ['get', 'riskLabel'], risk.label],
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': risk.color,
          'line-width': 2,
          'line-opacity': 0.9,
        },
      }, firstSymbolId);
    }

    // Add hover interactions
    const fillLayerIds = RISK_LEVELS.map(r =>
      `wssi-fill-${r.label.replace(/\s+/g, '-').toLowerCase()}`
    );

    const handleMouseEnter = () => {
      if (m) m.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      if (m) m.getCanvas().style.cursor = '';
      popup.current?.remove();
    };

    const handleMouseMove = (e: mapboxgl.MapMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties;

      if (!props) return;

      // Use inline styles since Tailwind classes won't work in Mapbox popups
      const html = `
        <div style="padding: 8px; font-size: 14px;">
          <div style="font-weight: 600; color: white; margin-bottom: 4px;">Day ${props.day} Outlook</div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="width: 12px; height: 12px; border-radius: 2px; background-color: ${props.riskColor}; display: inline-block;"></span>
            <span style="color: white;">${props.riskLabel}</span>
          </div>
          <div style="color: #9ca3af; font-size: 12px;">WSSI: ${props.originalCategory || props.originalLabel || 'N/A'}</div>
        </div>
      `;

      popup.current
        ?.setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(m);
    };

    for (const layerId of fillLayerIds) {
      if (m.getLayer(layerId)) {
        m.on('mouseenter', layerId, handleMouseEnter);
        m.on('mouseleave', layerId, handleMouseLeave);
        m.on('mousemove', layerId, handleMouseMove);
      }
    }

    return () => {
      for (const layerId of fillLayerIds) {
        if (m.getLayer(layerId)) {
          m.off('mouseenter', layerId, handleMouseEnter);
          m.off('mouseleave', layerId, handleMouseLeave);
          m.off('mousemove', layerId, handleMouseMove);
        }
      }
    };
  }, [wssiData, selectedDay, mapLoaded]);

  // Handle day change
  const handleDayChange = (day: number) => {
    setSelectedDay(day);
    if (!wssiData[day]) {
      fetchWSSIData(day);
    }
  };

  // Refresh current day's data
  const handleRefresh = () => {
    fetchWSSIData(selectedDay);
  };

  // Check if current day has data
  const currentDayData = wssiData[selectedDay];
  const hasData = currentDayData && currentDayData.features.length > 0;
  const isLoading = loading[selectedDay];
  const isProcessing = processing[selectedDay];
  const isBusy = isLoading || isProcessing;

  return (
    <div className="h-screen bg-mv-bg-primary flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-mv-bg-secondary/95 backdrop-blur-sm border-b border-white/10 px-4 py-2 z-20">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Snowflake className="text-cyan-400" size={24} />
            <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Winter Storm Severity Index
            </h1>
            <span className="hidden sm:inline text-xs text-mv-text-muted bg-white/5 px-2 py-0.5 rounded">
              WPC WSSI
            </span>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdate && (
              <span className="text-xs text-mv-text-muted hidden md:inline">
                Updated: {lastUpdate}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isBusy}
              className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw size={16} className={`text-mv-text-muted ${isBusy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 bg-mv-bg-secondary/95 backdrop-blur-sm border-r border-white/10 p-4 overflow-y-auto">
          {/* Day selector */}
          <section className="mb-6">
            <h3 className="text-xs font-semibold text-mv-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
              <Calendar size={14} />
              Forecast Day
            </h3>
            <div className="flex gap-2">
              {DAYS.map(day => (
                <button
                  key={day}
                  onClick={() => handleDayChange(day)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                    selectedDay === day
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'bg-white/5 text-mv-text-secondary hover:bg-white/10 border border-transparent'
                  }`}
                >
                  Day {day}
                </button>
              ))}
            </div>
          </section>

          {/* Legend */}
          <section className="mb-6">
            <h3 className="text-xs font-semibold text-mv-text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
              <Info size={14} />
              Risk Levels
            </h3>
            <div className="space-y-2">
              {RISK_LEVELS.map(risk => (
                <div key={risk.label} className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: risk.color, opacity: 0.7 }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-mv-text-primary truncate">{risk.label}</div>
                    <div className="text-xs text-mv-text-muted truncate">{risk.wssiLabel}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Info box */}
          <section className="p-3 rounded-lg bg-white/5 border border-white/10">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-mv-text-muted">
                <p className="mb-2">
                  The WSSI shows potential winter weather impacts, combining snow, ice,
                  wind, and ground conditions.
                </p>
                <p>
                  Data from NOAA Weather Prediction Center.
                </p>
              </div>
            </div>
          </section>
        </aside>

        {/* Map container */}
        <main className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />

          {/* Loading overlay */}
          {(!mapLoaded || isBusy) && (
            <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <span className="text-sm text-mv-text-muted">
                  {isLoading ? 'Fetching WSSI data...' : isProcessing ? 'Processing polygons...' : 'Loading map...'}
                </span>
              </div>
            </div>
          )}

          {/* No data message */}
          {mapLoaded && !isBusy && !hasData && !error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-mv-bg-secondary/95 backdrop-blur-sm text-mv-text-muted px-4 py-2 rounded-lg border border-white/10 text-sm">
                No winter storm impacts forecast for Day {selectedDay}
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-red-500/20 backdrop-blur-sm text-red-400 px-4 py-2 rounded-lg border border-red-500/30 text-sm flex items-center gap-2">
                <AlertTriangle size={16} />
                {error}
              </div>
            </div>
          )}

          {/* Day indicator */}
          <div className="absolute bottom-4 left-4 z-10">
            <div className="bg-mv-bg-secondary/95 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10">
              <div className="text-xs text-mv-text-muted">Viewing</div>
              <div className="text-lg font-bold text-cyan-400">Day {selectedDay} Outlook</div>
            </div>
          </div>
        </main>
      </div>

      {/* Custom popup styles */}
      <style jsx global>{`
        .wssi-popup .mapboxgl-popup-content {
          background: rgba(15, 15, 20, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 0;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }
        .wssi-popup .mapboxgl-popup-tip {
          border-top-color: rgba(15, 15, 20, 0.95);
        }
      `}</style>
    </div>
  );
}
