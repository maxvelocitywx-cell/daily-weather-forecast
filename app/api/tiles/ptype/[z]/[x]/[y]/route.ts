import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

// Cache for tile results (in-memory, short TTL)
const tileCache = new Map<string, { data: Buffer; timestamp: number }>();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// NOAA MRMS endpoints
const MRMS_REFL_URL = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage';
const MRMS_PTYPE_WMS = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_pcpn_typ/ows';

// MRMS Precip Type Categories (from MRMS documentation):
// 0 = No precip
// 1 = Warm stratiform rain (green)
// 3 = Snow (blue/cyan)
// 6 = Convective rain (yellow/orange)
// 7 = Hail (magenta/pink)
// 10 = Cool stratiform rain (light green)
// 91 = Tropical stratiform (teal)
// 96 = Tropical convective (orange)

// Output color palettes for rendering (low -> mid -> high intensity)
// We map MRMS categories to winter-friendly display categories
const PALETTES = {
  snow: [
    [147, 197, 253], // #93C5FD - light snow
    [59, 130, 246],  // #3B82F6 - medium snow
    [30, 64, 175],   // #1E40AF - heavy snow
  ],
  rain: [
    [134, 239, 172], // #86EFAC - light rain
    [34, 197, 94],   // #22C55E - medium rain
    [22, 101, 52],   // #166534 - heavy rain
  ],
  convective: [
    [253, 224, 71],  // #FDE047 - light
    [234, 179, 8],   // #EAB308 - medium
    [161, 98, 7],    // #A16207 - heavy
  ],
  hail: [
    [251, 207, 232], // #FBCFE8 - light
    [236, 72, 153],  // #EC4899 - medium
    [157, 23, 77],   // #9D174D - heavy
  ],
  coolRain: [
    [167, 243, 208], // #A7F3D0 - light (could be transitional/mix zone)
    [52, 211, 153],  // #34D399 - medium
    [6, 95, 70],     // #065F46 - heavy
  ],
  tropical: [
    [254, 215, 170], // #FED7AA - light
    [251, 146, 60],  // #FB923C - medium
    [194, 65, 12],   // #C2410C - heavy
  ],
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

// Interpolate between two colors
function lerpColor(c1: number[], c2: number[], t: number): number[] {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

// Get color from palette based on intensity (0-1)
function getColorFromPalette(palette: number[][], intensity: number): number[] {
  const t = Math.max(0, Math.min(1, intensity));
  if (t <= 0.5) {
    return lerpColor(palette[0], palette[1], t * 2);
  } else {
    return lerpColor(palette[1], palette[2], (t - 0.5) * 2);
  }
}

// Classify precip type from WMS pixel colors
// The MRMS WMS uses specific colors for each category
function classifyPtypeFromWmsColor(r: number, g: number, b: number): { category: string; intensity: number } | null {
  // Skip transparent/near-black pixels
  if (r < 15 && g < 15 && b < 15) return null;

  // Calculate color characteristics
  const max = Math.max(r, g, b);
  const brightness = (r + g + b) / 3 / 255;

  // Snow: predominantly blue/cyan (high blue, lower red/green)
  // MRMS snow is typically rendered in blue/cyan tones
  if (b > 80 && b >= r && b > g * 0.7) {
    // The more saturated the blue, the more confident it's snow
    const blueRatio = b / (r + g + b + 1);
    if (blueRatio > 0.35) {
      return { category: 'snow', intensity: Math.min(1, brightness * 1.5) };
    }
  }

  // Cyan-ish (snow or cool conditions)
  if (g > 100 && b > 100 && r < g && Math.abs(g - b) < 60) {
    return { category: 'snow', intensity: brightness };
  }

  // Hail: magenta/pink (high red and blue, lower green)
  if (r > 100 && b > 80 && r > g * 1.3 && b > g * 0.8) {
    return { category: 'hail', intensity: brightness };
  }

  // Convective: yellow/orange (high red and green, low blue)
  if (r > 150 && g > 100 && b < g * 0.7) {
    return { category: 'convective', intensity: brightness };
  }

  // Orange-ish (tropical or convective)
  if (r > 180 && g > 80 && g < r && b < 100) {
    return { category: 'tropical', intensity: brightness };
  }

  // Cool stratiform rain: teal/cyan-green
  if (g > 120 && b > 80 && r < g && b < g) {
    return { category: 'coolRain', intensity: brightness };
  }

  // Warm stratiform rain: green (high green, lower red/blue)
  if (g > 80 && g > r && g > b) {
    return { category: 'rain', intensity: brightness };
  }

  // Light green (rain)
  if (g > r && g > b && g > 60) {
    return { category: 'rain', intensity: brightness };
  }

  // Fallback: if there's significant color, treat as rain
  if (max > 60) {
    return { category: 'rain', intensity: brightness };
  }

  return null;
}

// Get intensity multiplier from reflectivity colors
function getReflIntensity(r: number, g: number, b: number, a: number): number {
  if (a < 20) return 0;

  // MRMS reflectivity uses a standard color ramp:
  // Low dBZ: greens/blues
  // Mid dBZ: yellows/oranges
  // High dBZ: reds/magentas/white
  const brightness = (r + g + b) / 3 / 255;

  // Reds and magentas indicate highest reflectivity
  if (r > 200 && g < 100) {
    return Math.min(1, 0.8 + brightness * 0.2);
  }

  // Oranges/yellows indicate moderate-high reflectivity
  if (r > 180 && g > 100 && b < 100) {
    return 0.5 + brightness * 0.3;
  }

  // Greens indicate lower reflectivity
  if (g > r && g > b) {
    return 0.2 + brightness * 0.3;
  }

  return brightness;
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'maxvelocitywx.com (contact@maxvelocitywx.com)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
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
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z: zStr, x: xStr, y: yStr } = await params;
  const z = parseInt(zStr, 10);
  const x = parseInt(xStr, 10);
  const y = parseInt(yStr, 10);

  const { searchParams } = new URL(request.url);
  const time = searchParams.get('time') || new Date().toISOString();

  // Check cache
  const cacheKey = `ptype/${z}/${x}/${y}/${time}`;
  const cached = tileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return new NextResponse(new Uint8Array(cached.data), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=180',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Compute bbox for this tile
  const bbox = tileToBbox(z, x, y);
  const bboxStr = bbox.join(',');

  // Parse time for MRMS (Unix timestamp in ms)
  const timeMs = new Date(time).getTime();

  // Build URLs
  const reflUrl = `${MRMS_REFL_URL}?bbox=${bboxStr}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&time=${timeMs}&f=image`;

  const ptypeParams = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.1.1',
    layers: 'conus_pcpn_typ',
    styles: '',
    format: 'image/png',
    transparent: 'true',
    srs: 'EPSG:3857',
    width: '256',
    height: '256',
    bbox: bboxStr,
  });
  const ptypeUrl = `${MRMS_PTYPE_WMS}?${ptypeParams.toString()}`;

  // Fetch both images in parallel
  const [reflBuffer, ptypeBuffer] = await Promise.all([
    fetchImage(reflUrl),
    fetchImage(ptypeUrl),
  ]);

  // If we don't have p-type data, return transparent tile
  if (!ptypeBuffer) {
    const transparent = await createTransparentTile();
    return new NextResponse(new Uint8Array(transparent), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    // Decode p-type image
    const ptypeImage = sharp(ptypeBuffer);
    const ptypeMeta = await ptypeImage.metadata();
    const ptypeRaw = await ptypeImage.ensureAlpha().raw().toBuffer();

    // Decode reflectivity image if available
    let reflRaw: Buffer | null = null;
    let reflChannels = 4;
    if (reflBuffer) {
      const reflImage = sharp(reflBuffer);
      const reflMeta = await reflImage.metadata();
      reflRaw = await reflImage.ensureAlpha().raw().toBuffer();
      reflChannels = reflMeta.channels || 4;
    }

    const width = ptypeMeta.width || 256;
    const height = ptypeMeta.height || 256;

    // Create output buffer (RGBA)
    const outputBuffer = Buffer.alloc(width * height * 4);

    // Process each pixel
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4; // Always 4 channels after ensureAlpha

      // Get p-type pixel
      const ptypeR = ptypeRaw[idx];
      const ptypeG = ptypeRaw[idx + 1];
      const ptypeB = ptypeRaw[idx + 2];
      const ptypeA = ptypeRaw[idx + 3];

      // Skip transparent pixels
      if (ptypeA < 20) {
        outputBuffer[idx] = 0;
        outputBuffer[idx + 1] = 0;
        outputBuffer[idx + 2] = 0;
        outputBuffer[idx + 3] = 0;
        continue;
      }

      // Classify precip type from WMS color
      const classification = classifyPtypeFromWmsColor(ptypeR, ptypeG, ptypeB);

      if (!classification) {
        outputBuffer[idx] = 0;
        outputBuffer[idx + 1] = 0;
        outputBuffer[idx + 2] = 0;
        outputBuffer[idx + 3] = 0;
        continue;
      }

      // Get intensity from reflectivity if available
      let intensity = classification.intensity;
      if (reflRaw) {
        const reflIdx = i * (reflChannels >= 4 ? 4 : reflChannels);
        const reflR = reflRaw[reflIdx] || 0;
        const reflG = reflRaw[reflIdx + 1] || 0;
        const reflB = reflRaw[reflIdx + 2] || 0;
        const reflA = reflChannels >= 4 ? (reflRaw[reflIdx + 3] || 0) : 255;

        if (reflA > 20) {
          // Blend p-type intensity with reflectivity
          const reflInt = getReflIntensity(reflR, reflG, reflB, reflA);
          intensity = Math.max(intensity, reflInt);
        }
      }

      // Ensure minimum visibility
      intensity = Math.max(0.25, Math.min(1, intensity));

      // Get color from appropriate palette
      const palette = PALETTES[classification.category as keyof typeof PALETTES] || PALETTES.rain;
      const color = getColorFromPalette(palette, intensity);

      // Set alpha based on intensity (more intense = more opaque)
      const alpha = Math.round(Math.min(255, 140 + intensity * 100));

      outputBuffer[idx] = color[0];
      outputBuffer[idx + 1] = color[1];
      outputBuffer[idx + 2] = color[2];
      outputBuffer[idx + 3] = alpha;
    }

    // Encode output PNG
    const outputPng = await sharp(outputBuffer, {
      raw: {
        width,
        height,
        channels: 4,
      },
    }).png().toBuffer();

    // Cache the result
    tileCache.set(cacheKey, { data: outputPng, timestamp: Date.now() });

    // Clean old cache entries periodically
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
        'Cache-Control': 'public, max-age=180',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error processing p-type tile:', error);

    // Return transparent tile on error
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
