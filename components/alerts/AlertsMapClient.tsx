'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Maximize2, Layers } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Severity color mapping
const SEVERITY_COLORS: Record<string, { fill: string; stroke: string; marker: string }> = {
  Extreme: { fill: 'rgba(239, 68, 68, 0.35)', stroke: '#ef4444', marker: '#ef4444' },
  Severe: { fill: 'rgba(249, 115, 22, 0.35)', stroke: '#f97316', marker: '#f97316' },
  Moderate: { fill: 'rgba(234, 179, 8, 0.35)', stroke: '#eab308', marker: '#eab308' },
  Minor: { fill: 'rgba(34, 211, 238, 0.35)', stroke: '#22d3ee', marker: '#22d3ee' },
  Unknown: { fill: 'rgba(156, 163, 175, 0.25)', stroke: '#9ca3af', marker: '#9ca3af' }
};

export interface AlertGeometry {
  type: string;
  coordinates: number[][][] | number[][][][];
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
    }
    return bounds.isEmpty() ? null : bounds;
  } catch {
    return null;
  }
}

// Calculate centroid from geometry for marker placement
function getCentroidFromGeometry(geometry: AlertGeometry): [number, number] | null {
  try {
    let sumLng = 0, sumLat = 0, count = 0;

    if (geometry.type === 'Polygon') {
      const coords = geometry.coordinates as number[][][];
      coords[0].forEach(coord => {
        sumLng += coord[0];
        sumLat += coord[1];
        count++;
      });
    } else if (geometry.type === 'MultiPolygon') {
      const coords = geometry.coordinates as number[][][][];
      coords.forEach(polygon => {
        polygon[0].forEach(coord => {
          sumLng += coord[0];
          sumLat += coord[1];
          count++;
        });
      });
    }

    if (count === 0) return null;
    return [sumLng / count, sumLat / count];
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
  const [showPolygons, setShowPolygons] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);

  // Convert alerts to GeoJSON
  const { polygonGeoJSON, markerGeoJSON } = useMemo(() => {
    const polygonFeatures: GeoJSON.Feature[] = [];
    const markerFeatures: GeoJSON.Feature[] = [];

    alerts.forEach((alert, index) => {
      const colors = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.Unknown;

      if (alert.hasGeometry && alert.geometry) {
        // Add polygon feature
        polygonFeatures.push({
          type: 'Feature',
          id: alert.id,
          properties: {
            id: alert.id,
            event: alert.event,
            severity: alert.severity,
            expires: alert.expires,
            areaDesc: alert.areaDesc,
            fillColor: colors.fill,
            strokeColor: colors.stroke,
            isTop5: alert.isTop5 || false,
            rank: alert.rank || index + 1
          },
          geometry: alert.geometry as GeoJSON.Geometry
        });

        // Add centroid marker for clickability
        const centroid = getCentroidFromGeometry(alert.geometry);
        if (centroid) {
          markerFeatures.push({
            type: 'Feature',
            id: `marker-${alert.id}`,
            properties: {
              id: alert.id,
              event: alert.event,
              severity: alert.severity,
              expires: alert.expires,
              areaDesc: alert.areaDesc,
              markerColor: colors.marker,
              isTop5: alert.isTop5 || false,
              rank: alert.rank || index + 1
            },
            geometry: {
              type: 'Point',
              coordinates: centroid
            }
          });
        }
      }
    });

    return {
      polygonGeoJSON: { type: 'FeatureCollection' as const, features: polygonFeatures },
      markerGeoJSON: { type: 'FeatureCollection' as const, features: markerFeatures }
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

  // Add/update alert layers
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

      // Fill layer
      map.current.addLayer({
        id: 'alert-polygons-fill',
        type: 'fill',
        source: 'alert-polygons',
        paint: {
          'fill-color': ['get', 'fillColor'],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.6,
            ['boolean', ['feature-state', 'hover'], false], 0.5,
            0.35
          ]
        }
      });

      // Stroke layer
      map.current.addLayer({
        id: 'alert-polygons-stroke',
        type: 'line',
        source: 'alert-polygons',
        paint: {
          'line-color': ['get', 'strokeColor'],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3,
            ['boolean', ['feature-state', 'hover'], false], 2.5,
            1.5
          ],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1,
            0.8
          ]
        }
      });
    }

    // Add or update marker source
    const markerSource = map.current.getSource('alert-markers') as mapboxgl.GeoJSONSource;
    if (markerSource) {
      markerSource.setData(markerGeoJSON);
    } else {
      map.current.addSource('alert-markers', {
        type: 'geojson',
        data: markerGeoJSON
      });

      map.current.addLayer({
        id: 'alert-markers',
        type: 'circle',
        source: 'alert-markers',
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['get', 'isTop5'], false], 8,
            6
          ],
          'circle-color': ['get', 'markerColor'],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3,
            2
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1,
            0.9
          ]
        }
      });
    }
  }, [mapLoaded, polygonGeoJSON, markerGeoJSON]);

  // Update layer visibility
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    if (map.current.getLayer('alert-polygons-fill')) {
      map.current.setLayoutProperty('alert-polygons-fill', 'visibility', showPolygons ? 'visible' : 'none');
      map.current.setLayoutProperty('alert-polygons-stroke', 'visibility', showPolygons ? 'visible' : 'none');
    }
    if (map.current.getLayer('alert-markers')) {
      map.current.setLayoutProperty('alert-markers', 'visibility', showMarkers ? 'visible' : 'none');
    }
  }, [mapLoaded, showPolygons, showMarkers]);

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
          { source: 'alert-markers', id: `marker-${alert.id}` },
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
        { source: 'alert-markers', id: `marker-${selectedAlertId}` },
        { selected: true }
      );
    }
  }, [mapLoaded, selectedAlertId, alerts]);

  // Hover popup and interactions
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    let hoveredId: string | null = null;

    hoverPopup.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'alert-hover-popup',
      maxWidth: '280px',
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

    const handleMouseEnter = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (!e.features || !e.features[0] || !map.current) return;

      map.current.getCanvas().style.cursor = 'pointer';

      const props = e.features[0].properties;
      if (!props) return;

      const alertId = props.id;

      if (hoveredId && hoveredId !== alertId) {
        map.current.setFeatureState(
          { source: 'alert-polygons', id: hoveredId },
          { hover: false }
        );
      }

      hoveredId = alertId;
      onAlertHover(alertId);

      map.current.setFeatureState(
        { source: 'alert-polygons', id: alertId },
        { hover: true }
      );

      const coords = e.lngLat;
      const colors = SEVERITY_COLORS[props.severity] || SEVERITY_COLORS.Unknown;

      hoverPopup.current?.setLngLat(coords).setHTML(`
        <div style="
          background: rgba(23, 23, 23, 0.95);
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid ${colors.stroke};
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(8px);
        ">
          <div style="
            font-weight: 700;
            color: ${colors.marker};
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
              background: ${colors.fill};
              color: ${colors.marker};
              border: 1px solid ${colors.stroke};
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

      if (hoveredId) {
        map.current.setFeatureState(
          { source: 'alert-polygons', id: hoveredId },
          { hover: false }
        );
        hoveredId = null;
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

    // Add listeners for polygons
    map.current.on('mouseenter', 'alert-polygons-fill', handleMouseEnter);
    map.current.on('mouseleave', 'alert-polygons-fill', handleMouseLeave);
    map.current.on('click', 'alert-polygons-fill', handleClick);

    // Add listeners for markers
    map.current.on('mouseenter', 'alert-markers', handleMouseEnter);
    map.current.on('mouseleave', 'alert-markers', handleMouseLeave);
    map.current.on('click', 'alert-markers', handleClick);

    // Click on map background to deselect
    map.current.on('click', (e) => {
      const features = map.current?.queryRenderedFeatures(e.point, {
        layers: ['alert-polygons-fill', 'alert-markers']
      });
      if (!features || features.length === 0) {
        onAlertSelect(null);
      }
    });

    return () => {
      if (map.current) {
        map.current.off('mouseenter', 'alert-polygons-fill', handleMouseEnter);
        map.current.off('mouseleave', 'alert-polygons-fill', handleMouseLeave);
        map.current.off('click', 'alert-polygons-fill', handleClick);
        map.current.off('mouseenter', 'alert-markers', handleMouseEnter);
        map.current.off('mouseleave', 'alert-markers', handleMouseLeave);
        map.current.off('click', 'alert-markers', handleClick);
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

      {/* Map controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
        {/* Layer toggle */}
        <div className="bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg border border-white/10 p-2">
          <div className="flex items-center gap-2 mb-2">
            <Layers size={14} className="text-mv-text-muted" />
            <span className="text-xs text-mv-text-secondary">Layers</span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPolygons}
                onChange={(e) => setShowPolygons(e.target.checked)}
                className="w-3 h-3 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
              />
              <span className="text-xs text-mv-text-secondary">Polygons</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showMarkers}
                onChange={(e) => setShowMarkers(e.target.checked)}
                className="w-3 h-3 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
              />
              <span className="text-xs text-mv-text-secondary">Markers</span>
            </label>
          </div>
        </div>
      </div>

      {/* Fit to all button */}
      <button
        onClick={fitToAllAlerts}
        className="absolute bottom-3 left-3 flex items-center gap-2 px-3 py-2 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg border border-white/10 hover:border-white/20 transition-colors z-10"
        title="Fit to all alerts"
      >
        <Maximize2 size={14} className="text-mv-text-primary" />
        <span className="text-xs text-mv-text-secondary">Fit All</span>
      </button>

      {/* Legend */}
      <div className="absolute bottom-3 right-3 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg p-3 border border-white/10 z-10">
        <div className="text-xs text-mv-text-muted mb-2">Severity</div>
        <div className="flex flex-col gap-1">
          {['Extreme', 'Severe', 'Moderate', 'Minor'].map(sev => (
            <div key={sev} className="flex items-center gap-2">
              <div
                className="w-4 h-3 rounded-sm border"
                style={{
                  background: SEVERITY_COLORS[sev].fill,
                  borderColor: SEVERITY_COLORS[sev].stroke
                }}
              />
              <span className="text-[10px] text-mv-text-secondary">{sev}</span>
            </div>
          ))}
        </div>
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
