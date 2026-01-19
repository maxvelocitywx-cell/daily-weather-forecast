import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { NarrativeResponse, NationalNarrative, RegionNarrative } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Fetch WPC Extended Forecast Discussion
 * https://www.wpc.ncep.noaa.gov/discussions/pmdepd.html
 */
async function fetchWPCDiscussion(): Promise<string | null> {
  try {
    // WPC provides the discussion in plain text format
    const response = await fetch('https://www.wpc.ncep.noaa.gov/discussions/pmdepd.txt', {
      headers: {
        'User-Agent': 'MaxVelocityWX (weather@example.com)',
      },
      next: { revalidate: 21600 }, // Cache for 6 hours
    });

    if (!response.ok) {
      console.error('WPC discussion fetch failed:', response.status);
      return null;
    }

    const text = await response.text();
    return text;
  } catch (error) {
    console.error('Error fetching WPC discussion:', error);
    return null;
  }
}

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

    // Fetch WPC discussion and forecast data in parallel
    const [wpcDiscussion, forecastRes] = await Promise.all([
      fetchWPCDiscussion(),
      fetch(`${baseUrl}/api/forecast`),
    ]);

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

    // Generate national narrative using WPC discussion
    const wpcContext = wpcDiscussion
      ? `\nWPC EXTENDED FORECAST DISCUSSION (official NWS source):\n${wpcDiscussion.slice(0, 4000)}\n`
      : '';

    const nationalPrompt = `You are a professional meteorologist summarizing the national weather outlook.

${wpcContext}

CURRENT WEATHER DATA BY REGION:
${regionDetails}

INSTRUCTIONS:
Based on the WPC Extended Forecast Discussion above (if available) and the regional weather data, provide:

1. WEATHER HIGHLIGHTS AND HAZARDS: Write a 2-3 paragraph summary of the main weather story across the US. Focus on:
   - Active weather systems and their impacts
   - Significant hazards (winter storms, severe weather, flooding, etc.)
   - Temperature patterns and anomalies
   - Mention specific cities and regions affected

2. Then provide exactly 3-5 bullet point HIGHLIGHTS (short, impactful statements about key weather features)

Format your response EXACTLY as:
SUMMARY:
[2-3 paragraphs of weather highlights and hazards]

HIGHLIGHTS:
• [First highlight - most significant weather story]
• [Second highlight]
• [Third highlight]
• [Fourth highlight if warranted]
• [Fifth highlight if warranted]

Be professional, specific, and factual. Reference the WPC discussion content when available. No emojis.`;

    const nationalResponse = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: nationalPrompt }],
      max_tokens: 800,
      temperature: 0.5,
    });

    const nationalText = nationalResponse.choices[0]?.message?.content || '';

    // Parse the response
    const summaryMatch = nationalText.match(/SUMMARY:\s*([\s\S]*?)(?=HIGHLIGHTS:|$)/i);
    const highlightsMatch = nationalText.match(/HIGHLIGHTS:\s*([\s\S]*)/i);

    const overviewText = summaryMatch?.[1]?.trim() || nationalText;

    // Extract bullet points from highlights
    const highlightsText = highlightsMatch?.[1] || '';
    const highlights = highlightsText
      .split(/[•\-\*]/)
      .map((h: string) => h.trim())
      .filter((h: string) => h.length > 10)
      .slice(0, 5);

    // If no highlights extracted, generate from active regions
    const finalHighlights = highlights.length > 0
      ? highlights
      : forecast.national.activeRegions.map((regionId: string) => {
          const region = forecast.regions.find((r: any) => r.region.id === regionId);
          return region ? `${region.region.name}: ${region.risk.headline}` : '';
        }).filter(Boolean).slice(0, 5);

    // Add fallback highlights if still empty
    if (finalHighlights.length === 0) {
      finalHighlights.push('Quiet weather pattern across much of the US');
      finalHighlights.push('No significant hazards expected');
    }

    const nationalNarrative: NationalNarrative = {
      headline: forecast.national.activeRegions.length > 0
        ? `Active weather across ${forecast.national.activeRegions.length} region${forecast.national.activeRegions.length > 1 ? 's' : ''}`
        : 'Quiet conditions nationwide',
      overview: overviewText,
      highlights: finalHighlights,
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
