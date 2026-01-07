// GET /api/soundings/inventory
// Returns available observation times for a station

import { NextResponse } from 'next/server';
import { getStationById } from '@/lib/soundings/stations';
import { probeUWyoAvailability } from '@/lib/soundings/uwyo-fetcher';
import { InventoryResponse } from '@/lib/soundings/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stationId = searchParams.get('station_id');
    const daysBack = parseInt(searchParams.get('days') || '7', 10);

    if (!stationId) {
      return NextResponse.json(
        { error: 'station_id parameter is required' },
        { status: 400 }
      );
    }

    // Get station metadata
    const station = getStationById(stationId);
    if (!station) {
      return NextResponse.json(
        { error: `Station ${stationId} not found` },
        { status: 404 }
      );
    }

    // Probe UWyo for available dates (limited to recent data)
    const limitedDays = Math.min(daysBack, 14); // Cap at 14 days for performance
    const availability = await probeUWyoAvailability(stationId, limitedDays);

    // Build response
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    const response: InventoryResponse = {
      station_id: station.id,
      station_name: station.name,
      year: currentYear,
      month: currentMonth,
      available: availability.map(a => ({
        date: a.date,
        times: a.times,
        sources: ['uwyo'] as ('igra' | 'uwyo')[],
      })),
      range: {
        earliest: availability.length > 0
          ? availability[availability.length - 1].date
          : new Date().toISOString().split('T')[0],
        latest: availability.length > 0
          ? availability[0].date
          : new Date().toISOString().split('T')[0],
      },
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('Error in /api/soundings/inventory:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory' },
      { status: 500 }
    );
  }
}
