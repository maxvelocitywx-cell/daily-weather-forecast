import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Tile size
const TILE_SIZE = 256;

// NOAA MapServer export endpoint
// Layer IDs: 1 = Day 1 Overall, 2 = Day 2 Overall, 3 = Day 3 Overall
const MAPSERVER_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';

// Layer IDs for Overall Impact
const WSSI_LAYER_IDS: Record<number, string> = {
  1: '1',  // Overall_Impact_Day_1
  2: '2',  // Overall_Impact_Day_2
  3: '3',  // Overall_Impact_Day_3
};

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

// In-memory cache for tiles (per-instance, cleared on cold start)
const tileCache = new Map<string, { data: Buffer; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  // Check in-memory cache
  const cacheKey = `${day}:${z}:${x}:${y}`;
  const cached = tileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return new NextResponse(new Uint8Array(cached.data), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'Access-Control-Allow-Origin': '*',
        'X-WSSI-Cached': 'memory',
      },
    });
  }

  // Get tile bbox in Web Mercator
  const bbox = tileToBbox(z, x, y);
  const bboxStr = bbox.join(',');

  // Get layer ID for this day
  const layerId = WSSI_LAYER_IDS[day];

  // Build export URL - request image from NOAA MapServer
  // Use a larger size and downsample for smoother results
  const exportSize = TILE_SIZE * 2; // 512px, then downsample to 256
  const exportUrl = new URL(`${MAPSERVER_BASE}/export`);
  exportUrl.searchParams.set('bbox', bboxStr);
  exportUrl.searchParams.set('bboxSR', '3857');
  exportUrl.searchParams.set('imageSR', '3857');
  exportUrl.searchParams.set('size', `${exportSize},${exportSize}`);
  exportUrl.searchParams.set('format', 'png32');
  exportUrl.searchParams.set('transparent', 'true');
  exportUrl.searchParams.set('layers', `show:${layerId}`);
  exportUrl.searchParams.set('f', 'image');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(exportUrl.toString(), {
      headers: {
        'User-Agent': 'maxvelocitywx.com',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[WSSI-Tile] NOAA export error: ${response.status}`);
      const transparent = await createTransparentTile();
      return new NextResponse(new Uint8Array(transparent), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Process with sharp: resize down and apply slight blur for smoothing
    let image = sharp(inputBuffer);

    // Resize to tile size with high-quality downsampling
    image = image.resize(TILE_SIZE, TILE_SIZE, {
      kernel: 'lanczos3',
    });

    // Apply slight blur for edge smoothing (sigma 0.5-1.0)
    image = image.blur(0.8);

    const outputBuffer = await image.png().toBuffer();

    // Cache the result
    tileCache.set(cacheKey, { data: outputBuffer, timestamp: Date.now() });

    // Clean old cache entries occasionally
    if (Math.random() < 0.05) {
      const now = Date.now();
      for (const [key, value] of tileCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          tileCache.delete(key);
        }
      }
    }

    return new NextResponse(new Uint8Array(outputBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'Access-Control-Allow-Origin': '*',
        'X-WSSI-Day': String(day),
      },
    });
  } catch (error) {
    console.error('[WSSI-Tile] Error:', error);

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
