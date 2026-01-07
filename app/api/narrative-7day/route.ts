import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { REGIONS, REGION_IDS } from '@/lib/regions';
import { RegionId } from '@/lib/types';
import { formatDayLabel, getNowInTimezone, DEFAULT_TIMEZONE } from '@/lib/formatDayLabel';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface DayNarrative {
  day: number;
  date: string;
  dayLabel: string;
  risk: number;
  narrative: string;
  hazards: string[];
}

interface SevenDayNarrativeResponse {
  days: DayNarrative[];
  generatedAt: string;
}

/**
 * GET /api/narrative-7day
 * Returns AI-generated 3-4 sentence narratives for each of the next 7 days
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

    // Aggregate 7-day data from all regions
    const dayData: Array<{
      day: number;
      date: string;
      avgRisk: number;
      maxRisk: number;
      hazards: Map<string, { count: number; maxValue: number; unit: string }>;
      activeRegions: string[];
    }> = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const hazards = new Map<string, { count: number; maxValue: number; unit: string }>();
      const activeRegions: string[] = [];
      let totalRisk = 0;
      let maxRisk = 0;
      let regionCount = 0;
      let date = '';

      for (const region of forecast.regions) {
        const dayRisk = region.risk.days[dayIndex];
        if (dayRisk) {
          date = dayRisk.date;
          totalRisk += dayRisk.score;
          maxRisk = Math.max(maxRisk, dayRisk.score);
          regionCount++;

          if (dayRisk.score >= 3) {
            activeRegions.push(region.region.name);
          }

          for (const hazard of dayRisk.hazards || []) {
            const existing = hazards.get(hazard.hazard) || { count: 0, maxValue: 0, unit: hazard.unit };
            existing.count++;
            existing.maxValue = Math.max(existing.maxValue, hazard.rawValue);
            hazards.set(hazard.hazard, existing);
          }
        }
      }

      dayData.push({
        day: dayIndex + 1,
        date,
        avgRisk: regionCount > 0 ? totalRisk / regionCount : 1,
        maxRisk,
        hazards,
        activeRegions,
      });
    }

    const client = new OpenAI({ apiKey });

    // Generate narratives for all 7 days in a single call for efficiency
    const dayDescriptions = dayData.map((d) => {
      const hazardsList = Array.from(d.hazards.entries())
        .map(([name, info]) => `${name}: up to ${info.maxValue.toFixed(1)}${info.unit} in ${info.count} region(s)`)
        .join('; ');

      return `Day ${d.day} (${d.date}):
- National avg risk: ${d.avgRisk.toFixed(1)}/10, max: ${d.maxRisk.toFixed(1)}/10
- Active regions: ${d.activeRegions.length > 0 ? d.activeRegions.join(', ') : 'None'}
- Hazards: ${hazardsList || 'None significant'}`;
    }).join('\n\n');

    const prompt = `You are a professional meteorologist writing 7-day weather forecasts for the United States.

Below is weather data for each of the next 7 days:

${dayDescriptions}

For EACH day, write a 3-4 sentence narrative paragraph. Each narrative should:
1. Lead with the main weather story for that day
2. Mention which regions will see the most significant weather
3. Include specific values when hazards exist (inches of snow/rain, wind speeds)
4. Be professional, factual, and avoid sensationalism
5. Do NOT use emojis

Format your response as JSON with this structure:
{
  "narratives": [
    {"day": 1, "narrative": "..."},
    {"day": 2, "narrative": "..."},
    ...
  ]
}

Only output valid JSON, no other text.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{"narratives": []}';
    let parsed: { narratives: Array<{ day: number; narrative: string }> };

    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { narratives: [] };
    }

    // Build response
    const days: DayNarrative[] = dayData.map((d, i) => {
      const narrativeData = parsed.narratives.find((n) => n.day === d.day);

      // Use canonical formatDayLabel for consistent day naming
      const now = getNowInTimezone(DEFAULT_TIMEZONE);
      const labelResult = formatDayLabel(d.date, now, DEFAULT_TIMEZONE);
      const dayLabel = labelResult.dayName;

      return {
        day: d.day,
        date: d.date,
        dayLabel,
        risk: Math.round(d.avgRisk * 10) / 10,
        narrative: narrativeData?.narrative || 'Forecast narrative temporarily unavailable.',
        hazards: Array.from(d.hazards.keys()),
      };
    });

    const result: SevenDayNarrativeResponse = {
      days,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('7-day narrative API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate 7-day narratives' },
      { status: 500 }
    );
  }
}
