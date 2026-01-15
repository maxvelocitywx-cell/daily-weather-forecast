import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getModelById, COLOR_SCALES } from '@/lib/models/registry';

export const runtime = 'nodejs';

const OPEN_METEO_API_KEY = 'yH4W7Ms6acRVmSnd';

// Tile cache (in-memory, short TTL)
const tileCache = new Map<string, { data: Buffer; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Convert tile coordinates to lat/lon bounds
function tileToBounds(z: number, x: number, y: number): { north: number; south: number; west: number; east: number } {
  const n = Math.pow(2, z);

  // Web Mercator to lat/lon
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;

  const latRadN = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const latRadS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n)));

  const north = latRadN * 180 / Math.PI;
  const south = latRadS * 180 / Math.PI;

  return { north, south, west, east };
}

// Interpolate color from color scale
function getColorForValue(value: number, colorScale: { stops: { value: number; color: number[] }[] }): number[] {
  const { stops } = colorScale;

  if (value <= stops[0].value) {
    return [...stops[0].color];
  }
  if (value >= stops[stops.length - 1].value) {
    return [...stops[stops.length - 1].color];
  }

  // Find the two stops to interpolate between
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].value && value <= stops[i + 1].value) {
      const t = (value - stops[i].value) / (stops[i + 1].value - stops[i].value);
      const c1 = stops[i].color;
      const c2 = stops[i + 1].color;

      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * t),
        Math.round(c1[1] + (c2[1] - c1[1]) * t),
        Math.round(c1[2] + (c2[2] - c1[2]) * t),
        c1.length > 3 && c2.length > 3
          ? Math.round((c1[3] ?? 255) + ((c2[3] ?? 255) - (c1[3] ?? 255)) * t)
          : 255,
      ];
    }
  }

  return [128, 128, 128, 255];
}

// Get the appropriate color scale for a variable
function getColorScaleForVariable(variable: string): { stops: { value: number; color: number[] }[] } {
  if (variable.includes('temperature') || variable.includes('dew_point') || variable.includes('apparent')) {
    return COLOR_SCALES.temperature;
  }
  if (variable.includes('precipitation') || variable.includes('rain') || variable.includes('snow')) {
    return COLOR_SCALES.precipitation;
  }
  if (variable.includes('wind')) {
    return COLOR_SCALES.wind;
  }
  if (variable.includes('cape')) {
    return COLOR_SCALES.cape;
  }

  // Default temperature-like scale
  return COLOR_SCALES.temperature;
}

// Convert Celsius to Fahrenheit
function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

// Convert m/s to mph
function msToMph(ms: number): number {
  return ms * 2.237;
}

// Convert mm to inches
function mmToInches(mm: number): number {
  return mm / 25.4;
}

// Bilinear interpolation for smoother rendering
function bilinearInterpolate(
  data: number[][],
  x: number,
  y: number,
  width: number,
  height: number
): number | null {
  const x0 = Math.floor(x);
  const x1 = Math.min(x0 + 1, width - 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, height - 1);

  const dx = x - x0;
  const dy = y - y0;

  const v00 = data[y0]?.[x0];
  const v10 = data[y0]?.[x1];
  const v01 = data[y1]?.[x0];
  const v11 = data[y1]?.[x1];

  if (v00 === null || v00 === undefined || isNaN(v00) ||
      v10 === null || v10 === undefined || isNaN(v10) ||
      v01 === null || v01 === undefined || isNaN(v01) ||
      v11 === null || v11 === undefined || isNaN(v11)) {
    return null;
  }

  const v0 = v00 * (1 - dx) + v10 * dx;
  const v1 = v01 * (1 - dx) + v11 * dx;

  return v0 * (1 - dy) + v1 * dy;
}

async function createTransparentTile(): Promise<Buffer> {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ model: string; variable: string; z: string; x: string; y: string }> }
) {
  const { model: modelId, variable, z: zStr, x: xStr, y: yStr } = await params;
  const z = parseInt(zStr, 10);
  const x = parseInt(xStr, 10);
  const y = parseInt(yStr, 10);

  const { searchParams } = new URL(request.url);
  const forecastHour = parseInt(searchParams.get('hour') || '0', 10);
  const runTime = searchParams.get('run'); // ISO format

  // Get model definition
  const model = getModelById(modelId);
  if (!model || !model.openMeteoSupport) {
    return new NextResponse(JSON.stringify({ error: 'Model not supported' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check cache
  const cacheKey = `model/${modelId}/${variable}/${z}/${x}/${y}/${forecastHour}/${runTime || 'latest'}`;
  const cached = tileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return new NextResponse(new Uint8Array(cached.data), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Get tile bounds
  const bounds = tileToBounds(z, x, y);

  // Skip tiles outside reasonable bounds
  if (bounds.south > 85 || bounds.north < -85 || bounds.west > 180 || bounds.east < -180) {
    const transparent = await createTransparentTile();
    return new NextResponse(new Uint8Array(transparent), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    // Determine grid resolution based on zoom level
    // Higher zoom = more points needed for smooth rendering
    const gridSize = Math.min(64, Math.max(16, Math.pow(2, Math.min(z, 6))));

    // Create grid of lat/lon points
    const latStep = (bounds.north - bounds.south) / (gridSize - 1);
    const lonStep = (bounds.east - bounds.west) / (gridSize - 1);

    const latitudes: number[] = [];
    const longitudes: number[] = [];

    for (let i = 0; i < gridSize; i++) {
      latitudes.push(bounds.north - i * latStep);
      longitudes.push(bounds.west + i * lonStep);
    }

    // Build Open-Meteo API URL
    // We'll fetch a grid of points for this tile
    const apiEndpoint = model.openMeteoApiEndpoint || 'forecast';
    const baseUrl = `https://customer-api.open-meteo.com/v1/${apiEndpoint}`;

    // For grid data, we need to make multiple requests or use their grid endpoint
    // Open-Meteo doesn't have a native grid endpoint, so we'll sample strategically

    // Sample center point to get data availability
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLon = (bounds.west + bounds.east) / 2;

    const apiParams = new URLSearchParams({
      latitude: centerLat.toFixed(4),
      longitude: centerLon.toFixed(4),
      hourly: variable,
      forecast_hours: (forecastHour + 1).toString(),
      apikey: OPEN_METEO_API_KEY,
    });

    if (model.openMeteoModel) {
      apiParams.set('models', model.openMeteoModel);
    }

    // For a proper implementation, we'd need to fetch multiple points
    // For now, let's create a gradient tile based on a grid sample

    // Create multiple point requests (simplified - in production use batch API)
    const samplePoints = [
      { lat: bounds.north, lon: bounds.west },
      { lat: bounds.north, lon: bounds.east },
      { lat: bounds.south, lon: bounds.west },
      { lat: bounds.south, lon: bounds.east },
      { lat: centerLat, lon: centerLon },
    ];

    const samplePromises = samplePoints.map(async (point) => {
      try {
        const url = `${baseUrl}?latitude=${point.lat.toFixed(4)}&longitude=${point.lon.toFixed(4)}&hourly=${variable}&forecast_hours=${forecastHour + 1}&apikey=${OPEN_METEO_API_KEY}${model.openMeteoModel ? `&models=${model.openMeteoModel}` : ''}`;

        const response = await fetch(url, {
          headers: { 'User-Agent': 'maxvelocitywx.com' },
        });

        if (!response.ok) {
          return { lat: point.lat, lon: point.lon, value: null };
        }

        const data = await response.json();
        const values = data.hourly?.[variable];
        const value = values?.[forecastHour] ?? null;

        return { lat: point.lat, lon: point.lon, value };
      } catch {
        return { lat: point.lat, lon: point.lon, value: null };
      }
    });

    const samples = await Promise.all(samplePromises);
    const validSamples = samples.filter(s => s.value !== null);

    if (validSamples.length === 0) {
      const transparent = await createTransparentTile();
      return new NextResponse(new Uint8Array(transparent), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Get color scale
    const colorScale = getColorScaleForVariable(variable);

    // Create tile image with bilinear interpolation
    const tileSize = 256;
    const outputBuffer = Buffer.alloc(tileSize * tileSize * 4);

    // Inverse distance weighting interpolation
    for (let py = 0; py < tileSize; py++) {
      for (let px = 0; px < tileSize; px++) {
        const pixelLat = bounds.north - (py / tileSize) * (bounds.north - bounds.south);
        const pixelLon = bounds.west + (px / tileSize) * (bounds.east - bounds.west);

        // IDW interpolation
        let weightSum = 0;
        let valueSum = 0;

        for (const sample of validSamples) {
          const dx = pixelLon - sample.lon;
          const dy = pixelLat - sample.lat;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 0.001) {
            // Very close, use this value directly
            weightSum = 1;
            valueSum = sample.value as number;
            break;
          }

          const weight = 1 / (dist * dist);
          weightSum += weight;
          valueSum += weight * (sample.value as number);
        }

        let interpolatedValue = valueSum / weightSum;

        // Convert units if needed
        if (variable.includes('temperature') || variable.includes('dew_point') || variable.includes('apparent')) {
          interpolatedValue = celsiusToFahrenheit(interpolatedValue);
        } else if (variable.includes('wind_speed') || variable.includes('wind_gusts')) {
          interpolatedValue = msToMph(interpolatedValue);
        } else if (variable.includes('precipitation') || variable.includes('rain') || variable.includes('snow')) {
          interpolatedValue = mmToInches(interpolatedValue);
        }

        const color = getColorForValue(interpolatedValue, colorScale);

        const idx = (py * tileSize + px) * 4;
        outputBuffer[idx] = color[0];
        outputBuffer[idx + 1] = color[1];
        outputBuffer[idx + 2] = color[2];
        outputBuffer[idx + 3] = color.length > 3 ? color[3] : 200; // Semi-transparent
      }
    }

    // Encode to PNG with smoothing
    const outputPng = await sharp(outputBuffer, {
      raw: {
        width: tileSize,
        height: tileSize,
        channels: 4,
      },
    })
      .blur(1.5) // Smooth the interpolation artifacts
      .png()
      .toBuffer();

    // Cache the result
    tileCache.set(cacheKey, { data: outputPng, timestamp: Date.now() });

    // Periodic cache cleanup
    if (Math.random() < 0.1) {
      const now = Date.now();
      for (const [key, value] of tileCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          tileCache.delete(key);
        }
      }
    }

    return new NextResponse(new Uint8Array(outputPng), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error generating model tile:', error);

    const transparent = await createTransparentTile();
    return new NextResponse(new Uint8Array(transparent), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=30',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
