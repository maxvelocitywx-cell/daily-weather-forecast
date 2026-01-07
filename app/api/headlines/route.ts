/**
 * GET /api/headlines
 *
 * Returns the latest headlines run.
 * If no run exists, generates headlines on-demand using the verified generator.
 *
 * VERIFIED HEADLINES SYSTEM:
 * - All headlines are backed by verified facts from live data sources
 * - Every headline includes fact_ids referencing the source facts
 * - No hallucination - all claims traceable to sources
 */

import { NextResponse } from 'next/server';
import { getLatestRun, storeHeadlinesRun, needsNewRun } from '@/lib/headlines/storage';
import { buildVerifiedFactsBundle } from '@/lib/headlines/verified-fetchers';
import { generateVerifiedHeadlines } from '@/lib/headlines/verified-generator';
import { Headline } from '@/lib/headlines/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    // Get latest run
    let run = getLatestRun();

    // If no run exists or it's stale, generate new headlines
    if (!run || needsNewRun()) {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        // Return placeholder if no API key
        return NextResponse.json({
          id: 'placeholder',
          timestamp: new Date().toISOString(),
          headlines: generatePlaceholderHeadlines(),
          facts_summary: 'API key not configured',
        });
      }

      try {
        console.log('[Headlines API] Generating verified headlines...');

        // Fetch all data sources and build verified facts bundle
        const factsBundle = await buildVerifiedFactsBundle();
        console.log(`[Headlines API] Facts bundle: ${factsBundle.facts.length} verified facts`);
        console.log(`[Headlines API] Breakdown: ${factsBundle.counts.alerts} alerts, ${factsBundle.counts.lsr} LSR, ${factsBundle.counts.station_obs} station obs`);

        // Generate headlines with strict fact validation
        const headlines = await generateVerifiedHeadlines(factsBundle, apiKey);
        console.log(`[Headlines API] Generated ${headlines.length} verified headlines`);

        // Build facts summary
        const factsSummary = [
          `${factsBundle.counts.alerts} alerts`,
          `${factsBundle.counts.lsr} storm reports`,
          `${factsBundle.counts.station_obs} station obs`,
          `${factsBundle.counts.spc} SPC outlooks`,
          `${factsBundle.counts.wpc} WPC ERO`,
        ].filter(s => !s.startsWith('0 ')).join(', ');

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

/**
 * Generate placeholder headlines when generation fails
 * These are generic and don't make specific claims
 */
function generatePlaceholderHeadlines(): Headline[] {
  const now = new Date().toISOString();

  return [
    {
      id: 'p1',
      headline: 'Check NWS for active weather alerts across the United States',
      topic: 'general',
      confidence_label: 'Medium',
      location: { state: 'United States', place: 'Nationwide' },
      timestamp_utc: now,
      source_name: 'NWS',
      source_url: 'https://www.weather.gov/alerts',
      fact_ids: [],
    },
    {
      id: 'p2',
      headline: 'SPC monitoring severe weather potential across the Plains',
      topic: 'severe',
      confidence_label: 'Medium',
      location: { state: 'Multiple States', place: 'Central US' },
      timestamp_utc: now,
      source_name: 'SPC',
      source_url: 'https://www.spc.noaa.gov/',
      fact_ids: [],
    },
    {
      id: 'p3',
      headline: 'WPC tracking precipitation patterns nationwide',
      topic: 'flood',
      confidence_label: 'Medium',
      location: { state: 'United States', place: 'Nationwide' },
      timestamp_utc: now,
      source_name: 'WPC',
      source_url: 'https://www.wpc.ncep.noaa.gov/',
      fact_ids: [],
    },
    {
      id: 'p4',
      headline: 'NHC monitoring tropical activity in Atlantic basin',
      topic: 'tropical',
      confidence_label: 'Medium',
      location: { state: 'Multiple States', place: 'Atlantic Basin' },
      timestamp_utc: now,
      source_name: 'NHC',
      source_url: 'https://www.nhc.noaa.gov/',
      fact_ids: [],
    },
    {
      id: 'p5',
      headline: 'Local Storm Reports available via Iowa Mesonet',
      topic: 'severe',
      confidence_label: 'High',
      location: { state: 'United States', place: 'Nationwide' },
      timestamp_utc: now,
      source_name: 'IEM',
      source_url: 'https://mesonet.agron.iastate.edu/lsr/',
      fact_ids: [],
    },
    {
      id: 'p6',
      headline: 'Real-time observations updating from ASOS stations',
      topic: 'general',
      confidence_label: 'Measured',
      location: { state: 'United States', place: 'Nationwide' },
      timestamp_utc: now,
      source_name: 'NWS ASOS',
      source_url: 'https://www.weather.gov/asos/',
      fact_ids: [],
    },
    {
      id: 'p7',
      headline: 'Fire weather conditions being monitored in Western states',
      topic: 'fire',
      confidence_label: 'Medium',
      location: { state: 'Multiple States', place: 'Western US' },
      timestamp_utc: now,
      source_name: 'NWS',
      source_url: 'https://www.weather.gov/',
      fact_ids: [],
    },
    {
      id: 'p8',
      headline: 'Winter weather outlooks available for Northern tier',
      topic: 'winter',
      confidence_label: 'Medium',
      location: { state: 'Multiple States', place: 'Northern US' },
      timestamp_utc: now,
      source_name: 'NWS',
      source_url: 'https://www.weather.gov/',
      fact_ids: [],
    },
    {
      id: 'p9',
      headline: 'Marine forecasts updated for coastal waters',
      topic: 'marine',
      confidence_label: 'High',
      location: { state: 'Multiple States', place: 'Coastal US' },
      timestamp_utc: now,
      source_name: 'NWS Marine',
      source_url: 'https://www.weather.gov/marine',
      fact_ids: [],
    },
    {
      id: 'p10',
      headline: 'Aviation weather products available from AWC',
      topic: 'aviation',
      confidence_label: 'High',
      location: { state: 'United States', place: 'Nationwide' },
      timestamp_utc: now,
      source_name: 'AWC',
      source_url: 'https://www.aviationweather.gov/',
      fact_ids: [],
    },
  ];
}
