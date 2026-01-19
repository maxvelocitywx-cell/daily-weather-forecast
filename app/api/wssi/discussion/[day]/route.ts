import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache discussions for 6 hours
const discussionCache: Record<string, { content: string; timestamp: number; issueTime: string }> = {};
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours in ms

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ day: string }> }
) {
  const { day: dayStr } = await params;
  const day = parseInt(dayStr);

  if (isNaN(day) || day < 1 || day > 3) {
    return Response.json({ error: 'Invalid day. Must be 1, 2, or 3.' }, { status: 400 });
  }

  const cacheKey = `day-${day}`;

  // Check cache
  const cached = discussionCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return Response.json({
      discussion: cached.content,
      cached: true,
      issueTime: cached.issueTime,
      nextUpdate: new Date(cached.timestamp + CACHE_DURATION).toISOString(),
    });
  }

  try {
    // Fetch current WSSI data for context
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://us-weather-synopsis.vercel.app';
    const wssiResponse = await fetch(`${baseUrl}/api/wssi/day/${day}?res=overview`, {
      headers: { 'Cache-Control': 'no-cache' },
    });

    let wssiContext = 'No WSSI data available';
    let categoriesPresent: string[] = [];

    if (wssiResponse.ok) {
      const wssiData = await wssiResponse.json();
      if (wssiData.features && wssiData.features.length > 0) {
        // Extract unique categories and their details
        const categoryMap: Record<string, { count: number; label: string }> = {};
        for (const feature of wssiData.features) {
          const label = feature.properties?.riskLabel || 'Unknown';
          const originalLabel = feature.properties?.originalLabel || '';
          if (!categoryMap[label]) {
            categoryMap[label] = { count: 0, label: originalLabel };
          }
          categoryMap[label].count++;
        }
        categoriesPresent = Object.keys(categoryMap);
        wssiContext = `Categories present: ${categoriesPresent.join(', ')}. Details: ${JSON.stringify(categoryMap)}`;
      } else {
        wssiContext = 'No significant winter weather impacts expected.';
      }
    }

    // Calculate issue time (round to nearest 6 hours)
    const now = new Date();
    const issueHour = Math.floor(now.getUTCHours() / 6) * 6;
    const issueTime = new Date(now);
    issueTime.setUTCHours(issueHour, 0, 0, 0);

    // Determine if there's active winter weather
    const hasActiveWeather = categoriesPresent.length > 0;

    const prompt = `You are a professional meteorologist writing an official Winter Storm Severity Index (WSSI) forecast discussion for the National Weather Service.

Based on the following WSSI data for Day ${day} (${day === 1 ? 'today' : day === 2 ? 'tomorrow' : 'day after tomorrow'}), write a detailed forecast discussion:

WSSI DATA:
${wssiContext}

${hasActiveWeather ? `
Write the discussion in this EXACT format:

DAY ${day} WINTER STORM OUTLOOK
Issued: ${issueTime.toUTCString()}

[WRITE A SHORT ALL-CAPS HEADLINE SUMMARIZING THE MAIN THREAT]

SUMMARY
[2-3 sentences giving an overview of the main threats, affected locations, and timing]

REGIONAL BREAKDOWN
[For each affected region, write a paragraph with specific details about expected conditions, snowfall amounts, timing, and impacts. Include regions like: Great Lakes, Northeast, Mid-Atlantic, Upper Midwest, Central Plains, Pacific Northwest, Rocky Mountains, etc. Only include regions that are actually affected.]

EXPECTED IMPACTS
• [List 4-6 bullet points of expected impacts: travel disruptions, power outages, school closures, etc.]

FORECAST CONFIDENCE
[One sentence on forecast confidence level and reasoning]

---
Next update: ${new Date(Date.now() + CACHE_DURATION).toUTCString()}
` : `
Write a brief discussion noting that no significant winter weather is expected for Day ${day}. Keep it professional and concise:

DAY ${day} WINTER STORM OUTLOOK
Issued: ${issueTime.toUTCString()}

NO SIGNIFICANT WINTER WEATHER EXPECTED

[Write 2-3 sentences explaining the quiet weather pattern]

---
Next update: ${new Date(Date.now() + CACHE_DURATION).toUTCString()}
`}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.7,
    });

    const discussion = completion.choices[0].message.content || 'Unable to generate forecast discussion.';

    // Cache the result
    discussionCache[cacheKey] = {
      content: discussion,
      timestamp: Date.now(),
      issueTime: issueTime.toISOString(),
    };

    return Response.json({
      discussion,
      cached: false,
      issueTime: issueTime.toISOString(),
      nextUpdate: new Date(Date.now() + CACHE_DURATION).toISOString(),
    });
  } catch (error) {
    console.error('[WSSI Discussion] Error:', error);
    return Response.json(
      { error: 'Failed to generate forecast discussion' },
      { status: 500 }
    );
  }
}
