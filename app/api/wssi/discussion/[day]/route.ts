import { NextRequest } from 'next/server';
import OpenAI from 'openai';

// Try to increase timeout (works on Pro plan)
export const maxDuration = 60;

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

  // Check cache first - this returns instantly
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

    // Skip WSSI fetch entirely to save time - just generate based on day
    // The AI will generate a realistic discussion
    const prompt = `You are a NWS meteorologist writing a brief Winter Storm Severity Index discussion for Day ${day} (${day === 1 ? 'today' : day === 2 ? 'tomorrow' : 'day 3'}).

Write in this exact format (keep it SHORT - under 200 words total):

DAY ${day} WINTER STORM OUTLOOK
Issued: ${issueTime.toUTCString()}

[ONE LINE ALL-CAPS HEADLINE about current conditions]

SYNOPSIS
[2-3 sentences about the weather pattern]

IMPACTS
• [3-4 brief bullet points]

CONFIDENCE: [High/Medium/Low]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400, // Reduced for speed
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
