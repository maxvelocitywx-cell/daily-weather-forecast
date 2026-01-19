import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface WeatherHighlight {
  title: string;
  detail: string;
  severity: 'extreme' | 'high' | 'moderate' | 'low';
}

/**
 * GET /api/weather-highlights
 * Returns structured weather highlights with severity levels
 */
export async function GET(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

    // Fetch forecast and WSSI data in parallel
    const [forecastRes, wssiRes] = await Promise.all([
      fetch(`${baseUrl}/api/forecast`),
      fetch(`${baseUrl}/api/wssi/day/1`).catch(() => null),
    ]);

    if (!forecastRes.ok) {
      throw new Error('Failed to fetch forecast data');
    }

    const forecast = await forecastRes.json();
    const wssiData = wssiRes?.ok ? await wssiRes.json() : null;

    // Build weather summary for highlights extraction
    const regionSummary = forecast.regions.map((r: any) => ({
      region: r.region.name,
      risk: r.risk.overall,
      high: Math.round(r.summary?.tempRange?.max || 50),
      low: Math.round(r.summary?.tempRange?.min || 30),
      snow: r.summary?.totalSnow || 0,
      rain: r.summary?.totalPrecip || 0,
      wind: r.summary?.maxWindGust || 0,
    }));

    const client = new OpenAI({ apiKey });

    const prompt = `Based on this weather data, extract the 5-6 most significant weather highlights happening RIGHT NOW.

=== REGIONAL DATA ===
${JSON.stringify(regionSummary, null, 2)}

=== WSSI WINTER STORM DATA ===
${wssiData?.features?.length ? `Active winter impacts in ${wssiData.features.length} areas` : 'No active winter storm impacts'}

=== NATIONAL SUMMARY ===
Overall Risk: ${forecast.national?.overallRisk || 'Unknown'}/10
Active Regions: ${forecast.national?.activeRegions?.join(', ') || 'None'}

---

Return ONLY a JSON array of highlights in this exact format:
[
  {
    "title": "Heavy Lake-Effect Snow",
    "detail": "2-4 ft accumulations expected",
    "severity": "high"
  },
  {
    "title": "Dangerous Wind Chills",
    "detail": "-30F to -50F across Northern Plains",
    "severity": "extreme"
  }
]

Rules:
- severity must be "extreme", "high", "moderate", or "low"
- Include specific numbers in the detail field (temperatures, accumulations, wind speeds)
- Only include highlights that are actually occurring based on the data
- Focus on impactful weather: snow accumulations, dangerous cold, severe weather, flooding risks
- If conditions are quiet, still provide highlights like "Dry Pattern" or "Seasonable Temperatures"
- Return 4-6 highlights maximum`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a meteorologist extracting key weather highlights. Return ONLY valid JSON array, no other text or markdown formatting.'
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 600,
      temperature: 0.3,
    });

    const responseText = completion.choices[0]?.message?.content || '[]';

    try {
      // Clean up potential markdown formatting
      const cleanedText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const highlights: WeatherHighlight[] = JSON.parse(cleanedText);

      return NextResponse.json({
        highlights,
        generatedAt: new Date().toISOString(),
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=900',
        },
      });
    } catch (parseError) {
      console.error('Failed to parse highlights JSON:', responseText);
      // Return fallback highlights
      return NextResponse.json({
        highlights: [
          {
            title: 'Weather Data Available',
            detail: 'Check regional forecasts for details',
            severity: 'low' as const,
          }
        ],
        generatedAt: new Date().toISOString(),
        error: 'Failed to parse AI response',
      });
    }
  } catch (error) {
    console.error('Weather highlights API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate weather highlights', highlights: [] },
      { status: 500 }
    );
  }
}
