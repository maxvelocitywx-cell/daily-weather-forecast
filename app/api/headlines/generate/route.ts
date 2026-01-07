/**
 * POST /api/headlines/generate
 *
 * Manual trigger for headline generation.
 * Can be used for initial generation or force refresh.
 *
 * Uses the verified headlines system with strict fact validation.
 */

import { NextResponse } from 'next/server';
import { buildVerifiedFactsBundle } from '@/lib/headlines/verified-fetchers';
import { generateVerifiedHeadlines } from '@/lib/headlines/verified-generator';
import { storeHeadlinesRun } from '@/lib/headlines/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    console.log('[Headlines Generate] Starting verified generation...');

    // Fetch all data sources and build verified facts bundle
    const factsBundle = await buildVerifiedFactsBundle();
    console.log(`[Headlines Generate] Fetched ${factsBundle.facts.length} verified facts`);
    console.log(`[Headlines Generate] Breakdown: ${factsBundle.counts.alerts} alerts, ${factsBundle.counts.lsr} LSR, ${factsBundle.counts.station_obs} station obs`);

    // Generate headlines with strict fact validation
    const headlines = await generateVerifiedHeadlines(factsBundle, apiKey);
    console.log(`[Headlines Generate] Generated ${headlines.length} verified headlines`);

    // Build facts summary
    const factsSummary = [
      `${factsBundle.counts.alerts} alerts`,
      `${factsBundle.counts.lsr} storm reports`,
      `${factsBundle.counts.station_obs} station obs`,
      `${factsBundle.counts.spc} SPC outlooks`,
      `${factsBundle.counts.wpc} WPC ERO`,
    ].filter(s => !s.startsWith('0 ')).join(', ');

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
