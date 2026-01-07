/**
 * POST /api/headlines/generate
 *
 * Manual trigger for headline generation.
 * Can be used for initial generation or force refresh.
 */

import { NextResponse } from 'next/server';
import { buildFactsBundle } from '@/lib/headlines/fetchers';
import { generateHeadlines } from '@/lib/headlines/generator';
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

    console.log('[Headlines Generate] Starting...');

    // Fetch all data sources
    const facts = await buildFactsBundle();
    console.log(`[Headlines Generate] Fetched facts: ${facts.alerts.length} alerts`);

    // Generate headlines using OpenAI
    const headlines = await generateHeadlines(facts, apiKey);
    console.log(`[Headlines Generate] Generated ${headlines.length} headlines`);

    // Store the run
    const run = storeHeadlinesRun(
      headlines,
      `${facts.alerts.length} alerts, ${facts.spc_outlooks.length} SPC, ${facts.ero_outlooks.length} ERO`
    );

    return NextResponse.json({
      status: 'success',
      run,
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
