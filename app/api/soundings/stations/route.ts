// GET /api/soundings/stations
// Returns all RAOB stations and ACARS airports

import { NextResponse } from 'next/server';
import { RAOB_STATIONS, ACTIVE_CONUS_STATIONS } from '@/lib/soundings/stations';
import { ACARS_AIRPORTS } from '@/lib/soundings/airports';
import { StationsResponse } from '@/lib/soundings/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('include_inactive') === 'true';
    const conusOnly = searchParams.get('conus_only') !== 'false'; // Default true

    // Filter stations based on params
    let stations = includeInactive ? RAOB_STATIONS : RAOB_STATIONS.filter(s => s.active);

    if (conusOnly) {
      stations = stations.filter(s => !['AK', 'HI'].includes(s.state));
    }

    const response: StationsResponse = {
      raob_stations: stations,
      acars_airports: conusOnly
        ? ACARS_AIRPORTS.filter(a => !['AK', 'HI'].includes(a.state))
        : ACARS_AIRPORTS,
      last_updated: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Error in /api/soundings/stations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stations' },
      { status: 500 }
    );
  }
}
