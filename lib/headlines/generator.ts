/**
 * Headlines Generator
 *
 * Uses OpenAI to generate weather headlines from the facts bundle.
 * Uses Structured Outputs for guaranteed JSON format.
 *
 * Now includes real-time observation/report data (EventFacts).
 */

import OpenAI from 'openai';
import { LegacyFactsBundle, Headline, HeadlinesSchema, EventFact } from './types';

const SYSTEM_PROMPT = `You are a professional meteorologist and weather news editor for a major US weather service.
Your job is to generate 10 concise, accurate weather headlines based ONLY on the provided data.

RULES:
1. Each headline must be max 90 characters
2. Headlines must be grounded in the provided facts - DO NOT invent or hallucinate
3. PRIORITIZE real-time reports (EventFacts) over general outlook information
4. For high-impact verified items, prefer:
   - Tornado reports and EF ratings
   - Wind gusts >= 70 mph
   - Hail >= 1.00"
   - Flash flood reports
5. Cover geographic diversity across the US when possible
6. Use active voice and present tense
7. Be specific about locations and magnitudes when data supports it
8. Include the exact source_url from the facts bundle for each headline
9. For event facts, include the lat/lon and timestamp in your response

CONFIDENCE LEVELS (use these based on data source):
- "measured" = From official station observations (ASOS/AWOS instruments)
- "reported" = From Local Storm Reports (LSR) / trained spotters
- "surveyed" = From official NWS damage surveys (EF ratings)
- "high" = Direct from official warnings/watches
- "medium" = Derived from outlook data
- "low" = Inferred or extended outlook

PRIORITY ORDER FOR HEADLINES:
1. Confirmed tornado reports or EF ratings
2. Measured/reported wind gusts >= 70 mph
3. Significant hail reports (>= 1.00")
4. Flash flood reports
5. Extreme temperatures (measured)
6. Active severe/winter/flood warnings
7. SPC/WPC outlooks at Enhanced or higher
8. Other significant weather

TOPIC MAPPING:
- severe: Tornadoes, severe thunderstorms, high winds, hail
- winter: Snow, ice, blizzards, wind chill, freeze
- flood: Flash floods, river flooding, coastal flooding, excessive rain
- tropical: Hurricanes, tropical storms, tropical depressions
- heat: Excessive heat, heat advisories, high temperatures
- fire: Red flag warnings, fire weather, dry conditions
- aviation: Dense fog, low visibility, aviation hazards
- marine: Marine warnings, high surf, rip currents
- general: General weather patterns, extended outlooks

NO duplicate stories - each headline must cover a distinct topic/area.
If there aren't 10 significant stories from real-time data, fill remaining slots with outlook info.`;

/**
 * Generate headlines using OpenAI with structured outputs
 * @deprecated Use generateVerifiedHeadlines from verified-generator instead
 */
export async function generateHeadlines(
  facts: LegacyFactsBundle,
  apiKey: string
): Promise<Headline[]> {
  const client = new OpenAI({ apiKey });

  // Build a compact facts summary for the prompt
  const factsPrompt = buildFactsPrompt(facts);

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: factsPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'weather_headlines',
          strict: true,
          schema: HeadlinesSchema,
        },
      },
      temperature: 0.3,
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const parsed = JSON.parse(content) as { headlines: Headline[] };

    // Validate and deduplicate
    const headlines = deduplicateHeadlines(parsed.headlines);

    // Ensure exactly 10 headlines
    while (headlines.length < 10) {
      headlines.push({
        id: `h${headlines.length + 1}`,
        headline: 'Quiet weather pattern expected across much of the nation',
        topic: 'general',
        confidence_label: 'Low',
        location: { state: 'United States', place: 'Nationwide' },
        timestamp_utc: new Date().toISOString(),
        source_name: 'NWS National Overview',
        source_url: 'https://www.weather.gov/',
        fact_ids: [],
      });
    }

    return headlines.slice(0, 10);
  } catch (error) {
    console.error('Error generating headlines:', error);
    throw error;
  }
}

/**
 * Build a compact facts prompt for the model
 */
function buildFactsPrompt(facts: LegacyFactsBundle): string {
  const sections: string[] = [];

  sections.push(`=== WEATHER DATA BUNDLE (${facts.generated_at}) ===\n`);

  // PRIORITY: Real-time event facts (LSR, station obs, storm events)
  if (facts.event_facts && facts.event_facts.length > 0) {
    sections.push('## REAL-TIME EVENT REPORTS (PRIORITY):');
    sections.push('(These are verified observations - prefer these for headlines)\n');

    // Group by type for easier reading
    const tornadoFacts = facts.event_facts.filter(f => f.type === 'tornado_report' || f.type === 'tornado_rating');
    const windFacts = facts.event_facts.filter(f => f.type === 'wind_gust');
    const hailFacts = facts.event_facts.filter(f => f.type === 'hail');
    const floodFacts = facts.event_facts.filter(f => f.type === 'flash_flood' || f.type === 'flood');
    const otherFacts = facts.event_facts.filter(f =>
      !['tornado_report', 'tornado_rating', 'wind_gust', 'hail', 'flash_flood', 'flood'].includes(f.type)
    );

    if (tornadoFacts.length > 0) {
      sections.push('### TORNADO REPORTS:');
      for (const fact of tornadoFacts.slice(0, 10)) {
        sections.push(formatEventFact(fact));
      }
      sections.push('');
    }

    if (windFacts.length > 0) {
      sections.push('### WIND REPORTS:');
      for (const fact of windFacts.slice(0, 15)) {
        sections.push(formatEventFact(fact));
      }
      sections.push('');
    }

    if (hailFacts.length > 0) {
      sections.push('### HAIL REPORTS:');
      for (const fact of hailFacts.slice(0, 10)) {
        sections.push(formatEventFact(fact));
      }
      sections.push('');
    }

    if (floodFacts.length > 0) {
      sections.push('### FLOOD REPORTS:');
      for (const fact of floodFacts.slice(0, 10)) {
        sections.push(formatEventFact(fact));
      }
      sections.push('');
    }

    if (otherFacts.length > 0) {
      sections.push('### OTHER REPORTS:');
      for (const fact of otherFacts.slice(0, 5)) {
        sections.push(formatEventFact(fact));
      }
      sections.push('');
    }
  }

  // Active alerts summary
  if (facts.alerts.length > 0) {
    sections.push('## ACTIVE NWS ALERTS:');
    for (const alert of facts.alerts.slice(0, 15)) {
      const states = alert.states.slice(0, 5).join(', ');
      sections.push(
        `- ${alert.event} (${alert.severity}/${alert.urgency}): ${states || 'Multiple areas'}`
      );
      if (alert.headline) {
        sections.push(`  Headline: "${alert.headline.slice(0, 100)}..."`);
      }
      sections.push(`  Source: ${alert.source_url}`);
    }
    sections.push(`  Total active alert types: ${facts.total_active_alerts}`);
    sections.push('');
  } else {
    sections.push('## ACTIVE NWS ALERTS: None currently active\n');
  }

  // SPC Outlooks
  if (facts.spc_outlooks.length > 0) {
    sections.push('## SPC CONVECTIVE OUTLOOKS:');
    for (const outlook of facts.spc_outlooks) {
      sections.push(
        `- Day ${outlook.day}: Max category ${outlook.max_category} (${outlook.categorical_areas.join(', ')})`
      );
      sections.push(`  Source: ${outlook.source_url}`);
    }
    sections.push('');
  }

  // SPC MDs
  if (facts.spc_mds.length > 0) {
    sections.push('## SPC MESOSCALE DISCUSSIONS:');
    for (const md of facts.spc_mds) {
      sections.push(`- MD #${md.md_number}: ${md.concern}`);
      sections.push(`  Source: ${md.source_url}`);
    }
    sections.push('');
  }

  // ERO Outlooks
  if (facts.ero_outlooks.length > 0) {
    sections.push('## WPC EXCESSIVE RAINFALL OUTLOOKS:');
    for (const ero of facts.ero_outlooks) {
      sections.push(`- Day ${ero.day}: Max category ${ero.max_category}`);
      sections.push(`  Source: ${ero.source_url}`);
    }
    sections.push('');
  }

  // Tropical
  if (facts.tropical.length > 0) {
    sections.push('## NHC TROPICAL SYSTEMS:');
    for (const system of facts.tropical) {
      sections.push(
        `- ${system.system_name} (${system.classification}): ${system.max_wind} kt, ${system.movement}`
      );
      sections.push(`  Threat areas: ${system.threat_areas.join(', ')}`);
      sections.push(`  Source: ${system.source_url}`);
    }
    sections.push('');
  }

  // Summary
  sections.push('## SUMMARY:');
  sections.push(`- Total event reports: ${facts.total_event_facts || 0}`);
  sections.push(`- Total alert types: ${facts.total_active_alerts}`);
  if (facts.top_events.length > 0) {
    sections.push(`- Top events: ${facts.top_events.join(', ')}`);
  }

  sections.push('\n=== GENERATE 10 HEADLINES BASED ON THE ABOVE DATA ===');
  sections.push('Remember:');
  sections.push('- Prioritize real-time event reports over general outlooks');
  sections.push('- Use the exact source_url from the data');
  sections.push('- Include lat, lon, and timestamp for event-based headlines');
  sections.push('- Use appropriate confidence level based on data source');

  return sections.join('\n');
}

/**
 * Format an EventFact for the prompt
 */
function formatEventFact(fact: EventFact): string {
  const parts: string[] = [];

  // Type and magnitude
  let typeDesc = fact.type.replace(/_/g, ' ').toUpperCase();
  if (fact.magnitude !== null) {
    if (fact.units) {
      typeDesc += ` ${fact.magnitude} ${fact.units}`;
    } else {
      typeDesc += ` ${fact.magnitude}`;
    }
  }

  // Time ago
  const time = new Date(fact.timestamp_utc);
  const ago = getTimeAgo(time);

  parts.push(`- ${typeDesc}`);
  parts.push(`  Location: ${fact.location_name}, ${fact.state}`);
  parts.push(`  Coordinates: ${fact.lat.toFixed(3)}, ${fact.lon.toFixed(3)}`);
  parts.push(`  Time: ${fact.timestamp_utc} (${ago})`);
  parts.push(`  Confidence: ${fact.confidence.toUpperCase()}`);
  parts.push(`  Source: ${fact.source_name}`);
  parts.push(`  URL: ${fact.source_url}`);
  if (fact.remarks) {
    parts.push(`  Remarks: ${fact.remarks.slice(0, 100)}`);
  }

  return parts.join('\n');
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Deduplicate headlines by checking for similar topics/locations
 */
function deduplicateHeadlines(headlines: Headline[]): Headline[] {
  const seen = new Set<string>();
  const result: Headline[] = [];

  for (const headline of headlines) {
    // Create a key based on topic and location
    const locationKey = headline.location?.state || 'us';
    const key = `${headline.topic}-${locationKey}`.toLowerCase();

    // Also check for very similar headlines
    const headlineLower = headline.headline.toLowerCase();
    const isDuplicate = Array.from(seen).some(s => {
      if (s === key) return true;
      // Check if headline text is too similar
      const existingHeadlines = result.map(h => h.headline.toLowerCase());
      return existingHeadlines.some(eh =>
        similarity(headlineLower, eh) > 0.7
      );
    });

    if (!isDuplicate) {
      seen.add(key);
      result.push(headline);
    }
  }

  return result;
}

/**
 * Simple similarity check using Jaccard index on words
 */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  return intersection / (wordsA.size + wordsB.size - intersection);
}
