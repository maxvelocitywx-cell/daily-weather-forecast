// GET /api/soundings/sounding
// Returns sounding data with derived parameters

import { NextResponse } from 'next/server';
import { getStationById } from '@/lib/soundings/stations';
import { fetchUWyoSounding, fetchLatestUWyoSounding } from '@/lib/soundings/uwyo-fetcher';
import { computeDerivedParameters } from '@/lib/soundings/derived';
import { SoundingResponse } from '@/lib/soundings/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stationId = searchParams.get('station_id');
    const date = searchParams.get('date'); // YYYY-MM-DD
    const time = searchParams.get('time'); // 00Z or 12Z
    const source = searchParams.get('source') || 'uwyo';

    if (!stationId) {
      return NextResponse.json(
        { error: 'station_id parameter is required' },
        { status: 400 }
      );
    }

    // Validate station exists
    const station = getStationById(stationId);
    if (!station) {
      return NextResponse.json(
        { error: `Station ${stationId} not found` },
        { status: 404 }
      );
    }

    let sounding;

    if (!date || !time) {
      // Fetch latest available sounding
      sounding = await fetchLatestUWyoSounding(stationId);
    } else {
      // Parse date components
      const dateParts = date.split('-');
      if (dateParts.length !== 3) {
        return NextResponse.json(
          { error: 'Invalid date format. Use YYYY-MM-DD' },
          { status: 400 }
        );
      }

      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10);
      const day = parseInt(dateParts[2], 10);

      // Parse time (00Z or 12Z)
      const hour = time.toUpperCase().startsWith('12') ? 12 : 0;

      // Fetch sounding
      if (source === 'uwyo' || source === 'igra') {
        sounding = await fetchUWyoSounding(stationId, year, month, day, hour);
      } else {
        return NextResponse.json(
          { error: 'Invalid source. Use "uwyo" or "igra"' },
          { status: 400 }
        );
      }
    }

    if (!sounding) {
      return NextResponse.json(
        { error: 'No sounding data available for the specified station and time' },
        { status: 404 }
      );
    }

    // Compute derived parameters
    const derived = computeDerivedParameters(sounding);

    const response: SoundingResponse = {
      sounding,
      derived,
      source: sounding.source,
      cached: false, // Cache status would come from the fetcher
      fetched_at: new Date().toISOString(),
    };

    // Set cache headers based on data age
    const obsDate = new Date(sounding.obs_time);
    const ageMs = Date.now() - obsDate.getTime();
    const isRecent = ageMs < 7 * 24 * 60 * 60 * 1000; // < 7 days
    const maxAge = isRecent ? 1800 : 86400; // 30 min for recent, 1 day for historical

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge / 2}`,
      },
    });
  } catch (error) {
    console.error('Error in /api/soundings/sounding:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sounding data' },
      { status: 500 }
    );
  }
}
