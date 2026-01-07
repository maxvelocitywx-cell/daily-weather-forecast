import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/overlay/spc
 * Returns SPC convective outlook data (mock for now)
 */
export async function GET() {
  // In production, this would fetch from SPC GeoJSON endpoints
  // For now, return mock data structure

  const mockSPC = {
    day1: {
      categorical: { level: 1, category: 'MRGL', probability: 5 },
      valid_time: new Date().toISOString(),
    },
    day2: {
      categorical: { level: 0, category: 'TSTM', probability: 0 },
      valid_time: new Date(Date.now() + 86400000).toISOString(),
    },
    day3: {
      categorical: { level: 0, category: 'NONE', probability: 0 },
      valid_time: new Date(Date.now() + 172800000).toISOString(),
    },
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(mockSPC, {
    headers: {
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300',
    },
  });
}
