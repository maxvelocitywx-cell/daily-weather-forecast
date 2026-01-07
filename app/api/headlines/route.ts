/**
 * GET /api/headlines
 *
 * Returns the latest headlines run.
 * If no run exists, generates headlines on-demand.
 */

import { NextResponse } from 'next/server';
import { getLatestRun, storeHeadlinesRun, needsNewRun } from '@/lib/headlines/storage';
import { buildFactsBundle } from '@/lib/headlines/fetchers';
import { generateHeadlines } from '@/lib/headlines/generator';

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
        console.log('[Headlines API] Generating fresh headlines...');

        // Fetch all data sources
        const facts = await buildFactsBundle();
        console.log(`[Headlines API] Fetched facts: ${facts.alerts.length} alerts, ${facts.total_event_facts} events`);

        // Generate headlines using OpenAI
        const headlines = await generateHeadlines(facts, apiKey);
        console.log(`[Headlines API] Generated ${headlines.length} headlines`);

        // Store the run
        run = storeHeadlinesRun(
          headlines,
          `${facts.alerts.length} alerts, ${facts.total_event_facts} event reports`
        );
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
 */
function generatePlaceholderHeadlines() {
  return [
    {
      headline: 'Check NWS for active weather alerts across the United States',
      topic: 'general',
      regions: ['United States'],
      confidence: 'high',
      source_name: 'NWS',
      source_url: 'https://www.weather.gov/alerts',
    },
    {
      headline: 'SPC monitoring severe weather potential across the Plains',
      topic: 'severe',
      regions: ['Central US'],
      confidence: 'medium',
      source_name: 'SPC',
      source_url: 'https://www.spc.noaa.gov/',
    },
    {
      headline: 'WPC tracking precipitation patterns nationwide',
      topic: 'flood',
      regions: ['United States'],
      confidence: 'medium',
      source_name: 'WPC',
      source_url: 'https://www.wpc.ncep.noaa.gov/',
    },
    {
      headline: 'NHC monitoring tropical activity in Atlantic basin',
      topic: 'tropical',
      regions: ['Atlantic', 'Gulf Coast'],
      confidence: 'medium',
      source_name: 'NHC',
      source_url: 'https://www.nhc.noaa.gov/',
    },
    {
      headline: 'Local Storm Reports available via Iowa Mesonet',
      topic: 'severe',
      regions: ['United States'],
      confidence: 'high',
      source_name: 'IEM',
      source_url: 'https://mesonet.agron.iastate.edu/lsr/',
    },
    {
      headline: 'Real-time observations updating from ASOS stations',
      topic: 'general',
      regions: ['United States'],
      confidence: 'measured',
      source_name: 'NWS ASOS',
      source_url: 'https://www.weather.gov/asos/',
    },
    {
      headline: 'Fire weather conditions being monitored in Western states',
      topic: 'fire',
      regions: ['Western US'],
      confidence: 'medium',
      source_name: 'NWS',
      source_url: 'https://www.weather.gov/',
    },
    {
      headline: 'Winter weather outlooks available for Northern tier',
      topic: 'winter',
      regions: ['Northern US'],
      confidence: 'medium',
      source_name: 'NWS',
      source_url: 'https://www.weather.gov/',
    },
    {
      headline: 'Marine forecasts updated for coastal waters',
      topic: 'marine',
      regions: ['Coastal US'],
      confidence: 'high',
      source_name: 'NWS Marine',
      source_url: 'https://www.weather.gov/marine',
    },
    {
      headline: 'Aviation weather products available from AWC',
      topic: 'aviation',
      regions: ['United States'],
      confidence: 'high',
      source_name: 'AWC',
      source_url: 'https://www.aviationweather.gov/',
    },
  ];
}
