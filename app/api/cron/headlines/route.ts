/**
 * POST /api/cron/headlines
 *
 * Cron endpoint to generate new headlines every 15 minutes.
 * Called by Vercel Cron or external scheduler.
 *
 * Security: Requires CRON_SECRET header in production.
 *
 * Uses the Xweather headlines system with strict fact validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  buildXweatherFactsBundle,
  generateXweatherHeadlines,
  storeHeadlinesRun,
  needsNewRun,
  getLatestRun,
} from '@/lib/xweather';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Verify cron secret in production
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // Check if we actually need a new run
    if (!needsNewRun()) {
      const latest = getLatestRun();
      return NextResponse.json({
        status: 'skipped',
        message: 'Last run is still fresh',
        lastRun: latest?.timestamp,
      });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    const xweatherClientId = process.env.XWEATHER_CLIENT_ID;
    const xweatherClientSecret = process.env.XWEATHER_CLIENT_SECRET;

    if (!openaiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    if (!xweatherClientId || !xweatherClientSecret) {
      return NextResponse.json(
        { error: 'XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET must be configured' },
        { status: 500 }
      );
    }

    console.log('[Headlines Cron] Starting Xweather-based headlines generation...');

    // Fetch all data sources and build facts bundle
    const factsBundle = await buildXweatherFactsBundle();
    console.log(`[Headlines Cron] Fetched ${factsBundle.facts.length} verified facts`);
    console.log(`[Headlines Cron] Breakdown: ${factsBundle.counts.observations} obs, ${factsBundle.counts.storm_reports} reports, ${factsBundle.counts.alerts} alerts`);

    // Generate headlines with strict fact validation
    const headlines = await generateXweatherHeadlines(factsBundle, openaiKey);
    console.log(`[Headlines Cron] Generated ${headlines.length} verified headlines`);

    // Build facts summary
    const factsSummary = [
      factsBundle.counts.observations > 0 ? `${factsBundle.counts.observations} observations` : null,
      factsBundle.counts.storm_reports > 0 ? `${factsBundle.counts.storm_reports} storm reports` : null,
      factsBundle.counts.alerts > 0 ? `${factsBundle.counts.alerts} alerts` : null,
    ].filter(Boolean).join(', ') || 'No active data';

    // Store the run
    const run = storeHeadlinesRun(headlines, factsSummary);

    console.log(`[Headlines Cron] Stored run ${run.id}`);

    return NextResponse.json({
      status: 'success',
      run_id: run.id,
      timestamp: run.timestamp,
      headline_count: headlines.length,
      facts_count: factsBundle.facts.length,
    });
  } catch (error) {
    console.error('[Headlines Cron] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate headlines', details: String(error) },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  // In development, allow GET requests for testing
  if (process.env.NODE_ENV === 'development') {
    return POST(request);
  }

  return NextResponse.json(
    { error: 'Use POST for cron calls' },
    { status: 405 }
  );
}
