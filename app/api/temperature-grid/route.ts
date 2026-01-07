import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

export const maxDuration = 60;

interface TempPoint {
  lat: number;
  lon: number;
  temp: number;
}

// Cache for temperature data
const temperatureCache: Record<string, { points: TempPoint[]; timestamp: number }> = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch GFS data from NOMADS
 */
function fetchGFSData(
  dateStr: string,
  modelRun: string,
  timeIndex: number,
  variable: string,
  latMinIdx: number,
  latMaxIdx: number,
  lonMinIdx: number,
  lonMaxIdx: number,
  latStep: number,
  lonStep: number
): Promise<TempPoint[]> {
  const url =
    `https://nomads.ncep.noaa.gov/dods/gfs_0p25/gfs${dateStr}/gfs_0p25_${modelRun}.ascii?` +
    `${variable}%5B${timeIndex}%5D%5B${latMinIdx}:${latStep}:${latMaxIdx}%5D%5B${lonMinIdx}:${lonStep}:${lonMaxIdx}%5D`;

  console.log(`Fetching GFS: ${url}`);

  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const lines = data.split('\n');
            const tempPoints: TempPoint[] = [];

            for (const line of lines) {
              const trimmed = line.trim();
              const match = trimmed.match(/^\[(\d+)\]\[(\d+)\],\s*(.+)$/);
              if (match) {
                const latIdx = parseInt(match[2]);
                const values = match[3].split(',').map((v) => parseFloat(v.trim()));

                const actualLatIdx = latMinIdx + latIdx * latStep;
                const lat = actualLatIdx * 0.25 - 90;

                values.forEach((tempK, lonIdx) => {
                  if (!isNaN(tempK) && tempK > 0) {
                    const actualLonIdx = lonMinIdx + lonIdx * lonStep;
                    let lon = actualLonIdx * 0.25;
                    if (lon > 180) lon -= 360;

                    const tempF = ((tempK - 273.15) * 9) / 5 + 32;

                    tempPoints.push({
                      lat: lat,
                      lon: lon,
                      temp: Math.round(tempF),
                    });
                  }
                });
              }
            }

            resolve(tempPoints);
          } catch (err) {
            console.error('Error parsing GFS data:', err);
            resolve([]);
          }
        });
      })
      .on('error', (err) => {
        console.error('Error fetching GFS data:', err.message);
        resolve([]);
      });
  });
}

/**
 * Fetch temperature grid for a specific day
 */
async function fetchTemperatureGrid(day: number, type: string): Promise<TempPoint[]> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10).replace(/-/g, '');

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

  // CONUS bounds
  const latMin = 24,
    latMax = 50;
  const lonMin = 235,
    lonMax = 294; // -125 to -66 in 0-360 format

  const latMinIdx = Math.floor((latMin + 90) / 0.25);
  const latMaxIdx = Math.floor((latMax + 90) / 0.25);
  const lonMinIdx = Math.floor(lonMin / 0.25);
  const lonMaxIdx = Math.floor(lonMax / 0.25);

  const latStep = 2;
  const lonStep = 2;

  const variable = type === 'high' ? 'tmax2m' : 'tmin2m';

  const attempts: { dateStr: string; modelRun: string; timeIndex: number }[] = [];

  if (type === 'low' && day === 1) {
    attempts.push({ dateStr: today, modelRun: '00z', timeIndex: 2 });
    attempts.push({ dateStr: yesterdayStr, modelRun: '00z', timeIndex: 6 });
  } else {
    const baseTimeIndex = type === 'high' ? 9 : 0;
    const timeIndex = baseTimeIndex + (day - 1) * 4;

    attempts.push({ dateStr: today, modelRun: '12z', timeIndex: timeIndex });
    attempts.push({ dateStr: yesterdayStr, modelRun: '12z', timeIndex: timeIndex + 4 });
  }

  console.log(`Fetching GFS ${type} temperature for day ${day}...`);

  for (const attempt of attempts) {
    console.log(`Trying ${attempt.dateStr} ${attempt.modelRun} run...`);

    const tempPoints = await fetchGFSData(
      attempt.dateStr,
      attempt.modelRun,
      attempt.timeIndex,
      variable,
      latMinIdx,
      latMaxIdx,
      lonMinIdx,
      lonMaxIdx,
      latStep,
      lonStep
    );

    if (tempPoints.length > 0) {
      console.log(`Got ${tempPoints.length} temperature points from ${attempt.dateStr} ${attempt.modelRun}`);
      return tempPoints;
    }
  }

  console.log('No temperature data available from any source');
  return [];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dayParam = searchParams.get('day') || '1';
  const type = searchParams.get('type') || 'high';

  const day = parseInt(dayParam);
  if (isNaN(day) || day < 1 || day > 7) {
    return NextResponse.json({ error: 'Invalid day parameter' }, { status: 400 });
  }

  const cacheKey = `${day}-${type}`;
  const cached = temperatureCache[cacheKey];

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      points: cached.points,
      cached: true,
      day,
      type,
    });
  }

  try {
    const points = await fetchTemperatureGrid(day, type);

    if (points.length > 0) {
      temperatureCache[cacheKey] = {
        points,
        timestamp: Date.now(),
      };
    }

    return NextResponse.json({
      points,
      cached: false,
      day,
      type,
    });
  } catch (error) {
    console.error('Error fetching temperature grid:', error);
    return NextResponse.json({ error: 'Failed to fetch temperature data', points: [] }, { status: 500 });
  }
}
