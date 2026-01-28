'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Snowflake, Play, Pause, ChevronLeft, ChevronRight, X, MapPin } from 'lucide-react';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Custom Mapbox style
const MAPBOX_STYLE = 'mapbox://styles/maxvelocity/cmkew9qqf003y01rxdwxp37k4';

// Use our proxy API to avoid CORS issues
const getProxyUrl = (category: string, severity: string, hour: number) =>
  `/api/wssi-image?category=${category}&severity=${severity}&hour=${hour}`;

// Image bounds (CONUS extent)
const IMAGE_BOUNDS: [number, number, number, number] = [-125.81, 24.71, -64.96, 57.56];

// Impact categories - IDs must match WPC filename convention
const IMPACT_CATEGORIES = [
  { id: 'Overall', label: 'Overall Winter Storm Impacts' },
  { id: 'Snow_Amount', label: 'Snow Amount' },
  { id: 'Snow_Load', label: 'Snow Load' },
  { id: 'Ice_Accumulation', label: 'Ice Accumulation' },
  { id: 'Blowing_Snow', label: 'Blowing Snow' },
] as const;

// Severity levels
const SEVERITY_LEVELS = [
  { id: 'minor', label: 'Minor', color: '#93c5fd' },
  { id: 'moderate', label: 'Moderate', color: '#fbbf24' },
  { id: 'major', label: 'Major', color: '#f97316' },
  { id: 'extreme', label: 'Extreme', color: '#dc2626' },
] as const;

// Probability color scale (from WPC legend)
// Maps RGB values to probability ranges
const PROBABILITY_COLORS = [
  { range: '90-100%', color: [128, 0, 38], probability: 95 },      // Dark red
  { range: '80-90%', color: [189, 0, 38], probability: 85 },       // Red
  { range: '70-80%', color: [227, 26, 28], probability: 75 },      // Orange-red
  { range: '60-70%', color: [252, 78, 42], probability: 65 },      // Orange
  { range: '50-60%', color: [253, 141, 60], probability: 55 },     // Light orange
  { range: '40-50%', color: [254, 178, 76], probability: 45 },     // Yellow-orange
  { range: '30-40%', color: [254, 217, 118], probability: 35 },    // Yellow
  { range: '20-30%', color: [255, 237, 160], probability: 25 },    // Light yellow
  { range: '10-20%', color: [255, 255, 204], probability: 15 },    // Pale yellow
  { range: '<10%', color: [255, 255, 255], probability: 5 },       // White/transparent
];

// Helper to find closest probability from RGB
function getProbabilityFromColor(r: number, g: number, b: number, a: number): { range: string; probability: number } | null {
  // If mostly transparent or white, no data
  if (a < 50 || (r > 250 && g > 250 && b > 250)) {
    return null;
  }

  // Find closest match by color distance
  let closest = PROBABILITY_COLORS[PROBABILITY_COLORS.length - 1];
  let minDistance = Infinity;

  for (const pc of PROBABILITY_COLORS) {
    const distance = Math.sqrt(
      Math.pow(r - pc.color[0], 2) +
      Math.pow(g - pc.color[1], 2) +
      Math.pow(b - pc.color[2], 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closest = pc;
    }
  }

  return closest;
}

interface ClickInfo {
  lng: number;
  lat: number;
  probability: { range: string; probability: number } | null;
  loading: boolean;
}

// Forecast hours (24 to 168 in 6-hour increments)
const FORECAST_HOURS = Array.from({ length: 25 }, (_, i) => 24 + i * 6);

// Convert forecast hour to day/time label
function formatForecastHour(hour: number): string {
  const days = Math.floor(hour / 24);
  const remainingHours = hour % 24;

  if (remainingHours === 0) {
    return `Day ${days}`;
  }
  return `Day ${days} +${remainingHours}h`;
}

// Get valid time from forecast hour
function getValidTime(hour: number): string {
  const now = new Date();
  // Round to nearest 6-hour cycle (00, 06, 12, 18 UTC)
  const utcHour = now.getUTCHours();
  const cycleHour = Math.floor(utcHour / 6) * 6;
  now.setUTCHours(cycleHour, 0, 0, 0);

  const validTime = new Date(now.getTime() + hour * 60 * 60 * 1000);
  return validTime.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    timeZoneName: 'short',
  });
}

export default function WSSIImpactsClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<typeof IMPACT_CATEGORIES[number]['id']>('Overall');
  const [selectedSeverity, setSelectedSeverity] = useState<typeof SEVERITY_LEVELS[number]['id']>('moderate');
  const [forecastHour, setForecastHour] = useState(24);
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageOpacity, setImageOpacity] = useState(0.7);
  const [imageError, setImageError] = useState(false);
  const [clickInfo, setClickInfo] = useState<ClickInfo | null>(null);

  const animationRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);

  // Build image URL using proxy
  const getImageUrl = useCallback(() => {
    return getProxyUrl(selectedCategory, selectedSeverity, forecastHour);
  }, [selectedCategory, selectedSeverity, forecastHour]);

  // Update map image source
  const updateMapImage = useCallback(() => {
    if (!map.current || !mapLoaded) return;

    const imageUrl = getImageUrl();
    const source = map.current.getSource('wssi-image') as mapboxgl.ImageSource;

    if (source) {
      setImageError(false);
      source.updateImage({ url: imageUrl });
    }
  }, [getImageUrl, mapLoaded]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_STYLE,
      center: [-98, 39],
      zoom: 3.8,
      minZoom: 2,
      maxZoom: 10,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      if (!map.current) return;

      const initialUrl = getProxyUrl('Overall', 'moderate', 24);

      // Add image source
      map.current.addSource('wssi-image', {
        type: 'image',
        url: initialUrl,
        coordinates: [
          [IMAGE_BOUNDS[0], IMAGE_BOUNDS[3]], // top-left
          [IMAGE_BOUNDS[2], IMAGE_BOUNDS[3]], // top-right
          [IMAGE_BOUNDS[2], IMAGE_BOUNDS[1]], // bottom-right
          [IMAGE_BOUNDS[0], IMAGE_BOUNDS[1]], // bottom-left
        ],
      });

      // Find the first label layer to insert below
      const layers = map.current.getStyle().layers;
      const labelLayerId = layers.find(
        (layer) => layer.type === 'symbol' && (layer.layout as Record<string, unknown>)?.['text-field']
      )?.id;

      // Add image layer
      map.current.addLayer({
        id: 'wssi-image-layer',
        type: 'raster',
        source: 'wssi-image',
        paint: {
          'raster-opacity': 0.7,
          'raster-fade-duration': 0,
        },
      }, labelLayerId);

      setMapLoaded(true);
    });

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update image when selections change
  useEffect(() => {
    updateMapImage();
  }, [updateMapImage]);

  // Load image data for click detection
  useEffect(() => {
    if (!mapLoaded) return;

    const imageUrl = getImageUrl();
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // Create canvas if needed
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        imageDataRef.current = ctx.getImageData(0, 0, img.width, img.height);
      }
    };

    img.onerror = () => {
      imageDataRef.current = null;
    };

    img.src = imageUrl;
  }, [getImageUrl, mapLoaded]);

  // Handle map click
  const handleMapClick = useCallback((e: mapboxgl.MapMouseEvent) => {
    const { lng, lat } = e.lngLat;

    // Check if click is within image bounds
    if (lng < IMAGE_BOUNDS[0] || lng > IMAGE_BOUNDS[2] ||
        lat < IMAGE_BOUNDS[1] || lat > IMAGE_BOUNDS[3]) {
      setClickInfo(null);
      return;
    }

    // Convert lng/lat to pixel coordinates in the image
    const imageWidth = imageDataRef.current?.width || 1;
    const imageHeight = imageDataRef.current?.height || 1;

    const x = Math.floor(((lng - IMAGE_BOUNDS[0]) / (IMAGE_BOUNDS[2] - IMAGE_BOUNDS[0])) * imageWidth);
    const y = Math.floor(((IMAGE_BOUNDS[3] - lat) / (IMAGE_BOUNDS[3] - IMAGE_BOUNDS[1])) * imageHeight);

    // Get pixel color from cached image data
    if (imageDataRef.current && x >= 0 && x < imageWidth && y >= 0 && y < imageHeight) {
      const idx = (y * imageWidth + x) * 4;
      const r = imageDataRef.current.data[idx];
      const g = imageDataRef.current.data[idx + 1];
      const b = imageDataRef.current.data[idx + 2];
      const a = imageDataRef.current.data[idx + 3];

      const probability = getProbabilityFromColor(r, g, b, a);

      setClickInfo({
        lng,
        lat,
        probability,
        loading: false,
      });
    } else {
      setClickInfo({
        lng,
        lat,
        probability: null,
        loading: false,
      });
    }
  }, []);

  // Add click handler to map
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.on('click', handleMapClick);
    map.current.getCanvas().style.cursor = 'crosshair';

    return () => {
      if (map.current) {
        map.current.off('click', handleMapClick);
      }
    };
  }, [mapLoaded, handleMapClick]);

  // Update opacity
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    map.current.setPaintProperty('wssi-image-layer', 'raster-opacity', imageOpacity);
  }, [imageOpacity, mapLoaded]);

  // Animation loop
  useEffect(() => {
    if (isPlaying) {
      animationRef.current = setInterval(() => {
        setForecastHour((prev) => {
          const currentIndex = FORECAST_HOURS.indexOf(prev);
          const nextIndex = (currentIndex + 1) % FORECAST_HOURS.length;
          return FORECAST_HOURS[nextIndex];
        });
      }, 750);
    } else {
      if (animationRef.current) {
        clearInterval(animationRef.current);
        animationRef.current = null;
      }
    }

    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [isPlaying]);

  // Handle slider step
  const stepForecastHour = (direction: 'prev' | 'next') => {
    const currentIndex = FORECAST_HOURS.indexOf(forecastHour);
    if (direction === 'prev' && currentIndex > 0) {
      setForecastHour(FORECAST_HOURS[currentIndex - 1]);
    } else if (direction === 'next' && currentIndex < FORECAST_HOURS.length - 1) {
      setForecastHour(FORECAST_HOURS[currentIndex + 1]);
    }
  };

  return (
    <div className="h-screen bg-mv-bg-primary flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-mv-bg-secondary/95 backdrop-blur-sm border-b border-white/10 px-4 py-2 z-20">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Snowflake className="text-cyan-400" size={24} />
            <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              WSSI Impacts Slider
            </h1>
          </div>
          <div className="text-xs text-mv-text-muted">
            Source: NOAA/WPC
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 flex-shrink-0 bg-mv-bg-secondary/50 border-r border-white/10 p-4 space-y-5 overflow-y-auto">
          {/* Impact Category */}
          <section>
            <h3 className="text-sm font-semibold text-mv-text-primary mb-3">Impact Category</h3>
            <div className="space-y-1">
              {IMPACT_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'bg-white/5 text-mv-text-muted hover:bg-white/10'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </section>

          {/* Severity Level */}
          <section>
            <h3 className="text-sm font-semibold text-mv-text-primary mb-3">Severity Level</h3>
            <div className="grid grid-cols-2 gap-2">
              {SEVERITY_LEVELS.map((sev) => (
                <button
                  key={sev.id}
                  onClick={() => setSelectedSeverity(sev.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                    selectedSeverity === sev.id
                      ? 'ring-2 ring-white/30'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: `${sev.color}25`,
                    color: sev.color,
                    borderColor: sev.color,
                  }}
                >
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: sev.color }}
                  />
                  {sev.label}
                </button>
              ))}
            </div>
          </section>

          {/* Opacity Slider */}
          <section>
            <h3 className="text-sm font-semibold text-mv-text-primary mb-3">
              Overlay Opacity: {Math.round(imageOpacity * 100)}%
            </h3>
            <input
              type="range"
              min="0"
              max="100"
              value={imageOpacity * 100}
              onChange={(e) => setImageOpacity(Number(e.target.value) / 100)}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </section>

          {/* Info */}
          <section className="text-xs text-mv-text-muted space-y-2">
            <p>
              <strong>WSSI-P</strong> shows the probability of reaching or exceeding
              the selected impact level for each category.
            </p>
            <p>
              Data from NOAA Weather Prediction Center ensemble forecasts.
            </p>
          </section>
        </aside>

        {/* Map + Slider */}
        <main className="flex-1 flex flex-col relative">
          {/* Map */}
          <div ref={mapContainer} className="flex-1" />

          {/* Loading overlay */}
          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <span className="text-sm text-mv-text-muted">Loading map...</span>
              </div>
            </div>
          )}

          {/* Image error indicator */}
          {imageError && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-yellow-500/20 backdrop-blur-sm text-yellow-400 px-4 py-2 rounded-lg border border-yellow-500/30 text-sm">
                Image not available for this selection
              </div>
            </div>
          )}

          {/* Click Info Popup */}
          {clickInfo && (
            <div className="absolute top-4 left-4 z-10">
              <div className="bg-mv-bg-secondary/95 backdrop-blur-sm rounded-xl border border-white/10 shadow-xl overflow-hidden min-w-[240px]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-cyan-400" />
                    <span className="text-sm font-medium text-mv-text-primary">Location Details</span>
                  </div>
                  <button
                    onClick={() => setClickInfo(null)}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                  >
                    <X size={14} className="text-mv-text-muted" />
                  </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3">
                  {/* Coordinates */}
                  <div className="text-xs text-mv-text-muted">
                    {clickInfo.lat.toFixed(3)}°N, {Math.abs(clickInfo.lng).toFixed(3)}°W
                  </div>

                  {/* Probability */}
                  <div>
                    <div className="text-xs text-mv-text-muted mb-1">
                      {IMPACT_CATEGORIES.find(c => c.id === selectedCategory)?.label} - {SEVERITY_LEVELS.find(s => s.id === selectedSeverity)?.label}+
                    </div>
                    {clickInfo.probability ? (
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg"
                          style={{
                            backgroundColor: `rgb(${PROBABILITY_COLORS.find(p => p.range === clickInfo.probability?.range)?.color.join(',') || '100,100,100'})`,
                            color: clickInfo.probability.probability > 50 ? 'white' : '#1a1a2e',
                          }}
                        >
                          {clickInfo.probability.probability}%
                        </div>
                        <div>
                          <div className="text-sm font-medium text-mv-text-primary">
                            {clickInfo.probability.range} Probability
                          </div>
                          <div className="text-xs text-mv-text-muted">
                            of {selectedSeverity}+ impacts
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-mv-text-muted">
                        No significant probability at this location
                      </div>
                    )}
                  </div>

                  {/* Forecast time */}
                  <div className="pt-2 border-t border-white/10 text-xs text-mv-text-muted">
                    Valid: {getValidTime(forecastHour)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Click hint */}
          {!clickInfo && mapLoaded && (
            <div className="absolute bottom-32 left-4 z-10">
              <div className="bg-mv-bg-secondary/80 backdrop-blur-sm text-mv-text-muted px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 border border-white/10">
                <MapPin size={12} className="text-cyan-400" />
                Click map for probability details
              </div>
            </div>
          )}

          {/* Probability Legend - Bottom Center */}
          {mapLoaded && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-mv-bg-secondary/95 backdrop-blur-sm rounded-xl border border-white/10 p-4 shadow-xl">
                <div className="text-sm font-semibold text-mv-text-primary mb-3 text-center">
                  Probability of {SEVERITY_LEVELS.find(s => s.id === selectedSeverity)?.label}+ Impacts
                </div>
                <div className="flex items-center">
                  {/* Color bar segments - WPC colors: dark blue → light blue → yellow → orange → red → dark red/brown */}
                  {[
                    { pct: '<10%', color: '#08306b' },
                    { pct: '10%', color: '#2171b5' },
                    { pct: '20%', color: '#6baed6' },
                    { pct: '30%', color: '#c6dbef' },
                    { pct: '40%', color: '#ffffb2' },
                    { pct: '50%', color: '#fecc5c' },
                    { pct: '60%', color: '#fd8d3c' },
                    { pct: '70%', color: '#f03b20' },
                    { pct: '80%', color: '#bd0026' },
                    { pct: '90%', color: '#67000d' },
                  ].map((item, idx, arr) => (
                    <div key={idx} className="flex flex-col items-center">
                      <div
                        className={`w-12 h-6 ${idx === 0 ? 'rounded-l-md' : ''} ${idx === arr.length - 1 ? 'rounded-r-md' : ''}`}
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-[10px] text-mv-text-muted mt-1.5 whitespace-nowrap">
                        {item.pct}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Time Slider Panel */}
          <div className="flex-shrink-0 bg-mv-bg-secondary/95 backdrop-blur-sm border-t border-white/10 px-4 py-3">
            {/* Valid Time Display */}
            <div className="text-center mb-2">
              <span className="text-sm text-mv-text-muted">Valid: </span>
              <span className="text-sm font-medium text-mv-text-primary">
                {getValidTime(forecastHour)}
              </span>
              <span className="text-sm text-mv-text-muted ml-3">
                ({formatForecastHour(forecastHour)})
              </span>
            </div>

            {/* Slider Controls */}
            <div className="flex items-center gap-4 max-w-4xl mx-auto">
              {/* Step Back */}
              <button
                onClick={() => stepForecastHour('prev')}
                disabled={forecastHour === FORECAST_HOURS[0]}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={20} className="text-mv-text-muted" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`p-2 rounded-lg transition-colors ${
                  isPlaying
                    ? 'bg-cyan-500/20 text-cyan-400'
                    : 'bg-white/5 hover:bg-white/10 text-mv-text-muted'
                }`}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>

              {/* Slider */}
              <div className="flex-1">
                <input
                  type="range"
                  min={FORECAST_HOURS[0]}
                  max={FORECAST_HOURS[FORECAST_HOURS.length - 1]}
                  step={6}
                  value={forecastHour}
                  onChange={(e) => setForecastHour(Number(e.target.value))}
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
                {/* Tick marks */}
                <div className="flex justify-between mt-1 px-1">
                  {[24, 48, 72, 96, 120, 144, 168].map((hour) => (
                    <span
                      key={hour}
                      className={`text-[10px] ${
                        forecastHour === hour ? 'text-cyan-400' : 'text-mv-text-muted'
                      }`}
                    >
                      {hour}h
                    </span>
                  ))}
                </div>
              </div>

              {/* Step Forward */}
              <button
                onClick={() => stepForecastHour('next')}
                disabled={forecastHour === FORECAST_HOURS[FORECAST_HOURS.length - 1]}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={20} className="text-mv-text-muted" />
              </button>
            </div>

            {/* Hour Labels */}
            <div className="flex justify-center gap-6 mt-2 text-xs text-mv-text-muted">
              <span>Day 1</span>
              <span>Day 2</span>
              <span>Day 3</span>
              <span>Day 4</span>
              <span>Day 5</span>
              <span>Day 6</span>
              <span>Day 7</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
