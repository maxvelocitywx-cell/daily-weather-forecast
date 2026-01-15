'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Maximize2 } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

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
  const [mapLoaded, setMapLoaded] = useState(false);
  const [legendExpanded, setLegendExpanded] = useState(false);

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
      style: 'mapbox://styles/mapbox/dark-v11',
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
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Add/update alert layers - ONLY fill and line layers, NO point/circle/symbol layers
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    // Add or update polygon source
    const polygonSource = map.current.getSource('alert-polygons') as mapboxgl.GeoJSONSource;
    if (polygonSource) {
      polygonSource.setData(polygonGeoJSON);
    } else {
      map.current.addSource('alert-polygons', {
        type: 'geojson',
        data: polygonGeoJSON
      });

      // Fill layer for polygons
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
      });

      // Stroke layer for polygons (100% opacity)
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
      });
    }

    // Add or update line source (for LineString geometries)
    const lineSource = map.current.getSource('alert-lines') as mapboxgl.GeoJSONSource;
    if (lineSource) {
      lineSource.setData(lineGeoJSON);
    } else {
      map.current.addSource('alert-lines', {
        type: 'geojson',
        data: lineGeoJSON
      });

      // Line layer (outline only, no fill)
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
      });
    }
  }, [mapLoaded, polygonGeoJSON, lineGeoJSON]);

  // Handle selection state
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    // Clear all selected states first
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

    // Set selected state
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

    // Add listeners for polygon fill
    map.current.on('mouseenter', 'alert-polygons-fill', (e) => handleMouseEnter(e, 'alert-polygons'));
    map.current.on('mouseleave', 'alert-polygons-fill', handleMouseLeave);
    map.current.on('click', 'alert-polygons-fill', handleClick);

    // Add listeners for lines
    map.current.on('mouseenter', 'alert-lines', (e) => handleMouseEnter(e, 'alert-lines'));
    map.current.on('mouseleave', 'alert-lines', handleMouseLeave);
    map.current.on('click', 'alert-lines', handleClick);

    // Click on map background to deselect
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

  // Expose flyToAlert externally
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
      // Default to CONUS view
      map.current.flyTo({
        center: [-98.5, 39.8],
        zoom: 3.5,
        duration: 1000
      });
    }
  }, [alerts]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-white/10" style={{ height }}>
      <div ref={mapContainer} className="absolute inset-0" />

      {/* Fit to all button */}
      <button
        onClick={fitToAllAlerts}
        className="absolute top-3 left-3 flex items-center gap-2 px-3 py-2 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg border border-white/10 hover:border-white/20 transition-colors z-10"
        title="Fit to all alerts"
      >
        <Maximize2 size={14} className="text-mv-text-primary" />
        <span className="text-xs text-mv-text-secondary">Fit All</span>
      </button>

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
