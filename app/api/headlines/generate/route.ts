/**
 * POST /api/headlines/generate
 *
 * Manual trigger for headline generation using Xweather API.
 * Can be used for initial generation or force refresh.
 *
 * Uses the Xweather headlines system with strict fact validation.
 */

import { NextResponse } from 'next/server';
import {
  buildXweatherFactsBundle,
  generateXweatherHeadlines,
  storeHeadlinesRun,
} from '@/lib/xweather';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
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

    console.log('[Headlines Generate] Starting Xweather-based generation...');

    // Fetch all data sources and build facts bundle
    const factsBundle = await buildXweatherFactsBundle();
    console.log(`[Headlines Generate] Fetched ${factsBundle.facts.length} verified facts`);
    console.log(`[Headlines Generate] Breakdown: ${factsBundle.counts.observations} obs, ${factsBundle.counts.storm_reports} reports, ${factsBundle.counts.alerts} alerts`);

    // Generate headlines with strict fact validation
    const headlines = await generateXweatherHeadlines(factsBundle, openaiKey);
    console.log(`[Headlines Generate] Generated ${headlines.length} verified headlines`);

    // Build facts summary
    const factsSummary = [
      factsBundle.counts.observations > 0 ? `${factsBundle.counts.observations} observations` : null,
      factsBundle.counts.storm_reports > 0 ? `${factsBundle.counts.storm_reports} storm reports` : null,
      factsBundle.counts.alerts > 0 ? `${factsBundle.counts.alerts} alerts` : null,
    ].filter(Boolean).join(', ') || 'No active data';

    // Store the run
    const run = storeHeadlinesRun(headlines, factsSummary);

    return NextResponse.json({
      status: 'success',
      run,
      facts_count: factsBundle.facts.length,
    });
  } catch (error) {
    console.error('[Headlines Generate] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate headlines', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}
