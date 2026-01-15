import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

// Cache for tile results (in-memory, short TTL)
const tileCache = new Map<string, { data: Buffer; timestamp: number }>();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// NOAA MRMS endpoints
const MRMS_REFL_URL = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage';
const MRMS_PTYPE_WMS = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_pcpn_typ/ows';

// Precip type categories from MRMS (approximate values)
// 0 = no precip, 1 = warm rain, 2 = snow, 3 = ice/ZR, 4 = sleet, 5 = hail, 6 = big drops, etc.
// The WMS colors typically: green=rain, blue=snow, pink=mix, purple=freezing, etc.

// Color palettes for p-type (low -> mid -> high intensity)
const PALETTES = {
  snow: [
    [147, 197, 253], // #93C5FD - light
    [37, 99, 235],   // #2563EB - medium
    [30, 58, 138],   // #1E3A8A - heavy
  ],
  mix: [
    [251, 207, 232], // #FBCFE8 - light
    [244, 114, 182], // #F472B6 - medium
    [190, 24, 93],   // #BE185D - heavy
  ],
  freezingRain: [
    [221, 214, 254], // #DDD6FE - light
    [139, 92, 246],  // #8B5CF6 - medium
    [109, 40, 217],  // #6D28D9 - heavy
  ],
  sleet: [
    [233, 213, 255], // #E9D5FF - light
    [192, 132, 252], // #C084FC - medium
    [126, 34, 206],  // #7E22CE - heavy
  ],
  rain: [
    [187, 247, 208], // #BBF7D0 - light
    [34, 197, 94],   // #22C55E - medium
    [21, 128, 61],   // #15803D - heavy
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
  if (intensity <= 0.5) {
    return lerpColor(palette[0], palette[1], intensity * 2);
  } else {
    return lerpColor(palette[1], palette[2], (intensity - 0.5) * 2);
  }
}

// Classify p-type pixel color to category
function classifyPtypeColor(r: number, g: number, b: number): string | null {
  // Skip transparent/black pixels
  if (r === 0 && g === 0 && b === 0) return null;
  if (r < 10 && g < 10 && b < 10) return null;

  // Detect p-type from WMS colors (approximate heuristics)
  // These values are based on typical MRMS p-type WMS rendering

  // Snow: blue-ish (high blue, low-mid red/green)
  if (b > 100 && b > r && b > g * 0.8) {
    return 'snow';
  }

  // Rain: green-ish (high green)
  if (g > 80 && g > r && g > b) {
    return 'rain';
  }

  // Mix: pink/magenta (high red, high blue, lower green)
  if (r > 100 && b > 80 && r > g && b > g * 0.7) {
    // Could be mix or freezing rain - distinguish by ratio
    if (b > r * 0.9) {
      return 'freezingRain'; // More purple
    }
    return 'mix'; // More pink
  }

  // Sleet: lavender/light purple
  if (r > 150 && b > 150 && g > 100 && Math.abs(r - b) < 50) {
    return 'sleet';
  }

  // Freezing rain: purple (high blue, moderate red, low green)
  if (b > 100 && r > 80 && g < r && b > g) {
    return 'freezingRain';
  }

  // Default to rain if we have some color
  if (r > 50 || g > 50 || b > 50) {
    return 'rain';
  }

  return null;
}

// Get intensity from reflectivity pixel (grayscale approximation)
function getReflIntensity(r: number, g: number, b: number, a: number): number {
  if (a < 10) return 0;

  // Reflectivity tiles use a color ramp. We'll approximate intensity from brightness
  // and color characteristics
  const brightness = (r + g + b) / 3 / 255;

  // Higher reflectivity often shows warmer colors (yellow/orange/red)
  // Lower shows cooler (green/blue)
  let intensity = brightness;

  // Boost for warmer colors (indicates higher dBZ)
  if (r > g && r > b) {
    intensity = Math.min(1, intensity * 1.3);
  }

  return Math.min(1, Math.max(0, intensity));
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'maxvelocitywx.com (contact@maxvelocitywx.com)',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return null;
  }
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
  const cacheKey = `${z}/${x}/${y}/${time}`;
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

  // Fetch reflectivity tile
  const reflUrl = `${MRMS_REFL_URL}?bbox=${bboxStr}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&time=${timeMs}&f=image`;

  // Fetch p-type tile from WMS
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
    time: time,
  });
  const ptypeUrl = `${MRMS_PTYPE_WMS}?${ptypeParams.toString()}`;

  // Fetch both images in parallel
  const [reflBuffer, ptypeBuffer] = await Promise.all([
    fetchImage(reflUrl),
    fetchImage(ptypeUrl),
  ]);

  // If we don't have p-type data, return transparent
  if (!ptypeBuffer) {
    const transparent = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toBuffer();

    return new NextResponse(new Uint8Array(transparent), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    // Decode images
    const ptypeImage = sharp(ptypeBuffer);
    const ptypeMeta = await ptypeImage.metadata();
    const ptypeRaw = await ptypeImage.raw().toBuffer();

    let reflRaw: Buffer | null = null;
    if (reflBuffer) {
      const reflImage = sharp(reflBuffer);
      reflRaw = await reflImage.raw().toBuffer();
    }

    const width = ptypeMeta.width || 256;
    const height = ptypeMeta.height || 256;
    const channels = ptypeMeta.channels || 4;

    // Create output buffer
    const outputBuffer = Buffer.alloc(width * height * 4);

    // Process each pixel
    for (let i = 0; i < width * height; i++) {
      const ptypeIdx = i * channels;
      const outputIdx = i * 4;

      // Get p-type pixel
      const ptypeR = ptypeRaw[ptypeIdx];
      const ptypeG = ptypeRaw[ptypeIdx + 1];
      const ptypeB = ptypeRaw[ptypeIdx + 2];
      const ptypeA = channels === 4 ? ptypeRaw[ptypeIdx + 3] : 255;

      // Skip transparent pixels
      if (ptypeA < 10) {
        outputBuffer[outputIdx] = 0;
        outputBuffer[outputIdx + 1] = 0;
        outputBuffer[outputIdx + 2] = 0;
        outputBuffer[outputIdx + 3] = 0;
        continue;
      }

      // Classify precip type
      const ptypeCategory = classifyPtypeColor(ptypeR, ptypeG, ptypeB);

      if (!ptypeCategory) {
        outputBuffer[outputIdx] = 0;
        outputBuffer[outputIdx + 1] = 0;
        outputBuffer[outputIdx + 2] = 0;
        outputBuffer[outputIdx + 3] = 0;
        continue;
      }

      // Get intensity from reflectivity or fall back to p-type brightness
      let intensity = 0.5; // Default medium intensity

      if (reflRaw) {
        const reflR = reflRaw[ptypeIdx];
        const reflG = reflRaw[ptypeIdx + 1];
        const reflB = reflRaw[ptypeIdx + 2];
        const reflA = channels === 4 ? reflRaw[ptypeIdx + 3] : 255;
        intensity = getReflIntensity(reflR, reflG, reflB, reflA);
      } else {
        // Use p-type color brightness as fallback
        intensity = (ptypeR + ptypeG + ptypeB) / 3 / 255;
      }

      // Ensure minimum visibility
      intensity = Math.max(0.2, intensity);

      // Get color from palette
      const palette = PALETTES[ptypeCategory as keyof typeof PALETTES] || PALETTES.rain;
      const color = getColorFromPalette(palette, intensity);

      // Calculate alpha based on intensity
      const alpha = Math.round(Math.min(255, Math.max(100, intensity * 255 * 0.8)));

      outputBuffer[outputIdx] = color[0];
      outputBuffer[outputIdx + 1] = color[1];
      outputBuffer[outputIdx + 2] = color[2];
      outputBuffer[outputIdx + 3] = alpha;
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

    // Clean old cache entries
    const now = Date.now();
    for (const [key, value] of tileCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        tileCache.delete(key);
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
    const transparent = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toBuffer();

    return new NextResponse(new Uint8Array(transparent), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=30',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
