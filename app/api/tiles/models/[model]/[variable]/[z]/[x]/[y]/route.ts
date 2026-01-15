import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getModelById, COLOR_SCALES } from '@/lib/models/registry';

export const runtime = 'nodejs';

const OPEN_METEO_API_KEY = 'yH4W7Ms6acRVmSnd';

// Tile cache (in-memory, short TTL)
const tileCache = new Map<string, { data: Buffer; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Tile size - 512 for smoother results
const TILE_SIZE = 512;

// Grid sampling resolution - how many points to fetch per tile
const GRID_SIZE = 8; // 8x8 grid = 64 API calls per tile

// Contour configuration
const CONTOUR_INTERVALS: Record<string, { interval: number; color: number[]; width: number }> = {
  temperature: { interval: 10, color: [0, 0, 0], width: 1 }, // Every 10°F
  pressure: { interval: 4, color: [0, 0, 0], width: 1 }, // Every 4mb
  heights: { interval: 60, color: [0, 0, 0], width: 1 }, // Every 60m (500mb)
};

// Convert tile coordinates to lat/lon bounds
function tileToBounds(z: number, x: number, y: number): { north: number; south: number; west: number; east: number } {
  const n = Math.pow(2, z);
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
  if (value <= stops[0].value) return [...stops[0].color];
  if (value >= stops[stops.length - 1].value) return [...stops[stops.length - 1].color];

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
  return COLOR_SCALES.temperature;
}

// Unit conversions
function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

function msToMph(ms: number): number {
  return ms * 2.237;
}

function mmToInches(mm: number): number {
  return mm / 25.4;
}

// Bilinear interpolation on a 2D grid
function bilinearInterpolate(
  grid: (number | null)[][],
  x: number, // 0 to gridWidth-1 (fractional)
  y: number  // 0 to gridHeight-1 (fractional)
): number | null {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  if (gridWidth === 0 || gridHeight === 0) return null;

  // Clamp to valid range
  x = Math.max(0, Math.min(gridWidth - 1.001, x));
  y = Math.max(0, Math.min(gridHeight - 1.001, y));

  const x0 = Math.floor(x);
  const x1 = Math.min(x0 + 1, gridWidth - 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, gridHeight - 1);

  const dx = x - x0;
  const dy = y - y0;

  const v00 = grid[y0]?.[x0];
  const v10 = grid[y0]?.[x1];
  const v01 = grid[y1]?.[x0];
  const v11 = grid[y1]?.[x1];

  // If any corner is null, try to find a valid value
  if (v00 === null || v10 === null || v01 === null || v11 === null) {
    // Return closest valid value or null
    const validValues = [v00, v10, v01, v11].filter(v => v !== null) as number[];
    return validValues.length > 0 ? validValues[0] : null;
  }

  // Bilinear interpolation
  const v0 = v00 * (1 - dx) + v10 * dx;
  const v1 = v01 * (1 - dx) + v11 * dx;
  return v0 * (1 - dy) + v1 * dy;
}

// Check if a contour line crosses between two values
function crossesContour(v1: number, v2: number, contourLevel: number): boolean {
  return (v1 <= contourLevel && v2 > contourLevel) || (v1 > contourLevel && v2 <= contourLevel);
}

// Determine if pixel should be part of a contour line
function isContourPixel(
  grid: (number | null)[][],
  px: number, // pixel x in tile
  py: number, // pixel y in tile
  tileSize: number,
  gridWidth: number,
  gridHeight: number,
  contourInterval: number
): boolean {
  // Map pixel to grid coordinates
  const gx = (px / tileSize) * (gridWidth - 1);
  const gy = (py / tileSize) * (gridHeight - 1);

  const centerVal = bilinearInterpolate(grid, gx, gy);
  if (centerVal === null) return false;

  // Check neighboring pixels for contour crossings
  const delta = 1.5; // Check slightly offset positions
  const neighbors = [
    bilinearInterpolate(grid, gx + delta / tileSize * (gridWidth - 1), gy),
    bilinearInterpolate(grid, gx - delta / tileSize * (gridWidth - 1), gy),
    bilinearInterpolate(grid, gx, gy + delta / tileSize * (gridHeight - 1)),
    bilinearInterpolate(grid, gx, gy - delta / tileSize * (gridHeight - 1)),
  ];

  // Find which contour levels might be crossed
  const minVal = Math.min(centerVal, ...neighbors.filter(n => n !== null) as number[]);
  const maxVal = Math.max(centerVal, ...neighbors.filter(n => n !== null) as number[]);

  // Check if any contour level is crossed
  const startLevel = Math.floor(minVal / contourInterval) * contourInterval;
  const endLevel = Math.ceil(maxVal / contourInterval) * contourInterval;

  for (let level = startLevel; level <= endLevel; level += contourInterval) {
    for (const neighbor of neighbors) {
      if (neighbor !== null && crossesContour(centerVal, neighbor, level)) {
        return true;
      }
    }
  }

  return false;
}

async function createTransparentTile(): Promise<Buffer> {
  return sharp({
    create: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}

// Fetch grid data from Open-Meteo
async function fetchGridData(
  baseUrl: string,
  model: { openMeteoModel?: string },
  variable: string,
  forecastHour: number,
  bounds: { north: number; south: number; west: number; east: number },
  gridSize: number
): Promise<(number | null)[][]> {
  const grid: (number | null)[][] = [];

  // Create grid of lat/lon points with some padding
  const latPadding = (bounds.north - bounds.south) * 0.1;
  const lonPadding = (bounds.east - bounds.west) * 0.1;

  const latMin = bounds.south - latPadding;
  const latMax = bounds.north + latPadding;
  const lonMin = bounds.west - lonPadding;
  const lonMax = bounds.east + lonPadding;

  const latStep = (latMax - latMin) / (gridSize - 1);
  const lonStep = (lonMax - lonMin) / (gridSize - 1);

  // Create all sample points
  const points: { lat: number; lon: number; row: number; col: number }[] = [];
  for (let row = 0; row < gridSize; row++) {
    grid[row] = new Array(gridSize).fill(null);
    for (let col = 0; col < gridSize; col++) {
      points.push({
        lat: latMax - row * latStep, // North to south
        lon: lonMin + col * lonStep, // West to east
        row,
        col,
      });
    }
  }

  // Fetch in parallel with concurrency limit
  const BATCH_SIZE = 16;
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (point) => {
        try {
          const url = `${baseUrl}?latitude=${point.lat.toFixed(4)}&longitude=${point.lon.toFixed(4)}&hourly=${variable}&forecast_hours=${forecastHour + 1}&apikey=${OPEN_METEO_API_KEY}${model.openMeteoModel ? `&models=${model.openMeteoModel}` : ''}`;

          const response = await fetch(url, {
            headers: { 'User-Agent': 'maxvelocitywx.com' },
          });

          if (!response.ok) return { ...point, value: null };

          const data = await response.json();
          const values = data.hourly?.[variable];
          const value = values?.[forecastHour] ?? null;

          return { ...point, value };
        } catch {
          return { ...point, value: null };
        }
      })
    );

    for (const result of results) {
      grid[result.row][result.col] = result.value;
    }
  }

  return grid;
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
  const runTime = searchParams.get('run');

  // Get model definition
  const model = getModelById(modelId);
  if (!model || !model.openMeteoSupport) {
    return new NextResponse(JSON.stringify({ error: 'Model not supported' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check cache
  const cacheKey = `model/${modelId}/${variable}/${z}/${x}/${y}/${forecastHour}/${runTime || 'latest'}/v2`;
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
    const apiEndpoint = model.openMeteoApiEndpoint || 'forecast';
    const baseUrl = `https://customer-api.open-meteo.com/v1/${apiEndpoint}`;

    // Fetch grid data
    const gridData = await fetchGridData(baseUrl, model, variable, forecastHour, bounds, GRID_SIZE);

    // Check if we have any valid data
    const hasValidData = gridData.some(row => row.some(v => v !== null));
    if (!hasValidData) {
      const transparent = await createTransparentTile();
      return new NextResponse(new Uint8Array(transparent), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Get color scale and contour config
    const colorScale = getColorScaleForVariable(variable);

    // Determine if we should draw contours
    let contourConfig: { interval: number; color: number[]; width: number } | null = null;
    if (variable.includes('temperature') || variable.includes('dew_point') || variable.includes('apparent')) {
      contourConfig = CONTOUR_INTERVALS.temperature;
    } else if (variable.includes('pressure') || variable === 'pressure_msl' || variable === 'surface_pressure') {
      contourConfig = CONTOUR_INTERVALS.pressure;
    } else if (variable.includes('geopotential') || variable.includes('height')) {
      contourConfig = CONTOUR_INTERVALS.heights;
    }

    // Create output buffer
    const outputBuffer = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);

    // Precompute grid dimensions for interpolation
    const gridHeight = gridData.length;
    const gridWidth = gridData[0]?.length || 0;

    // Padding ratios (grid extends beyond tile bounds)
    const latPaddingRatio = 0.1;
    const lonPaddingRatio = 0.1;

    // Map tile pixel to grid coordinate
    const pixelToGridX = (px: number): number => {
      const tileRatio = px / TILE_SIZE; // 0 to 1 within tile
      // Grid has padding on each side, so tile maps to middle portion
      const gridRatioStart = lonPaddingRatio / (1 + 2 * lonPaddingRatio);
      const gridRatioEnd = (1 + lonPaddingRatio) / (1 + 2 * lonPaddingRatio);
      const gridRatio = gridRatioStart + tileRatio * (gridRatioEnd - gridRatioStart);
      return gridRatio * (gridWidth - 1);
    };

    const pixelToGridY = (py: number): number => {
      const tileRatio = py / TILE_SIZE;
      const gridRatioStart = latPaddingRatio / (1 + 2 * latPaddingRatio);
      const gridRatioEnd = (1 + latPaddingRatio) / (1 + 2 * latPaddingRatio);
      const gridRatio = gridRatioStart + tileRatio * (gridRatioEnd - gridRatioStart);
      return gridRatio * (gridHeight - 1);
    };

    // Render each pixel with bilinear interpolation
    for (let py = 0; py < TILE_SIZE; py++) {
      for (let px = 0; px < TILE_SIZE; px++) {
        const gx = pixelToGridX(px);
        const gy = pixelToGridY(py);

        let value = bilinearInterpolate(gridData, gx, gy);

        if (value === null) {
          // Transparent pixel
          const idx = (py * TILE_SIZE + px) * 4;
          outputBuffer[idx] = 0;
          outputBuffer[idx + 1] = 0;
          outputBuffer[idx + 2] = 0;
          outputBuffer[idx + 3] = 0;
          continue;
        }

        // Convert units
        if (variable.includes('temperature') || variable.includes('dew_point') || variable.includes('apparent')) {
          value = celsiusToFahrenheit(value);
        } else if (variable.includes('wind_speed') || variable.includes('wind_gusts')) {
          value = msToMph(value);
        } else if (variable.includes('precipitation') || variable.includes('rain') || variable.includes('snow')) {
          value = mmToInches(value);
        }

        // Get base color
        let color = getColorForValue(value, colorScale);
        let alpha = 200; // Base opacity

        // Check for contour
        if (contourConfig) {
          // Create a converted grid for contour detection (only convert once if needed)
          // For simplicity, we'll use the raw grid for contour detection
          // and check if this pixel is on a contour line
          const isContour = isContourPixel(
            gridData.map(row => row.map(v => {
              if (v === null) return null;
              if (variable.includes('temperature') || variable.includes('dew_point') || variable.includes('apparent')) {
                return celsiusToFahrenheit(v);
              }
              return v;
            })),
            px, py, TILE_SIZE, gridWidth, gridHeight, contourConfig.interval
          );

          if (isContour) {
            // Draw contour line (dark color, fully opaque)
            color = [...contourConfig.color, 255];
            alpha = 255;
          }
        }

        const idx = (py * TILE_SIZE + px) * 4;
        outputBuffer[idx] = color[0];
        outputBuffer[idx + 1] = color[1];
        outputBuffer[idx + 2] = color[2];
        outputBuffer[idx + 3] = color.length > 3 ? color[3] : alpha;
      }
    }

    // Encode to PNG (light blur to smooth any remaining artifacts)
    const outputPng = await sharp(outputBuffer, {
      raw: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        channels: 4,
      },
    })
      .blur(0.5) // Light blur to smooth edges
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
