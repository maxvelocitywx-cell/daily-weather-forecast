/**
 * OpenAI-based region/day narrative generation
 * Uses computed metrics only - never hallucinates data
 */

import OpenAI from 'openai';
import { RegionId } from './types';
import { RegionDayMetrics } from './regionMetrics';
import { formatDayLabel, getNowInTimezone, DEFAULT_TIMEZONE } from './formatDayLabel';

// ============================================================================
// Types
// ============================================================================

export interface NarrativeResult {
  narrative: string;
  generatedAt: string;
  dayIndex: number;
  regionId: RegionId;
}

export interface NarrativeCacheEntry {
  narrative: string;
  generatedAt: string;
  expiresAt: number;
}

// In-memory cache (10-30 min TTL)
const narrativeCache = new Map<string, NarrativeCacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ============================================================================
// Region name mapping
// ============================================================================

const REGION_NAMES: Record<RegionId, string> = {
  'northeast': 'Northeast',
  'southeast': 'Southeast',
  'midwest': 'Midwest',
  'southern_plains': 'Southern Plains',
  'northern_plains': 'Northern Plains',
  'northwest': 'Northwest',
  'southwest': 'Southwest',
};

// ============================================================================
// OpenAI client
// ============================================================================

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ============================================================================
// Narrative generation
// ============================================================================

/**
 * Generate a region/day narrative using OpenAI
 * Uses only the computed metrics - no hallucination
 *
 * @param metrics - Pre-computed region/day metrics
 * @param wpcSnippet - Optional WPC discussion snippet (Day 1-2 only)
 * @returns Narrative string (3-6 sentences)
 */
export async function generateRegionNarrative(
  metrics: RegionDayMetrics,
  wpcSnippet?: string
): Promise<NarrativeResult> {
  const cacheKey = `${metrics.regionId}-${metrics.dayIndex}-${metrics.date}`;

  // Check cache
  const cached = narrativeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      narrative: cached.narrative,
      generatedAt: cached.generatedAt,
      dayIndex: metrics.dayIndex,
      regionId: metrics.regionId,
    };
  }

  const regionName = REGION_NAMES[metrics.regionId] || metrics.regionId;
  const dayLabel = getDayLabel(metrics.dayIndex);

  // Build the structured prompt
  const metricsJson = buildMetricsJson(metrics);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(regionName, dayLabel, metricsJson, metrics, wpcSnippet);

  try {
    const client = getOpenAIClient();

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.4,
    });

    const narrative = completion.choices[0]?.message?.content?.trim() ||
      generateFallbackNarrative(metrics, regionName, dayLabel);

    // Cache the result
    const generatedAt = new Date().toISOString();
    narrativeCache.set(cacheKey, {
      narrative,
      generatedAt,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return {
      narrative,
      generatedAt,
      dayIndex: metrics.dayIndex,
      regionId: metrics.regionId,
    };
  } catch (error) {
    console.error('OpenAI narrative generation failed:', error);
    // Return fallback narrative
    const fallback = generateFallbackNarrative(metrics, regionName, dayLabel);
    return {
      narrative: fallback,
      generatedAt: new Date().toISOString(),
      dayIndex: metrics.dayIndex,
      regionId: metrics.regionId,
    };
  }
}

/**
 * Build system prompt for narrative generation
 */
function buildSystemPrompt(): string {
  return `You are a professional weather forecaster writing regional weather narratives.

CRITICAL RULES:
1. Use ONLY the provided metrics - do not invent or hallucinate any data
2. Never claim specific amounts unless they appear in the metrics
3. Write 3-6 sentences in plain prose (no bullet points, no markdown)
4. Focus on: main drivers, likely hazards, impacted cities (from topCities), and uncertainty for days 4-7
5. If metrics show low values across the board, simply state it will be quiet
6. For coverage percentages, use the provided fractions (0.0-1.0) - multiply by 100 for percent
7. Never mention ice/freezing rain unless explicitly in the metrics
8. When uncertain, acknowledge uncertainty rather than speculating

Style:
- Professional, concise, broadcast-style language
- Avoid sensationalism for low-risk days
- Use city names from topCities to add geographic specificity
- For days 6-7, explicitly note forecast confidence is lower`;
}

/**
 * Build the user prompt with all metrics
 */
function buildUserPrompt(
  regionName: string,
  dayLabel: string,
  metricsJson: string,
  metrics: RegionDayMetrics,
  wpcSnippet?: string
): string {
  let prompt = `Write a weather narrative for the ${regionName} region for ${dayLabel}.

METRICS (use ONLY these values):
${metricsJson}

`;

  if (wpcSnippet && metrics.dayIndex <= 2) {
    prompt += `WPC DISCUSSION (supplemental context, Day 1-2 only):
${wpcSnippet}

`;
  }

  if (metrics.topCities.length > 0) {
    const topCityNames = metrics.topCities
      .slice(0, 4)
      .map(c => `${c.name} (${c.score.toFixed(1)}, ${c.primaryHazard || 'quiet'})`)
      .join(', ');
    prompt += `TOP IMPACT CITIES: ${topCityNames}\n\n`;
  }

  if (metrics.dayIndex >= 6) {
    prompt += `NOTE: This is Day ${metrics.dayIndex} - acknowledge lower forecast confidence.\n\n`;
  }

  prompt += `Write 3-6 sentences covering: pattern/drivers, hazards, impacted areas, and any uncertainty.`;

  return prompt;
}

/**
 * Build metrics JSON for the prompt
 */
function buildMetricsJson(metrics: RegionDayMetrics): string {
  const obj: Record<string, unknown> = {
    date: metrics.date,
    dayIndex: metrics.dayIndex,
    temperature: {
      min_p10: metrics.temp_min_p10,
      max_p90: metrics.temp_max_p90,
      min_avg: metrics.temp_min_avg,
      max_avg: metrics.temp_max_avg,
    },
    wind: {
      gust_p90: metrics.wind_gust_p90,
      gust_max: metrics.wind_gust_max,
    },
    rain: {
      p75: metrics.rain_p75,
      p90: metrics.rain_p90,
      max: metrics.rain_max,
      coverage_fraction: metrics.rain_cov,
    },
    snow: {
      p75: metrics.snow_p75,
      p90: metrics.snow_p90,
      max: metrics.snow_max,
      coverage_fraction: metrics.snow_cov,
    },
    coverage: {
      rain_25_pct: Math.round(metrics.rain_cov * 100),
      snow_1in_pct: Math.round(metrics.snow_cov * 100),
      windy_30mph_pct: Math.round(metrics.windy_cov * 100),
    },
    risk: {
      average: metrics.risk_avg,
      max: metrics.risk_max,
      level: metrics.risk_level,
    },
    cityCount: metrics.cityCount,
  };

  if (metrics.spc_max) {
    obj.spc_outlook = metrics.spc_max;
  }
  if (metrics.ero_max) {
    obj.ero_outlook = metrics.ero_max;
  }

  return JSON.stringify(obj, null, 2);
}

/**
 * Generate a fallback narrative when OpenAI fails
 */
function generateFallbackNarrative(
  metrics: RegionDayMetrics,
  regionName: string,
  dayLabel: string
): string {
  const sentences: string[] = [];

  // Opening sentence based on risk level
  if (metrics.risk_avg < 2) {
    sentences.push(`The ${regionName} expects a generally quiet ${dayLabel} with no significant weather hazards.`);
  } else if (metrics.risk_avg < 3.5) {
    sentences.push(`The ${regionName} will see some weather activity for ${dayLabel}.`);
  } else if (metrics.risk_avg < 5) {
    sentences.push(`Active weather is expected across the ${regionName} for ${dayLabel}.`);
  } else {
    sentences.push(`Significant impacts are likely across the ${regionName} for ${dayLabel}.`);
  }

  // Snow sentence
  if (metrics.snow_max >= 1) {
    const coverage = Math.round(metrics.snow_cov * 100);
    if (metrics.snow_max >= 4) {
      sentences.push(`Heavy snow with locally up to ${metrics.snow_max.toFixed(1)}" is possible, affecting ${coverage}% of the region.`);
    } else {
      sentences.push(`Snow accumulations up to ${metrics.snow_max.toFixed(1)}" expected in some areas.`);
    }
  }

  // Rain sentence
  if (metrics.rain_max >= 0.5) {
    const coverage = Math.round(metrics.rain_cov * 100);
    if (metrics.rain_max >= 1) {
      sentences.push(`Heavy rain with locally ${metrics.rain_max.toFixed(2)}" possible, covering ${coverage}% of cities.`);
    } else {
      sentences.push(`Rain expected for ${coverage}% of the region.`);
    }
  }

  // Wind sentence
  if (metrics.wind_gust_max >= 30) {
    const coverage = Math.round(metrics.windy_cov * 100);
    sentences.push(`Gusty winds up to ${metrics.wind_gust_max} mph affecting ${coverage}% of the area.`);
  }

  // Top cities
  if (metrics.topCities.length > 0 && metrics.risk_avg >= 2.5) {
    const cityNames = metrics.topCities.slice(0, 3).map(c => c.name).join(', ');
    sentences.push(`Highest impacts expected near ${cityNames}.`);
  }

  // Uncertainty for extended
  if (metrics.dayIndex >= 6) {
    sentences.push(`Extended forecast confidence is lower for this time range.`);
  }

  // Overlays
  if (metrics.spc_max) {
    sentences.push(`The Storm Prediction Center has a ${metrics.spc_max} severe weather risk.`);
  }
  if (metrics.ero_max) {
    sentences.push(`WPC has issued a ${metrics.ero_max} Excessive Rainfall Outlook.`);
  }

  return sentences.slice(0, 6).join(' ');
}

/**
 * Get narrative-friendly day label using canonical formatDayLabel
 * Returns "today (Monday)", "tomorrow (Tuesday)", or just "Wednesday"
 */
function getDayLabel(dayIndex: number, date?: string): string {
  // Simple version: use dayIndex only
  const label = formatDayLabel(dayIndex);

  // If we have a date, get the weekday name for extended format
  if (date) {
    const now = getNowInTimezone(DEFAULT_TIMEZONE);
    const result = formatDayLabel(date, now, DEFAULT_TIMEZONE);

    if (result.isToday) return `today (${result.dayName === 'Today' ? getDayOfWeek(date) : result.dayName})`;
    if (result.isTomorrow) return `tomorrow (${getDayOfWeek(date)})`;
    return result.dayName;
  }

  // Fallback for dayIndex-only version (get weekday from computed date)
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + dayIndex - 1);
  const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

  if (dayIndex === 1) return `today (${dayOfWeek})`;
  if (dayIndex === 2) return `tomorrow (${dayOfWeek})`;
  return dayOfWeek;
}

function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * Invalidate cache for a region
 */
export function invalidateRegionNarrativeCache(regionId: RegionId): void {
  for (const key of narrativeCache.keys()) {
    if (key.startsWith(regionId)) {
      narrativeCache.delete(key);
    }
  }
}

/**
 * Invalidate all narrative cache
 */
export function invalidateAllNarrativeCache(): void {
  narrativeCache.clear();
}

/**
 * Generate narratives for all 7 days for a region
 */
export async function generateRegionAllDaysNarratives(
  metricsArray: RegionDayMetrics[],
  wpcSnippetDay1?: string,
  wpcSnippetDay2?: string
): Promise<NarrativeResult[]> {
  const results: NarrativeResult[] = [];

  for (const metrics of metricsArray) {
    let wpcSnippet: string | undefined;
    if (metrics.dayIndex === 1) wpcSnippet = wpcSnippetDay1;
    if (metrics.dayIndex === 2) wpcSnippet = wpcSnippetDay2;

    const result = await generateRegionNarrative(metrics, wpcSnippet);
    results.push(result);
  }

  return results;
}
