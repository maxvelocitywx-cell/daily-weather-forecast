import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getCityById } from '@/lib/cities';
import { CityNarrative } from '@/lib/types';
import { formatDayLabel } from '@/lib/formatDayLabel';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/city-narrative?city_id=xxx&day=0
 * Returns AI-generated narrative for a specific city
 */
export async function GET(request: NextRequest) {
  const cityId = request.nextUrl.searchParams.get('city_id');
  const day = parseInt(request.nextUrl.searchParams.get('day') || '0', 10);

  if (!cityId) {
    return NextResponse.json({ error: 'city_id is required' }, { status: 400 });
  }

  const city = getCityById(cityId);
  if (!city) {
    return NextResponse.json({ error: 'City not found' }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    // Fetch city forecast data
    const cityRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/city?city_id=${cityId}`
    );

    if (!cityRes.ok) {
      throw new Error('Failed to fetch city data');
    }

    const { city: cityForecast } = await cityRes.json();
    const dayData = cityForecast.dailySummary[day];
    const dayRisk = cityForecast.dailyRisks[day];

    if (!dayData) {
      return NextResponse.json({ error: 'Day not found' }, { status: 404 });
    }

    const client = new OpenAI({ apiKey });

    // Use canonical formatDayLabel (day param is 0-indexed, so add 1)
    const dayLabel = formatDayLabel(day + 1);

    const prompt = `Write a brief weather narrative for ${city.name}, ${city.state} for ${dayLabel}:

Conditions:
- High: ${Math.round(dayData.tmax)}°F, Low: ${Math.round(dayData.tmin)}°F
- Snow: ${dayData.snow_total.toFixed(1)}"
- Rain: ${dayData.rain_total.toFixed(2)}"
- Wind gusts: ${Math.round(dayData.wind_gust_max)} mph
- Conditions: ${dayData.conditions?.primary || 'Unknown'}
- Risk level: ${dayRisk?.level || 'quiet'} (${dayRisk?.score_display || 1}/10)

Provide:
HEADLINE: [5-10 word headline]
SUMMARY: [2-3 sentences about weather and any impacts]
CONFIDENCE: [high/medium/low based on forecast uncertainty]

Keep it professional and factual. Focus on what matters to residents.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    });

    const text = response.choices[0]?.message?.content || '';
    const headlineMatch = text.match(/HEADLINE:\s*(.+)/i);
    // Use a simpler regex that works without the 's' flag
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+?)(?=CONFIDENCE:|$)/i);
    const confidenceMatch = text.match(/CONFIDENCE:\s*(\w+)/i);

    const narrative: CityNarrative = {
      cityId,
      headline: headlineMatch?.[1]?.trim() || `${dayLabel} forecast for ${city.name}`,
      summary: summaryMatch?.[1]?.trim() || 'Forecast details available.',
      confidence: confidenceMatch?.[1]?.toLowerCase() || 'medium',
      updatedUtc: new Date().toISOString(),
      disclaimer: 'Check official NWS alerts for watches and warnings.',
    };

    return NextResponse.json(
      { narrative },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
        },
      }
    );
  } catch (error) {
    console.error('City narrative API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate city narrative' },
      { status: 500 }
    );
  }
}
