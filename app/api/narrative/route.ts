import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import OpenAI from 'openai';
import { REGIONS, REGION_IDS } from '@/lib/regions';
import { NarrativeResponse, NationalNarrative, RegionNarrative } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/narrative
 * Returns AI-generated weather narratives for all regions
 */
export async function GET(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    // Get base URL from request
    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

    // Fetch current forecast data
    const forecastRes = await fetch(`${baseUrl}/api/forecast`);

    if (!forecastRes.ok) {
      throw new Error('Failed to fetch forecast data');
    }

    const forecast = await forecastRes.json();

    const client = new OpenAI({ apiKey });

    // Generate national narrative
    const nationalPrompt = `You are a professional meteorologist writing a weather synopsis for the United States.

Current conditions:
- National risk level: ${forecast.national.level} (${forecast.national.overallRisk}/10)
- Active regions: ${forecast.national.activeRegions.join(', ') || 'None'}

Regional overview:
${forecast.regions.map((r: any) => `- ${r.region.name}: ${r.risk.level} (${r.risk.overall}/10) - ${r.risk.headline}`).join('\n')}

Write a concise 2-paragraph national weather outlook:
1. First paragraph: Main weather story and significant hazards
2. Second paragraph: Regional variations and outlook

Keep it professional, factual, and avoid sensationalism. No emojis.`;

    const nationalResponse = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: nationalPrompt }],
      max_tokens: 500,
      temperature: 0.7,
    });

    const nationalText = nationalResponse.choices[0]?.message?.content || '';
    const nationalParagraphs = nationalText.split('\n\n').filter(p => p.trim());

    const nationalNarrative: NationalNarrative = {
      headline: forecast.national.activeRegions.length > 0
        ? `Active weather across ${forecast.national.activeRegions.length} region${forecast.national.activeRegions.length > 1 ? 's' : ''}`
        : 'Quiet conditions nationwide',
      overview: nationalParagraphs.join('\n\n'),
      highlights: forecast.national.activeRegions.map((regionId: string) => {
        const region = forecast.regions.find((r: any) => r.region.id === regionId);
        return region ? `${region.region.name}: ${region.risk.headline}` : '';
      }).filter(Boolean),
    };

    // Generate regional narratives (in parallel)
    const regionalPromises = forecast.regions.map(async (region: any) => {
      const regionPrompt = `Write a 1-sentence headline and 2-sentence summary for ${region.region.name}:
- Risk: ${region.risk.level} (${region.risk.overall}/10)
- Snow: ${region.summary.totalSnow.toFixed(1)}" total
- Rain: ${region.summary.totalPrecip.toFixed(2)}" total
- Wind: ${region.summary.maxWindGust} mph max gusts
- Temps: ${Math.round(region.summary.tempRange.min)}°F to ${Math.round(region.summary.tempRange.max)}°F

Format:
HEADLINE: [one short headline]
SUMMARY: [2 sentences about conditions and impacts]`;

      try {
        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: regionPrompt }],
          max_tokens: 150,
          temperature: 0.7,
        });

        const text = response.choices[0]?.message?.content || '';
        const headlineMatch = text.match(/HEADLINE:\s*(.+)/i);
        // Use [\s\S] instead of 's' flag for ES2017 compatibility
        const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+)/i);

        return {
          regionId: region.region.id,
          headline: headlineMatch?.[1]?.trim() || region.risk.headline,
          summary: summaryMatch?.[1]?.trim() || 'Weather conditions within normal ranges.',
        } as RegionNarrative;
      } catch (error) {
        console.error(`Error generating narrative for ${region.region.id}:`, error);
        return {
          regionId: region.region.id,
          headline: region.risk.headline,
          summary: 'Narrative temporarily unavailable.',
        } as RegionNarrative;
      }
    });

    const regionalNarratives = await Promise.all(regionalPromises);

    const response: NarrativeResponse = {
      national: nationalNarrative,
      regional: regionalNarratives,
      meta: {
        generatedAt: new Date().toISOString(),
        model: 'gpt-4o-mini',
      },
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('Narrative API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate narratives' },
      { status: 500 }
    );
  }
}
