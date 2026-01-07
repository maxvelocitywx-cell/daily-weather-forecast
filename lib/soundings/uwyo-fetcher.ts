// University of Wyoming Sounding Data Fetcher
// Fetches upper air soundings from weather.uwyo.edu
// This is the primary source for near-real-time sounding data

import { Sounding, SoundingLevel, CacheEntry, CACHE_TTL } from './types';
import { getStationById } from './stations';

// In-memory cache for sounding data
const soundingCache: Map<string, CacheEntry<Sounding>> = new Map();

// UWyo region codes for US stations
const UWYO_REGION = 'naconf'; // North America

// Parse UWyo HTML response into sounding data
function parseUWyoHTML(html: string, stationId: string): Sounding | null {
  try {
    // Extract the data table from HTML
    // UWyo returns data in <PRE> tags with fixed-width format
    const preMatch = html.match(/<PRE>([\s\S]*?)<\/PRE>/i);
    if (!preMatch) {
      console.error('No PRE tag found in UWyo response');
      return null;
    }

    const preContent = preMatch[1];
    const lines = preContent.split('\n');

    // Find station info line (contains lat/lon/elev)
    // Format: "Station number: 72351"
    // "Observation time: 231212/0000"
    // "Station latitude: 35.22"
    // etc.
    let stationName = '';
    let lat = 0;
    let lon = 0;
    let elevation = 0;
    let obsTime = '';

    for (const line of lines) {
      if (line.includes('Station identifier:')) {
        // This line might have the ID
      }
      if (line.includes('Observation time:')) {
        const match = line.match(/Observation time:\s*(\d{6}\/\d{4})/);
        if (match) {
          // Format: YYMMDD/HHMM -> convert to ISO
          const dateStr = match[1];
          const yy = parseInt(dateStr.slice(0, 2));
          const mm = dateStr.slice(2, 4);
          const dd = dateStr.slice(4, 6);
          const hh = dateStr.slice(7, 9);
          const min = dateStr.slice(9, 11);
          const year = yy > 50 ? 1900 + yy : 2000 + yy;
          obsTime = `${year}-${mm}-${dd}T${hh}:${min}:00Z`;
        }
      }
      if (line.includes('Station latitude:')) {
        const match = line.match(/Station latitude:\s*([-\d.]+)/);
        if (match) lat = parseFloat(match[1]);
      }
      if (line.includes('Station longitude:')) {
        const match = line.match(/Station longitude:\s*([-\d.]+)/);
        if (match) lon = parseFloat(match[1]);
      }
      if (line.includes('Station elevation:')) {
        const match = line.match(/Station elevation:\s*([\d.]+)/);
        if (match) elevation = parseFloat(match[1]);
      }
    }

    // Get station info from our database
    const station = getStationById(stationId);
    if (station) {
      stationName = station.name;
      if (!lat) lat = station.lat;
      if (!lon) lon = station.lon;
      if (!elevation) elevation = station.elevation_m;
    }

    // Find the data header line
    // Format: PRES   HGHT   TEMP   DWPT   RELH   MIXR   DRCT   SKNT   THTA   THTE   THTV
    const headerIndex = lines.findIndex((line) =>
      line.includes('PRES') && line.includes('HGHT') && line.includes('TEMP')
    );

    if (headerIndex === -1) {
      console.error('Could not find data header in UWyo response');
      return null;
    }

    // Parse data lines (skip header and units line)
    const levels: SoundingLevel[] = [];

    for (let i = headerIndex + 3; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('Station') || line.startsWith('<')) break;

      // Split by whitespace - UWyo uses fixed-width format
      const parts = line.split(/\s+/).filter(p => p.length > 0);

      if (parts.length < 7) continue;

      const pressure = parseFloat(parts[0]);
      const height = parseFloat(parts[1]);
      const temp = parseFloat(parts[2]);
      const dewpoint = parseFloat(parts[3]);
      const rh = parseFloat(parts[4]);
      const mixingRatio = parseFloat(parts[5]);
      const windDir = parseFloat(parts[6]);
      const windSpeed = parseFloat(parts[7]);

      // Skip invalid data (9999 or similar placeholders)
      if (isNaN(pressure) || pressure > 1100 || pressure < 10) continue;
      if (isNaN(height)) continue;

      levels.push({
        pressure_mb: pressure,
        height_m: height,
        temp_c: isNaN(temp) ? NaN : temp,
        dewpoint_c: isNaN(dewpoint) ? NaN : dewpoint,
        rh: isNaN(rh) ? undefined : rh,
        wind_dir_deg: isNaN(windDir) ? 0 : windDir,
        wind_speed_kt: isNaN(windSpeed) ? 0 : windSpeed,
        mixing_ratio_gkg: isNaN(mixingRatio) ? undefined : mixingRatio,
      });
    }

    if (levels.length === 0) {
      console.error('No valid levels parsed from UWyo response');
      return null;
    }

    // Sort by pressure (highest/surface first)
    levels.sort((a, b) => b.pressure_mb - a.pressure_mb);

    // Extract surface observation (highest pressure level)
    const surface = levels[0];

    return {
      station_id: stationId,
      station_name: stationName,
      wmo_id: station?.wmo_id,
      lat,
      lon,
      elevation_m: elevation,
      obs_time: obsTime,
      obs_time_z: obsTime.includes('00:00') ? '00Z' : '12Z',
      source: 'uwyo',
      levels,
      surface: {
        pressure_mb: surface.pressure_mb,
        temp_c: surface.temp_c,
        dewpoint_c: surface.dewpoint_c,
        rh: surface.rh,
        wind_dir_deg: surface.wind_dir_deg,
        wind_speed_kt: surface.wind_speed_kt,
      },
    };
  } catch (error) {
    console.error('Error parsing UWyo HTML:', error);
    return null;
  }
}

// Fetch sounding from University of Wyoming
export async function fetchUWyoSounding(
  stationId: string,
  year: number,
  month: number,
  day: number,
  hour: number // 0 or 12
): Promise<Sounding | null> {
  // Build cache key
  const cacheKey = `uwyo:${stationId}:${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}${String(hour).padStart(2, '0')}`;

  // Check cache
  const cached = soundingCache.get(cacheKey);
  if (cached && Date.now() < cached.expires_at) {
    return cached.data;
  }

  // Get station WMO ID (UWyo uses WMO IDs, not IGRA IDs)
  const station = getStationById(stationId);
  if (!station?.wmo_id) {
    console.error(`Station ${stationId} not found or has no WMO ID`);
    return null;
  }

  // Build UWyo URL
  // Format: http://weather.uwyo.edu/cgi-bin/sounding?region=naconf&TYPE=TEXT%3ALIST&YEAR=2024&MONTH=01&FROM=0112&TO=0112&STNM=72351
  const fromDate = `${String(day).padStart(2, '0')}${String(hour).padStart(2, '0')}`;
  const url = new URL('http://weather.uwyo.edu/cgi-bin/sounding');
  url.searchParams.set('region', UWYO_REGION);
  url.searchParams.set('TYPE', 'TEXT:LIST');
  url.searchParams.set('YEAR', String(year));
  url.searchParams.set('MONTH', String(month).padStart(2, '0'));
  url.searchParams.set('FROM', fromDate);
  url.searchParams.set('TO', fromDate);
  url.searchParams.set('STNM', station.wmo_id);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'maxvelocitywx.com (contact@maxvelocitywx.com)',
      },
      next: { revalidate: 1800 }, // 30 minute cache
    });

    if (!response.ok) {
      console.error(`UWyo fetch failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const html = await response.text();

    // Check for "Can't get" error from UWyo
    if (html.includes("Can't get") || html.includes('Sorry')) {
      console.log(`No data available from UWyo for ${stationId} on ${year}-${month}-${day} ${hour}Z`);
      return null;
    }

    const sounding = parseUWyoHTML(html, stationId);

    if (sounding) {
      // Determine cache TTL based on age
      const obsDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      const ageMs = Date.now() - obsDate.getTime();
      const isRecent = ageMs < 7 * 24 * 60 * 60 * 1000; // < 7 days
      const ttl = isRecent ? CACHE_TTL.sounding_recent : CACHE_TTL.sounding_historical;

      soundingCache.set(cacheKey, {
        data: sounding,
        fetched_at: Date.now(),
        expires_at: Date.now() + ttl,
      });
    }

    return sounding;
  } catch (error) {
    console.error('Error fetching from UWyo:', error);
    return null;
  }
}

// Fetch latest available sounding for a station
export async function fetchLatestUWyoSounding(
  stationId: string
): Promise<Sounding | null> {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Determine which synoptic time to try first
  // 00Z data typically available by ~01:30Z, 12Z by ~13:30Z
  let targetHour: number;
  let targetDate = new Date(now);

  if (utcHour >= 14) {
    // Try 12Z from today
    targetHour = 12;
  } else if (utcHour >= 2) {
    // Try 00Z from today
    targetHour = 0;
  } else {
    // Try 12Z from yesterday
    targetHour = 12;
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
  }

  // Try primary target
  let sounding = await fetchUWyoSounding(
    stationId,
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth() + 1,
    targetDate.getUTCDate(),
    targetHour
  );

  if (sounding) return sounding;

  // Try fallback (previous synoptic time)
  if (targetHour === 12) {
    // Try 00Z from same day
    sounding = await fetchUWyoSounding(
      stationId,
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth() + 1,
      targetDate.getUTCDate(),
      0
    );
  } else {
    // Try 12Z from previous day
    targetDate.setUTCDate(targetDate.getUTCDate() - 1);
    sounding = await fetchUWyoSounding(
      stationId,
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth() + 1,
      targetDate.getUTCDate(),
      12
    );
  }

  return sounding;
}

// Get available dates for a station from UWyo
// UWyo doesn't have a direct inventory endpoint, so we probe recent dates
export async function probeUWyoAvailability(
  stationId: string,
  daysBack: number = 7
): Promise<{ date: string; times: ('00Z' | '12Z')[] }[]> {
  const available: { date: string; times: ('00Z' | '12Z')[] }[] = [];

  const now = new Date();

  for (let d = 0; d < daysBack; d++) {
    const checkDate = new Date(now);
    checkDate.setUTCDate(checkDate.getUTCDate() - d);

    const year = checkDate.getUTCFullYear();
    const month = checkDate.getUTCMonth() + 1;
    const day = checkDate.getUTCDate();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const times: ('00Z' | '12Z')[] = [];

    // Check 00Z
    const sounding00Z = await fetchUWyoSounding(stationId, year, month, day, 0);
    if (sounding00Z) times.push('00Z');

    // Check 12Z
    const sounding12Z = await fetchUWyoSounding(stationId, year, month, day, 12);
    if (sounding12Z) times.push('12Z');

    if (times.length > 0) {
      available.push({ date: dateStr, times });
    }
  }

  return available;
}

// Clear expired cache entries
export function cleanUWyoCache(): void {
  const now = Date.now();
  for (const [key, entry] of soundingCache.entries()) {
    if (now > entry.expires_at) {
      soundingCache.delete(key);
    }
  }
}

// Get cache statistics
export function getUWyoCacheStats(): { size: number; entries: string[] } {
  return {
    size: soundingCache.size,
    entries: Array.from(soundingCache.keys()),
  };
}
