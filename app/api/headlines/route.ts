/**
 * GET /api/headlines
 *
 * Returns the latest headlines run using Xweather as the primary data source.
 * If no run exists or it's stale, generates headlines on-demand.
 *
 * XWEATHER HEADLINES SYSTEM:
 * - All headlines are backed by verified facts from Xweather API
 * - Every headline includes fact_ids referencing the source facts
 * - No hallucination - all claims traceable to Xweather data
 */

import { NextResponse } from 'next/server';
import {
  getLatestRun,
  storeHeadlinesRun,
  needsNewRun,
  buildXweatherFactsBundle,
  generateXweatherHeadlines,
  generatePlaceholderHeadlines,
  XweatherHeadline,
} from '@/lib/xweather';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    // Get latest run
    let run = getLatestRun();

    // If no run exists or it's stale, generate new headlines
    if (!run || needsNewRun()) {
      const openaiKey = process.env.OPENAI_API_KEY;
      const xweatherClientId = process.env.XWEATHER_CLIENT_ID;
      const xweatherClientSecret = process.env.XWEATHER_CLIENT_SECRET;

      // Check for required API keys
      if (!openaiKey) {
        console.warn('[Headlines API] OPENAI_API_KEY not configured');
        return NextResponse.json({
          id: 'placeholder',
          timestamp: new Date().toISOString(),
          headlines: generatePlaceholderHeadlines(),
          facts_summary: 'OpenAI API key not configured',
          validation: { facts_used: 0, headlines_validated: false },
        });
      }

      if (!xweatherClientId || !xweatherClientSecret) {
        console.warn('[Headlines API] Xweather credentials not configured');
        return NextResponse.json({
          id: 'placeholder',
          timestamp: new Date().toISOString(),
          headlines: generatePlaceholderHeadlines(),
          facts_summary: 'Xweather API credentials not configured',
          validation: { facts_used: 0, headlines_validated: false },
        });
      }

      try {
        console.log('[Headlines API] Generating Xweather headlines...');

        // Fetch all data sources and build facts bundle
        const factsBundle = await buildXweatherFactsBundle();
        console.log(`[Headlines API] Facts bundle: ${factsBundle.facts.length} verified facts`);
        console.log(`[Headlines API] Breakdown: ${factsBundle.counts.observations} obs, ${factsBundle.counts.storm_reports} reports, ${factsBundle.counts.alerts} alerts`);

        // Generate headlines with strict fact validation
        const headlines = await generateXweatherHeadlines(factsBundle, openaiKey);
        console.log(`[Headlines API] Generated ${headlines.length} verified headlines`);

        // Build facts summary
        const factsSummary = [
          factsBundle.counts.observations > 0 ? `${factsBundle.counts.observations} observations` : null,
          factsBundle.counts.storm_reports > 0 ? `${factsBundle.counts.storm_reports} storm reports` : null,
          factsBundle.counts.alerts > 0 ? `${factsBundle.counts.alerts} alerts` : null,
        ].filter(Boolean).join(', ') || 'No active data';

        // Store the run
        run = storeHeadlinesRun(headlines, factsSummary);
      } catch (genError) {
        console.error('[Headlines API] Generation error:', genError);

        // If we have an old run, return it
        if (run) {
          return NextResponse.json(run);
        }

        // Otherwise return placeholder
        return NextResponse.json({
          id: 'error-placeholder',
          timestamp: new Date().toISOString(),
          headlines: generatePlaceholderHeadlines(),
          facts_summary: 'Generation temporarily unavailable',
          validation: { facts_used: 0, headlines_validated: false },
        });
      }
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
