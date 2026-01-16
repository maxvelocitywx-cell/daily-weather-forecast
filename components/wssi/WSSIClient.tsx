'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Snowflake, RefreshCw } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Custom Mapbox style - NEVER change after init
const MAPBOX_STYLE = 'mapbox://styles/maxvelocity/cmkew9qqf003y01rxdwxp37k4';

// Zoom threshold for resolution switching
const DETAIL_ZOOM_THRESHOLD = 6;

// Debounce delay for fetch (ms)
const FETCH_DEBOUNCE_MS = 200;

// Risk levels for legend
const RISK_LEVELS = [
  { label: 'Marginal Risk', wssiLabel: 'Winter Weather Area', color: '#60A5FA' },
  { label: 'Slight Risk', wssiLabel: 'Minor Impacts', color: '#2563EB' },
  { label: 'Enhanced Risk', wssiLabel: 'Moderate Impacts', color: '#7C3AED' },
  { label: 'Moderate Risk', wssiLabel: 'Major Impacts', color: '#A21CAF' },
  { label: 'High Risk', wssiLabel: 'Extreme Impacts', color: '#DC2626' },
];

const DAYS = [1, 2, 3];

interface WSSIGeoJSON {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJSON.Geometry;
    properties: Record<string, unknown>;
  }>;
  error?: string;
}

type Resolution = 'overview' | 'detail';

export default function WSSIClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const popup = useRef<mapboxgl.Popup | null>(null);
  const sourceAdded = useRef(false);
  const layersAdded = useRef(false);

  // Debounce timer ref
  const fetchDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{ features: number; vertices: number; bytes: number } | null>(null);
  const [displayResolution, setDisplayResolution] = useState<Resolution>('overview');

  // Cache: day -> { overview: data, detail: data }
  const dataCache = useRef<Record<number, Record<Resolution, WSSIGeoJSON | null>>>({});

  // Track current resolution (not in state to avoid re-renders)
  const currentResolution = useRef<Resolution>('overview');

  // Track current day for internal use
  const currentDay = useRef<number>(1);

  // Track in-flight fetch to prevent duplicates
  const inFlightFetch = useRef<string | null>(null);

  // Add WSSI layers to map (called once after style loads)
  const addWSSILayers = useCallback(() => {
    if (!map.current || layersAdded.current) return;

    // Add source if not exists
    if (!sourceAdded.current) {
      map.current.addSource('wssi', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      sourceAdded.current = true;
    }

    // Add fill layer with 0.40 opacity as specified
    map.current.addLayer({
      id: 'wssi-fill',
      type: 'fill',
      source: 'wssi',
      paint: {
        'fill-color': ['get', 'riskColor'],
        'fill-opacity': 0.40,
      },
    });

    // Add halo outline (wider, semi-transparent for glow effect)
    map.current.addLayer({
      id: 'wssi-outline-halo',
      type: 'line',
      source: 'wssi',
      paint: {
        'line-color': ['get', 'riskColor'],
        'line-width': 5,
        'line-opacity': 0.3,
        'line-blur': 2,
      },
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
    });

    // Add main outline
    map.current.addLayer({
      id: 'wssi-outline',
      type: 'line',
      source: 'wssi',
      paint: {
        'line-color': ['get', 'riskColor'],
        'line-width': 2,
        'line-opacity': 0.9,
      },
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
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

    layersAdded.current = true;
  }, []);

  // Update map source with data (no state changes, just map update)
  const updateMapData = useCallback((data: WSSIGeoJSON | null) => {
    if (!map.current || !sourceAdded.current) return;

    const source = map.current.getSource('wssi') as mapboxgl.GeoJSONSource;
    if (!source) return;

    if (data) {
      source.setData(data);
    } else {
      source.setData({ type: 'FeatureCollection', features: [] });
    }
  }, []);

  // Fetch WSSI data for a day/resolution - returns data, doesn't update state much
  const fetchWSSIData = useCallback(async (day: number, resolution: Resolution): Promise<WSSIGeoJSON | null> => {
    // Check cache first
    if (dataCache.current[day]?.[resolution]) {
      const cached = dataCache.current[day][resolution];
      // Update display metrics from cache
      if (cached && cached.features) {
        setMetrics({
          features: cached.features.length,
          vertices: 0, // We don't have this from cache
          bytes: 0,
        });
      }
      return cached;
    }

    // Prevent duplicate in-flight fetches
    const fetchKey = `${day}-${resolution}`;
    if (inFlightFetch.current === fetchKey) {
      return null;
    }
    inFlightFetch.current = fetchKey;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/wssi/day/${day}?res=${resolution}`);
      const lastModified = response.headers.get('X-WSSI-Last-Modified');
      const featureCount = response.headers.get('X-WSSI-Features');
      const vertexCount = response.headers.get('X-WSSI-Vertices');
      const byteCount = response.headers.get('X-WSSI-Bytes');

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const data: WSSIGeoJSON = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Cache the data
      if (!dataCache.current[day]) {
        dataCache.current[day] = { overview: null, detail: null };
      }
      dataCache.current[day][resolution] = data;

      if (lastModified) {
        setLastUpdate(new Date(lastModified).toLocaleString());
      }

      setMetrics({
        features: parseInt(featureCount || '0', 10),
        vertices: parseInt(vertexCount || '0', 10),
        bytes: parseInt(byteCount || '0', 10),
      });

      console.log(`[WSSI] Day ${day} ${resolution}: ${featureCount}f, ${vertexCount}v, ${((parseInt(byteCount || '0', 10)) / 1024).toFixed(1)}KB`);

      return data;
    } catch (err) {
      console.error('Error fetching WSSI:', err);
      setError(err instanceof Error ? err.message : 'Failed to load');
      return null;
    } finally {
      setLoading(false);
      inFlightFetch.current = null;
    }
  }, []);

  // Debounced load function - fetches and updates map
  const loadDataDebounced = useCallback((day: number, resolution: Resolution) => {
    // Clear any pending debounce
    if (fetchDebounceTimer.current) {
      clearTimeout(fetchDebounceTimer.current);
    }

    fetchDebounceTimer.current = setTimeout(async () => {
      const data = await fetchWSSIData(day, resolution);
      updateMapData(data);
      setDisplayResolution(resolution);
    }, FETCH_DEBOUNCE_MS);
  }, [fetchWSSIData, updateMapData]);

  // Handle zoom changes - compute resolution and trigger fetch if needed
  const handleZoomEnd = useCallback(() => {
    if (!map.current) return;

    const zoom = map.current.getZoom();
    const newRes: Resolution = zoom >= DETAIL_ZOOM_THRESHOLD ? 'detail' : 'overview';

    // Only refetch if resolution actually changed
    if (newRes !== currentResolution.current) {
      currentResolution.current = newRes;
      loadDataDebounced(currentDay.current, newRes);
    }
  }, [loadDataDebounced]);

  // Initialize map ONCE - no state dependencies that could cause remount
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_STYLE,
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
      addWSSILayers();
      setMapLoaded(true);

      // Initial data load after map is ready
      loadDataDebounced(currentDay.current, currentResolution.current);
    });

    // Handle style reload (if style changes externally)
    map.current.on('style.load', () => {
      sourceAdded.current = false;
      layersAdded.current = false;
      addWSSILayers();
    });

    // Zoom-based resolution switching - use zoomend (not zoom) to trigger once per interaction
    map.current.on('zoomend', handleZoomEnd);

    return () => {
      if (fetchDebounceTimer.current) {
        clearTimeout(fetchDebounceTimer.current);
      }
      popup.current?.remove();
      map.current?.remove();
      map.current = null;
      sourceAdded.current = false;
      layersAdded.current = false;
    };
  }, [addWSSILayers, handleZoomEnd, loadDataDebounced]);

  // Handle day change - only this state change triggers a refetch
  const handleDayChange = useCallback((day: number) => {
    setSelectedDay(day);
    currentDay.current = day;

    // Load data for new day at current resolution
    loadDataDebounced(day, currentResolution.current);
  }, [loadDataDebounced]);

  const handleRefresh = useCallback(() => {
    // Clear cache for current day and refetch
    if (dataCache.current[currentDay.current]) {
      dataCache.current[currentDay.current] = { overview: null, detail: null };
    }
    loadDataDebounced(currentDay.current, currentResolution.current);
  }, [loadDataDebounced]);

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
            <span className="text-xs text-cyan-400 font-mono hidden sm:inline">
              {displayResolution}
            </span>
            {metrics && (
              <span className="text-xs text-mv-text-muted hidden lg:inline font-mono">
                {metrics.features}f/{metrics.vertices}v/{(metrics.bytes / 1024).toFixed(0)}KB
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw size={16} className={`text-mv-text-muted ${loading ? 'animate-spin' : ''}`} />
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
            <p className="mt-2 text-[10px]">
              Zoom in for higher detail resolution.
            </p>
          </section>
        </aside>

        {/* Map container */}
        <main className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />

          {/* Loading overlay */}
          {(!mapLoaded || loading) && (
            <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <span className="text-sm text-mv-text-muted">
                  {loading ? 'Loading WSSI data...' : 'Loading map...'}
                </span>
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
