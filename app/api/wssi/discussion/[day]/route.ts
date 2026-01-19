import { NextRequest } from 'next/server';
import OpenAI from 'openai';

// Increase timeout for this route
export const maxDuration = 30;

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
    // Calculate issue time (round to nearest 6 hours)
    const now = new Date();
    const issueHour = Math.floor(now.getUTCHours() / 6) * 6;
    const issueTime = new Date(now);
    issueTime.setUTCHours(issueHour, 0, 0, 0);

    // Try to fetch WSSI data with a short timeout
    let wssiContext = 'Current WSSI data unavailable - generate based on typical winter patterns';
    let categoriesPresent: string[] = [];

    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://us-weather-synopsis.vercel.app';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const wssiResponse = await fetch(`${baseUrl}/api/wssi/day/${day}?res=overview`, {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      clearTimeout(timeoutId);

      if (wssiResponse.ok) {
        const wssiData = await wssiResponse.json();
        if (wssiData.features && wssiData.features.length > 0) {
          // Extract unique categories
          const categories = new Set<string>();
          for (const feature of wssiData.features) {
            const label = feature.properties?.riskLabel;
            if (label) categories.add(label);
          }
          categoriesPresent = Array.from(categories);
          wssiContext = `Active winter weather categories: ${categoriesPresent.join(', ')}`;
        } else {
          wssiContext = 'No significant winter weather impacts currently shown on WSSI.';
        }
      }
    } catch (fetchErr) {
      console.log('[WSSI Discussion] WSSI fetch timed out or failed, proceeding without data');
    }

    const hasActiveWeather = categoriesPresent.length > 0;

    // Use gpt-4o-mini for faster responses
    const prompt = hasActiveWeather
      ? `You are a NWS meteorologist writing a WSSI forecast discussion.

Day ${day} (${day === 1 ? 'today' : day === 2 ? 'tomorrow' : 'day 3'})
${wssiContext}

Write in this format:

DAY ${day} WINTER STORM OUTLOOK
Issued: ${issueTime.toUTCString()}

[ALL-CAPS HEADLINE]

SUMMARY
[2-3 sentences on main threats]

REGIONAL BREAKDOWN
[1-2 paragraphs on affected regions]

EXPECTED IMPACTS
• [4-5 bullet points]

CONFIDENCE: [High/Medium/Low] - [brief reason]`
      : `You are a NWS meteorologist. Write a brief Day ${day} WSSI discussion noting no significant winter weather expected.

DAY ${day} WINTER STORM OUTLOOK
Issued: ${issueTime.toUTCString()}

NO SIGNIFICANT WINTER WEATHER EXPECTED

[2-3 sentences on the quiet pattern]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Faster model
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
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
      { error: 'Failed to generate forecast discussion. Please try again.' },
      { status: 500 }
    );
  }
}
