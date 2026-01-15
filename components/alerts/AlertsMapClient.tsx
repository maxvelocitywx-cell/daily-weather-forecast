'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Maximize2, Play, Pause } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Unified Radar Animation Config (both modes use same timing)
const FRAME_COUNT = 25; // 25 frames = 120 minutes at 5-min intervals
const FRAME_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes in ms
const ANIMATION_SPEED_MS = 250; // Fast loop 250ms per frame
const RADAR_OPACITY = 0.95;

// NOAA MRMS ImageServer base URL (base reflectivity)
const MRMS_BASE_URL = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';

// Radar mode type
type RadarMode = 'RADAR' | 'PTYPE' | 'OFF';

// Event-based color mapping (keyed by event string)
const EVENT_COLORS: Record<string, string> = {
  // Winter / Cold (icy blues & purples - highest visual priority)
  'Blizzard Warning': '#7C3AED',
  'Ice Storm Warning': '#A21CAF',
  'Winter Storm Warning': '#2563EB',
  'Snow Squall Warning': '#2563EB',
  'Lake Effect Snow Warning': '#2563EB',
  'Winter Weather Advisory': '#60A5FA',
  'Lake Effect Snow Advisory': '#60A5FA',
  'Freezing Rain Advisory': '#22D3EE',
  'Sleet Advisory': '#22D3EE',
  'Extreme Cold Warning': '#0EA5E9',
  'Wind Chill Warning': '#0EA5E9',
  'Wind Chill Advisory': '#93C5FD',
  'Hard Freeze Warning': '#93C5FD',
  'Freeze Warning': '#93C5FD',
  'Frost Advisory': '#93C5FD',
  'Cold Weather Advisory': '#93C5FD',
  'Freeze Watch': '#93C5FD',
  'Winter Storm Watch': '#60A5FA',

  // Flood / Rain (greens)
  'Flash Flood Warning': '#10B981',
  'Flood Warning': '#16A34A',
  'Flood Watch': '#A3E635',
  'Flood Advisory': '#86EFAC',
  'Coastal Flood Warning': '#16A34A',
  'Coastal Flood Advisory': '#86EFAC',
  'Areal Flood Warning': '#16A34A',
  'Areal Flood Advisory': '#86EFAC',

  // Wind (amber/orange)
  'Extreme Wind Warning': '#DC2626',
  'High Wind Warning': '#F97316',
  'Wind Advisory': '#FDBA74',
  'High Wind Watch': '#FDBA74',

  // Severe Convective (reds)
  'Tornado Warning': '#B91C1C',
  'Severe Thunderstorm Warning': '#EF4444',
  'Tornado Watch': '#F59E0B',
  'Severe Thunderstorm Watch': '#FBBF24',
  'Special Marine Warning': '#EF4444',

  // Fire (hot orange/red)
  'Red Flag Warning': '#FB7185',
  'Fire Weather Watch': '#FDA4AF',

  // Tropical / Marine (teal/navy)
  'Hurricane Warning': '#991B1B',
  'Hurricane Watch': '#F87171',
  'Tropical Storm Warning': '#0D9488',
  'Tropical Storm Watch': '#5EEAD4',
  'Storm Warning': '#1E3A8A',
  'Gale Warning': '#1E3A8A',
  'Gale Watch': '#3B82F6',
  'Small Craft Advisory': '#60A5FA',
  'Hazardous Seas Warning': '#0F766E',
  'Heavy Freezing Spray Warning': '#0EA5E9',
  'Brisk Wind Advisory': '#60A5FA',
  'Hurricane Force Wind Warning': '#991B1B',

  // Other
  'Dense Fog Advisory': '#9CA3AF',
  'Heat Advisory': '#FDE047',
  'Excessive Heat Warning': '#F59E0B',
  'Air Quality Alert': '#A1A1AA',
  'Air Stagnation Advisory': '#A1A1AA',
  'Special Weather Statement': '#CBD5E1',
  'Dust Storm Warning': '#D97706',
  'Blowing Dust Advisory': '#D97706',
  'Rip Current Statement': '#60A5FA',
};

// Fallback colors by product type
const FALLBACK_COLORS: Record<string, string> = {
  Warning: '#EF4444',
  Watch: '#F59E0B',
  Advisory: '#60A5FA',
  Statement: '#94A3B8',
};

// Severity-based styling (opacity and line width)
const SEVERITY_STYLE: Record<string, { fillOpacity: number; lineWidth: number }> = {
  Extreme: { fillOpacity: 0.55, lineWidth: 3.0 },
  Severe: { fillOpacity: 0.45, lineWidth: 2.5 },
  Moderate: { fillOpacity: 0.35, lineWidth: 2.0 },
  Minor: { fillOpacity: 0.25, lineWidth: 1.5 },
  Unknown: { fillOpacity: 0.20, lineWidth: 1.5 },
};

// Category groupings for legend
const LEGEND_CATEGORIES = [
  {
    name: 'Winter / Cold',
    events: [
      { event: 'Blizzard Warning', color: '#7C3AED' },
      { event: 'Ice Storm Warning', color: '#A21CAF' },
      { event: 'Winter Storm Warning', color: '#2563EB' },
      { event: 'Winter Weather Advisory', color: '#60A5FA' },
      { event: 'Wind Chill Warning', color: '#0EA5E9' },
      { event: 'Freeze Warning', color: '#93C5FD' },
    ]
  },
  {
    name: 'Flood',
    events: [
      { event: 'Flash Flood Warning', color: '#10B981' },
      { event: 'Flood Warning', color: '#16A34A' },
      { event: 'Flood Watch', color: '#A3E635' },
    ]
  },
  {
    name: 'Severe',
    events: [
      { event: 'Tornado Warning', color: '#B91C1C' },
      { event: 'Severe T-Storm Warn', color: '#EF4444' },
      { event: 'Tornado Watch', color: '#F59E0B' },
    ]
  },
  {
    name: 'Wind / Fire',
    events: [
      { event: 'High Wind Warning', color: '#F97316' },
      { event: 'Red Flag Warning', color: '#FB7185' },
    ]
  },
  {
    name: 'Marine',
    events: [
      { event: 'Storm/Gale Warning', color: '#1E3A8A' },
      { event: 'Small Craft Advisory', color: '#60A5FA' },
    ]
  },
];

// Get color for an event
function getEventColor(event: string): string {
  if (EVENT_COLORS[event]) {
    return EVENT_COLORS[event];
  }
  // Fallback based on product type
  if (event.includes('Warning')) return FALLBACK_COLORS.Warning;
  if (event.includes('Watch')) return FALLBACK_COLORS.Watch;
  if (event.includes('Advisory')) return FALLBACK_COLORS.Advisory;
  if (event.includes('Statement')) return FALLBACK_COLORS.Statement;
  return '#94A3B8';
}

// Get severity style
function getSeverityStyle(severity: string): { fillOpacity: number; lineWidth: number } {
  return SEVERITY_STYLE[severity] || SEVERITY_STYLE.Unknown;
}

// Generate frame timestamps (25 frames = 120 min at 5-min intervals)
function generateFrames(): { timestamp: number; isoUtc: string; localLabel: string }[] {
  const now = Date.now();
  // Round down to nearest 5 minutes
  const roundedNow = Math.floor(now / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS;

  const frames: { timestamp: number; isoUtc: string; localLabel: string }[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const timestamp = roundedNow - (i * FRAME_INTERVAL_MS);
    const date = new Date(timestamp);
    // ISO-8601 UTC format for API requests
    const isoUtc = date.toISOString();
    // Local time label
    const localLabel = date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    frames.push({ timestamp, isoUtc, localLabel });
  }

  return frames.reverse(); // Oldest first, newest last
}

// Build MRMS reflectivity tile URL for a specific timestamp
function buildRadarTileUrl(timestamp: number): string {
  return `${MRMS_BASE_URL}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&time=${timestamp}&f=image`;
}

// Build P-TYPE tile URL (server-side composited)
function buildPtypeTileUrl(isoUtc: string): string {
  // Use our server-side tile endpoint that composites reflectivity + p-type
  return `/api/tiles/ptype/{z}/{x}/{y}.png?time=${encodeURIComponent(isoUtc)}`;
}

export interface AlertGeometry {
  type: string;
  coordinates: number[][][] | number[][][][] | number[][] | number[][][];
}

export interface AlertForMap {
  id: string;
  event: string;
  severity: string;
  expires: string;
  areaDesc: string;
  hasGeometry: boolean;
  geometry: AlertGeometry | null;
  states: string[];
  isTop5?: boolean;
  rank?: number;
}

interface AlertsMapClientProps {
  alerts: AlertForMap[];
  selectedAlertId: string | null;
  onAlertSelect: (alertId: string | null) => void;
  onAlertHover: (alertId: string | null) => void;
  height?: number | string;
}

// Calculate bounds from geometry
function getBoundsFromGeometry(geometry: AlertGeometry): mapboxgl.LngLatBounds | null {
  const bounds = new mapboxgl.LngLatBounds();

  try {
    if (geometry.type === 'Polygon') {
      const coords = geometry.coordinates as number[][][];
      coords[0].forEach(coord => bounds.extend([coord[0], coord[1]] as [number, number]));
    } else if (geometry.type === 'MultiPolygon') {
      const coords = geometry.coordinates as number[][][][];
      coords.forEach(polygon => {
        polygon[0].forEach(coord => bounds.extend([coord[0], coord[1]] as [number, number]));
      });
    } else if (geometry.type === 'LineString') {
      const coords = geometry.coordinates as number[][];
      coords.forEach(coord => bounds.extend([coord[0], coord[1]] as [number, number]));
    } else if (geometry.type === 'MultiLineString') {
      const coords = geometry.coordinates as number[][][];
      coords.forEach(line => {
        line.forEach(coord => bounds.extend([coord[0], coord[1]] as [number, number]));
      });
    }
    return bounds.isEmpty() ? null : bounds;
  } catch {
    return null;
  }
}

export default function AlertsMapClient({
  alerts,
  selectedAlertId,
  onAlertSelect,
  onAlertHover,
  height = 480
}: AlertsMapClientProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const hoverPopup = useRef<mapboxgl.Popup | null>(null);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [legendExpanded, setLegendExpanded] = useState(false);

  // Unified radar state
  const [radarMode, setRadarMode] = useState<RadarMode>('RADAR');
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(FRAME_COUNT - 1); // Start at newest
  const [frames, setFrames] = useState<{ timestamp: number; isoUtc: string; localLabel: string }[]>([]);
  const [radarLayersReady, setRadarLayersReady] = useState(false);
  const [ptypeLayersReady, setPtypeLayersReady] = useState(false);

  // Generate frames on mount and refresh every 5 minutes
  useEffect(() => {
    setFrames(generateFrames());

    const refreshInterval = setInterval(() => {
      setFrames(generateFrames());
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(refreshInterval);
  }, []);

  // Convert alerts to GeoJSON - NO POINT LAYERS, only fill/line
  const { polygonGeoJSON, lineGeoJSON } = useMemo(() => {
    const polygonFeatures: GeoJSON.Feature[] = [];
    const lineFeatures: GeoJSON.Feature[] = [];

    alerts.forEach((alert, index) => {
      if (!alert.hasGeometry || !alert.geometry) return;

      const color = getEventColor(alert.event);
      const style = getSeverityStyle(alert.severity);
      const isPolygon = alert.geometry.type === 'Polygon' || alert.geometry.type === 'MultiPolygon';
      const isLine = alert.geometry.type === 'LineString' || alert.geometry.type === 'MultiLineString';

      const properties = {
        id: alert.id,
        event: alert.event,
        severity: alert.severity,
        expires: alert.expires,
        areaDesc: alert.areaDesc,
        color: color,
        fillOpacity: style.fillOpacity,
        lineWidth: style.lineWidth,
        isTop5: alert.isTop5 || false,
        rank: alert.rank || index + 1
      };

      if (isPolygon) {
        polygonFeatures.push({
          type: 'Feature',
          id: alert.id,
          properties,
          geometry: alert.geometry as GeoJSON.Geometry
        });
      } else if (isLine) {
        lineFeatures.push({
          type: 'Feature',
          id: alert.id,
          properties,
          geometry: alert.geometry as GeoJSON.Geometry
        });
      }
    });

    return {
      polygonGeoJSON: { type: 'FeatureCollection' as const, features: polygonFeatures },
      lineGeoJSON: { type: 'FeatureCollection' as const, features: lineFeatures }
    };
  }, [alerts]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/maxvelocity/cmkew9qqf003y01rxdwxp37k4',
      center: [-98.5, 39.8],
      zoom: 3.5,
      minZoom: 2,
      maxZoom: 12,
      attributionControl: false
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      'top-right'
    );

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    const resizeObserver = new ResizeObserver(() => {
      map.current?.resize();
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Helper to find the first symbol layer id (for inserting layers below labels)
  const getFirstSymbolLayerId = useCallback((): string | undefined => {
    if (!map.current) return undefined;
    const style = map.current.getStyle();
    if (!style || !style.layers) return undefined;
    const firstSymbol = style.layers.find(l => l.type === 'symbol');
    return firstSymbol?.id;
  }, []);

  // Add RADAR layers (one per frame)
  useEffect(() => {
    if (!mapLoaded || !map.current || frames.length === 0) return;

    const firstSymbolId = getFirstSymbolLayerId();

    // Add radar sources and layers for each frame
    frames.forEach((frame, index) => {
      const sourceId = `radar-source-${index}`;
      const layerId = `radar-layer-${index}`;

      if (!map.current?.getSource(sourceId)) {
        map.current?.addSource(sourceId, {
          type: 'raster',
          tiles: [buildRadarTileUrl(frame.timestamp)],
          tileSize: 256,
          attribution: 'NOAA MRMS'
        });

        map.current?.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': 0,
            'raster-fade-duration': 0
          }
        }, firstSymbolId);
      }
    });

    setRadarLayersReady(true);
  }, [mapLoaded, frames, getFirstSymbolLayerId]);

  // Add P-TYPE layers (one per frame)
  useEffect(() => {
    if (!mapLoaded || !map.current || frames.length === 0) return;

    const firstSymbolId = getFirstSymbolLayerId();

    // Add p-type sources and layers for each frame
    frames.forEach((frame, index) => {
      const sourceId = `ptype-source-${index}`;
      const layerId = `ptype-layer-${index}`;

      if (!map.current?.getSource(sourceId)) {
        map.current?.addSource(sourceId, {
          type: 'raster',
          tiles: [buildPtypeTileUrl(frame.isoUtc)],
          tileSize: 256,
          attribution: 'NOAA MRMS P-Type'
        });

        map.current?.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': 0,
            'raster-fade-duration': 0
          }
        }, firstSymbolId);
      }
    });

    setPtypeLayersReady(true);
  }, [mapLoaded, frames, getFirstSymbolLayerId]);

  // Update layer visibility based on mode and current frame
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    // Update RADAR layers
    if (radarLayersReady) {
      frames.forEach((_, index) => {
        const layerId = `radar-layer-${index}`;
        if (map.current?.getLayer(layerId)) {
          const shouldShow = radarMode === 'RADAR' && index === currentFrameIndex;
          map.current.setPaintProperty(layerId, 'raster-opacity', shouldShow ? RADAR_OPACITY : 0);
        }
      });
    }

    // Update P-TYPE layers
    if (ptypeLayersReady) {
      frames.forEach((_, index) => {
        const layerId = `ptype-layer-${index}`;
        if (map.current?.getLayer(layerId)) {
          const shouldShow = radarMode === 'PTYPE' && index === currentFrameIndex;
          map.current.setPaintProperty(layerId, 'raster-opacity', shouldShow ? RADAR_OPACITY : 0);
        }
      });
    }
  }, [mapLoaded, radarLayersReady, ptypeLayersReady, radarMode, currentFrameIndex, frames]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || radarMode === 'OFF' || (!radarLayersReady && !ptypeLayersReady)) {
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    animationRef.current = setInterval(() => {
      setCurrentFrameIndex(prev => (prev + 1) % FRAME_COUNT);
    }, ANIMATION_SPEED_MS);

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isPlaying, radarMode, radarLayersReady, ptypeLayersReady]);

  // Radar controls
  const handlePlayPause = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setCurrentFrameIndex(parseInt(e.target.value, 10));
  }, []);

  // Mode toggle with mutual exclusion
  const setMode = useCallback((mode: RadarMode) => {
    setRadarMode(mode);
    // Reset to newest frame when switching modes
    setCurrentFrameIndex(FRAME_COUNT - 1);
    setIsPlaying(true);
  }, []);

  // Add/update alert layers
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const firstSymbolId = getFirstSymbolLayerId();

    // Add or update polygon source
    const polygonSource = map.current.getSource('alert-polygons') as mapboxgl.GeoJSONSource;
    if (polygonSource) {
      polygonSource.setData(polygonGeoJSON);
    } else {
      map.current.addSource('alert-polygons', {
        type: 'geojson',
        data: polygonGeoJSON
      });

      map.current.addLayer({
        id: 'alert-polygons-fill',
        type: 'fill',
        source: 'alert-polygons',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['*', ['get', 'fillOpacity'], 1.5],
            ['boolean', ['feature-state', 'hover'], false],
            ['*', ['get', 'fillOpacity'], 1.3],
            ['get', 'fillOpacity']
          ]
        }
      }, firstSymbolId);

      map.current.addLayer({
        id: 'alert-polygons-stroke',
        type: 'line',
        source: 'alert-polygons',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['*', ['get', 'lineWidth'], 1.5],
            ['boolean', ['feature-state', 'hover'], false],
            ['*', ['get', 'lineWidth'], 1.2],
            ['get', 'lineWidth']
          ],
          'line-opacity': 1
        }
      }, firstSymbolId);
    }

    // Add or update line source
    const lineSource = map.current.getSource('alert-lines') as mapboxgl.GeoJSONSource;
    if (lineSource) {
      lineSource.setData(lineGeoJSON);
    } else {
      map.current.addSource('alert-lines', {
        type: 'geojson',
        data: lineGeoJSON
      });

      map.current.addLayer({
        id: 'alert-lines',
        type: 'line',
        source: 'alert-lines',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ['*', ['get', 'lineWidth'], 1.5],
            ['boolean', ['feature-state', 'hover'], false],
            ['*', ['get', 'lineWidth'], 1.2],
            ['get', 'lineWidth']
          ],
          'line-opacity': 1
        }
      }, firstSymbolId);
    }
  }, [mapLoaded, polygonGeoJSON, lineGeoJSON, getFirstSymbolLayerId]);

  // Re-order layers below labels when style changes
  useEffect(() => {
    if (!map.current) return;

    const handleStyleData = () => {
      if (!map.current) return;

      const firstSymbolId = getFirstSymbolLayerId();
      if (!firstSymbolId) return;

      // Move radar layers
      frames.forEach((_, index) => {
        const radarLayerId = `radar-layer-${index}`;
        const ptypeLayerId = `ptype-layer-${index}`;
        if (map.current?.getLayer(radarLayerId)) {
          map.current.moveLayer(radarLayerId, firstSymbolId);
        }
        if (map.current?.getLayer(ptypeLayerId)) {
          map.current.moveLayer(ptypeLayerId, firstSymbolId);
        }
      });

      // Move alert layers
      if (map.current.getLayer('alert-polygons-fill')) {
        map.current.moveLayer('alert-polygons-fill', firstSymbolId);
      }
      if (map.current.getLayer('alert-polygons-stroke')) {
        map.current.moveLayer('alert-polygons-stroke', firstSymbolId);
      }
      if (map.current.getLayer('alert-lines')) {
        map.current.moveLayer('alert-lines', firstSymbolId);
      }
    };

    map.current.on('styledata', handleStyleData);

    return () => {
      map.current?.off('styledata', handleStyleData);
    };
  }, [getFirstSymbolLayerId, frames]);

  // Handle selection state
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    alerts.forEach(alert => {
      if (alert.hasGeometry) {
        map.current?.setFeatureState(
          { source: 'alert-polygons', id: alert.id },
          { selected: false }
        );
        map.current?.setFeatureState(
          { source: 'alert-lines', id: alert.id },
          { selected: false }
        );
      }
    });

    if (selectedAlertId) {
      map.current.setFeatureState(
        { source: 'alert-polygons', id: selectedAlertId },
        { selected: true }
      );
      map.current.setFeatureState(
        { source: 'alert-lines', id: selectedAlertId },
        { selected: true }
      );
    }
  }, [mapLoaded, selectedAlertId, alerts]);

  // Hover popup and interactions
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    let hoveredId: string | null = null;
    let hoveredSource: string | null = null;

    hoverPopup.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'alert-hover-popup',
      maxWidth: '300px',
      offset: [0, -10]
    });

    const formatExpires = (expires: string) => {
      const date = new Date(expires);
      return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    };

    const handleMouseEnter = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }, source: string) => {
      if (!e.features || !e.features[0] || !map.current) return;

      map.current.getCanvas().style.cursor = 'pointer';

      const props = e.features[0].properties;
      if (!props) return;

      const alertId = props.id;

      if (hoveredId && (hoveredId !== alertId || hoveredSource !== source)) {
        if (hoveredSource) {
          map.current.setFeatureState(
            { source: hoveredSource, id: hoveredId },
            { hover: false }
          );
        }
      }

      hoveredId = alertId;
      hoveredSource = source;
      onAlertHover(alertId);

      map.current.setFeatureState(
        { source, id: alertId },
        { hover: true }
      );

      const coords = e.lngLat;
      const color = props.color || '#94A3B8';

      hoverPopup.current?.setLngLat(coords).setHTML(`
        <div style="
          background: rgba(23, 23, 23, 0.95);
          padding: 12px 14px;
          border-radius: 10px;
          border: 2px solid ${color};
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(8px);
        ">
          <div style="
            font-weight: 700;
            color: ${color};
            font-size: 13px;
            margin-bottom: 6px;
          ">${props.event}</div>
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
          ">
            <span style="
              padding: 2px 8px;
              border-radius: 4px;
              font-size: 10px;
              font-weight: 600;
              background: ${color}33;
              color: ${color};
              border: 1px solid ${color};
            ">${props.severity}</span>
          </div>
          <div style="color: rgba(255, 255, 255, 0.6); font-size: 11px;">
            Expires: ${formatExpires(props.expires)}
          </div>
        </div>
      `).addTo(map.current);
    };

    const handleMouseLeave = () => {
      if (!map.current) return;

      map.current.getCanvas().style.cursor = '';

      if (hoveredId && hoveredSource) {
        map.current.setFeatureState(
          { source: hoveredSource, id: hoveredId },
          { hover: false }
        );
        hoveredId = null;
        hoveredSource = null;
      }

      onAlertHover(null);
      hoverPopup.current?.remove();
    };

    const handleClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (!e.features || !e.features[0]) return;

      const props = e.features[0].properties;
      if (!props) return;

      onAlertSelect(props.id);
      e.originalEvent.stopPropagation();
    };

    map.current.on('mouseenter', 'alert-polygons-fill', (e) => handleMouseEnter(e, 'alert-polygons'));
    map.current.on('mouseleave', 'alert-polygons-fill', handleMouseLeave);
    map.current.on('click', 'alert-polygons-fill', handleClick);

    map.current.on('mouseenter', 'alert-lines', (e) => handleMouseEnter(e, 'alert-lines'));
    map.current.on('mouseleave', 'alert-lines', handleMouseLeave);
    map.current.on('click', 'alert-lines', handleClick);

    map.current.on('click', (e) => {
      const features = map.current?.queryRenderedFeatures(e.point, {
        layers: ['alert-polygons-fill', 'alert-lines']
      });
      if (!features || features.length === 0) {
        onAlertSelect(null);
      }
    });

    return () => {
      if (map.current) {
        map.current.off('mouseenter', 'alert-polygons-fill', (e) => handleMouseEnter(e, 'alert-polygons'));
        map.current.off('mouseleave', 'alert-polygons-fill', handleMouseLeave);
        map.current.off('click', 'alert-polygons-fill', handleClick);
        map.current.off('mouseenter', 'alert-lines', (e) => handleMouseEnter(e, 'alert-lines'));
        map.current.off('mouseleave', 'alert-lines', handleMouseLeave);
        map.current.off('click', 'alert-lines', handleClick);
      }
      hoverPopup.current?.remove();
    };
  }, [mapLoaded, onAlertSelect, onAlertHover]);

  // Fly to selected alert
  const flyToAlert = useCallback((alertId: string) => {
    if (!map.current) return;

    const alert = alerts.find(a => a.id === alertId);
    if (!alert?.geometry) return;

    const bounds = getBoundsFromGeometry(alert.geometry);
    if (bounds) {
      map.current.fitBounds(bounds, {
        padding: 80,
        maxZoom: 9,
        duration: 1000
      });
    }
  }, [alerts]);

  useEffect(() => {
    if (selectedAlertId) {
      flyToAlert(selectedAlertId);
    }
  }, [selectedAlertId, flyToAlert]);

  // Fit to all alerts
  const fitToAllAlerts = useCallback(() => {
    if (!map.current || alerts.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    let hasValidBounds = false;

    alerts.forEach(alert => {
      if (alert.geometry) {
        const alertBounds = getBoundsFromGeometry(alert.geometry);
        if (alertBounds) {
          bounds.extend(alertBounds);
          hasValidBounds = true;
        }
      }
    });

    if (hasValidBounds) {
      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 6,
        duration: 1000
      });
    } else {
      map.current.flyTo({
        center: [-98.5, 39.8],
        zoom: 3.5,
        duration: 1000
      });
    }
  }, [alerts]);

  const currentFrameLabel = frames[currentFrameIndex]?.localLabel || '';
  const layersReady = radarMode === 'RADAR' ? radarLayersReady : radarMode === 'PTYPE' ? ptypeLayersReady : false;

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-white/10" style={{ height }}>
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Top left controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
        {/* Fit to all button */}
        <button
          onClick={fitToAllAlerts}
          className="flex items-center gap-2 px-3 py-2 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg border border-white/10 hover:border-white/20 transition-colors"
          title="Fit to all alerts"
        >
          <Maximize2 size={14} className="text-mv-text-primary" />
          <span className="text-xs text-mv-text-secondary">Fit All</span>
        </button>
      </div>

      {/* Compact radar controls - bottom left */}
      <div className="absolute bottom-3 left-3 bg-mv-bg-secondary/95 backdrop-blur-sm rounded-lg border border-white/10 p-2 z-10" style={{ width: '210px' }}>
        {/* Row 1: Play/Pause + Mode toggle */}
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={handlePlayPause}
            className={`p-1.5 rounded-full transition-colors ${
              radarMode !== 'OFF'
                ? 'bg-cyan-500/20 hover:bg-cyan-500/30'
                : 'bg-white/5 hover:bg-white/10'
            }`}
            title={isPlaying ? 'Pause' : 'Play'}
            disabled={radarMode === 'OFF'}
          >
            {isPlaying && radarMode !== 'OFF' ? (
              <Pause size={14} className="text-cyan-400" />
            ) : (
              <Play size={14} className={radarMode !== 'OFF' ? 'text-cyan-400 ml-0.5' : 'text-gray-500 ml-0.5'} />
            )}
          </button>

          {/* Mode toggle buttons */}
          <div className="flex-1 flex rounded-md overflow-hidden border border-white/10">
            <button
              onClick={() => setMode('RADAR')}
              className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                radarMode === 'RADAR'
                  ? 'bg-green-500/30 text-green-400'
                  : 'bg-transparent text-mv-text-muted hover:bg-white/5'
              }`}
            >
              RADAR
            </button>
            <button
              onClick={() => setMode('PTYPE')}
              className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
                radarMode === 'PTYPE'
                  ? 'bg-purple-500/30 text-purple-400'
                  : 'bg-transparent text-mv-text-muted hover:bg-white/5'
              }`}
            >
              P-TYPE
            </button>
            <button
              onClick={() => setMode('OFF')}
              className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                radarMode === 'OFF'
                  ? 'bg-white/10 text-mv-text-primary'
                  : 'bg-transparent text-mv-text-muted hover:bg-white/5'
              }`}
            >
              OFF
            </button>
          </div>
        </div>

        {/* Row 2: Slider */}
        {radarMode !== 'OFF' && layersReady && (
          <>
            <input
              type="range"
              min={0}
              max={FRAME_COUNT - 1}
              value={currentFrameIndex}
              onChange={handleSliderChange}
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer mb-1.5
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-2.5
                [&::-webkit-slider-thumb]:h-2.5
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-cyan-400
                [&::-webkit-slider-thumb]:cursor-pointer
                [&::-moz-range-thumb]:w-2.5
                [&::-moz-range-thumb]:h-2.5
                [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:bg-cyan-400
                [&::-moz-range-thumb]:border-0"
            />

            {/* Row 3: Time label */}
            <div className="flex justify-between items-center text-[9px]">
              <span className="text-mv-text-muted">-2 hr</span>
              <span className={`font-mono ${radarMode === 'RADAR' ? 'text-green-400' : 'text-purple-400'}`}>
                {currentFrameLabel}
              </span>
              <span className="text-mv-text-muted">Now</span>
            </div>
          </>
        )}

        {/* P-TYPE Legend (only when P-TYPE is active) */}
        {radarMode === 'PTYPE' && (
          <div className="border-t border-white/10 mt-2 pt-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px]">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, #93C5FD, #1E40AF)' }} />
                <span className="text-mv-text-secondary">Snow</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, #86EFAC, #166534)' }} />
                <span className="text-mv-text-secondary">Rain</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, #A7F3D0, #065F46)' }} />
                <span className="text-mv-text-secondary">Cool</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, #FDE047, #A16207)' }} />
                <span className="text-mv-text-secondary">Conv</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, #FBCFE8, #9D174D)' }} />
                <span className="text-mv-text-secondary">Hail</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend - Category-based */}
      <div
        className="absolute bottom-3 right-3 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg border border-white/10 z-10 overflow-hidden"
        style={{ maxHeight: legendExpanded ? '400px' : '40px', transition: 'max-height 0.3s ease' }}
      >
        <button
          onClick={() => setLegendExpanded(!legendExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-white/5 transition-colors"
        >
          <span className="text-xs font-medium text-mv-text-primary">Alert Legend</span>
          <span className="text-[10px] text-mv-text-muted">{legendExpanded ? '▼' : '▲'}</span>
        </button>

        {legendExpanded && (
          <div className="px-3 pb-3 max-h-[340px] overflow-y-auto">
            {LEGEND_CATEGORIES.map(category => (
              <div key={category.name} className="mb-2">
                <div className="text-[10px] font-semibold text-mv-text-muted uppercase tracking-wider mb-1">
                  {category.name}
                </div>
                <div className="flex flex-col gap-0.5">
                  {category.events.map(item => (
                    <div key={item.event} className="flex items-center gap-2">
                      <div
                        className="w-4 h-2.5 rounded-sm"
                        style={{
                          background: item.color,
                          opacity: 0.7,
                          border: `1px solid ${item.color}`
                        }}
                      />
                      <span className="text-[10px] text-mv-text-secondary whitespace-nowrap">{item.event}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Loading state */}
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
            <span className="text-sm text-mv-text-muted">Loading map...</span>
          </div>
        </div>
      )}
    </div>
  );
}
