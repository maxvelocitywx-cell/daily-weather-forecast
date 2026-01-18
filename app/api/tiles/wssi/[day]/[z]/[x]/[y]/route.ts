import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Tile size - use lower resolution for smoother appearance
const TILE_SIZE = 256;

// NOAA MapServer export endpoint
const MAPSERVER_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';

// Layer IDs for Overall Impact
const WSSI_LAYER_IDS: Record<number, string> = {
  1: '1',  // Overall_Impact_Day_1
  2: '2',  // Overall_Impact_Day_2
  3: '3',  // Overall_Impact_Day_3
};

// Our target colors (must match client legend)
// Marginal: #60A5FA (96, 165, 250)
// Slight: #2563EB (37, 99, 235)
// Enhanced: #7C3AED (124, 58, 237)
// Moderate: #A21CAF (162, 28, 175)
// High: #DC2626 (220, 38, 38)
const TARGET_COLORS = {
  elevated: { r: 96, g: 165, b: 250 },   // Marginal - light blue
  minor: { r: 37, g: 99, b: 235 },       // Slight - blue
  moderate: { r: 124, g: 58, b: 237 },   // Enhanced - purple
  major: { r: 162, g: 28, b: 175 },      // Moderate - magenta
  extreme: { r: 220, g: 38, b: 38 },     // High - red
};

// NOAA's approximate colors (we'll match these and remap)
// These are approximate - NOAA uses a color ramp
// Elevated: light green/cyan
// Minor: green
// Moderate: yellow/gold
// Major: orange
// Extreme: red/magenta

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

// Classify NOAA color to our category
function classifyNoaaColor(r: number, g: number, b: number): keyof typeof TARGET_COLORS | null {
  // Skip transparent/near-black pixels
  if (r < 20 && g < 20 && b < 20) return null;

  // NOAA uses these approximate colors:
  // Elevated: #90EE90 or similar light green/cyan (high G, moderate R, low-moderate B)
  // Minor: #008000 or similar green (low R, high G, low B)
  // Moderate: #FFD700 or similar yellow/gold (high R, high G, low B)
  // Major: #FFA500 or similar orange (high R, moderate G, low B)
  // Extreme: #FF0000 or similar red (high R, low G, low B)

  // Calculate color characteristics
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  // Skip very dark colors
  if (max < 50) return null;

  // Red dominant (extreme) - high R, low G and B
  if (r > 180 && g < 100 && b < 100) {
    return 'extreme';
  }

  // Orange (major) - high R, moderate G, low B
  if (r > 180 && g > 80 && g < 180 && b < 100) {
    return 'major';
  }

  // Yellow/Gold (moderate) - high R, high G, low B
  if (r > 180 && g > 180 && b < 120) {
    return 'moderate';
  }

  // Pure green (minor) - low R, high G, low B
  if (r < 100 && g > 100 && b < 100) {
    return 'minor';
  }

  // Light green/cyan (elevated) - moderate-high R, high G, moderate B
  // Or any other greenish color
  if (g > r && g > b && g > 80) {
    return 'elevated';
  }

  // Magenta/pink (could be extreme too)
  if (r > 150 && b > 100 && g < 100) {
    return 'extreme';
  }

  // Default: if there's significant color, treat as elevated
  if (max > 80) {
    return 'elevated';
  }

  return null;
}

// Remap NOAA colors to our color scheme
function remapColors(inputBuffer: Buffer, width: number, height: number): Buffer {
  const outputBuffer = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const r = inputBuffer[idx];
    const g = inputBuffer[idx + 1];
    const b = inputBuffer[idx + 2];
    const a = inputBuffer[idx + 3];

    // Skip transparent pixels
    if (a < 30) {
      outputBuffer[idx] = 0;
      outputBuffer[idx + 1] = 0;
      outputBuffer[idx + 2] = 0;
      outputBuffer[idx + 3] = 0;
      continue;
    }

    const category = classifyNoaaColor(r, g, b);

    if (!category) {
      outputBuffer[idx] = 0;
      outputBuffer[idx + 1] = 0;
      outputBuffer[idx + 2] = 0;
      outputBuffer[idx + 3] = 0;
      continue;
    }

    const targetColor = TARGET_COLORS[category];
    outputBuffer[idx] = targetColor.r;
    outputBuffer[idx + 1] = targetColor.g;
    outputBuffer[idx + 2] = targetColor.b;
    outputBuffer[idx + 3] = 200; // Semi-transparent
  }

  return outputBuffer;
}

// In-memory cache for tiles
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

  // Build export URL - request larger image for better quality after blur
  const exportSize = 512; // Fetch at 512, process, then resize to 256
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

    // Decode PNG to raw RGBA
    const decoded = await sharp(inputBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Remap NOAA colors to our color scheme
    const remapped = remapColors(decoded.data, decoded.info.width, decoded.info.height);

    // Create sharp image from remapped data
    let image = sharp(remapped, {
      raw: {
        width: decoded.info.width,
        height: decoded.info.height,
        channels: 4,
      },
    });

    // Apply strong Gaussian blur for smooth edges (higher sigma = more blur)
    // Sigma of 3-5 gives nice smooth edges
    image = image.blur(4);

    // Resize down to tile size with high-quality downsampling
    image = image.resize(TILE_SIZE, TILE_SIZE, {
      kernel: 'lanczos3',
    });

    // Apply another slight blur after resize
    image = image.blur(1.5);

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
