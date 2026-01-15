'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Snowflake, Calendar, Info, AlertTriangle, RefreshCw } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Risk levels and their colors
const RISK_LEVELS = [
  { label: 'Marginal Risk', wssiLabel: 'Winter Weather Area', color: '#60A5FA' },
  { label: 'Slight Risk', wssiLabel: 'Minor Impacts', color: '#2563EB' },
  { label: 'Enhanced Risk', wssiLabel: 'Moderate Impacts', color: '#7C3AED' },
  { label: 'Moderate Risk', wssiLabel: 'Major Impacts', color: '#A21CAF' },
  { label: 'High Risk', wssiLabel: 'Extreme Impacts', color: '#DC2626' },
];

// Available days
const DAYS = [1, 2, 3];

interface WSSIFeature {
  type: 'Feature';
  geometry: GeoJSON.Geometry;
  properties: {
    day: number;
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

export default function WSSIClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const popup = useRef<mapboxgl.Popup | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [wssiData, setWssiData] = useState<Record<number, WSSIGeoJSON>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch WSSI data for a specific day
  const fetchWSSIData = useCallback(async (day: number) => {
    if (loading[day]) return;

    setLoading(prev => ({ ...prev, [day]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/wssi/day/${day}`);
      const lastModified = response.headers.get('X-WSSI-Last-Modified');

      if (!response.ok) {
        throw new Error(`Failed to fetch WSSI data: ${response.status}`);
      }

      const data: WSSIGeoJSON = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setWssiData(prev => ({ ...prev, [day]: data }));

      if (lastModified) {
        setLastUpdate(new Date(lastModified).toLocaleString());
      }
    } catch (err) {
      console.error('Error fetching WSSI data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load WSSI data');
    } finally {
      setLoading(prev => ({ ...prev, [day]: false }));
    }
  }, [loading]);

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

  // Fetch initial data when map loads
  useEffect(() => {
    if (mapLoaded) {
      fetchWSSIData(selectedDay);
    }
  }, [mapLoaded, selectedDay, fetchWSSIData]);

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
    for (const risk of RISK_LEVELS) {
      const fillLayerId = `wssi-fill-${risk.label.replace(/\s+/g, '-').toLowerCase()}`;
      const outlineLayerId = `wssi-outline-${risk.label.replace(/\s+/g, '-').toLowerCase()}`;

      // Fill layer
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

      // Outline layer
      m.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: 'wssi-data',
        filter: ['==', ['get', 'riskLabel'], risk.label],
        paint: {
          'line-color': risk.color,
          'line-width': 1.5,
          'line-opacity': 0.95,
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

      const html = `
        <div class="p-2 text-sm">
          <div class="font-semibold text-white mb-1">Day ${props.day} Outlook</div>
          <div class="flex items-center gap-2 mb-1">
            <span class="w-3 h-3 rounded-sm" style="background-color: ${props.riskColor}"></span>
            <span class="text-white">${props.riskLabel}</span>
          </div>
          <div class="text-gray-400 text-xs">WSSI: ${props.originalLabel}</div>
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
              disabled={isLoading}
              className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw size={16} className={`text-mv-text-muted ${isLoading ? 'animate-spin' : ''}`} />
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
          {(!mapLoaded || isLoading) && (
            <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <span className="text-sm text-mv-text-muted">
                  {isLoading ? 'Loading WSSI data...' : 'Loading map...'}
                </span>
              </div>
            </div>
          )}

          {/* No data message */}
          {mapLoaded && !isLoading && !hasData && !error && (
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
