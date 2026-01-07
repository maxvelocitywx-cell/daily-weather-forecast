/**
 * POST /api/cron/headlines
 *
 * Cron endpoint to generate new headlines every 15 minutes.
 * Called by Vercel Cron or external scheduler.
 *
 * Security: Requires CRON_SECRET header in production.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildFactsBundle } from '@/lib/headlines/fetchers';
import { generateHeadlines } from '@/lib/headlines/generator';
import { storeHeadlinesRun, needsNewRun, getLatestRun } from '@/lib/headlines/storage';

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    console.log('[Headlines Cron] Starting headlines generation...');

    // Fetch all data sources
    const facts = await buildFactsBundle();
    console.log(`[Headlines Cron] Fetched facts: ${facts.alerts.length} alerts, ${facts.spc_outlooks.length} SPC, ${facts.ero_outlooks.length} ERO`);

    // Generate headlines using OpenAI
    const headlines = await generateHeadlines(facts, apiKey);
    console.log(`[Headlines Cron] Generated ${headlines.length} headlines`);

    // Store the run
    const run = storeHeadlinesRun(
      headlines,
      `${facts.alerts.length} alerts, ${facts.spc_outlooks.length} SPC outlooks, ${facts.ero_outlooks.length} ERO outlooks`
    );

    console.log(`[Headlines Cron] Stored run ${run.id}`);

    return NextResponse.json({
      status: 'success',
      run_id: run.id,
      timestamp: run.timestamp,
      headline_count: headlines.length,
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
