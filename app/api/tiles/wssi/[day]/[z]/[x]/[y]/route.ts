import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { kv } from '@vercel/kv';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Tile size for rendering
const TILE_SIZE = 256;

// Gaussian blur sigma in pixels (adjusted per zoom level for ~25 mile smoothing)
// At zoom 0, 1 pixel ≈ 156 km, at zoom 4, 1 pixel ≈ 9.8 km
// 25 miles ≈ 40 km
const BASE_BLUR_KM = 40; // 25 miles in km

// WSSI severity colors with smooth gradient-friendly opacity
const WSSI_COLORS: Record<string, { r: number; g: number; b: number; priority: number }> = {
  elevated: { r: 96, g: 165, b: 250, priority: 1 },  // #60A5FA - Marginal
  minor: { r: 37, g: 99, b: 235, priority: 2 },      // #2563EB - Slight
  moderate: { r: 124, g: 58, b: 237, priority: 3 },  // #7C3AED - Enhanced
  major: { r: 162, g: 28, b: 175, priority: 4 },     // #A21CAF - Moderate
  extreme: { r: 220, g: 38, b: 38, priority: 5 },    // #DC2626 - High
};

// Priority order for rendering (higher = on top)
const PRIORITY_ORDER = ['elevated', 'minor', 'moderate', 'major', 'extreme'];

// ArcGIS MapServer for WSSI
const MAPSERVER_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';
const WSSI_LAYER_IDS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
};

// KV cache settings
const KV_RAW_TTL = 10 * 60; // 10 minutes for raw data
const KV_TILE_TTL = 5 * 60; // 5 minutes for rendered tiles

// Convert tile coordinates to Web Mercator bbox
function tileToBbox(z: number, x: number, y: number): [number, number, number, number] {
  const n = Math.pow(2, z);
  const tileSize = 20037508.34 * 2 / n;

  const minX = -20037508.34 + x * tileSize;
  const maxX = minX + tileSize;
  const maxY = 20037508.34 - y * tileSize;
  const minY = maxY - tileSize;

  return [minX, minY, maxX, maxY];
}

// Convert tile bbox to WGS84 for query
function bboxToWGS84(bbox: [number, number, number, number]): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = bbox;

  // Web Mercator to WGS84
  const toWGS84 = (x: number, y: number): [number, number] => {
    const lon = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
    return [lon, lat];
  };

  const [minLon, minLat] = toWGS84(minX, minY);
  const [maxLon, maxLat] = toWGS84(maxX, maxY);

  return [minLon, minLat, maxLon, maxLat];
}

// Get km per pixel at given zoom level
function getKmPerPixel(z: number): number {
  // At zoom 0, world is 256 pixels wide, circumference ~40075 km
  // km per pixel = 40075 / (256 * 2^z)
  return 40075 / (256 * Math.pow(2, z));
}

// Calculate blur sigma in pixels for target km
function getBlurSigma(z: number, targetKm: number = BASE_BLUR_KM): number {
  const kmPerPixel = getKmPerPixel(z);
  // Sigma in pixels = target km / km per pixel
  // Clamp between 1 and 30 to keep blur reasonable
  return Math.max(1, Math.min(30, targetKm / kmPerPixel));
}

// Extract WSSI category from feature properties
function extractCategory(properties: Record<string, unknown>): string | null {
  const possibleProps = ['impact', 'idp_wssilabel', 'label', 'Label', 'LABEL', 'name', 'Name'];

  for (const prop of possibleProps) {
    if (properties[prop]) {
      const value = String(properties[prop]).toLowerCase().trim();

      if (value === 'extreme' || value === 'extreme impacts') return 'extreme';
      if (value === 'major' || value === 'major impacts') return 'major';
      if (value === 'moderate' || value === 'moderate impacts') return 'moderate';
      if (value === 'minor' || value === 'minor impacts') return 'minor';
      if (value === 'elevated' || value === 'winter weather area') return 'elevated';

      if (value.includes('extreme')) return 'extreme';
      if (value.includes('major')) return 'major';
      if (value.includes('moderate')) return 'moderate';
      if (value.includes('minor')) return 'minor';
      if (value.includes('elevated') || value.includes('winter weather')) return 'elevated';
    }
  }

  return null;
}

// Fetch raw WSSI data from NOAA with caching
async function fetchWSSIData(day: number): Promise<FeatureCollection | null> {
  const cacheKey = `wssi:raw:${day}`;

  // Try KV cache first
  try {
    const cached = await kv.get<FeatureCollection>(cacheKey);
    if (cached) {
      console.log(`[WSSI-Tile] Cache hit for raw data day ${day}`);
      return cached;
    }
  } catch (e) {
    console.warn('[WSSI-Tile] KV get error:', e);
  }

  const layerId = WSSI_LAYER_IDS[day];
  if (!layerId) return null;

  const queryUrl = `${MAPSERVER_BASE}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&returnGeometry=true`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(queryUrl, {
      headers: { 'User-Agent': 'maxvelocitywx.com' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[WSSI-Tile] NOAA API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as FeatureCollection;

    // Cache the raw data
    try {
      await kv.set(cacheKey, data, { ex: KV_RAW_TTL });
    } catch (e) {
      console.warn('[WSSI-Tile] KV set error:', e);
    }

    return data;
  } catch (e) {
    console.error('[WSSI-Tile] Fetch error:', e);
    return null;
  }
}

// Check if a point is inside a polygon ring using ray casting
function pointInRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Check if a point is inside a polygon (with holes)
function pointInPolygon(x: number, y: number, coords: Position[][]): boolean {
  // Must be inside outer ring
  if (!pointInRing(x, y, coords[0])) {
    return false;
  }
  // Must be outside all holes
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(x, y, coords[i])) {
      return false;
    }
  }
  return true;
}

// Check if a point is inside a MultiPolygon
function pointInMultiPolygon(x: number, y: number, coords: Position[][][]): boolean {
  for (const polygon of coords) {
    if (pointInPolygon(x, y, polygon)) {
      return true;
    }
  }
  return false;
}

// Rasterize features to a grid
function rasterizeFeatures(
  features: Feature[],
  bbox: [number, number, number, number],
  width: number,
  height: number
): Uint8Array {
  // Priority grid - stores highest priority category at each pixel (0 = none)
  const grid = new Uint8Array(width * height);

  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonStep = (maxLon - minLon) / width;
  const latStep = (maxLat - minLat) / height;

  // Group features by category for priority ordering
  const featuresByCategory: Record<string, Feature[]> = {};
  for (const feature of features) {
    if (!feature.geometry) continue;
    const geom = feature.geometry;
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;

    const category = extractCategory((feature.properties || {}) as Record<string, unknown>);
    if (!category || !WSSI_COLORS[category]) continue;

    if (!featuresByCategory[category]) {
      featuresByCategory[category] = [];
    }
    featuresByCategory[category].push(feature);
  }

  // Rasterize in priority order (lower priority first, so higher overwrites)
  for (const category of PRIORITY_ORDER) {
    const catFeatures = featuresByCategory[category];
    if (!catFeatures) continue;

    const priority = WSSI_COLORS[category].priority;

    for (const feature of catFeatures) {
      const geom = feature.geometry as Polygon | MultiPolygon;

      // Check each pixel
      for (let py = 0; py < height; py++) {
        const lat = maxLat - (py + 0.5) * latStep; // Note: Y is inverted

        for (let px = 0; px < width; px++) {
          const lon = minLon + (px + 0.5) * lonStep;
          const idx = py * width + px;

          // Only update if this category has higher priority
          if (grid[idx] >= priority) continue;

          let inside = false;
          if (geom.type === 'Polygon') {
            inside = pointInPolygon(lon, lat, geom.coordinates);
          } else {
            inside = pointInMultiPolygon(lon, lat, geom.coordinates);
          }

          if (inside) {
            grid[idx] = priority;
          }
        }
      }
    }
  }

  return grid;
}

// Create transparent tile
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

// Render priority grid to RGBA buffer with smooth colors
function renderGridToRGBA(
  grid: Uint8Array,
  width: number,
  height: number
): Buffer {
  const rgba = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const priority = grid[i];
    const idx = i * 4;

    if (priority === 0) {
      // Transparent
      rgba[idx] = 0;
      rgba[idx + 1] = 0;
      rgba[idx + 2] = 0;
      rgba[idx + 3] = 0;
    } else {
      // Find category by priority
      const category = PRIORITY_ORDER[priority - 1];
      const color = WSSI_COLORS[category];

      rgba[idx] = color.r;
      rgba[idx + 1] = color.g;
      rgba[idx + 2] = color.b;
      rgba[idx + 3] = 180; // Semi-transparent for overlay
    }
  }

  return rgba;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ day: string; z: string; x: string; y: string }> }
) {
  const { day: dayStr, z: zStr, x: xStr, y: yStr } = await params;
  const day = parseInt(dayStr, 10);
  const z = parseInt(zStr, 10);
  const x = parseInt(xStr, 10);
  const y = parseInt(yStr, 10);

  // Validate parameters
  if (isNaN(day) || day < 1 || day > 3) {
    return new NextResponse('Invalid day', { status: 400 });
  }
  if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || z > 12) {
    return new NextResponse('Invalid tile coordinates', { status: 400 });
  }

  // Check tile cache
  const tileCacheKey = `wssi:tile:${day}:${z}:${x}:${y}`;
  try {
    const cached = await kv.get<string>(tileCacheKey);
    if (cached) {
      const buffer = Buffer.from(cached, 'base64');
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=300, s-maxage=600',
          'Access-Control-Allow-Origin': '*',
          'X-WSSI-Cached': 'true',
        },
      });
    }
  } catch (e) {
    console.warn('[WSSI-Tile] KV tile cache error:', e);
  }

  // Get tile bbox
  const mercatorBbox = tileToBbox(z, x, y);
  const wgs84Bbox = bboxToWGS84(mercatorBbox);

  // Calculate render size - higher resolution for better blur quality
  // At low zoom, use larger render size for smoother results
  const renderScale = z < 4 ? 4 : z < 6 ? 2 : 1;
  const renderSize = TILE_SIZE * renderScale;

  // Fetch WSSI data
  const data = await fetchWSSIData(day);

  if (!data || !data.features || data.features.length === 0) {
    const transparent = await createTransparentTile();
    return new NextResponse(new Uint8Array(transparent), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Expand bbox slightly for blur edge handling (prevents hard edges at tile boundaries)
  const blurSigma = getBlurSigma(z);
  const expandFactor = blurSigma * 2 / renderSize; // Expand by blur radius
  const lonRange = wgs84Bbox[2] - wgs84Bbox[0];
  const latRange = wgs84Bbox[3] - wgs84Bbox[1];
  const expandedBbox: [number, number, number, number] = [
    wgs84Bbox[0] - lonRange * expandFactor,
    wgs84Bbox[1] - latRange * expandFactor,
    wgs84Bbox[2] + lonRange * expandFactor,
    wgs84Bbox[3] + latRange * expandFactor,
  ];

  // Calculate expanded render size
  const expandedSize = Math.ceil(renderSize * (1 + expandFactor * 2));

  try {
    // Rasterize features to priority grid
    const grid = rasterizeFeatures(data.features, expandedBbox, expandedSize, expandedSize);

    // Render to RGBA
    const rgba = renderGridToRGBA(grid, expandedSize, expandedSize);

    // Create sharp image and apply Gaussian blur
    let image = sharp(rgba, {
      raw: {
        width: expandedSize,
        height: expandedSize,
        channels: 4,
      },
    });

    // Apply Gaussian blur for smooth edges
    // Sigma determines blur radius - larger = smoother
    if (blurSigma > 0.5) {
      image = image.blur(blurSigma);
    }

    // Crop back to original tile bounds (remove expanded edges)
    const cropOffset = Math.floor((expandedSize - renderSize) / 2);
    image = image.extract({
      left: cropOffset,
      top: cropOffset,
      width: renderSize,
      height: renderSize,
    });

    // Resize to tile size if we rendered at higher resolution
    if (renderScale > 1) {
      image = image.resize(TILE_SIZE, TILE_SIZE, {
        kernel: 'lanczos3', // High quality downscaling
      });
    }

    // Output as PNG
    const png = await image.png().toBuffer();

    // Cache the tile
    try {
      await kv.set(tileCacheKey, png.toString('base64'), { ex: KV_TILE_TTL });
    } catch (e) {
      console.warn('[WSSI-Tile] KV tile set error:', e);
    }

    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'Access-Control-Allow-Origin': '*',
        'X-WSSI-Day': String(day),
        'X-WSSI-Blur': String(blurSigma.toFixed(2)),
      },
    });
  } catch (error) {
    console.error('[WSSI-Tile] Render error:', error);

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
