'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Snowflake, RefreshCw, X, AlertTriangle } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Custom Mapbox style - NEVER change after init
const MAPBOX_STYLE = 'mapbox://styles/maxvelocity/cmkew9qqf003y01rxdwxp37k4';

// Use single resolution for consistent roundness at all zoom levels
const FIXED_RESOLUTION = 'detail';

// Risk levels for legend
const RISK_LEVELS = [
  { label: 'Marginal Risk', wssiLabel: 'Winter Weather Area', color: '#60A5FA' },
  { label: 'Slight Risk', wssiLabel: 'Minor Impacts', color: '#2563EB' },
  { label: 'Enhanced Risk', wssiLabel: 'Moderate Impacts', color: '#7C3AED' },
  { label: 'Moderate Risk', wssiLabel: 'Major Impacts', color: '#A21CAF' },
  { label: 'High Risk', wssiLabel: 'Extreme Impacts', color: '#DC2626' },
];

const DAYS = [1, 2, 3];

// Risk details for modal display
const RISK_DETAILS: Record<string, { title: string; description: string; impacts: string[] }> = {
  'Marginal Risk': {
    title: 'Marginal Risk - Winter Weather Area',
    description: 'Limited winter weather expected with minimal impacts to travel and daily activities.',
    impacts: [
      'Light snow accumulation possible',
      'Minor travel inconveniences',
      'Normal precautions advised',
    ],
  },
  'Slight Risk': {
    title: 'Slight Risk - Minor Impacts',
    description: 'Minor winter weather impacts expected. Some travel delays possible.',
    impacts: [
      'Snow accumulation 1-3 inches likely',
      'Slippery road conditions',
      'Plan extra travel time',
      'Check road conditions before traveling',
    ],
  },
  'Enhanced Risk': {
    title: 'Enhanced Risk - Moderate Impacts',
    description: 'Moderate winter storm impacts expected. Significant travel disruptions likely.',
    impacts: [
      'Snow accumulation 3-6 inches likely',
      'Hazardous driving conditions',
      'Possible power outages',
      'Consider postponing travel',
    ],
  },
  'Moderate Risk': {
    title: 'Moderate Risk - Major Impacts',
    description: 'Major winter storm impacts expected. Dangerous travel conditions.',
    impacts: [
      'Heavy snow accumulation 6-12 inches',
      'Travel extremely hazardous or impossible',
      'Extended power outages likely',
      'Stay home if possible',
      'Stock emergency supplies',
    ],
  },
  'High Risk': {
    title: 'High Risk - Extreme Impacts',
    description: 'Extreme winter storm with life-threatening conditions. Travel should be avoided.',
    impacts: [
      'Blizzard or ice storm conditions',
      'Snow accumulation 12+ inches possible',
      'Widespread power outages expected',
      'Life-threatening conditions',
      'Do not travel under any circumstances',
      'Seek shelter immediately',
    ],
  },
};

interface WSSIGeoJSON {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJSON.Geometry;
    properties: Record<string, unknown>;
  }>;
  error?: string;
  status?: string; // For 202 Building response
  message?: string;
}

// Max poll attempts and delay
const POLL_DELAY_MS = 3000;
const MAX_POLL_ATTEMPTS = 20; // 60 seconds max

export default function WSSIClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const popup = useRef<mapboxgl.Popup | null>(null);
  const sourceAdded = useRef(false);
  const layersAdded = useRef(false);

  // State - use fixed resolution for consistent appearance
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{ features: number; vertices: number; bytes: number } | null>(null);
  const [modalData, setModalData] = useState<{ riskLabel: string; riskColor: string; originalLabel: string } | null>(null);

  // Refs for fetch control - these prevent loops
  const lastFetchKey = useRef<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const dataCache = useRef<Record<string, WSSIGeoJSON>>({});

  // Update map source with data
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

    // Find the first label/symbol layer to insert our layers below it
    // This ensures WSSI polygons render underneath city names, roads, and other map features
    const layers = map.current.getStyle().layers;
    const labelLayerId = layers.find(
      (layer) => layer.type === 'symbol' && (layer.layout as Record<string, unknown>)?.['text-field']
    )?.id;

    // Add fill layer with 0.40 opacity as specified
    // Insert BEFORE labelLayerId so it renders underneath labels
    map.current.addLayer({
      id: 'wssi-fill',
      type: 'fill',
      source: 'wssi',
      paint: {
        'fill-color': ['get', 'riskColor'],
        'fill-opacity': 0.40,
        'fill-antialias': false, // Test: disable antialiasing to debug hollow circle
      },
    }, labelLayerId);

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
    }, labelLayerId);

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
    }, labelLayerId);

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
      const riskLabel = props?.riskLabel || 'Unknown';
      const riskColor = props?.riskColor || '#fff';
      const originalLabel = props?.originalLabel || '';

      popup.current
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding: 12px; min-width: 180px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <div style="width: 12px; height: 12px; border-radius: 3px; background: ${riskColor}; flex-shrink: 0;"></div>
              <div style="font-weight: 600; font-size: 14px; color: #fff;">
                ${riskLabel}
              </div>
            </div>
            <div style="font-size: 12px; color: #9CA3AF; margin-bottom: 8px;">
              ${originalLabel}
            </div>
            <div style="font-size: 11px; color: #6B7280; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
              Click for details
            </div>
          </div>
        `)
        .addTo(map.current);
    });

    // Click handler - open modal with risk details
    map.current.on('click', 'wssi-fill', (e) => {
      if (!e.features?.length) return;

      const feature = e.features[0];
      const props = feature.properties;

      setModalData({
        riskLabel: props?.riskLabel || 'Unknown',
        riskColor: props?.riskColor || '#fff',
        originalLabel: props?.originalLabel || '',
      });
    });

    layersAdded.current = true;
  }, []);

  // Initialize map ONCE - empty dependency array
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    console.log('[WSSI] Initializing map');

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

    // Inject CSS for popup styling (more reliable than styled-jsx)
    if (!document.getElementById('wssi-popup-styles')) {
      const style = document.createElement('style');
      style.id = 'wssi-popup-styles';
      style.textContent = `
        .wssi-popup .mapboxgl-popup-content {
          background: rgba(15, 15, 20, 0.95);
          color: white;
          padding: 0;
          border-radius: 8px;
          font-size: 14px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .wssi-popup .mapboxgl-popup-tip {
          border-top-color: rgba(15, 15, 20, 0.95);
        }
      `;
      document.head.appendChild(style);
    }

    map.current.on('load', () => {
      console.log('[WSSI] Map loaded');
      addWSSILayers();
      setMapLoaded(true);
    });

    // Handle style reload (if style changes externally)
    map.current.on('style.load', () => {
      sourceAdded.current = false;
      layersAdded.current = false;
      addWSSILayers();
    });

    // No zoom-based resolution switching - use same data at all zoom levels

    return () => {
      console.log('[WSSI] Cleaning up map');
      popup.current?.remove();
      map.current?.remove();
      map.current = null;
      sourceAdded.current = false;
      layersAdded.current = false;
    };
  }, [addWSSILayers]);

  // Fetch data when day changes
  // Uses fixed resolution for consistent appearance at all zoom levels
  useEffect(() => {
    if (!mapLoaded) return;

    const key = `${selectedDay}:${FIXED_RESOLUTION}`;

    // Guard: don't refetch if we already fetched this key
    if (lastFetchKey.current === key) {
      console.log(`[WSSI] Skip fetch - same key: ${key}`);
      return;
    }

    // Check cache first
    if (dataCache.current[key]) {
      console.log(`[WSSI] Using cached data for: ${key}`);
      lastFetchKey.current = key;
      updateMapData(dataCache.current[key]);
      return;
    }

    // Abort any in-flight request
    if (abortController.current) {
      console.log(`[WSSI] Aborting previous fetch`);
      abortController.current.abort();
    }

    // Create new abort controller
    const controller = new AbortController();
    abortController.current = controller;

    const fetchData = async () => {
      console.log(`[WSSI] Fetch start: ${key}`);
      setLoading(true);
      setError(null);

      let pollAttempts = 0;

      while (pollAttempts < MAX_POLL_ATTEMPTS) {
        try {
          const response = await fetch(`/api/wssi/day/${selectedDay}?res=${FIXED_RESOLUTION}`, {
            signal: controller.signal,
          });

          // Check if this request was aborted
          if (controller.signal.aborted) {
            console.log(`[WSSI] Fetch aborted: ${key}`);
            return;
          }

          // Handle 202 Building response - poll again
          if (response.status === 202) {
            pollAttempts++;
            console.log(`[WSSI] 202 Building - poll attempt ${pollAttempts}/${MAX_POLL_ATTEMPTS}`);

            if (pollAttempts >= MAX_POLL_ATTEMPTS) {
              throw new Error('Data computation timed out');
            }

            // Wait before polling again
            await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
            continue;
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data: WSSIGeoJSON = await response.json();

          // Check abort again after parsing
          if (controller.signal.aborted) {
            console.log(`[WSSI] Fetch aborted after parse: ${key}`);
            return;
          }

          if (data.error) {
            throw new Error(data.error);
          }

          // Extract metrics from headers
          const featureCount = response.headers.get('X-WSSI-Features');
          const vertexCount = response.headers.get('X-WSSI-Vertices');
          const byteCount = response.headers.get('X-WSSI-Bytes');
          const lastModified = response.headers.get('X-WSSI-Last-Modified');

          console.log(`[WSSI] Fetch success: ${key}, ${featureCount}f, ${vertexCount}v, ${byteCount}b`);

          // Cache the data
          dataCache.current[key] = data;
          lastFetchKey.current = key;

          // Update state
          updateMapData(data);
          setMetrics({
            features: parseInt(featureCount || '0', 10),
            vertices: parseInt(vertexCount || '0', 10),
            bytes: parseInt(byteCount || '0', 10),
          });
          if (lastModified) {
            setLastUpdate(new Date(lastModified).toLocaleString());
          }
          setError(null);

          // Success - break out of poll loop
          break;

        } catch (err) {
          // Don't set error if aborted
          if (err instanceof Error && err.name === 'AbortError') {
            console.log(`[WSSI] Fetch aborted (caught): ${key}`);
            return;
          }
          console.error(`[WSSI] Fetch error: ${key}`, err);
          setError(err instanceof Error ? err.message : 'Failed to load');
          break;
        }
      }

      // Only clear loading if this is still the current request
      if (abortController.current === controller) {
        setLoading(false);
      }
    };

    fetchData();

    // Cleanup: abort on unmount or deps change
    return () => {
      controller.abort();
    };
  }, [mapLoaded, selectedDay, updateMapData]);

  // Handle day change
  const handleDayChange = useCallback((day: number) => {
    console.log(`[WSSI] Day change: ${day}`);
    setSelectedDay(day);
  }, []);

  // Handle manual refresh
  const handleRefresh = useCallback(() => {
    console.log(`[WSSI] Manual refresh`);
    // Clear cache for current key and reset lastFetchKey to force refetch
    const key = `${selectedDay}:${FIXED_RESOLUTION}`;
    delete dataCache.current[key];
    lastFetchKey.current = null;
    // Force re-render by updating a state
    setSelectedDay(prev => prev); // This won't change value but will trigger effect
  }, [selectedDay]);

  // Force refetch by changing a trigger state
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefreshClick = useCallback(() => {
    console.log(`[WSSI] Refresh clicked`);
    const key = `${selectedDay}:${FIXED_RESOLUTION}`;
    delete dataCache.current[key];
    lastFetchKey.current = null;
    setRefreshTrigger(prev => prev + 1);
  }, [selectedDay]);

  // Add refreshTrigger to the fetch effect dependencies
  useEffect(() => {
    if (!mapLoaded) return;
    if (refreshTrigger === 0) return; // Skip initial mount

    const key = `${selectedDay}:${FIXED_RESOLUTION}`;
    console.log(`[WSSI] Refresh trigger: ${key}`);

    // Abort any in-flight request
    if (abortController.current) {
      abortController.current.abort();
    }

    const controller = new AbortController();
    abortController.current = controller;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      let pollAttempts = 0;

      while (pollAttempts < MAX_POLL_ATTEMPTS) {
        try {
          const response = await fetch(`/api/wssi/day/${selectedDay}?res=${FIXED_RESOLUTION}`, {
            signal: controller.signal,
          });

          if (controller.signal.aborted) return;

          // Handle 202 Building response - poll again
          if (response.status === 202) {
            pollAttempts++;
            console.log(`[WSSI] Refresh 202 Building - poll attempt ${pollAttempts}/${MAX_POLL_ATTEMPTS}`);

            if (pollAttempts >= MAX_POLL_ATTEMPTS) {
              throw new Error('Data computation timed out');
            }

            await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
            continue;
          }

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const data: WSSIGeoJSON = await response.json();
          if (controller.signal.aborted) return;
          if (data.error) throw new Error(data.error);

          const featureCount = response.headers.get('X-WSSI-Features');
          const vertexCount = response.headers.get('X-WSSI-Vertices');
          const byteCount = response.headers.get('X-WSSI-Bytes');
          const lastModified = response.headers.get('X-WSSI-Last-Modified');

          dataCache.current[key] = data;
          lastFetchKey.current = key;

          updateMapData(data);
          setMetrics({
            features: parseInt(featureCount || '0', 10),
            vertices: parseInt(vertexCount || '0', 10),
            bytes: parseInt(byteCount || '0', 10),
          });
          if (lastModified) {
            setLastUpdate(new Date(lastModified).toLocaleString());
          }
          setError(null);
          break;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : 'Failed to load');
          break;
        }
      }

      if (abortController.current === controller) {
        setLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, [refreshTrigger, mapLoaded, selectedDay, updateMapData]);

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
                {metrics.features}f/{metrics.vertices}v/{(metrics.bytes / 1024).toFixed(0)}KB
              </span>
            )}
            <button
              onClick={handleRefreshClick}
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
              Smoothed with 25-mile radius curves.
            </p>
          </section>
        </aside>

        {/* Map container */}
        <main className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />

          {/* Loading overlay - only show on initial load, not on refetch */}
          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <span className="text-sm text-mv-text-muted">Loading map...</span>
              </div>
            </div>
          )}

          {/* Data loading indicator - small, non-blocking */}
          {mapLoaded && loading && (
            <div className="absolute top-4 left-4 z-10">
              <div className="bg-mv-bg-secondary/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/10 flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <span className="text-xs text-mv-text-muted">Loading data...</span>
              </div>
            </div>
          )}

          {/* Error message with retry */}
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-red-500/20 backdrop-blur-sm text-red-400 px-4 py-2 rounded-lg border border-red-500/30 text-sm flex items-center gap-3">
                <span>{error}</span>
                <button
                  onClick={handleRefreshClick}
                  className="px-2 py-1 bg-red-500/30 hover:bg-red-500/50 rounded text-xs"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Risk Details Modal */}
      {modalData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setModalData(null)}
        >
          <div
            className="bg-mv-bg-secondary border border-white/10 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              className="px-6 py-4 border-b border-white/10"
              style={{ backgroundColor: `${modalData.riskColor}15` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: modalData.riskColor }}
                  />
                  <h2 className="text-lg font-semibold text-mv-text-primary">
                    {modalData.riskLabel}
                  </h2>
                </div>
                <button
                  onClick={() => setModalData(null)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                >
                  <X size={20} className="text-mv-text-muted" />
                </button>
              </div>
              <p className="text-sm text-mv-text-muted mt-1">
                {modalData.originalLabel}
              </p>
            </div>

            {/* Modal Content */}
            <div className="px-6 py-4">
              {RISK_DETAILS[modalData.riskLabel] ? (
                <>
                  <p className="text-sm text-mv-text-secondary mb-4">
                    {RISK_DETAILS[modalData.riskLabel].description}
                  </p>
                  <div>
                    <h3 className="text-xs font-semibold text-mv-text-muted uppercase tracking-wider mb-2">
                      Expected Impacts
                    </h3>
                    <ul className="space-y-2">
                      {RISK_DETAILS[modalData.riskLabel].impacts.map((impact, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-mv-text-secondary">
                          <AlertTriangle
                            size={14}
                            className="flex-shrink-0 mt-0.5"
                            style={{ color: modalData.riskColor }}
                          />
                          {impact}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <p className="text-sm text-mv-text-muted">
                  No detailed information available for this risk level.
                </p>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-white/5 border-t border-white/10">
              <button
                onClick={() => setModalData(null)}
                className="w-full py-2 px-4 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium text-mv-text-primary transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
