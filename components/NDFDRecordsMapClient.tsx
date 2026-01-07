'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = 'pk.eyJ1IjoibWF4dmVsb2NpdHkiLCJhIjoiY204bjdmMXV3MG9wbDJtcHczd3NrdWYweSJ9.BoHcO6T-ujYk3euVv00Xlg';
mapboxgl.accessToken = MAPBOX_TOKEN;

interface RecordStation {
  id: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  fcstTemp: number;
  recordTemp: number;
  recordYear: number;
  diff: number;
}

interface RecordsData {
  [key: string]: {
    himax: RecordStation[];
    lomin: RecordStation[];
    lomax: RecordStation[];
    himin: RecordStation[];
  };
}

interface TempPoint {
  lat: number;
  lon: number;
  temp: number;
}

type RecordType = 'himax' | 'lomin' | 'lomax' | 'himin';

const recordTypes: Record<
  RecordType,
  {
    label: string;
    color: string;
    nearColor: string;
    tieColor: string;
    breakColor: string;
  }
> = {
  himax: {
    label: 'High Max',
    color: '#ff3333',
    nearColor: '#ff3333',
    tieColor: '#8b0000',
    breakColor: '#FF00EA',
  },
  lomin: {
    label: 'Low Min',
    color: '#3388ff',
    nearColor: '#87ceeb',
    tieColor: '#00bfff',
    breakColor: '#00008b',
  },
  lomax: {
    label: 'Low Max',
    color: '#66bbff',
    nearColor: '#87ceeb',
    tieColor: '#00bfff',
    breakColor: '#00008b',
  },
  himin: {
    label: 'High Min',
    color: '#ff8833',
    nearColor: '#ff8833',
    tieColor: '#cc6600',
    breakColor: '#994400',
  },
};

// Temperature to RGB color function
function tempToRGB(temp: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [-40, [148, 0, 211]],
    [-20, [75, 0, 130]],
    [0, [0, 0, 205]],
    [10, [0, 102, 255]],
    [20, [0, 191, 255]],
    [32, [0, 206, 209]],
    [40, [46, 139, 87]],
    [50, [154, 205, 50]],
    [60, [255, 255, 0]],
    [70, [255, 165, 0]],
    [80, [255, 69, 0]],
    [90, [220, 20, 60]],
    [100, [255, 182, 193]],
    [110, [255, 255, 255]],
  ];

  if (temp <= stops[0][0]) return stops[0][1];
  if (temp >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

  for (let i = 0; i < stops.length - 1; i++) {
    if (temp >= stops[i][0] && temp <= stops[i + 1][0]) {
      const t = (temp - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return [
        Math.round(stops[i][1][0] + t * (stops[i + 1][1][0] - stops[i][1][0])),
        Math.round(stops[i][1][1] + t * (stops[i + 1][1][1] - stops[i][1][1])),
        Math.round(stops[i][1][2] + t * (stops[i + 1][1][2] - stops[i][1][2])),
      ];
    }
  }
  return [255, 255, 255];
}

// US States GeoJSON
const US_STATES_URL =
  'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';

export default function NDFDRecordsMapClient() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const statesGeoRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const [selectedType, setSelectedType] = useState<RecordType>('himax');
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedStation, setSelectedStation] = useState<RecordStation | null>(null);
  const [hoverStation, setHoverStation] = useState<(RecordStation & { x: number; y: number }) | null>(null);
  const [recordsData, setRecordsData] = useState<RecordsData | null>(null);
  const [temperatureData, setTemperatureData] = useState<TempPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Get station color based on record status
  const getStationColor = useCallback((station: RecordStation, type: RecordType): string => {
    const typeConfig = recordTypes[type];
    const diff = station.diff;

    if (type === 'himax' || type === 'himin') {
      if (diff > 0) return typeConfig.breakColor;
      if (diff === 0) return typeConfig.tieColor;
      return typeConfig.nearColor;
    } else {
      if (diff < 0) return typeConfig.breakColor;
      if (diff === 0) return typeConfig.tieColor;
      return typeConfig.nearColor;
    }
  }, []);

  // Fetch US states GeoJSON for clipping
  useEffect(() => {
    fetch(US_STATES_URL)
      .then((res) => res.json())
      .then((data) => {
        statesGeoRef.current = data;
      })
      .catch((err) => console.error('Failed to load states:', err));
  }, []);

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current || !MAPBOX_TOKEN) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-96, 38],
      zoom: 3.8,
      minZoom: 3,
      maxZoom: 10,
      projection: 'mercator',
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      if (!map.current) return;
      setMapLoaded(true);

      const style = map.current.getStyle();
      if (!style) return;

      // Find first symbol layer for ordering
      let firstSymbolId: string | undefined;
      for (const layer of style.layers) {
        if (layer.type === 'symbol') {
          firstSymbolId = layer.id;
          break;
        }
      }

      // Style roads - subtle gray for light theme
      style.layers.forEach((layer) => {
        if (layer.type === 'line' && layer.id.includes('road')) {
          let color = '#9ca3af';
          let width: mapboxgl.Expression = ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8, 1, 12, 2];

          if (layer.id.includes('motorway') || layer.id.includes('trunk') || layer.id.includes('highway')) {
            color = '#6b7280';
            width = ['interpolate', ['linear'], ['zoom'], 4, 0.5, 6, 1, 8, 2, 12, 3];
          } else if (layer.id.includes('primary')) {
            color = '#9ca3af';
            width = ['interpolate', ['linear'], ['zoom'], 6, 0.5, 8, 1, 12, 2];
          } else if (layer.id.includes('secondary') || layer.id.includes('tertiary')) {
            color = '#d1d5db';
            width = ['interpolate', ['linear'], ['zoom'], 7, 0.5, 10, 1, 14, 1.5];
          } else if (layer.id.includes('street') || layer.id.includes('minor') || layer.id.includes('service')) {
            color = '#e5e7eb';
            width = ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1];
          }

          if (layer.id.includes('case')) {
            color = '#f3f4f6';
          }

          try {
            map.current?.setPaintProperty(layer.id, 'line-color', color);
            map.current?.setPaintProperty(layer.id, 'line-width', width);
            map.current?.setPaintProperty(layer.id, 'line-opacity', 0.8);
          } catch {
            // Ignore errors
          }
        }
      });

      // Style labels - dark text with white halo for light theme
      style.layers.forEach((layer) => {
        if (layer.type === 'symbol') {
          try {
            map.current?.setPaintProperty(layer.id, 'text-color', '#1f2937');
            map.current?.setPaintProperty(layer.id, 'text-halo-color', 'rgba(255, 255, 255, 0.9)');
            map.current?.setPaintProperty(layer.id, 'text-halo-width', 2);
            map.current?.setLayoutProperty(layer.id, 'text-size', [
              'interpolate',
              ['linear'],
              ['zoom'],
              4,
              11,
              6,
              13,
              8,
              15,
              10,
              17,
              12,
              19,
            ]);
          } catch {
            // Ignore errors
          }
        }
      });

      // Add US states source
      map.current.addSource('states', {
        type: 'geojson',
        data: US_STATES_URL,
      });

      // State fill (transparent)
      map.current.addLayer(
        {
          id: 'state-fill',
          type: 'fill',
          source: 'states',
          paint: {
            'fill-color': 'rgba(0, 0, 0, 0)',
            'fill-outline-color': 'rgba(107, 114, 128, 0.5)',
          },
        },
        firstSymbolId
      );

      // State borders - dark gray for light theme
      map.current.addLayer(
        {
          id: 'state-borders',
          type: 'line',
          source: 'states',
          paint: {
            'line-color': 'rgba(75, 85, 99, 0.7)',
            'line-width': 1.5,
          },
        },
        firstSymbolId
      );
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Fetch records data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch('/api/ndfd-records');
        if (response.ok) {
          const result = await response.json();
          setRecordsData(result.data);
          setLastUpdated(result.lastUpdated);
        }
      } catch (err) {
        console.error('Failed to fetch records:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Fetch temperature data when day/type changes
  useEffect(() => {
    async function fetchTemperatureData() {
      try {
        const tempType = selectedType === 'himin' || selectedType === 'lomin' ? 'low' : 'high';
        const response = await fetch(`/api/temperature-grid?day=${selectedDay}&type=${tempType}`);
        if (response.ok) {
          const result = await response.json();
          setTemperatureData(result.points || []);
        }
      } catch (err) {
        console.error('Failed to fetch temperature data:', err);
      }
    }

    if (recordsData) {
      fetchTemperatureData();
    }
  }, [selectedDay, selectedType, recordsData]);

  // Helper functions for Mercator projection
  const latToMercatorY = (lat: number) => {
    const latRad = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  };

  const mercatorYToLat = (y: number) => {
    return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
  };

  // Generate temperature overlay
  useEffect(() => {
    if (!map.current || !mapLoaded || temperatureData.length === 0) return;

    const bounds = {
      west: -125,
      east: -66,
      north: 50,
      south: 24,
    };

    const mercatorNorth = latToMercatorY(bounds.north);
    const mercatorSouth = latToMercatorY(bounds.south);

    // Create canvas for temperature grid
    const canvas = document.createElement('canvas');
    const baseWidth = 400;
    const mercatorHeight = mercatorNorth - mercatorSouth;
    const lonRange = bounds.east - bounds.west;
    const baseHeight = Math.round((baseWidth * mercatorHeight) / ((lonRange * Math.PI) / 180));

    const interpCanvas = document.createElement('canvas');
    interpCanvas.width = baseWidth;
    interpCanvas.height = baseHeight;
    const interpCtx = interpCanvas.getContext('2d');
    if (!interpCtx) return;

    const width = 800;
    const height = Math.round((width * mercatorHeight) / ((lonRange * Math.PI) / 180));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const interpImageData = interpCtx.createImageData(baseWidth, baseHeight);
    const interpData = interpImageData.data;

    // Build spatial index
    const gridCellSize = 2;
    const spatialGrid: Record<string, TempPoint[]> = {};
    for (const point of temperatureData) {
      const cellX = Math.floor((point.lon + 180) / gridCellSize);
      const cellY = Math.floor((point.lat + 90) / gridCellSize);
      const key = `${cellX},${cellY}`;
      if (!spatialGrid[key]) spatialGrid[key] = [];
      spatialGrid[key].push(point);
    }

    // IDW interpolation
    const power = 2;
    const maxDistDegrees = 4;

    for (let py = 0; py < baseHeight; py++) {
      for (let px = 0; px < baseWidth; px++) {
        const lon = bounds.west + ((px + 0.5) / baseWidth) * (bounds.east - bounds.west);
        const mercatorY = mercatorNorth - ((py + 0.5) / baseHeight) * mercatorHeight;
        const lat = mercatorYToLat(mercatorY);

        const cellX = Math.floor((lon + 180) / gridCellSize);
        const cellY = Math.floor((lat + 90) / gridCellSize);

        const nearbyPoints: TempPoint[] = [];
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const key = `${cellX + dx},${cellY + dy}`;
            if (spatialGrid[key]) {
              nearbyPoints.push(...spatialGrid[key]);
            }
          }
        }

        let weightSum = 0;
        let tempSum = 0;
        let hasPoint = false;

        for (const point of nearbyPoints) {
          const dLon = lon - point.lon;
          const dLat = lat - point.lat;
          const dist = Math.sqrt(dLon * dLon + dLat * dLat);

          if (dist < maxDistDegrees) {
            hasPoint = true;
            if (dist < 0.01) {
              tempSum = point.temp;
              weightSum = 1;
              break;
            }
            const weight = 1 / Math.pow(dist, power);
            weightSum += weight;
            tempSum += weight * point.temp;
          }
        }

        const idx = (py * baseWidth + px) * 4;

        if (hasPoint && weightSum > 0) {
          const temp = tempSum / weightSum;
          const rgb = tempToRGB(temp);
          interpData[idx] = rgb[0];
          interpData[idx + 1] = rgb[1];
          interpData[idx + 2] = rgb[2];
          interpData[idx + 3] = 200;
        } else {
          interpData[idx + 3] = 0;
        }
      }
    }

    interpCtx.putImageData(interpImageData, 0, 0);
    ctx.drawImage(interpCanvas, 0, 0, baseWidth, baseHeight, 0, 0, width, height);

    // Apply CONUS mask
    if (statesGeoRef.current) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d');
      if (maskCtx) {
        maskCtx.fillStyle = 'white';
        statesGeoRef.current.features.forEach((feature) => {
          const stateName = (feature.properties as { name?: string })?.name;
          if (stateName === 'Alaska' || stateName === 'Hawaii') return;

          const coords =
            feature.geometry.type === 'Polygon'
              ? [feature.geometry.coordinates]
              : feature.geometry.type === 'MultiPolygon'
              ? feature.geometry.coordinates
              : [];

          coords.forEach((polygon) => {
            polygon.forEach((ring: number[][]) => {
              maskCtx.beginPath();
              ring.forEach((coord: number[], i: number) => {
                const x = ((coord[0] - bounds.west) / (bounds.east - bounds.west)) * width;
                const coordMercatorY = latToMercatorY(coord[1]);
                const y = ((mercatorNorth - coordMercatorY) / mercatorHeight) * height;
                if (i === 0) {
                  maskCtx.moveTo(x, y);
                } else {
                  maskCtx.lineTo(x, y);
                }
              });
              maskCtx.closePath();
              maskCtx.fill();
            });
          });
        });

        const maskData = maskCtx.getImageData(0, 0, width, height).data;
        for (let i = 0; i < data.length; i += 4) {
          if (maskData[i] === 0) {
            data[i + 3] = 0;
          }
        }
        ctx.putImageData(imageData, 0, 0);
      }
    }

    const dataUrl = canvas.toDataURL('image/png');

    // Add or update the image source
    if (map.current.getSource('temperature-image')) {
      map.current.removeLayer('temperature-layer');
      map.current.removeSource('temperature-image');
    }

    map.current.addSource('temperature-image', {
      type: 'image',
      url: dataUrl,
      coordinates: [
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.east, bounds.south],
        [bounds.west, bounds.south],
      ],
    });

    map.current.addLayer(
      {
        id: 'temperature-layer',
        type: 'raster',
        source: 'temperature-image',
        paint: {
          'raster-opacity': 0.75,
          'raster-fade-duration': 0,
        },
      },
      'state-fill'
    );

    // Reorder layers
    if (map.current.getLayer('state-borders')) {
      map.current.moveLayer('state-borders');
    }

    ['station-glow', 'station-circles', 'station-highlight'].forEach((layerId) => {
      if (map.current?.getLayer(layerId)) {
        try {
          map.current.moveLayer(layerId);
        } catch {
          // Ignore
        }
      }
    });
  }, [temperatureData, mapLoaded, latToMercatorY, mercatorYToLat]);

  // Update station markers
  useEffect(() => {
    if (!map.current || !mapLoaded || !recordsData) return;

    const dayKey = `d${selectedDay}`;
    const currentData = recordsData[dayKey]?.[selectedType] || [];

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: currentData
        .map((station) => {
          const color = getStationColor(station, selectedType);
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [station.lon, station.lat],
            },
            properties: {
              id: station.id,
              city: station.city,
              state: station.state,
              fcstTemp: station.fcstTemp,
              recordTemp: station.recordTemp,
              recordYear: station.recordYear,
              diff: station.diff,
              color: color,
            },
          };
        })
        .filter((f) => !isNaN(f.geometry.coordinates[0]) && !isNaN(f.geometry.coordinates[1])),
    };

    if (map.current.getSource('stations')) {
      (map.current.getSource('stations') as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.current.addSource('stations', {
        type: 'geojson',
        data: geojson,
      });

      map.current.addLayer({
        id: 'station-glow',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': 16,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.4,
          'circle-blur': 1,
        },
      });

      map.current.addLayer({
        id: 'station-circles',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': 9,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.current.addLayer({
        id: 'station-highlight',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': 3,
          'circle-color': '#ffffff',
          'circle-opacity': 0.7,
        },
      });

      map.current.on('click', 'station-circles', (e) => {
        if (e.features && e.features.length > 0) {
          const props = e.features[0].properties;
          if (props) {
            setSelectedStation({
              id: props.id,
              city: props.city,
              state: props.state || '',
              lat: 0,
              lon: 0,
              fcstTemp: props.fcstTemp,
              recordTemp: props.recordTemp,
              recordYear: props.recordYear,
              diff: props.diff,
            });
          }
        }
      });

      map.current.on('mousemove', 'station-circles', (e) => {
        if (e.features && e.features.length > 0 && map.current) {
          const props = e.features[0].properties;
          map.current.getCanvas().style.cursor = 'pointer';
          if (props) {
            setHoverStation({
              id: props.id,
              city: props.city,
              state: props.state || '',
              lat: 0,
              lon: 0,
              fcstTemp: props.fcstTemp,
              recordTemp: props.recordTemp,
              recordYear: props.recordYear,
              diff: props.diff,
              x: e.point.x,
              y: e.point.y,
            });
          }
        }
      });

      map.current.on('mouseleave', 'station-circles', () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = '';
          setHoverStation(null);
        }
      });
    }
  }, [recordsData, selectedDay, selectedType, mapLoaded, getStationColor]);

  // Helper functions
  const getTotalCounts = useCallback(() => {
    if (!recordsData) return {};
    const counts: Record<string, Record<string, number>> = {};
    for (let d = 1; d <= 7; d++) {
      const dayKey = `d${d}`;
      counts[dayKey] = {
        himax: recordsData[dayKey]?.himax?.length || 0,
        lomin: recordsData[dayKey]?.lomin?.length || 0,
        lomax: recordsData[dayKey]?.lomax?.length || 0,
        himin: recordsData[dayKey]?.himin?.length || 0,
      };
    }
    return counts;
  }, [recordsData]);

  const totalCounts = getTotalCounts();

  const getDayTotal = useCallback(
    (day: number): number => {
      const dayKey = `d${day}`;
      const counts = totalCounts[dayKey];
      if (!counts) return 0;
      return counts.himax + counts.lomin + counts.lomax + counts.himin;
    },
    [totalCounts]
  );

  const getRecordStatusCounts = useCallback(() => {
    if (!recordsData) return { breaking: 0, tied: 0, near: 0 };

    const dayKey = `d${selectedDay}`;
    const stations = recordsData[dayKey]?.[selectedType] || [];

    let breaking = 0;
    let tied = 0;
    let near = 0;

    stations.forEach((station) => {
      const diff = station.diff;
      if (selectedType === 'himax' || selectedType === 'himin') {
        if (diff > 0) breaking++;
        else if (diff === 0) tied++;
        else near++;
      } else {
        if (diff < 0) breaking++;
        else if (diff === 0) tied++;
        else near++;
      }
    });

    return { breaking, tied, near };
  }, [recordsData, selectedDay, selectedType]);

  const recordStatusCounts = getRecordStatusCounts();

  const getForecastDate = (dayOffset: number): string => {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset - 1);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  if (!MAPBOX_TOKEN) {
    return <div className="p-8 text-center text-mv-text-muted">Mapbox token not configured</div>;
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap gap-4 items-start justify-between">
          {/* Record Type Selector */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2 font-semibold">Record Type</label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(recordTypes) as [RecordType, (typeof recordTypes)[RecordType]][]).map(
                ([key, config]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedType(key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      selectedType === key ? 'ring-2 ring-gray-400 shadow-md' : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: selectedType === key ? config.color : `${config.color}20`,
                      color: selectedType === key ? '#fff' : config.color,
                    }}
                  >
                    {config.label}
                    <span className="ml-2 px-1.5 py-0.5 bg-black/20 rounded text-xs">
                      {totalCounts[`d${selectedDay}`]?.[key] || 0}
                    </span>
                  </button>
                )
              )}
            </div>

            {/* Record Status Counts */}
            <div className="flex gap-4 mt-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: recordTypes[selectedType].breakColor }} />
                <span className="text-gray-600 font-medium">Breaking:</span>
                <span className="font-bold" style={{ color: recordTypes[selectedType].breakColor }}>
                  {recordStatusCounts.breaking}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: recordTypes[selectedType].tieColor }} />
                <span className="text-gray-600 font-medium">Tied:</span>
                <span className="font-bold" style={{ color: recordTypes[selectedType].tieColor }}>
                  {recordStatusCounts.tied}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: recordTypes[selectedType].nearColor }} />
                <span className="text-gray-600 font-medium">Near:</span>
                <span className="font-bold" style={{ color: recordTypes[selectedType].nearColor }}>
                  {recordStatusCounts.near}
                </span>
              </div>
            </div>
          </div>

          {/* Day Selector */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2 font-semibold">Forecast Day</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const total = getDayTotal(day);
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`min-w-[48px] h-10 rounded-lg font-bold text-sm transition-all flex flex-col items-center justify-center ${
                      selectedDay === day
                        ? 'bg-blue-600 text-white ring-2 ring-blue-300 shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                    }`}
                  >
                    <span>D{day}</span>
                    <span className="text-[10px] opacity-70">({total})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Forecast Date */}
          <div className="text-right">
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2 font-semibold">Forecast Date</label>
            <div className="text-blue-600 font-bold text-lg">{getForecastDate(selectedDay)}</div>
            {lastUpdated && (
              <div className="text-xs text-gray-500 mt-1">Updated: {new Date(lastUpdated).toLocaleTimeString()}</div>
            )}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="relative bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm" style={{ height: '75vh', minHeight: '600px' }}>
        <div ref={mapContainer} className="w-full h-full" />

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4" />
              <div className="text-lg text-gray-700 font-semibold">Loading NDFD records...</div>
            </div>
          </div>
        )}

        {/* Hover Tooltip */}
        {hoverStation && !selectedStation && (
          <div className="absolute pointer-events-none z-20" style={{ left: hoverStation.x + 15, top: hoverStation.y - 80 }}>
            <div
              className="bg-black/95 rounded-lg px-3 py-2 shadow-xl"
              style={{ borderColor: recordTypes[selectedType].color, borderWidth: 2 }}
            >
              <div className="font-bold text-white">{hoverStation.city}</div>
              <div className="text-sm text-gray-300">
                Forecast:{' '}
                <span className="font-semibold" style={{ color: recordTypes[selectedType].color }}>
                  {hoverStation.fcstTemp}°F
                </span>
              </div>
              <div className="text-sm text-gray-300">
                Record: {hoverStation.recordTemp}°F ({hoverStation.recordYear})
              </div>
              <div className="text-sm">
                <span
                  className="font-bold"
                  style={{
                    color: hoverStation.diff > 0 ? '#ff3333' : hoverStation.diff < 0 ? '#3388ff' : '#ffcc00',
                  }}
                >
                  {hoverStation.diff > 0 ? '+' : ''}
                  {hoverStation.diff}°F
                </span>
                <span className="text-gray-400 ml-2">
                  {hoverStation.diff > 0 ? '(Breaking!)' : hoverStation.diff === 0 ? '(Tying!)' : '(Near)'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Station Detail Modal */}
        {selectedStation && (
          <div
            className="absolute inset-0 flex items-center justify-center z-30 bg-black/50"
            onClick={() => setSelectedStation(null)}
          >
            <div
              className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border-2"
              style={{ borderColor: recordTypes[selectedType].color }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedStation.city}</h3>
                  <p className="text-gray-500 text-sm">
                    {selectedStation.state} - Station: {selectedStation.id}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedStation(null)}
                  className="text-gray-400 hover:text-gray-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                >
                  ×
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <span className="text-gray-600 font-medium">Forecast Temp</span>
                  <span className="text-2xl font-bold" style={{ color: recordTypes[selectedType].color }}>
                    {selectedStation.fcstTemp}°F
                  </span>
                </div>

                <div className="flex justify-between items-center bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <span className="text-gray-600 font-medium">Current Record</span>
                  <span className="text-xl font-bold text-gray-900">{selectedStation.recordTemp}°F</span>
                </div>

                <div className="flex justify-between items-center bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <span className="text-gray-600 font-medium">Record Year</span>
                  <span className="text-lg font-bold text-gray-900">{selectedStation.recordYear}</span>
                </div>

                <div className="rounded-lg p-3 text-center" style={{ backgroundColor: recordTypes[selectedType].color }}>
                  <span className="text-xl font-bold text-white uppercase">
                    {selectedStation.diff > 0 ? 'BREAKING RECORD!' : selectedStation.diff === 0 ? 'TYING RECORD!' : 'NEAR RECORD'}
                  </span>
                  <p className="text-sm text-white/90 mt-1">
                    {Math.abs(selectedStation.diff)}°F{' '}
                    {selectedStation.diff > 0 ? 'above' : selectedStation.diff < 0 ? 'below' : 'at'} record
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Temperature Legend - temporarily hidden */}
        {/* <div className="absolute bottom-4 left-4 right-4 bg-white/95 rounded-lg p-3 z-10 shadow-lg border border-gray-200">
          <p className="text-xs text-gray-700 mb-2 font-semibold">Temperature (°F)</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-800 font-bold">-40°</span>
            <div
              className="flex-1 h-4 rounded border border-gray-300"
              style={{
                background:
                  'linear-gradient(to right, #9400d3, #4b0082, #0000cd, #0066ff, #00bfff, #00ced1, #2e8b57, #9acd32, #ffff00, #ffa500, #ff4500, #dc143c, #ffb6c1, #ffffff)',
              }}
            />
            <span className="text-xs text-gray-800 font-bold">110°</span>
          </div>
        </div> */}
      </div>

      {/* Summary Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Records Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 px-3 text-gray-600 font-semibold">Type</th>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <th
                    key={d}
                    className={`py-3 px-3 text-center font-semibold ${
                      selectedDay === d ? 'bg-blue-50 text-blue-700' : 'text-gray-600'
                    }`}
                  >
                    Day {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.entries(recordTypes) as [RecordType, (typeof recordTypes)[RecordType]][]).map(([key, config]) => (
                <tr key={key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-3 font-semibold" style={{ color: config.color }}>
                    {config.label}
                  </td>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                    const count = totalCounts[`d${d}`]?.[key] || 0;
                    return (
                      <td
                        key={d}
                        className={`py-3 px-3 text-center ${selectedDay === d ? 'bg-blue-50' : ''}`}
                        style={{
                          color: count > 0 ? config.color : '#9ca3af',
                          fontWeight: count > 0 ? 700 : 400,
                        }}
                      >
                        {count > 0 ? count : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 border-blue-200 bg-blue-50/50">
                <td className="py-3 px-3 font-bold text-gray-900">TOTAL</td>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const total = getDayTotal(d);
                  return (
                    <td
                      key={d}
                      className={`py-3 px-3 text-center font-bold ${
                        selectedDay === d ? 'bg-blue-100 text-blue-700' : 'text-blue-600'
                      }`}
                    >
                      {total > 0 ? total : '—'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Data Source */}
      <div className="text-sm text-gray-600 text-center py-2">
        Source: NOAA/NWS Weather Prediction Center NDFD Records Display • Temperature data from GFS via NOMADS •{' '}
        <a
          href="https://www.wpc.ncep.noaa.gov/exper/ndfd/ndfd.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline font-medium"
        >
          View Official WPC Data
        </a>
      </div>
    </div>
  );
}
