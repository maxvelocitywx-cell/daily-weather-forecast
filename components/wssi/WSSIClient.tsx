'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Snowflake, RefreshCw } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Custom Mapbox style - NEVER change after init
const MAPBOX_STYLE = 'mapbox://styles/maxvelocity/cmkew9qqf003y01rxdwxp37k4';

// Risk levels for legend
const RISK_LEVELS = [
  { label: 'Marginal Risk', wssiLabel: 'Winter Weather Area', color: '#60A5FA' },
  { label: 'Slight Risk', wssiLabel: 'Minor Impacts', color: '#2563EB' },
  { label: 'Enhanced Risk', wssiLabel: 'Moderate Impacts', color: '#7C3AED' },
  { label: 'Moderate Risk', wssiLabel: 'Major Impacts', color: '#A21CAF' },
  { label: 'High Risk', wssiLabel: 'Extreme Impacts', color: '#DC2626' },
];

const DAYS = [1, 2, 3];

// Source/layer IDs
const WSSI_SOURCE_ID = 'wssi-tiles';
const WSSI_LAYER_ID = 'wssi-raster';

export default function WSSIClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const currentDay = useRef<number>(1);

  // State
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update tile source URL when day changes
  const updateTileSource = useCallback((day: number) => {
    if (!map.current) return;

    console.log(`[WSSI] Updating tile source for day ${day}`);
    currentDay.current = day;

    // Remove existing source and layer if present
    try {
      if (map.current.getLayer(WSSI_LAYER_ID)) {
        map.current.removeLayer(WSSI_LAYER_ID);
      }
      if (map.current.getSource(WSSI_SOURCE_ID)) {
        map.current.removeSource(WSSI_SOURCE_ID);
      }
    } catch (e) {
      // Ignore errors during cleanup
    }

    // Add new source with updated day
    const tileUrl = `/api/tiles/wssi/${day}/{z}/{x}/{y}`;

    try {
      map.current.addSource(WSSI_SOURCE_ID, {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 10,
      });

      // Add raster layer
      map.current.addLayer({
        id: WSSI_LAYER_ID,
        type: 'raster',
        source: WSSI_SOURCE_ID,
        paint: {
          'raster-opacity': 0.85,
          'raster-fade-duration': 200,
        },
      });
    } catch (e) {
      console.error('[WSSI] Error adding tile source:', e);
    }

    setLoading(false);
    setError(null);
  }, []);

  // Initialize map ONCE
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    console.log('[WSSI] Initializing map');

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_STYLE,
      center: [-98, 39],
      zoom: 3.5,
      minZoom: 2,
      maxZoom: 10,
    });

    map.current = mapInstance;

    mapInstance.addControl(new mapboxgl.NavigationControl(), 'top-right');

    mapInstance.on('load', () => {
      console.log('[WSSI] Map loaded');
      setMapLoaded(true);
    });

    // Handle style reload (if style changes externally)
    mapInstance.on('style.load', () => {
      console.log('[WSSI] Style reloaded, re-adding tiles');
      // Re-add tile source after style change
      if (currentDay.current) {
        updateTileSource(currentDay.current);
      }
    });

    // Track tile loading state
    mapInstance.on('dataloading', (e: mapboxgl.MapDataEvent) => {
      if ('sourceId' in e && e.sourceId === WSSI_SOURCE_ID) {
        setLoading(true);
      }
    });

    mapInstance.on('data', (e: mapboxgl.MapDataEvent) => {
      if ('sourceId' in e && e.sourceId === WSSI_SOURCE_ID && 'isSourceLoaded' in e && e.isSourceLoaded) {
        setLoading(false);
      }
    });

    mapInstance.on('error', (e: mapboxgl.ErrorEvent) => {
      // Check if this is a source-related error
      const sourceError = e as unknown as { sourceId?: string };
      if (sourceError.sourceId === WSSI_SOURCE_ID) {
        console.error('[WSSI] Tile error:', e.error);
        setError('Failed to load some tiles');
      }
    });

    return () => {
      console.log('[WSSI] Cleaning up map');
      mapInstance.remove();
      map.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add initial tile layer when map loads
  useEffect(() => {
    if (mapLoaded) {
      updateTileSource(selectedDay);
    }
  }, [mapLoaded, updateTileSource, selectedDay]);

  // Handle day change
  const handleDayChange = useCallback((day: number) => {
    console.log(`[WSSI] Day change: ${day}`);
    setLoading(true);
    setSelectedDay(day);
  }, []);

  // Handle manual refresh - force tile reload by removing and re-adding source
  const handleRefreshClick = useCallback(() => {
    console.log(`[WSSI] Refresh clicked`);
    setLoading(true);
    updateTileSource(selectedDay);
  }, [selectedDay, updateTileSource]);

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
            <span className="text-xs text-cyan-400 font-mono hidden sm:inline">
              raster
            </span>
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
              Smooth raster rendering with 25-mile blur radius.
            </p>
          </section>
        </aside>

        {/* Map container */}
        <main className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />

          {/* Loading overlay - only show on initial load */}
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
                <span className="text-xs text-mv-text-muted">Loading tiles...</span>
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
    </div>
  );
}
