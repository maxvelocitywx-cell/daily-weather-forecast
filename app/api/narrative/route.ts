import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { NarrativeResponse, NationalNarrative, RegionNarrative } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Technical meteorologist system prompt
const METEOROLOGIST_SYSTEM_PROMPT = `You are an elite operational meteorologist writing technical weather briefings. Your style:

TONE & VOCABULARY:
- Use precise meteorological terminology (850mb temperatures, synoptic scale, instability, CAA, WAA, etc.)
- Reference specific model data, NWS office codes (BUF, DTX, OKX), and product types (AFDs, MESOs)
- Include quantitative details: snowfall rates (inches/hour), accumulations, wind chills, temperatures at pressure levels
- Mention atmospheric dynamics: Arctic boundaries, clipper systems, shortwave troughs, jet stream positioning
- Reference space weather when relevant: CMEs, geomagnetic storm levels (G1-G5), solar flares (X-class, M-class)

STRUCTURE:
- Lead with the most impactful weather story using dramatic but accurate language
- Include specific numbers: "2-4 inches per hour", "-30F to -50F wind chills", "850mb temps of -20C"
- Reference local NWS offices and their products: "AFDs from BUF and DTX highlight..."
- Compare to previous day or climatology when relevant
- End with secondary concerns (fire weather, marine, etc.)

NEVER:
- Use generic phrases like "stay safe" or "bundle up"
- Be vague - always use specific numbers and locations
- Make up data - only use what's provided
- Sound like a TV weatherperson - sound like an NWS forecaster

ALWAYS:
- Sound urgent when conditions warrant
- Use technical meteorological terms
- Reference specific NWS offices, products, and advisories
- Include atmospheric levels (850mb, 500mb) when discussing temperature advection or dynamics`;

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
 * Fetch SPC Day 1 Convective Outlook
 */
async function fetchSPCOutlook(): Promise<string | null> {
  try {
    const response = await fetch('https://www.spc.noaa.gov/products/outlook/day1otlk.html', {
      headers: { 'User-Agent': 'MaxVelocityWX (weather@example.com)' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const html = await response.text();
    // Extract text content between common markers
    const match = html.match(/CONVECTIVE OUTLOOK[\s\S]*?(?=<\/pre>|<\/body>)/i);
    return match ? match[0].slice(0, 2000) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch SWPC Space Weather Forecast
 */
async function fetchSpaceWeather(): Promise<string | null> {
  try {
    const response = await fetch('https://services.swpc.noaa.gov/text/discussion.txt', {
      headers: { 'User-Agent': 'MaxVelocityWX (weather@example.com)' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    return (await response.text()).slice(0, 1500);
  } catch {
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

    // Fetch all data sources in parallel
    const [wpcDiscussion, spcOutlook, spaceWeather, forecastRes, wssiRes] = await Promise.all([
      fetchWPCDiscussion(),
      fetchSPCOutlook(),
      fetchSpaceWeather(),
      fetch(`${baseUrl}/api/forecast`),
      fetch(`${baseUrl}/api/wssi/day/1`).catch(() => null),
    ]);

    if (!forecastRes.ok) {
      throw new Error('Failed to fetch forecast data');
    }

    const forecast = await forecastRes.json();
    const wssiData = wssiRes?.ok ? await wssiRes.json() : null;

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

    // Build comprehensive data context
    const wpcContext = wpcDiscussion
      ? `=== WPC EXTENDED FORECAST DISCUSSION ===\n${wpcDiscussion.slice(0, 4000)}\n`
      : '';

    const spcContext = spcOutlook
      ? `=== SPC DAY 1 CONVECTIVE OUTLOOK ===\n${spcOutlook}\n`
      : '';

    const spaceWeatherContext = spaceWeather
      ? `=== SWPC SPACE WEATHER DISCUSSION ===\n${spaceWeather}\n`
      : '';

    const wssiContext = wssiData?.features?.length > 0
      ? `=== WSSI WINTER STORM SEVERITY ===\nActive winter storm impacts detected across ${wssiData.features.length} areas.\n`
      : '';

    const nationalPrompt = `You are writing today's National Weather Synopsis.

${wpcContext}
${spcContext}
${spaceWeatherContext}
${wssiContext}

=== NUMERICAL FORECAST DATA BY REGION ===
${regionDetails}

---

Write the National Synopsis in this EXACT format:

SYNOPSIS:
[Write 2-3 paragraphs as a technical meteorological overview. Include:
- 850mb temperatures, pressure patterns, jet stream positioning where relevant
- Specific snowfall rates and accumulations (e.g., "2-4 inches per hour", "12-18" totals")
- Wind chill values with specific ranges (e.g., "-20F to -35F wind chills")
- Reference specific NWS offices when discussing regional impacts (e.g., "AFDs from BUF, DTX highlight...")
- Space weather impacts if any CMEs or geomagnetic storms are mentioned in SWPC data
- Fire weather, marine concerns as secondary notes if applicable
- Use dramatic but accurate language for significant events
- Reference the synoptic setup: Arctic boundaries, clipper systems, shortwave troughs, frontal positions]

HIGHLIGHTS:
• [Most significant weather story with specific numbers - e.g., "Heavy Lake-Effect Snow: 2-4 ft accumulations downwind of Lakes Erie and Ontario"]
• [Second major story with quantitative detail - e.g., "Dangerous Wind Chills: -30F to -50F across Northern Plains"]
• [Third highlight with specific impacts]
• [Fourth highlight if warranted - could be space weather, fire weather, etc.]
• [Fifth highlight if warranted - secondary concerns or notable temperature anomalies]

Keep the tone urgent and technical when conditions warrant. Reference specific data from the provided sources. Sound like an NWS operational forecaster, not a TV weatherperson.`;

    const nationalResponse = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: METEOROLOGIST_SYSTEM_PROMPT },
        { role: 'user', content: nationalPrompt }
      ],
      max_tokens: 1200,
      temperature: 0.6,
    });

    const nationalText = nationalResponse.choices[0]?.message?.content || '';

    // Parse the response (handle both SYNOPSIS and SUMMARY)
    const synopsisMatch = nationalText.match(/(?:SYNOPSIS|SUMMARY):\s*([\s\S]*?)(?=HIGHLIGHTS:|$)/i);
    const highlightsMatch = nationalText.match(/HIGHLIGHTS:\s*([\s\S]*)/i);

    const overviewText = synopsisMatch?.[1]?.trim() || nationalText;

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

      // Calculate wind chill if cold enough
      const minTemp = Math.round(region.summary.tempRange.min);
      const maxWind = region.summary.maxWindGust;
      let windChillNote = '';
      if (minTemp <= 32 && maxWind >= 10) {
        // Simple wind chill approximation
        const windChill = Math.round(35.74 + 0.6215 * minTemp - 35.75 * Math.pow(maxWind, 0.16) + 0.4275 * minTemp * Math.pow(maxWind, 0.16));
        windChillNote = `\n- Wind Chill: As low as ${windChill}°F`;
      }

      const regionPrompt = `Write a technical weather briefing for ${region.region.name}:

WEATHER DATA:
- Risk Level: ${region.risk.level} (${region.risk.overall}/10)
- Temperature Range: Lows ${minTemp}°F to Highs ${Math.round(region.summary.tempRange.max)}°F
- Snow Total: ${region.summary.totalSnow.toFixed(1)}"
- Rain Total: ${region.summary.totalPrecip.toFixed(2)}"
- Max Wind Gusts: ${maxWind} mph${windChillNote}

CITY DATA:
${cityDetails || 'No city-level data available'}

Format your response EXACTLY as:
HEADLINE: [Technical headline with specific numbers - e.g., "Arctic Air Mass: -10F to 15F with 2-4" Snow" or "Quiet Pattern: Highs near 45°F, dry conditions"]
SUMMARY: [2-3 sentences using meteorological terminology. Reference synoptic features (clipper systems, cold air advection, frontal boundaries). Include specific temperatures, accumulations, and wind values from the data. Mention relevant NWS offices for this region if applicable.]`;

      try {
        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an NWS operational meteorologist writing regional weather briefings. Use technical terminology, specific numbers, and reference synoptic features. Never be vague or use generic phrases.' },
            { role: 'user', content: regionPrompt }
          ],
          max_tokens: 200,
          temperature: 0.6,
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
