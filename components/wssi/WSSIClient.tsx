'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Snowflake, RefreshCw } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Risk levels for legend (in order of severity - low to high)
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
    category: string;
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
  const [metrics, setMetrics] = useState<{ features: number; vertices: number; bytes: number } | null>(null);

  // Debounce ref for day changes
  const dayChangeTimeout = useRef<NodeJS.Timeout | null>(null);

  // Fetch pre-processed WSSI data from server
  const fetchWSSIData = useCallback(async (day: number) => {
    // Skip if already loading this day
    if (loading[day]) return;

    setLoading(prev => ({ ...prev, [day]: true }));
    setError(null);

    try {
      // Use overview resolution for performance (server does all processing)
      const response = await fetch(`/api/wssi/day/${day}?res=overview`);
      const lastModified = response.headers.get('X-WSSI-Last-Modified');
      const featureCount = response.headers.get('X-WSSI-Features');
      const vertexCount = response.headers.get('X-WSSI-Vertices');
      const byteCount = response.headers.get('X-WSSI-Bytes');

      if (!response.ok) {
        throw new Error(`Failed to fetch WSSI data: ${response.status}`);
      }

      const data: WSSIGeoJSON = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Update state with pre-processed data (NO client-side processing!)
      setWssiData(prev => ({ ...prev, [day]: data }));

      if (lastModified) {
        setLastUpdate(new Date(lastModified).toLocaleString());
      }

      // Update metrics for debugging
      setMetrics({
        features: parseInt(featureCount || '0', 10),
        vertices: parseInt(vertexCount || '0', 10),
        bytes: parseInt(byteCount || '0', 10),
      });

      console.log(`[WSSI Client] Day ${day}: ${featureCount} features, ${vertexCount} vertices, ${((parseInt(byteCount || '0', 10)) / 1024).toFixed(1)} KB`);
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
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98, 39],
      zoom: 3.5,
      minZoom: 2,
      maxZoom: 10,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    popup.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'wssi-popup',
    });

    map.current.on('load', () => {
      if (!map.current) return;

      // Add empty source - will be populated when data loads
      map.current.addSource('wssi', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Add fill layer
      map.current.addLayer({
        id: 'wssi-fill',
        type: 'fill',
        source: 'wssi',
        paint: {
          'fill-color': ['get', 'riskColor'],
          'fill-opacity': 0.6,
        },
      });

      // Add outline layer
      map.current.addLayer({
        id: 'wssi-outline',
        type: 'line',
        source: 'wssi',
        paint: {
          'line-color': ['get', 'riskColor'],
          'line-width': 2,
          'line-opacity': 0.9,
        },
      });

      // Hover effects
      map.current.on('mouseenter', 'wssi-fill', () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', 'wssi-fill', () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
        popup.current?.remove();
      });

      map.current.on('mousemove', 'wssi-fill', (e) => {
        if (!e.features?.length || !popup.current || !map.current) return;

        const feature = e.features[0];
        const props = feature.properties;

        popup.current
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 8px;">
              <div style="font-weight: 600; color: ${props?.riskColor || '#fff'}; margin-bottom: 4px;">
                ${props?.riskLabel || 'Unknown'}
              </div>
              <div style="font-size: 12px; color: #9CA3AF;">
                ${props?.originalLabel || ''}
              </div>
            </div>
          `)
          .addTo(map.current);
      });

      setMapLoaded(true);
    });

    return () => {
      popup.current?.remove();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update map when data or day changes (debounced)
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    // Debounce day changes to prevent rapid re-renders
    if (dayChangeTimeout.current) {
      clearTimeout(dayChangeTimeout.current);
    }

    dayChangeTimeout.current = setTimeout(() => {
      const source = map.current?.getSource('wssi') as mapboxgl.GeoJSONSource;
      if (!source) return;

      const data = wssiData[selectedDay];
      if (data) {
        // Set pre-processed data directly - NO processing here
        source.setData(data);
      } else {
        // Clear and fetch
        source.setData({ type: 'FeatureCollection', features: [] });
        fetchWSSIData(selectedDay);
      }
    }, 100); // 100ms debounce

    return () => {
      if (dayChangeTimeout.current) {
        clearTimeout(dayChangeTimeout.current);
      }
    };
  }, [mapLoaded, selectedDay, wssiData, fetchWSSIData]);

  // Fetch data for initial day
  useEffect(() => {
    if (mapLoaded && !wssiData[selectedDay] && !loading[selectedDay]) {
      fetchWSSIData(selectedDay);
    }
  }, [mapLoaded, selectedDay, wssiData, loading, fetchWSSIData]);

  const handleDayChange = (day: number) => {
    setSelectedDay(day);
  };

  const handleRefresh = () => {
    // Clear cached data for current day and refetch
    setWssiData(prev => {
      const newData = { ...prev };
      delete newData[selectedDay];
      return newData;
    });
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
              WSSI Winter Storm Severity
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdate && (
              <span className="text-xs text-mv-text-muted hidden md:inline">
                Updated: {lastUpdate}
              </span>
            )}
            {metrics && (
              <span className="text-xs text-mv-text-muted hidden lg:inline font-mono">
                {metrics.features}f / {metrics.vertices}v / {(metrics.bytes / 1024).toFixed(0)}KB
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
        <aside className="w-64 flex-shrink-0 bg-mv-bg-secondary/50 border-r border-white/10 p-4 space-y-6 overflow-y-auto">
          {/* Day selector */}
          <section>
            <h3 className="text-sm font-semibold text-mv-text-primary mb-3">Forecast Day</h3>
            <div className="flex gap-2">
              {DAYS.map(day => (
                <button
                  key={day}
                  onClick={() => handleDayChange(day)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                    selectedDay === day
                      ? 'bg-cyan-500 text-white'
                      : 'bg-white/5 text-mv-text-muted hover:bg-white/10'
                  }`}
                >
                  Day {day}
                </button>
              ))}
            </div>
          </section>

          {/* Legend */}
          <section>
            <h3 className="text-sm font-semibold text-mv-text-primary mb-3">Risk Levels</h3>
            <div className="space-y-2">
              {RISK_LEVELS.map(level => (
                <div key={level.label} className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: level.color }}
                  />
                  <div className="flex-1">
                    <div className="text-xs font-medium text-mv-text-primary">{level.label}</div>
                    <div className="text-[10px] text-mv-text-muted">{level.wssiLabel}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Info */}
          <section className="text-xs text-mv-text-muted">
            <p>
              Winter Storm Severity Index (WSSI) from NOAA/NWS shows expected
              winter weather impacts over the next 3 days.
            </p>
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
              <div className="bg-red-500/20 backdrop-blur-sm text-red-400 px-4 py-2 rounded-lg border border-red-500/30 text-sm">
                {error}
              </div>
            </div>
          )}
        </main>
      </div>

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
