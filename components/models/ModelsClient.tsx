'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Play, Pause, ChevronDown, ChevronRight, Maximize2, Info, AlertCircle } from 'lucide-react';
import {
  MODEL_REGISTRY,
  VARIABLE_GROUPS,
  getModelById,
  getModelRuns,
  getModelsByCategory,
  type ModelDefinition,
  type ModelCategory,
} from '@/lib/models/registry';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Animation config
const ANIMATION_SPEED_MS = 500;
const CROSSFADE_DURATION_MS = 200;
const MODEL_OPACITY = 0.95;

// Region presets
const REGION_PRESETS = [
  { name: 'CONUS', center: [-98.5, 39.8] as [number, number], zoom: 4 },
  { name: 'Northeast', center: [-74, 42] as [number, number], zoom: 5.5 },
  { name: 'Southeast', center: [-84, 33] as [number, number], zoom: 5.5 },
  { name: 'Midwest', center: [-90, 42] as [number, number], zoom: 5.5 },
  { name: 'Plains', center: [-100, 38] as [number, number], zoom: 5.5 },
  { name: 'Southwest', center: [-112, 34] as [number, number], zoom: 5.5 },
  { name: 'Northwest', center: [-120, 46] as [number, number], zoom: 5.5 },
  { name: 'Alaska', center: [-152, 64] as [number, number], zoom: 4 },
];

// Category display info
const CATEGORY_INFO: Record<ModelCategory, { name: string; description: string }> = {
  global: { name: 'Global Models', description: 'Worldwide coverage, medium resolution' },
  regional: { name: 'Regional Models', description: 'Continental/regional focus' },
  cam: { name: 'CAM (High-Res)', description: 'Convection-allowing, storm-scale' },
  ensemble: { name: 'Ensembles', description: 'Probabilistic multi-member' },
};

interface BufferState {
  activeBuffer: 'A' | 'B';
  bufferAHour: number;
  bufferBHour: number;
  isTransitioning: boolean;
}

export default function ModelsClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const bufferStateRef = useRef<BufferState>({
    activeBuffer: 'A',
    bufferAHour: 0,
    bufferBHour: 0,
    isTransitioning: false,
  });

  const [mapLoaded, setMapLoaded] = useState(false);
  const [layersReady, setLayersReady] = useState(false);

  // Model selection state
  const [selectedModel, setSelectedModel] = useState<ModelDefinition>(MODEL_REGISTRY.find(m => m.id === 'gfs')!);
  const [selectedRun, setSelectedRun] = useState<{ runHour: number; timestamp: Date; label: string } | null>(null);
  const [selectedVariable, setSelectedVariable] = useState('temperature_2m');
  const [forecastHour, setForecastHour] = useState(0);

  // Animation state
  const [isPlaying, setIsPlaying] = useState(false);
  const [maxForecastHour, setMaxForecastHour] = useState(48);

  // UI state
  const [expandedCategories, setExpandedCategories] = useState<Set<ModelCategory>>(new Set(['global', 'cam']));
  const [expandedVarGroups, setExpandedVarGroups] = useState<Set<string>>(new Set(['temperature']));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Initialize runs when model changes
  useEffect(() => {
    const runs = getModelRuns(selectedModel, 4);
    if (runs.length > 0) {
      setSelectedRun(runs[0]);
    }
    setMaxForecastHour(Math.min(selectedModel.forecastHours, 120)); // Cap at 120 for UI
    setForecastHour(0);
  }, [selectedModel]);

  // Get valid hours for the selected model
  const forecastHours = useMemo(() => {
    const hours: number[] = [];
    const step = selectedModel.category === 'cam' ? 1 : 3; // Hourly for CAMs, 3-hourly for global
    for (let h = 0; h <= maxForecastHour; h += step) {
      hours.push(h);
    }
    return hours;
  }, [selectedModel, maxForecastHour]);

  // Format valid time
  const validTime = useMemo(() => {
    if (!selectedRun) return '';
    const validDate = new Date(selectedRun.timestamp.getTime() + forecastHour * 60 * 60 * 1000);
    return validDate.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [selectedRun, forecastHour]);

  // Build tile URL
  const buildTileUrl = useCallback((hour: number): string => {
    const runParam = selectedRun ? `&run=${selectedRun.timestamp.toISOString()}` : '';
    return `/api/tiles/models/${selectedModel.id}/${selectedVariable}/{z}/{x}/{y}.png?hour=${hour}${runParam}`;
  }, [selectedModel, selectedVariable, selectedRun]);

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
        cancelAnimationFrame(animationRef.current);
      }
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Get first symbol layer
  const getFirstSymbolLayerId = useCallback((): string | undefined => {
    if (!map.current) return undefined;
    const style = map.current.getStyle();
    if (!style || !style.layers) return undefined;
    const firstSymbol = style.layers.find(l => l.type === 'symbol');
    return firstSymbol?.id;
  }, []);

  // Update source tiles helper (defined before effects that use it)
  const updateSourceTiles = useCallback((sourceId: string, newUrl: string) => {
    if (!map.current) return;
    const source = map.current.getSource(sourceId) as mapboxgl.RasterTileSource;
    if (source && typeof source.setTiles === 'function') {
      source.setTiles([newUrl]);
    }
  }, []);

  // Initialize double-buffered layers (once on map load)
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const m = map.current;
    const firstSymbolId = getFirstSymbolLayerId();
    const buffers = ['A', 'B'] as const;

    // Only create layers if they don't exist (never remove/re-add)
    const sourceAExists = m.getSource('model-source-A');
    if (sourceAExists) {
      // Layers already exist, just update tiles
      const initialUrl = buildTileUrl(forecastHour);
      updateSourceTiles('model-source-A', initialUrl);
      updateSourceTiles('model-source-B', initialUrl);

      // Reset buffer state
      bufferStateRef.current = {
        activeBuffer: 'A',
        bufferAHour: forecastHour,
        bufferBHour: forecastHour,
        isTransitioning: false,
      };

      // Reset opacities
      if (m.getLayer('model-layer-A')) {
        m.setPaintProperty('model-layer-A', 'raster-opacity', MODEL_OPACITY);
      }
      if (m.getLayer('model-layer-B')) {
        m.setPaintProperty('model-layer-B', 'raster-opacity', 0);
      }

      setLayersReady(true);
      return;
    }

    // Create new sources and layers (first time only)
    const initialUrl = buildTileUrl(forecastHour);
    const modelMaxZoom = selectedModel.maxZoom || 8;

    for (const buffer of buffers) {
      const sourceId = `model-source-${buffer}`;
      const layerId = `model-layer-${buffer}`;

      m.addSource(sourceId, {
        type: 'raster',
        tiles: [initialUrl],
        tileSize: 256,
        maxzoom: modelMaxZoom,
      });

      m.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        maxzoom: modelMaxZoom + 2, // Allow some overzooming with linear resampling
        paint: {
          'raster-opacity': buffer === 'A' ? MODEL_OPACITY : 0,
          'raster-fade-duration': 0,
          'raster-resampling': 'linear', // Smooth bilinear interpolation
        },
      }, firstSymbolId);
    }

    bufferStateRef.current = {
      activeBuffer: 'A',
      bufferAHour: forecastHour,
      bufferBHour: forecastHour,
      isTransitioning: false,
    };

    setLayersReady(true);
  }, [mapLoaded, getFirstSymbolLayerId]);

  // Update tiles when model/variable/run changes (without recreating layers)
  useEffect(() => {
    if (!mapLoaded || !map.current || !layersReady) return;

    const m = map.current;
    const initialUrl = buildTileUrl(forecastHour);

    // Update both buffers with new tile URL
    updateSourceTiles('model-source-A', initialUrl);
    updateSourceTiles('model-source-B', initialUrl);

    // Reset opacities
    if (m.getLayer('model-layer-A')) {
      m.setPaintProperty('model-layer-A', 'raster-opacity', MODEL_OPACITY);
    }
    if (m.getLayer('model-layer-B')) {
      m.setPaintProperty('model-layer-B', 'raster-opacity', 0);
    }

    // Update maxzoom for the model
    const modelMaxZoom = selectedModel.maxZoom || 8;
    if (m.getLayer('model-layer-A')) {
      m.setLayerZoomRange('model-layer-A', 0, modelMaxZoom + 2);
    }
    if (m.getLayer('model-layer-B')) {
      m.setLayerZoomRange('model-layer-B', 0, modelMaxZoom + 2);
    }

    bufferStateRef.current = {
      activeBuffer: 'A',
      bufferAHour: forecastHour,
      bufferBHour: forecastHour,
      isTransitioning: false,
    };
  }, [mapLoaded, layersReady, selectedModel, selectedVariable, selectedRun, buildTileUrl, forecastHour, updateSourceTiles]);

  // Wait for source to load
  const waitForSourceLoad = useCallback((sourceId: string, timeout = 3000): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!map.current) {
        resolve(false);
        return;
      }

      const m = map.current;
      if (m.isSourceLoaded(sourceId)) {
        resolve(true);
        return;
      }

      const timeoutId = setTimeout(() => {
        m.off('sourcedata', checkLoaded);
        resolve(false);
      }, timeout);

      const checkLoaded = (e: mapboxgl.MapSourceDataEvent) => {
        if (e.sourceId === sourceId && m.isSourceLoaded(sourceId)) {
          clearTimeout(timeoutId);
          m.off('sourcedata', checkLoaded);
          resolve(true);
        }
      };

      m.on('sourcedata', checkLoaded);
    });
  }, []);

  // Crossfade between layers
  const crossfade = useCallback((
    showLayerId: string,
    hideLayerId: string,
    duration: number
  ): Promise<void> => {
    return new Promise((resolve) => {
      if (!map.current) {
        resolve();
        return;
      }

      const m = map.current;
      const steps = 10;
      const stepDuration = duration / steps;
      let step = 0;

      const animate = () => {
        step++;
        const progress = step / steps;

        const showOpacity = progress * MODEL_OPACITY;
        const hideOpacity = (1 - progress) * MODEL_OPACITY;

        if (m.getLayer(showLayerId)) {
          m.setPaintProperty(showLayerId, 'raster-opacity', showOpacity);
        }
        if (m.getLayer(hideLayerId)) {
          m.setPaintProperty(hideLayerId, 'raster-opacity', hideOpacity);
        }

        if (step < steps) {
          setTimeout(animate, stepDuration);
        } else {
          resolve();
        }
      };

      animate();
    });
  }, []);

  // Advance to next frame
  const advanceFrame = useCallback(async () => {
    if (!map.current || !layersReady) return;

    const state = bufferStateRef.current;
    if (state.isTransitioning) return;

    const currentIndex = forecastHours.indexOf(forecastHour);
    const nextIndex = (currentIndex + 1) % forecastHours.length;
    const nextHour = forecastHours[nextIndex];

    const nextBuffer = state.activeBuffer === 'A' ? 'B' : 'A';
    const showSourceId = `model-source-${nextBuffer}`;
    const showLayerId = `model-layer-${nextBuffer}`;
    const hideLayerId = `model-layer-${state.activeBuffer}`;

    state.isTransitioning = true;

    const nextUrl = buildTileUrl(nextHour);
    updateSourceTiles(showSourceId, nextUrl);

    await waitForSourceLoad(showSourceId, 2000);
    await crossfade(showLayerId, hideLayerId, CROSSFADE_DURATION_MS);

    if (nextBuffer === 'A') {
      state.bufferAHour = nextHour;
    } else {
      state.bufferBHour = nextHour;
    }
    state.activeBuffer = nextBuffer;
    state.isTransitioning = false;

    setForecastHour(nextHour);
  }, [layersReady, forecastHour, forecastHours, buildTileUrl, updateSourceTiles, waitForSourceLoad, crossfade]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || !layersReady) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const animate = (timestamp: number) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastFrameTimeRef.current;

      if (elapsed >= ANIMATION_SPEED_MS && !bufferStateRef.current.isTransitioning) {
        lastFrameTimeRef.current = timestamp;
        advanceFrame();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isPlaying, layersReady, advanceFrame]);

  // Handle slider change
  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!map.current || !layersReady) return;

    const newHour = parseInt(e.target.value, 10);
    setIsPlaying(false);

    const url = buildTileUrl(newHour);
    updateSourceTiles('model-source-A', url);

    if (map.current.getLayer('model-layer-A')) {
      map.current.setPaintProperty('model-layer-A', 'raster-opacity', MODEL_OPACITY);
    }
    if (map.current.getLayer('model-layer-B')) {
      map.current.setPaintProperty('model-layer-B', 'raster-opacity', 0);
    }

    bufferStateRef.current = {
      activeBuffer: 'A',
      bufferAHour: newHour,
      bufferBHour: newHour,
      isTransitioning: false,
    };

    setForecastHour(newHour);
  }, [layersReady, buildTileUrl, updateSourceTiles]);

  // Toggle category expansion
  const toggleCategory = (category: ModelCategory) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Toggle variable group expansion
  const toggleVarGroup = (group: string) => {
    setExpandedVarGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  // Navigate to region
  const navigateToRegion = (region: typeof REGION_PRESETS[0]) => {
    map.current?.flyTo({
      center: region.center,
      zoom: region.zoom,
      duration: 1000,
    });
  };

  // Get available runs
  const availableRuns = useMemo(() => {
    return getModelRuns(selectedModel, 4);
  }, [selectedModel]);

  return (
    <div className="min-h-screen bg-mv-bg-primary flex flex-col">
      {/* Top bar */}
      <header className="bg-mv-bg-secondary/95 backdrop-blur-sm border-b border-white/10 px-4 py-3 z-20">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
              Computer Models
            </h1>
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 font-mono">
                {selectedModel.shortName}
              </span>
              <span className="text-mv-text-muted">•</span>
              <span className="text-mv-text-secondary">
                {selectedRun?.label || '--Z'} Run
              </span>
              <span className="text-mv-text-muted">•</span>
              <span className="text-mv-text-secondary">
                F{forecastHour.toString().padStart(3, '0')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="hidden md:block text-mv-text-muted">Valid:</div>
            <div className="text-mv-text-primary font-mono">{validTime || '--'}</div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <aside
          className={`${sidebarCollapsed ? 'w-12' : 'w-72'} bg-mv-bg-secondary/95 backdrop-blur-sm border-r border-white/10 flex flex-col transition-all duration-300 overflow-hidden z-10`}
        >
          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full py-2 px-3 flex items-center justify-center border-b border-white/10 hover:bg-white/5 transition-colors"
          >
            <ChevronRight
              size={16}
              className={`text-mv-text-muted transition-transform ${sidebarCollapsed ? '' : 'rotate-180'}`}
            />
          </button>

          {!sidebarCollapsed && (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Model Selection */}
              <section>
                <h3 className="text-xs font-semibold text-mv-text-muted uppercase tracking-wider mb-2">
                  Model
                </h3>
                <div className="space-y-2">
                  {(['global', 'regional', 'cam', 'ensemble'] as ModelCategory[]).map(category => (
                    <div key={category} className="rounded-lg border border-white/10 overflow-hidden">
                      <button
                        onClick={() => toggleCategory(category)}
                        className="w-full px-3 py-2 flex items-center justify-between bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        <span className="text-sm text-mv-text-primary">{CATEGORY_INFO[category].name}</span>
                        <ChevronDown
                          size={14}
                          className={`text-mv-text-muted transition-transform ${expandedCategories.has(category) ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {expandedCategories.has(category) && (
                        <div className="p-1 space-y-0.5">
                          {getModelsByCategory(category).map(model => (
                            <button
                              key={model.id}
                              onClick={() => setSelectedModel(model)}
                              disabled={!model.openMeteoSupport}
                              className={`w-full px-2 py-1.5 rounded text-left text-xs flex items-center justify-between transition-colors ${
                                selectedModel.id === model.id
                                  ? 'bg-cyan-500/20 text-cyan-400'
                                  : model.openMeteoSupport
                                    ? 'hover:bg-white/5 text-mv-text-secondary'
                                    : 'text-mv-text-muted opacity-50 cursor-not-allowed'
                              }`}
                              title={!model.openMeteoSupport ? 'Not available via Open-Meteo' : model.description}
                            >
                              <span>{model.shortName}</span>
                              {!model.openMeteoSupport && (
                                <AlertCircle size={12} className="text-amber-500/70" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Run Selection */}
              <section>
                <h3 className="text-xs font-semibold text-mv-text-muted uppercase tracking-wider mb-2">
                  Run
                </h3>
                <div className="flex gap-1">
                  {availableRuns.map((run, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedRun(run)}
                      className={`flex-1 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                        selectedRun?.label === run.label
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-white/5 text-mv-text-secondary hover:bg-white/10 border border-transparent'
                      }`}
                    >
                      {run.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Variable Selection */}
              <section>
                <h3 className="text-xs font-semibold text-mv-text-muted uppercase tracking-wider mb-2">
                  Variable
                </h3>
                <div className="space-y-1">
                  {Object.entries(VARIABLE_GROUPS).map(([groupId, group]) => {
                    const isModelSupported = selectedModel.variables.includes(groupId);
                    return (
                      <div
                        key={groupId}
                        className={`rounded-lg border border-white/10 overflow-hidden ${!isModelSupported ? 'opacity-50' : ''}`}
                      >
                        <button
                          onClick={() => isModelSupported && toggleVarGroup(groupId)}
                          disabled={!isModelSupported}
                          className="w-full px-3 py-1.5 flex items-center justify-between bg-white/5 hover:bg-white/10 transition-colors"
                        >
                          <span className="text-sm text-mv-text-primary flex items-center gap-2">
                            <span>{group.icon}</span>
                            {group.name}
                          </span>
                          <ChevronDown
                            size={14}
                            className={`text-mv-text-muted transition-transform ${expandedVarGroups.has(groupId) ? 'rotate-180' : ''}`}
                          />
                        </button>
                        {expandedVarGroups.has(groupId) && isModelSupported && (
                          <div className="p-1 space-y-0.5">
                            {group.variables.map(variable => (
                              <button
                                key={variable.id}
                                onClick={() => setSelectedVariable(variable.id)}
                                className={`w-full px-2 py-1 rounded text-left text-xs transition-colors ${
                                  selectedVariable === variable.id
                                    ? 'bg-cyan-500/20 text-cyan-400'
                                    : 'hover:bg-white/5 text-mv-text-secondary'
                                }`}
                              >
                                {variable.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Region Presets */}
              <section>
                <h3 className="text-xs font-semibold text-mv-text-muted uppercase tracking-wider mb-2">
                  Region
                </h3>
                <div className="grid grid-cols-2 gap-1">
                  {REGION_PRESETS.map(region => (
                    <button
                      key={region.name}
                      onClick={() => navigateToRegion(region)}
                      className="px-2 py-1.5 rounded text-xs bg-white/5 text-mv-text-secondary hover:bg-white/10 transition-colors"
                    >
                      {region.name}
                    </button>
                  ))}
                </div>
              </section>

              {/* Model Info */}
              <section className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <Info size={14} className="text-cyan-400" />
                  <span className="text-xs font-semibold text-mv-text-primary">{selectedModel.name}</span>
                </div>
                <div className="text-xs text-mv-text-muted space-y-1">
                  <p>{selectedModel.description}</p>
                  <p className="text-mv-text-secondary">
                    Resolution: {selectedModel.resolution}
                  </p>
                  <p className="text-mv-text-secondary">
                    Forecast: {selectedModel.forecastHours}h
                  </p>
                </div>
              </section>
            </div>
          )}
        </aside>

        {/* Map container */}
        <main className="flex-1 relative">
          <div ref={mapContainer} className="absolute inset-0" />

          {/* Forecast hour controls - bottom */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-mv-bg-secondary/95 backdrop-blur-sm rounded-lg border border-white/10 p-3 z-10" style={{ width: '400px', maxWidth: '90%' }}>
            {/* Play/Pause and hour display */}
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-2 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 transition-colors"
              >
                {isPlaying ? (
                  <Pause size={16} className="text-cyan-400" />
                ) : (
                  <Play size={16} className="text-cyan-400 ml-0.5" />
                )}
              </button>
              <div className="flex-1">
                <input
                  type="range"
                  min={0}
                  max={maxForecastHour}
                  step={selectedModel.category === 'cam' ? 1 : 3}
                  value={forecastHour}
                  onChange={handleSliderChange}
                  className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-3
                    [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-cyan-400
                    [&::-webkit-slider-thumb]:cursor-pointer
                    [&::-moz-range-thumb]:w-3
                    [&::-moz-range-thumb]:h-3
                    [&::-moz-range-thumb]:rounded-full
                    [&::-moz-range-thumb]:bg-cyan-400
                    [&::-moz-range-thumb]:border-0"
                />
              </div>
              <div className="text-sm font-mono text-cyan-400 w-14 text-right">
                F{forecastHour.toString().padStart(3, '0')}
              </div>
            </div>
            {/* Time labels */}
            <div className="flex justify-between text-xs text-mv-text-muted">
              <span>Init</span>
              <span className="text-mv-text-secondary">{validTime}</span>
              <span>F{maxForecastHour}</span>
            </div>
          </div>

          {/* Loading overlay */}
          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary z-20">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <span className="text-sm text-mv-text-muted">Loading map...</span>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
