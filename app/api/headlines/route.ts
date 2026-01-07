/**
 * GET /api/headlines
 *
 * Returns the latest headlines run.
 * If no run exists yet, triggers generation (but won't block long).
 */

import { NextResponse } from 'next/server';
import { getLatestRun, initializeWithSeedData } from '@/lib/headlines/storage';

export const dynamic = 'force-dynamic';
export const revalidate = 60; // Revalidate every minute

export async function GET() {
  try {
    // Get latest run
    let run = getLatestRun();

    // If no run exists, initialize with seed data
    if (!run) {
      initializeWithSeedData();
      run = getLatestRun();
    }

    if (!run) {
      return NextResponse.json(
        { error: 'No headlines available' },
        { status: 503 }
      );
    }

    return NextResponse.json(run, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Headlines API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch headlines' },
      { status: 500 }
    );
  }
}
