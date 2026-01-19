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

    // Build detailed weather context for each region
    const regionDetails = forecast.regions.map((r: any) => {
      const details: string[] = [];
      details.push(`${r.region.name}:`);
      details.push(`  Risk: ${r.risk.level} (${r.risk.overall}/10)`);

      // Temperature details
      if (r.summary?.tempRange) {
        details.push(`  Temps: Highs ${Math.round(r.summary.tempRange.max)}°F, Lows ${Math.round(r.summary.tempRange.min)}°F`);
      }

      // Precipitation details
      if (r.summary?.totalSnow > 0.5) {
        details.push(`  Snow: ${r.summary.totalSnow.toFixed(1)}" expected`);
      }
      if (r.summary?.totalPrecip > 0.25) {
        details.push(`  Rain: ${r.summary.totalPrecip.toFixed(2)}" expected`);
      }

      // Wind details
      if (r.summary?.maxWindGust >= 25) {
        details.push(`  Wind: Gusts up to ${r.summary.maxWindGust} mph`);
      }

      // Top cities if available
      if (r.cities && r.cities.length > 0) {
        const topCities = r.cities.slice(0, 3).map((c: any) => {
          let cityInfo = `${c.name} (${Math.round(c.tmax || c.high || 50)}°F`;
          if (c.snow > 0) cityInfo += `, ${c.snow}" snow`;
          else if (c.rain > 0.1) cityInfo += `, ${c.rain}" rain`;
          cityInfo += ')';
          return cityInfo;
        }).join(', ');
        details.push(`  Cities: ${topCities}`);
      }

      return details.join('\n');
    }).join('\n\n');

    // Generate national narrative
    const nationalPrompt = `You are a professional meteorologist writing a detailed weather synopsis for the United States.

CURRENT WEATHER DATA BY REGION:
${regionDetails}

National Summary:
- Overall Risk Level: ${forecast.national.level} (${forecast.national.overallRisk}/10)
- Active Regions: ${forecast.national.activeRegions.join(', ') || 'None with elevated risk'}

INSTRUCTIONS:
Write a detailed 2-paragraph national weather outlook based on the ACTUAL DATA above:

Paragraph 1: Lead with the most significant weather story. Mention specific cities, temperatures, precipitation amounts (snow/rain totals), and wind speeds from the data. Focus on areas with active weather first.

Paragraph 2: Cover the quieter regions with their temperature ranges and conditions. Mention specific cities and their expected highs/lows.

IMPORTANT: Use the specific numbers and city names from the data above. Do not invent conditions - only reference what's in the data. Be professional and factual. No emojis.`;

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
      // Build city details for this region
      let cityDetails = '';
      if (region.cities && region.cities.length > 0) {
        cityDetails = region.cities.slice(0, 5).map((c: any) => {
          let info = `${c.name}: ${Math.round(c.tmax || c.high || 50)}°F high, ${Math.round(c.tmin || c.low || 30)}°F low`;
          if (c.snow > 0) info += `, ${c.snow}" snow`;
          else if (c.rain > 0.1) info += `, ${c.rain}" rain`;
          if (c.windGust >= 30) info += `, ${c.windGust} mph gusts`;
          return info;
        }).join('\n');
      }

      const regionPrompt = `Write a weather summary for ${region.region.name}:

WEATHER DATA:
- Risk Level: ${region.risk.level} (${region.risk.overall}/10)
- Temperature Range: Lows ${Math.round(region.summary.tempRange.min)}°F to Highs ${Math.round(region.summary.tempRange.max)}°F
- Snow Total: ${region.summary.totalSnow.toFixed(1)}"
- Rain Total: ${region.summary.totalPrecip.toFixed(2)}"
- Max Wind Gusts: ${region.summary.maxWindGust} mph
${cityDetails ? `\nCITY DETAILS:\n${cityDetails}` : ''}

Format your response EXACTLY as:
HEADLINE: [One short, specific headline mentioning key weather feature and a city if applicable]
SUMMARY: [2-3 sentences describing conditions with specific temperatures, precipitation amounts, and city names from the data above. Be specific, not generic.]`;

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
