import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { REGIONS } from '@/lib/regions';
import { RegionId } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/forecast-text?region=xxx&date=yyyy-mm-dd
 * Returns AI-generated forecast text for a specific region and day
 */
export async function GET(request: NextRequest) {
  const regionId = request.nextUrl.searchParams.get('region') as RegionId;
  const date = request.nextUrl.searchParams.get('date');

  if (!regionId || !REGIONS[regionId]) {
    return NextResponse.json({ error: 'Invalid region' }, { status: 400 });
  }

  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    const region = REGIONS[regionId];

    // Fetch forecast data
    const forecastRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/forecast`
    );

    if (!forecastRes.ok) {
      throw new Error('Failed to fetch forecast');
    }

    const forecast = await forecastRes.json();
    const regionForecast = forecast.regions.find((r: any) => r.region.id === regionId);

    if (!regionForecast) {
      return NextResponse.json({ error: 'Region not found' }, { status: 404 });
    }

    const dayData = regionForecast.risk.days.find((d: any) => d.date === date);

    if (!dayData) {
      return NextResponse.json({ error: 'Day not found' }, { status: 404 });
    }

    const client = new OpenAI({ apiKey });

    const prompt = `Write a 2-3 paragraph weather forecast for the ${region.name} region (${region.states.join(', ')}) for ${date}:

Conditions:
- Risk level: ${dayData.level} (${dayData.score}/10)
- Hazards: ${dayData.hazards.map((h: any) => `${h.hazard}: ${h.rawValue}${h.unit}`).join(', ') || 'None significant'}

Write like a professional NWS forecaster:
- Paragraph 1: Main weather story and timing
- Paragraph 2: Specific impacts and regional variations
- Paragraph 3: Outlook and advice (if needed)

Be specific about locations within the region. No emojis or sensationalism.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.7,
    });

    const forecastText = response.choices[0]?.message?.content || 'Forecast text unavailable.';

    return NextResponse.json(
      {
        region: regionId,
        date,
        forecast_text: forecastText,
        generated_at: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
        },
      }
    );
  } catch (error) {
    console.error('Forecast text API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate forecast text' },
      { status: 500 }
    );
  }
}
