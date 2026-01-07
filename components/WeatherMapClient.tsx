'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { RegionId, RegionRiskData, CityMetricsSummary } from '@/lib/types';
import { REGIONS } from '@/lib/regions';
import { Thermometer, Droplets, CloudSnow, Wind, AlertTriangle, Layers, Calendar } from 'lucide-react';
import { formatCityLabel } from '@/lib/formatCityLabel';
import { getCityDayRisk } from '@/lib/getCityDayRisk';
import { formatDayLabelWithDate } from '@/lib/formatDayLabel';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Risk border color function - must be defined before OVERLAY_CONFIG
function getRiskBorderColor(score: number): string {
  if (score <= 2) return 'rgba(16, 185, 129, 0.8)';
  if (score <= 3) return 'rgba(132, 204, 22, 0.8)';
  if (score <= 4) return 'rgba(234, 179, 8, 0.8)';
  if (score <= 5) return 'rgba(249, 115, 22, 0.8)';
  if (score <= 6) return 'rgba(239, 68, 68, 0.8)';
  if (score <= 7) return 'rgba(220, 38, 38, 0.8)';
  if (score <= 8) return 'rgba(185, 28, 28, 0.8)';
  if (score <= 9) return 'rgba(147, 51, 234, 0.8)';
  return 'rgba(0, 0, 0, 0.9)';
}

// Overlay types for map visualization
type MapOverlay = 'risk' | 'temp-high' | 'temp-low' | 'rain' | 'snow' | 'wind';

const OVERLAY_CONFIG: Record<MapOverlay, { label: string; icon: typeof AlertTriangle; colorFn: (value: number) => string }> = {
  'risk': {
    label: 'Risk',
    icon: AlertTriangle,
    colorFn: getRiskBorderColor,
  },
  'temp-high': {
    label: 'High',
    icon: Thermometer,
    colorFn: (temp: number) => {
      if (temp >= 100) return 'rgba(185, 28, 28, 0.8)';
      if (temp >= 90) return 'rgba(239, 68, 68, 0.8)';
      if (temp >= 80) return 'rgba(249, 115, 22, 0.8)';
      if (temp >= 70) return 'rgba(234, 179, 8, 0.8)';
      if (temp >= 60) return 'rgba(132, 204, 22, 0.8)';
      if (temp >= 50) return 'rgba(16, 185, 129, 0.8)';
      if (temp >= 40) return 'rgba(34, 211, 238, 0.8)';
      if (temp >= 30) return 'rgba(59, 130, 246, 0.8)';
      return 'rgba(147, 51, 234, 0.8)';
    },
  },
  'temp-low': {
    label: 'Low',
    icon: Thermometer,
    colorFn: (temp: number) => {
      if (temp >= 70) return 'rgba(249, 115, 22, 0.8)';
      if (temp >= 60) return 'rgba(234, 179, 8, 0.8)';
      if (temp >= 50) return 'rgba(132, 204, 22, 0.8)';
      if (temp >= 40) return 'rgba(16, 185, 129, 0.8)';
      if (temp >= 32) return 'rgba(34, 211, 238, 0.8)';
      if (temp >= 20) return 'rgba(59, 130, 246, 0.8)';
      if (temp >= 0) return 'rgba(147, 51, 234, 0.8)';
      return 'rgba(236, 72, 153, 0.8)';
    },
  },
  'rain': {
    label: 'Rain',
    icon: Droplets,
    colorFn: (inches: number) => {
      if (inches >= 2) return 'rgba(147, 51, 234, 0.8)';
      if (inches >= 1) return 'rgba(59, 130, 246, 0.8)';
      if (inches >= 0.5) return 'rgba(34, 211, 238, 0.8)';
      if (inches >= 0.25) return 'rgba(16, 185, 129, 0.8)';
      if (inches >= 0.1) return 'rgba(132, 204, 22, 0.8)';
      return 'rgba(100, 100, 100, 0.5)';
    },
  },
  'snow': {
    label: 'Snow',
    icon: CloudSnow,
    colorFn: (inches: number) => {
      if (inches >= 12) return 'rgba(147, 51, 234, 0.8)';
      if (inches >= 6) return 'rgba(59, 130, 246, 0.8)';
      if (inches >= 3) return 'rgba(34, 211, 238, 0.8)';
      if (inches >= 1) return 'rgba(96, 165, 250, 0.8)';
      if (inches >= 0.5) return 'rgba(186, 230, 253, 0.8)';
      return 'rgba(100, 100, 100, 0.5)';
    },
  },
  'wind': {
    label: 'Wind',
    icon: Wind,
    colorFn: (mph: number) => {
      if (mph >= 60) return 'rgba(147, 51, 234, 0.8)';
      if (mph >= 50) return 'rgba(185, 28, 28, 0.8)';
      if (mph >= 40) return 'rgba(239, 68, 68, 0.8)';
      if (mph >= 30) return 'rgba(249, 115, 22, 0.8)';
      if (mph >= 20) return 'rgba(234, 179, 8, 0.8)';
      return 'rgba(100, 100, 100, 0.5)';
    },
  },
};

export interface WeatherMapProps {
  regionRisks: Partial<Record<RegionId, RegionRiskData>>;
  cities: CityMetricsSummary[];
  selectedRegion: RegionId | null;
  selectedDay: number;
  onRegionSelect: (region: RegionId | null) => void;
  onDayChange?: (day: number) => void;
}

// Risk fill color for state polygons
function getRiskColor(score: number): string {
  if (score <= 2) return 'rgba(16, 185, 129, 0.4)'; // emerald
  if (score <= 3) return 'rgba(132, 204, 22, 0.4)'; // lime
  if (score <= 4) return 'rgba(234, 179, 8, 0.45)'; // yellow
  if (score <= 5) return 'rgba(249, 115, 22, 0.45)'; // orange
  if (score <= 6) return 'rgba(239, 68, 68, 0.5)'; // red
  if (score <= 7) return 'rgba(220, 38, 38, 0.55)'; // red-600
  if (score <= 8) return 'rgba(185, 28, 28, 0.6)'; // red-700
  if (score <= 9) return 'rgba(147, 51, 234, 0.6)'; // purple
  return 'rgba(0, 0, 0, 0.7)'; // black
}

// Category colors for badges (module scope to avoid recreation)
const SPC_COLORS: Record<string, string> = {
  'TSTM': 'rgba(132, 204, 22, 0.9)',
  'MRGL': 'rgba(16, 185, 129, 0.9)',
  'SLGT': 'rgba(234, 179, 8, 0.9)',
  'ENH': 'rgba(249, 115, 22, 0.9)',
  'MDT': 'rgba(239, 68, 68, 0.9)',
  'HIGH': 'rgba(236, 72, 153, 0.9)',
};

const ERO_COLORS: Record<string, string> = {
  'MRGL': 'rgba(132, 204, 22, 0.9)',
  'SLGT': 'rgba(234, 179, 8, 0.9)',
  'MDT': 'rgba(249, 115, 22, 0.9)',
  'HIGH': 'rgba(239, 68, 68, 0.9)',
};

const WSSI_COLORS: Record<string, string> = {
  'WINTER WEATHER AREA': 'rgba(96, 165, 250, 0.9)',
  'MINOR': 'rgba(59, 130, 246, 0.9)',
  'MODERATE': 'rgba(147, 51, 234, 0.9)',
  'MAJOR': 'rgba(236, 72, 153, 0.9)',
  'EXTREME': 'rgba(185, 28, 28, 0.9)',
};

// State to region mapping
const STATE_TO_REGION: Record<string, RegionId> = {
  // Northeast
  'Maine': 'northeast', 'New Hampshire': 'northeast', 'Vermont': 'northeast',
  'Massachusetts': 'northeast', 'Rhode Island': 'northeast', 'Connecticut': 'northeast',
  'New York': 'northeast', 'New Jersey': 'northeast', 'Pennsylvania': 'northeast',
  'Delaware': 'northeast', 'Maryland': 'northeast', 'District of Columbia': 'northeast',
  // Southeast
  'Virginia': 'southeast', 'West Virginia': 'southeast', 'North Carolina': 'southeast',
  'South Carolina': 'southeast', 'Georgia': 'southeast', 'Florida': 'southeast',
  'Kentucky': 'southeast', 'Tennessee': 'southeast', 'Alabama': 'southeast',
  'Mississippi': 'southeast', 'Louisiana': 'southeast',
  // Midwest
  'Ohio': 'midwest', 'Michigan': 'midwest', 'Indiana': 'midwest',
  'Illinois': 'midwest', 'Wisconsin': 'midwest', 'Minnesota': 'midwest',
  'Iowa': 'midwest', 'Missouri': 'midwest',
  // Southern Plains
  'Texas': 'southern_plains', 'Oklahoma': 'southern_plains', 'Kansas': 'southern_plains',
  'Arkansas': 'southern_plains',
  // Northern Plains
  'North Dakota': 'northern_plains', 'South Dakota': 'northern_plains',
  'Nebraska': 'northern_plains', 'Montana': 'northern_plains', 'Wyoming': 'northern_plains',
  'Colorado': 'northern_plains',
  // Northwest
  'Washington': 'northwest', 'Oregon': 'northwest', 'Idaho': 'northwest', 'Alaska': 'northwest',
  // Southwest
  'California': 'southwest', 'Nevada': 'southwest', 'Arizona': 'southwest',
  'New Mexico': 'southwest', 'Utah': 'southwest', 'Hawaii': 'southwest',
};

export default function WeatherMapClient({
  regionRisks,
  cities,
  selectedRegion,
  selectedDay,
  onRegionSelect,
  onDayChange,
}: WeatherMapProps) {
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const hoverPopup = useRef<mapboxgl.Popup | null>(null);
  const clickPopup = useRef<mapboxgl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [statesLoaded, setStatesLoaded] = useState(false);
  const [overlay, setOverlay] = useState<MapOverlay>('risk');
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [showDayMenu, setShowDayMenu] = useState(false);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);

  // Refs for hover debouncing
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hoveredCityIdRef = useRef<string | null>(null);

  // Navigate to full city detail page
  const handleFullForecast = useCallback((cityId: string) => {
    const dayKey = `day${selectedDay}`;
    router.push(`/city/${cityId}?day=${dayKey}`);
  }, [router, selectedDay]);

  // Close click popup
  const closeClickPopup = useCallback(() => {
    if (clickPopup.current) {
      clickPopup.current.remove();
    }
    setSelectedCityId(null);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!MAPBOX_TOKEN || !mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98.5, 39.8],
      zoom: 3.5,
      minZoom: 2.5,
      maxZoom: 10,
      attributionControl: false,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      'top-right'
    );

    map.current.on('load', () => {
      console.log('[MapDebug] Map loaded successfully');
      setMapLoaded(true);
    });

    map.current.on('error', (e) => {
      console.error('[MapDebug] Map error:', e?.error || e);
    });

    map.current.on('style.load', () => {
      console.log('[MapDebug] Style loaded');
    });

    // Resize map on container resize
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

  // Load US states GeoJSON and add state layers colored by region
  useEffect(() => {
    if (!mapLoaded || !map.current || statesLoaded) return;

    const loadStates = async () => {
      try {
        // Fetch US states GeoJSON from local file (much faster than external URL)
        const response = await fetch('/us-states.json');
        if (!response.ok) {
          throw new Error(`Failed to load states: ${response.status}`);
        }
        const statesGeoJson = await response.json();

        if (!map.current) return;

        // Add states source
        map.current.addSource('us-states', {
          type: 'geojson',
          data: statesGeoJson,
        });

        // Add fill layer for states
        map.current.addLayer({
          id: 'states-fill',
          type: 'fill',
          source: 'us-states',
          paint: {
            'fill-color': 'rgba(100, 100, 100, 0.2)',
            'fill-opacity': 0.6,
          },
        });

        // Add border layer for states
        map.current.addLayer({
          id: 'states-border',
          type: 'line',
          source: 'us-states',
          paint: {
            'line-color': 'rgba(255, 255, 255, 0.3)',
            'line-width': 0.5,
          },
        });

        // Add click handler for states
        map.current.on('click', 'states-fill', (e) => {
          if (e.features && e.features[0]) {
            const stateName = e.features[0].properties?.name;
            const regionId = STATE_TO_REGION[stateName];
            if (regionId) {
              onRegionSelect(regionId);
            }
          }
        });

        // Add hover effect
        map.current.on('mouseenter', 'states-fill', () => {
          if (map.current) {
            map.current.getCanvas().style.cursor = 'pointer';
          }
        });

        map.current.on('mouseleave', 'states-fill', () => {
          if (map.current) {
            map.current.getCanvas().style.cursor = '';
          }
        });

        setStatesLoaded(true);
      } catch (error) {
        console.error('Failed to load US states GeoJSON:', error);
        // Set statesLoaded to true anyway to prevent infinite retries
        setStatesLoaded(true);
      }
    };

    loadStates();
  }, [mapLoaded, statesLoaded, onRegionSelect]);

  // Update state colors based on region risk data
  useEffect(() => {
    if (!mapLoaded || !map.current || !statesLoaded) return;

    const statesSource = map.current.getSource('us-states') as mapboxgl.GeoJSONSource;
    if (!statesSource) return;

    // Build color cases for match expression
    const colorCases: [string, string][] = [];

    Object.entries(STATE_TO_REGION).forEach(([stateName, regionId]) => {
      const regionData = regionRisks[regionId];
      if (regionData) {
        const dayKey = `day${selectedDay}` as keyof RegionRiskData;
        const dayData = regionData[dayKey];
        const risk = typeof dayData === 'object' && dayData && 'risk' in dayData
          ? (dayData as { risk: number }).risk
          : 3;
        colorCases.push([stateName, getRiskColor(risk)]);
      }
    });

    // If no cases, use a simple color (match expression requires at least one case)
    if (colorCases.length === 0) {
      if (map.current.getLayer('states-fill')) {
        map.current.setPaintProperty('states-fill', 'fill-color', 'rgba(50, 50, 50, 0.3)');
      }
      return;
    }

    // Build match expression: ['match', ['get', 'name'], 'State1', 'color1', 'State2', 'color2', ..., 'default']
    const colorExpression: any[] = ['match', ['get', 'name']];
    colorCases.forEach(([stateName, color]) => {
      colorExpression.push(stateName, color);
    });
    // Default color for unmatched states
    colorExpression.push('rgba(50, 50, 50, 0.3)');

    if (map.current.getLayer('states-fill')) {
      map.current.setPaintProperty('states-fill', 'fill-color', colorExpression as any);
    }
  }, [mapLoaded, statesLoaded, regionRisks, selectedDay]);

  // Add city points as a GeoJSON layer (much faster than DOM markers)
  useEffect(() => {
    if (!mapLoaded || !map.current || !cities || cities.length === 0) return;

    const dayIndex = selectedDay - 1;

    // Build GeoJSON features for cities with full canonical data for tooltips
    const features = cities.map((city) => {
      const riskResult = getCityDayRisk(city, dayIndex);
      const condition = city.days[dayIndex]?.condition || 'Clear';
      const dailyRisk = city.dailyRisks?.[dayIndex];
      const dailySummary = city.dailySummary?.[dayIndex];
      const overlayData = dailyRisk?.overlay;

      let markerValue: number;
      let displayValue: string;

      switch (overlay) {
        case 'temp-high':
          markerValue = city.tempMax48h || 70;
          displayValue = `High ${Math.round(markerValue)}°F`;
          break;
        case 'temp-low':
          markerValue = city.tempMin48h || 50;
          displayValue = `Low ${Math.round(markerValue)}°F`;
          break;
        case 'rain':
          markerValue = city.rain24h || 0;
          displayValue = `Rain ${markerValue.toFixed(2)}"`;
          break;
        case 'snow':
          markerValue = city.snow24h || 0;
          displayValue = `Snow ${markerValue.toFixed(1)}"`;
          break;
        case 'wind':
          markerValue = city.maxGust48h || 0;
          displayValue = `Wind ${Math.round(markerValue)} mph`;
          break;
        default:
          if (!riskResult.hasData) {
            markerValue = 0;
            displayValue = 'Risk N/A';
          } else {
            markerValue = riskResult.score!;
            displayValue = `Risk ${markerValue.toFixed(1)}`;
          }
      }

      // Extract canonical data for enhanced tooltip (no recompute)
      const riskScore = dailyRisk?.score_display ?? null;
      const spcCategory = overlayData?.spc_category && overlayData.spc_category !== 'NONE' ? overlayData.spc_category : null;
      const eroCategory = overlayData?.ero_category && overlayData.ero_category !== 'NONE' ? overlayData.ero_category : null;
      const wssiCategory = overlayData?.wssi_category && overlayData.wssi_category !== 'NONE' ? overlayData.wssi_category : null;
      const tempHigh = dailySummary?.tmax ?? null;
      const tempLow = dailySummary?.tmin ?? null;
      const rain = dailySummary?.rain_total ?? null;
      const snow = dailySummary?.snow_total ?? null;
      const windGust = dailySummary?.wind_gust_max ?? null;

      return {
        type: 'Feature' as const,
        properties: {
          id: city.id,
          name: formatCityLabel(city),
          condition,
          displayValue,
          color: OVERLAY_CONFIG[overlay].colorFn(markerValue),
          // Canonical tooltip data (strings for GeoJSON serialization)
          riskScore: riskScore !== null ? riskScore.toFixed(1) : 'N/A',
          spcCategory: spcCategory || 'NONE',
          eroCategory: eroCategory || 'NONE',
          wssiCategory: wssiCategory || 'NONE',
          tempHigh: tempHigh !== null ? Math.round(tempHigh).toString() : 'N/A',
          tempLow: tempLow !== null ? Math.round(tempLow).toString() : 'N/A',
          rain: rain !== null ? rain.toFixed(2) : 'N/A',
          snow: snow !== null ? snow.toFixed(1) : 'N/A',
          windGust: windGust !== null ? Math.round(windGust).toString() : 'N/A',
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [city.lon, city.lat],
        },
      };
    });

    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    // Update or create source
    const source = map.current.getSource('cities') as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojsonData);
    } else {
      map.current.addSource('cities', {
        type: 'geojson',
        data: geojsonData,
      });

      // Add circle layer for cities
      map.current.addLayer({
        id: 'cities-circles',
        type: 'circle',
        source: 'cities',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.9)',
        },
      });

      // Hover effects for cursor
      map.current.on('mouseenter', 'cities-circles', () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = 'pointer';
        }
      });

      map.current.on('mouseleave', 'cities-circles', () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = '';
        }
      });
    }
  }, [mapLoaded, cities, selectedDay, overlay]);

  // Helper for risk score color
  const getRiskScoreColor = (score: string) => {
    const num = parseFloat(score);
    if (isNaN(num)) return 'rgba(100, 100, 100, 0.8)';
    if (num <= 2) return 'rgba(16, 185, 129, 0.9)';
    if (num <= 3) return 'rgba(132, 204, 22, 0.9)';
    if (num <= 4) return 'rgba(234, 179, 8, 0.9)';
    if (num <= 5) return 'rgba(249, 115, 22, 0.9)';
    if (num <= 6) return 'rgba(239, 68, 68, 0.9)';
    if (num <= 7) return 'rgba(220, 38, 38, 0.9)';
    if (num <= 8) return 'rgba(185, 28, 28, 0.9)';
    if (num <= 9) return 'rgba(147, 51, 234, 0.9)';
    return 'rgba(0, 0, 0, 0.9)';
  };


  // City hover tooltip (lightweight, pointer-events: none to prevent flicker)
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    // Create hover popup with pointer-events: none to prevent marker↔popup thrash
    hoverPopup.current = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'city-hover-tooltip',
      maxWidth: '200px',
      anchor: 'bottom',
      offset: [0, -10],
    });

    const showHoverTooltip = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (!e.features || !e.features[0] || !map.current || !hoverPopup.current) return;

      const props = e.features[0].properties;
      if (!props) return;

      const cityId = props.id;

      // Don't show hover if this city has click popup open
      if (cityId === selectedCityId) return;

      // Skip if same city already hovered
      if (hoveredCityIdRef.current === cityId) return;

      hoveredCityIdRef.current = cityId;

      // Clear any pending hide
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }

      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];

      // Simple hover tooltip - just name and risk score
      hoverPopup.current.setLngLat(coords).setHTML(`
        <div style="
          background: #171717;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          pointer-events: none;
        ">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="font-weight: 600; color: #fff; font-size: 13px;">${props.name}</div>
            <div style="
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 12px;
              font-weight: 700;
              background: ${getRiskScoreColor(props.riskScore)};
              color: #fff;
            ">${props.riskScore}</div>
          </div>
          <div style="color: rgba(255, 255, 255, 0.5); font-size: 10px; margin-top: 4px; text-align: center;">
            Click for details
          </div>
        </div>
      `).addTo(map.current);
    };

    const scheduleShowHover = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      // Clear any existing show timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }

      // Delay showing by 150ms to prevent flicker on quick mouse movement
      hoverTimeoutRef.current = setTimeout(() => {
        showHoverTooltip(e);
      }, 150);
    };

    const scheduleHideHover = () => {
      // Clear show timeout
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }

      // Delay hiding by 300ms for smooth exit
      hideTimeoutRef.current = setTimeout(() => {
        if (hoverPopup.current) {
          hoverPopup.current.remove();
        }
        hoveredCityIdRef.current = null;
      }, 300);
    };

    map.current.on('mouseenter', 'cities-circles', scheduleShowHover);
    map.current.on('mouseleave', 'cities-circles', scheduleHideHover);

    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      if (map.current) {
        map.current.off('mouseenter', 'cities-circles', scheduleShowHover);
        map.current.off('mouseleave', 'cities-circles', scheduleHideHover);
      }
      if (hoverPopup.current) {
        hoverPopup.current.remove();
        hoverPopup.current = null;
      }
    };
  }, [mapLoaded, selectedCityId]);

  // City click popup (full details with action button)
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    // Helper to build badge HTML
    const getBadge = (label: string, value: string, color: string) => {
      if (value === 'NONE' || value === 'N/A') return '';
      return `<span style="
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        background: ${color};
        color: #fff;
        margin-right: 4px;
        margin-bottom: 4px;
      ">${label}: ${value}</span>`;
    };

    const handleCityClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (!e.features || !e.features[0] || !map.current) return;

      const props = e.features[0].properties;
      if (!props) return;

      const cityId = props.id;
      const coords = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];

      // Close hover tooltip for this city
      if (hoverPopup.current) {
        hoverPopup.current.remove();
      }
      hoveredCityIdRef.current = null;

      // Close existing click popup
      if (clickPopup.current) {
        clickPopup.current.remove();
      }

      // Update selected city
      setSelectedCityId(cityId);

      // Build badges
      let badgesHtml = '';
      if (props.spcCategory !== 'NONE') {
        badgesHtml += getBadge('SPC', props.spcCategory, SPC_COLORS[props.spcCategory] || 'rgba(100, 100, 100, 0.8)');
      }
      if (props.eroCategory !== 'NONE') {
        badgesHtml += getBadge('ERO', props.eroCategory, ERO_COLORS[props.eroCategory] || 'rgba(100, 100, 100, 0.8)');
      }
      if (props.wssiCategory !== 'NONE') {
        const wssiDisplay = props.wssiCategory === 'WINTER WEATHER AREA' ? 'WWA' : props.wssiCategory;
        badgesHtml += getBadge('WSSI', wssiDisplay, WSSI_COLORS[props.wssiCategory] || 'rgba(100, 100, 100, 0.8)');
      }

      // Build weather row
      const weatherItems: string[] = [];
      if (props.tempHigh !== 'N/A' && props.tempLow !== 'N/A') {
        weatherItems.push(`${props.tempHigh}°/${props.tempLow}°F`);
      }
      if (props.snow !== 'N/A' && parseFloat(props.snow) > 0) {
        weatherItems.push(`${props.snow}" snow`);
      }
      if (props.rain !== 'N/A' && parseFloat(props.rain) > 0) {
        weatherItems.push(`${props.rain}" rain`);
      }
      if (props.windGust !== 'N/A' && parseFloat(props.windGust) >= 20) {
        weatherItems.push(`${props.windGust} mph gusts`);
      }

      // Create click popup with close button
      clickPopup.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: false,
        className: 'city-click-popup',
        maxWidth: '300px',
        anchor: 'bottom',
        offset: [0, -10],
      });

      clickPopup.current.setLngLat(coords).setHTML(`
        <div style="
          background: #171717;
          padding: 14px 16px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
          min-width: 220px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
            <div style="font-weight: 700; color: #fff; font-size: 15px;">${props.name}</div>
            <div style="
              padding: 4px 10px;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 700;
              background: ${getRiskScoreColor(props.riskScore)};
              color: #fff;
              min-width: 40px;
              text-align: center;
            ">${props.riskScore}</div>
          </div>
          ${badgesHtml ? `<div style="margin-bottom: 10px; line-height: 1.6;">${badgesHtml}</div>` : ''}
          ${weatherItems.length > 0 ? `
            <div style="
              color: rgba(255, 255, 255, 0.7);
              font-size: 12px;
              padding: 8px 0;
              border-top: 1px solid rgba(255, 255, 255, 0.1);
            ">
              ${weatherItems.join(' • ')}
            </div>
          ` : ''}
          <button
            id="fullForecastBtn-${cityId}"
            style="
              width: 100%;
              padding: 10px 16px;
              margin-top: 8px;
              background: #3b82f6;
              color: #fff;
              border: none;
              border-radius: 8px;
              font-size: 13px;
              font-weight: 600;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              transition: background 0.2s;
            "
            onmouseover="this.style.background='#2563eb'"
            onmouseout="this.style.background='#3b82f6'"
          >
            Full Forecast & Graphs
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      `).addTo(map.current);

      // Add click handler for the button after popup is added
      setTimeout(() => {
        const btn = document.getElementById(`fullForecastBtn-${cityId}`);
        if (btn) {
          btn.addEventListener('click', () => {
            handleFullForecast(cityId);
          });
        }
      }, 0);

      // Handle popup close
      clickPopup.current.on('close', () => {
        setSelectedCityId(null);
      });

      // Stop propagation to prevent map click
      e.originalEvent.stopPropagation();
    };

    map.current.on('click', 'cities-circles', handleCityClick);

    return () => {
      if (map.current) {
        map.current.off('click', 'cities-circles', handleCityClick);
      }
      if (clickPopup.current) {
        clickPopup.current.remove();
        clickPopup.current = null;
      }
    };
  }, [mapLoaded, handleFullForecast, closeClickPopup]);

  // Fly to selected region
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    if (selectedRegion && REGIONS[selectedRegion]) {
      const region = REGIONS[selectedRegion];
      map.current.flyTo({
        center: region.center,
        zoom: 5,
        duration: 1000,
      });
    } else {
      map.current.flyTo({
        center: [-98.5, 39.8],
        zoom: 3.5,
        duration: 1000,
      });
    }
  }, [mapLoaded, selectedRegion]);


  return (
    <div
      className="relative w-full h-full min-h-[400px] rounded-xl overflow-hidden"
      role="application"
      aria-label="Interactive weather risk map. Use the region list for keyboard navigation."
    >
      <div
        ref={mapContainer}
        className="absolute inset-0"
        aria-hidden="true"
      />

      {/* Map controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-2">
        {/* Day selector */}
        <div className="relative">
          <button
            onClick={() => setShowDayMenu(!showDayMenu)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && showDayMenu) {
                setShowDayMenu(false);
              }
            }}
            className="flex items-center gap-2 px-3 py-2 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg border border-white/10 hover:border-white/20 transition-colors w-full"
            aria-expanded={showDayMenu}
            aria-haspopup="listbox"
            aria-label={`Selected day: ${formatDayLabelWithDate(selectedDay).fullLabel}. Click to change.`}
          >
            <Calendar size={16} className="text-mv-text-primary" />
            <span className="text-xs text-mv-text-secondary">
              {formatDayLabelWithDate(selectedDay).label}
            </span>
          </button>

          {showDayMenu && (
            <div
              className="absolute top-full left-0 mt-1 bg-mv-bg-secondary/95 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden z-10 min-w-[140px]"
              role="listbox"
              aria-label="Day selection"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const dayInfo = formatDayLabelWithDate(day);
                const isActive = selectedDay === day;

                return (
                  <button
                    key={day}
                    onClick={() => {
                      onDayChange?.(day);
                      setShowDayMenu(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowDayMenu(false);
                      }
                    }}
                    className={`flex items-center justify-between gap-3 px-3 py-2 w-full text-left hover:bg-white/5 transition-colors ${
                      isActive ? 'bg-white/10' : ''
                    }`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <span className={`text-xs font-medium ${isActive ? 'text-mv-text-primary' : 'text-mv-text-secondary'}`}>
                      {dayInfo.fullLabel}
                    </span>
                    <span className={`text-[10px] ${isActive ? 'text-mv-text-muted' : 'text-mv-text-muted/60'}`}>
                      {dayInfo.date}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Overlay selector */}
        <div className="relative">
          <button
            onClick={() => setShowOverlayMenu(!showOverlayMenu)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && showOverlayMenu) {
                setShowOverlayMenu(false);
              }
            }}
            className="flex items-center gap-2 px-3 py-2 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg border border-white/10 hover:border-white/20 transition-colors w-full"
            aria-expanded={showOverlayMenu}
            aria-haspopup="listbox"
            aria-label={`Map overlay: ${OVERLAY_CONFIG[overlay].label}. Click to change.`}
          >
            <Layers size={16} className="text-mv-text-primary" />
            <span className="text-xs text-mv-text-secondary">{OVERLAY_CONFIG[overlay].label}</span>
          </button>

          {showOverlayMenu && (
            <div
              className="absolute top-full left-0 mt-1 bg-mv-bg-secondary/95 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden z-10 min-w-[120px]"
              role="listbox"
              aria-label="Map overlay options"
            >
              {(Object.keys(OVERLAY_CONFIG) as MapOverlay[]).map((key) => {
                const config = OVERLAY_CONFIG[key];
                const Icon = config.icon;
                const isActive = overlay === key;

                return (
                  <button
                    key={key}
                    onClick={() => {
                      setOverlay(key);
                      setShowOverlayMenu(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowOverlayMenu(false);
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-white/5 transition-colors ${
                      isActive ? 'bg-white/10' : ''
                    }`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <Icon size={14} className={isActive ? 'text-mv-accent-blue' : 'text-mv-text-muted'} />
                    <span className={`text-xs ${isActive ? 'text-mv-text-primary' : 'text-mv-text-secondary'}`}>
                      {config.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Map legend */}
      <div className="absolute bottom-4 left-4 bg-mv-bg-secondary/90 backdrop-blur-sm rounded-lg p-3 border border-white/10">
        <div className="text-xs text-mv-text-muted mb-2">{OVERLAY_CONFIG[overlay].label}</div>
        <div className="flex items-center gap-1">
          {overlay === 'risk' && [1, 3, 5, 7, 9].map((v) => (
            <div key={v} className="w-6 h-3 rounded-sm" style={{ background: OVERLAY_CONFIG[overlay].colorFn(v) }} title={`${v}`} />
          ))}
          {overlay === 'temp-high' && [50, 70, 80, 90, 100].map((v) => (
            <div key={v} className="w-6 h-3 rounded-sm" style={{ background: OVERLAY_CONFIG[overlay].colorFn(v) }} title={`${v}°F`} />
          ))}
          {overlay === 'temp-low' && [20, 32, 40, 50, 60].map((v) => (
            <div key={v} className="w-6 h-3 rounded-sm" style={{ background: OVERLAY_CONFIG[overlay].colorFn(v) }} title={`${v}°F`} />
          ))}
          {overlay === 'rain' && [0, 0.25, 0.5, 1, 2].map((v) => (
            <div key={v} className="w-6 h-3 rounded-sm" style={{ background: OVERLAY_CONFIG[overlay].colorFn(v) }} title={`${v}"`} />
          ))}
          {overlay === 'snow' && [0, 1, 3, 6, 12].map((v) => (
            <div key={v} className="w-6 h-3 rounded-sm" style={{ background: OVERLAY_CONFIG[overlay].colorFn(v) }} title={`${v}"`} />
          ))}
          {overlay === 'wind' && [10, 20, 30, 40, 50].map((v) => (
            <div key={v} className="w-6 h-3 rounded-sm" style={{ background: OVERLAY_CONFIG[overlay].colorFn(v) }} title={`${v} mph`} />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-mv-text-muted mt-1">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      {/* Loading state */}
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-mv-bg-primary">
          <div className="text-mv-text-muted">Loading map...</div>
        </div>
      )}
    </div>
  );
}
