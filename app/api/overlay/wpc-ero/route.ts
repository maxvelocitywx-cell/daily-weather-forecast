import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/overlay/wpc-ero
 * Returns WPC Excessive Rainfall Outlook data (mock for now)
 */
export async function GET() {
  // In production, this would fetch from WPC GeoJSON endpoints
  // For now, return mock data structure

  const mockERO = {
    day1: {
      level: 0,
      category: 'NONE',
      valid_time: new Date().toISOString(),
    },
    day2: {
      level: 0,
      category: 'NONE',
      valid_time: new Date(Date.now() + 86400000).toISOString(),
    },
    day3: {
      level: 0,
      category: 'NONE',
      valid_time: new Date(Date.now() + 172800000).toISOString(),
    },
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(mockERO, {
    headers: {
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300',
    },
  });
}
