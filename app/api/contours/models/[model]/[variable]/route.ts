import { NextRequest, NextResponse } from 'next/server';
import { getModelById } from '@/lib/models/registry';

export const runtime = 'nodejs';

const OPEN_METEO_API_KEY = 'yH4W7Ms6acRVmSnd';

// Contour intervals by variable type
const CONTOUR_CONFIG: Record<string, { interval: number; unit: string }> = {
  temperature: { interval: 2, unit: '°F' }, // Every 2°F
  pressure: { interval: 4, unit: 'mb' }, // Every 4mb
  heights: { interval: 60, unit: 'm' }, // Every 60m
};

// Unit conversions
function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

// Bilinear interpolation
function bilinearInterpolate(
  grid: (number | null)[][],
  x: number,
  y: number
): number | null {
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  if (gridWidth === 0 || gridHeight === 0) return null;

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

  if (v00 === null || v10 === null || v01 === null || v11 === null) {
    const validValues = [v00, v10, v01, v11].filter(v => v !== null) as number[];
    return validValues.length > 0 ? validValues[0] : null;
  }

  const v0 = v00 * (1 - dx) + v10 * dx;
  const v1 = v01 * (1 - dx) + v11 * dx;
  return v0 * (1 - dy) + v1 * dy;
}

// Marching squares to generate contour lines
function marchingSquares(
  grid: (number | null)[][],
  level: number,
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number
): number[][][] {
  const lines: number[][][] = [];
  const gridHeight = grid.length;
  const gridWidth = grid[0]?.length || 0;

  if (gridWidth < 2 || gridHeight < 2) return lines;

  const latStep = (latMax - latMin) / (gridHeight - 1);
  const lonStep = (lonMax - lonMin) / (gridWidth - 1);

  // Helper to convert grid coords to lat/lon
  const gridToLatLon = (gx: number, gy: number): [number, number] => {
    const lon = lonMin + gx * lonStep;
    const lat = latMax - gy * latStep; // Grid Y is inverted (north to south)
    return [lon, lat];
  };

  // Process each cell
  for (let gy = 0; gy < gridHeight - 1; gy++) {
    for (let gx = 0; gx < gridWidth - 1; gx++) {
      const v00 = grid[gy]?.[gx];
      const v10 = grid[gy]?.[gx + 1];
      const v01 = grid[gy + 1]?.[gx];
      const v11 = grid[gy + 1]?.[gx + 1];

      if (v00 === null || v10 === null || v01 === null || v11 === null) continue;

      // Calculate cell case (0-15) based on which corners are above the level
      let cellCase = 0;
      if (v00 >= level) cellCase |= 1;
      if (v10 >= level) cellCase |= 2;
      if (v11 >= level) cellCase |= 4;
      if (v01 >= level) cellCase |= 8;

      if (cellCase === 0 || cellCase === 15) continue; // No contour crosses this cell

      // Interpolate edge crossings
      const edges: Record<string, [number, number]> = {};

      // Top edge (v00 to v10)
      if ((cellCase & 1) !== (cellCase & 2)) {
        const t = (level - v00) / (v10 - v00);
        edges.top = gridToLatLon(gx + t, gy);
      }
      // Right edge (v10 to v11)
      if ((cellCase & 2) !== (cellCase & 4)) {
        const t = (level - v10) / (v11 - v10);
        edges.right = gridToLatLon(gx + 1, gy + t);
      }
      // Bottom edge (v01 to v11)
      if ((cellCase & 8) !== (cellCase & 4)) {
        const t = (level - v01) / (v11 - v01);
        edges.bottom = gridToLatLon(gx + t, gy + 1);
      }
      // Left edge (v00 to v01)
      if ((cellCase & 1) !== (cellCase & 8)) {
        const t = (level - v00) / (v01 - v00);
        edges.left = gridToLatLon(gx, gy + t);
      }

      // Connect edges based on cell case
      const segments: [string, string][] = [];
      switch (cellCase) {
        case 1: case 14: segments.push(['top', 'left']); break;
        case 2: case 13: segments.push(['top', 'right']); break;
        case 3: case 12: segments.push(['left', 'right']); break;
        case 4: case 11: segments.push(['right', 'bottom']); break;
        case 5:
          // Saddle - ambiguous, use average to decide
          if ((v00 + v11) / 2 >= level) {
            segments.push(['top', 'right'], ['bottom', 'left']);
          } else {
            segments.push(['top', 'left'], ['bottom', 'right']);
          }
          break;
        case 6: case 9: segments.push(['top', 'bottom']); break;
        case 7: case 8: segments.push(['left', 'bottom']); break;
        case 10:
          // Saddle - ambiguous
          if ((v00 + v11) / 2 >= level) {
            segments.push(['top', 'left'], ['bottom', 'right']);
          } else {
            segments.push(['top', 'right'], ['bottom', 'left']);
          }
          break;
      }

      for (const [e1, e2] of segments) {
        if (edges[e1] && edges[e2]) {
          lines.push([edges[e1], edges[e2]]);
        }
      }
    }
  }

  return lines;
}

// Connect line segments into continuous polylines
function connectSegments(segments: number[][][]): number[][][] {
  if (segments.length === 0) return [];

  const polylines: number[][][] = [];
  const used = new Set<number>();
  const epsilon = 0.0001;

  const pointsEqual = (p1: number[], p2: number[]): boolean => {
    return Math.abs(p1[0] - p2[0]) < epsilon && Math.abs(p1[1] - p2[1]) < epsilon;
  };

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const polyline: number[][] = [...segments[i]];
    used.add(i);

    // Try to extend the polyline
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const seg = segments[j];

        // Check if segment connects to end of polyline
        if (pointsEqual(polyline[polyline.length - 1], seg[0])) {
          polyline.push(seg[1]);
          used.add(j);
          extended = true;
        } else if (pointsEqual(polyline[polyline.length - 1], seg[1])) {
          polyline.push(seg[0]);
          used.add(j);
          extended = true;
        }
        // Check if segment connects to start of polyline
        else if (pointsEqual(polyline[0], seg[1])) {
          polyline.unshift(seg[0]);
          used.add(j);
          extended = true;
        } else if (pointsEqual(polyline[0], seg[0])) {
          polyline.unshift(seg[1]);
          used.add(j);
          extended = true;
        }
      }
    }

    if (polyline.length >= 2) {
      polylines.push(polyline);
    }
  }

  return polylines;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ model: string; variable: string }> }
) {
  const { model: modelId, variable } = await params;
  const { searchParams } = new URL(request.url);

  const forecastHour = parseInt(searchParams.get('hour') || '0', 10);
  const bbox = searchParams.get('bbox')?.split(',').map(Number);

  if (!bbox || bbox.length !== 4) {
    return NextResponse.json({ error: 'Missing or invalid bbox parameter' }, { status: 400 });
  }

  const [west, south, east, north] = bbox;

  const model = getModelById(modelId);
  if (!model || !model.openMeteoSupport) {
    return NextResponse.json({ error: 'Model not supported' }, { status: 400 });
  }

  // Determine contour config based on variable
  let contourType = 'temperature';
  if (variable.includes('pressure') || variable === 'pressure_msl' || variable === 'surface_pressure') {
    contourType = 'pressure';
  } else if (variable.includes('geopotential') || variable.includes('height')) {
    contourType = 'heights';
  }
  const config = CONTOUR_CONFIG[contourType];

  try {
    // Fetch grid data for contours (coarser grid is fine for contours)
    const GRID_SIZE = 12;
    const latPadding = (north - south) * 0.1;
    const lonPadding = (east - west) * 0.1;

    const latMin = south - latPadding;
    const latMax = north + latPadding;
    const lonMin = west - lonPadding;
    const lonMax = east + lonPadding;

    const latStep = (latMax - latMin) / (GRID_SIZE - 1);
    const lonStep = (lonMax - lonMin) / (GRID_SIZE - 1);

    // Build coordinate arrays
    const lats: number[] = [];
    const lons: number[] = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        lats.push(latMax - row * latStep);
        lons.push(lonMin + col * lonStep);
      }
    }

    const apiEndpoint = model.openMeteoApiEndpoint || 'forecast';
    const baseUrl = `https://customer-api.open-meteo.com/v1/${apiEndpoint}`;

    // Fetch data
    const latStr = lats.map(l => l.toFixed(4)).join(',');
    const lonStr = lons.map(l => l.toFixed(4)).join(',');
    const url = `${baseUrl}?latitude=${latStr}&longitude=${lonStr}&hourly=${variable}&forecast_hours=${forecastHour + 1}&apikey=${OPEN_METEO_API_KEY}${model.openMeteoModel ? `&models=${model.openMeteoModel}` : ''}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'maxvelocitywx.com' },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
    }

    const data = await response.json();

    // Build grid
    const grid: (number | null)[][] = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      grid[row] = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const idx = row * GRID_SIZE + col;
        let value: number | null = null;

        if (Array.isArray(data)) {
          value = data[idx]?.hourly?.[variable]?.[forecastHour] ?? null;
        } else if (data.hourly && idx === 0) {
          value = data.hourly?.[variable]?.[forecastHour] ?? null;
        }

        // Convert units
        if (value !== null) {
          if (variable.includes('temperature') || variable.includes('dew_point') || variable.includes('apparent')) {
            value = celsiusToFahrenheit(value);
          }
        }

        grid[row][col] = value;
      }
    }

    // Find min/max values for contour levels
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const row of grid) {
      for (const v of row) {
        if (v !== null) {
          minVal = Math.min(minVal, v);
          maxVal = Math.max(maxVal, v);
        }
      }
    }

    if (!isFinite(minVal) || !isFinite(maxVal)) {
      return NextResponse.json({
        type: 'FeatureCollection',
        features: [],
      });
    }

    // Generate contour features
    const features: GeoJSON.Feature[] = [];
    const startLevel = Math.floor(minVal / config.interval) * config.interval;
    const endLevel = Math.ceil(maxVal / config.interval) * config.interval;

    for (let level = startLevel; level <= endLevel; level += config.interval) {
      const segments = marchingSquares(grid, level, latMin, latMax, lonMin, lonMax);
      const polylines = connectSegments(segments);

      for (const coords of polylines) {
        if (coords.length >= 2) {
          features.push({
            type: 'Feature',
            properties: {
              level,
              label: `${level}${config.unit}`,
            },
            geometry: {
              type: 'LineString',
              coordinates: coords,
            },
          });
        }
      }
    }

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error generating contours:', error);
    return NextResponse.json({ error: 'Failed to generate contours' }, { status: 500 });
  }
}
