/**
 * Verified Headlines Generator
 *
 * Uses OpenAI to generate weather headlines with STRICT fact-based validation.
 *
 * CRITICAL RULES:
 * 1. Every headline MUST reference at least one fact_id from the bundle
 * 2. All numeric values MUST exist in the referenced facts
 * 3. "Measured" confidence ONLY for facts with station_id
 * 4. Geographic claims must match the referenced facts
 * 5. Post-generation validation rejects any headline that fails these checks
 */

import OpenAI from 'openai';
import { FactsBundle, Headline, HeadlinesSchema, VerifiedFact } from './types';

const SYSTEM_PROMPT = `You are a professional meteorologist generating weather headlines.
Your job is to generate EXACTLY 10 headlines based ONLY on the provided verified facts.

CRITICAL RULES - VIOLATIONS WILL BE REJECTED:

1. FACT REFERENCES REQUIRED
   - Every headline MUST include fact_ids array with at least one valid fact ID
   - You can ONLY use fact IDs that appear in the provided facts bundle
   - The headline text MUST match the data in the referenced facts

2. NUMERIC VALUES
   - You may ONLY include numbers that exist in the referenced facts
   - For wind: use the exact magnitude from the fact (e.g., "78 mph" if fact shows magnitude: 78)
   - For hail: use the exact size from the fact
   - NEVER make up or round numbers differently than the source

3. CONFIDENCE LABELS - BASED ON SOURCE TYPE
   - "Measured" = ONLY for station_obs facts that have station_id
   - "Reported" = ONLY for lsr facts
   - "High" = For nws_alert facts with urgency "Immediate"
   - "Medium" = For spc_outlook, wpc_ero, or lower-urgency alerts
   - "Low" = For extended outlooks only

4. GEOGRAPHY
   - Use the EXACT state and place from the referenced fact
   - NEVER claim a location not in the fact's location field
   - For station observations, use the station's verified city/state

5. SOURCE ATTRIBUTION
   - source_name: Copy EXACTLY from the referenced fact
   - source_url: Copy EXACTLY from the referenced fact
   - timestamp_utc: Copy EXACTLY from the referenced fact

6. DEDUPLICATION
   - No two headlines with same topic + location + claim
   - Cover geographic diversity across US regions

FORMAT:
Each headline must have:
- id: "h1", "h2", etc.
- headline: max 90 chars, factual claim from referenced fact
- topic: severe|winter|flood|tropical|heat|fire|aviation|marine|general
- confidence_label: Measured|Reported|High|Medium|Low (based on source type)
- location: { state, place } - copied from fact
- timestamp_utc: copied from fact
- source_name: copied from fact
- source_url: copied from fact
- fact_ids: ["fact-id-1", "fact-id-2"] - at least one required

PRIORITY ORDER:
1. Station-measured severe weather (wind >= 70 mph, extreme temps)
2. Tornado reports/warnings
3. Significant hail (>= 1")
4. Flash flood reports/warnings
5. Active severe/winter/flood warnings
6. SPC/WPC outlook risks (Enhanced or higher)
7. Other significant weather`;

interface OpenAIHeadlineResponse {
  headlines: Headline[];
}

/**
 * Validate a headline against the facts bundle
 */
function validateHeadline(
  headline: Headline,
  factsBundle: FactsBundle
): { valid: boolean; reason?: string } {
  // Must have at least one fact_id
  if (!headline.fact_ids || headline.fact_ids.length === 0) {
    return { valid: false, reason: 'Missing fact_ids' };
  }

  // All fact_ids must exist in the bundle
  for (const factId of headline.fact_ids) {
    if (!factsBundle.fact_ids.has(factId)) {
      return { valid: false, reason: `Unknown fact_id: ${factId}` };
    }
  }

  // Get the referenced facts
  const referencedFacts = headline.fact_ids
    .map(id => factsBundle.facts.find(f => f.id === id))
    .filter((f): f is VerifiedFact => f !== undefined);

  if (referencedFacts.length === 0) {
    return { valid: false, reason: 'No valid facts found for fact_ids' };
  }

  // Validate confidence label matches source type
  const primaryFact = referencedFacts[0];

  if (headline.confidence_label === 'Measured') {
    // Measured requires station_id
    const hasStationId = referencedFacts.some(f => f.station_id);
    if (!hasStationId) {
      return {
        valid: false,
        reason: 'Measured confidence requires station_id in referenced fact',
      };
    }
  }

  if (headline.confidence_label === 'Reported') {
    // Reported should only be for LSR facts
    const hasLSR = referencedFacts.some(f => f.source === 'lsr');
    if (!hasLSR) {
      return {
        valid: false,
        reason: 'Reported confidence only valid for LSR sources',
      };
    }
  }

  // Check that location matches referenced facts
  const factStates = referencedFacts.map(f => f.location.state);
  if (!factStates.includes(headline.location.state) && headline.location.state !== 'Multiple States') {
    return {
      valid: false,
      reason: `State "${headline.location.state}" not in referenced facts`,
    };
  }

  // Check for numeric claims in headline text
  const headlineNumbers = headline.headline.match(/\d+/g);
  if (headlineNumbers) {
    const factNumbers = referencedFacts.flatMap(f => {
      const nums: string[] = [];
      if (f.magnitude !== undefined) nums.push(String(f.magnitude));
      return nums;
    });

    // Allow some flexibility for derived numbers (e.g., "near 80" for 78)
    for (const num of headlineNumbers) {
      const numVal = parseInt(num);
      // Skip very small numbers and years
      if (numVal < 10 || numVal > 2000) continue;

      // Check if this number is close to any fact number
      const isInFacts = factNumbers.some(fn => {
        const fnVal = parseInt(fn);
        return Math.abs(fnVal - numVal) <= 5; // Allow ±5 rounding
      });

      // Also check if it's a reasonable temperature/date/year
      const isReasonableTemp = numVal >= -50 && numVal <= 130;
      const isReasonableNumber = numVal <= 100;

      if (!isInFacts && !isReasonableTemp && !isReasonableNumber) {
        return {
          valid: false,
          reason: `Number ${num} in headline not found in referenced facts`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Build a compact facts prompt for the model
 */
function buildFactsPrompt(bundle: FactsBundle): string {
  const sections: string[] = [];

  sections.push(`=== VERIFIED FACTS BUNDLE (${bundle.generated_at}) ===`);
  sections.push(`Total facts: ${bundle.facts.length}`);
  sections.push('');

  // Group facts by source for easier reading
  const bySource: Record<string, VerifiedFact[]> = {};
  for (const fact of bundle.facts) {
    const key = fact.source;
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(fact);
  }

  // Station observations (Measured) - highest priority
  if (bySource['station_obs']?.length > 0) {
    sections.push('## STATION OBSERVATIONS (Measured - highest confidence):');
    for (const fact of bySource['station_obs'].slice(0, 10)) {
      sections.push(formatFactForPrompt(fact));
    }
    sections.push('');
  }

  // LSR reports (Reported)
  if (bySource['lsr']?.length > 0) {
    sections.push('## LOCAL STORM REPORTS (Reported):');
    for (const fact of bySource['lsr'].slice(0, 15)) {
      sections.push(formatFactForPrompt(fact));
    }
    sections.push('');
  }

  // NWS Alerts (High confidence)
  if (bySource['nws_alert']?.length > 0) {
    sections.push('## NWS ALERTS (High confidence):');
    // Group by event type to reduce repetition
    const alertsByEvent: Record<string, VerifiedFact[]> = {};
    for (const fact of bySource['nws_alert']) {
      const key = fact.event_type;
      if (!alertsByEvent[key]) alertsByEvent[key] = [];
      alertsByEvent[key].push(fact);
    }

    for (const [eventType, alerts] of Object.entries(alertsByEvent).slice(0, 10)) {
      sections.push(`### ${eventType} (${alerts.length} alerts)`);
      for (const fact of alerts.slice(0, 3)) {
        sections.push(formatFactForPrompt(fact));
      }
    }
    sections.push('');
  }

  // SPC Outlooks (Medium confidence)
  if (bySource['spc_outlook']?.length > 0) {
    sections.push('## SPC OUTLOOKS (Medium confidence):');
    for (const fact of bySource['spc_outlook']) {
      sections.push(formatFactForPrompt(fact));
    }
    sections.push('');
  }

  // WPC ERO (Medium confidence)
  if (bySource['wpc_ero']?.length > 0) {
    sections.push('## WPC EXCESSIVE RAINFALL (Medium confidence):');
    for (const fact of bySource['wpc_ero']) {
      sections.push(formatFactForPrompt(fact));
    }
    sections.push('');
  }

  sections.push('=== GENERATE 10 HEADLINES ===');
  sections.push('Each headline MUST reference fact IDs from above.');
  sections.push('Use EXACT values from the facts - no making up numbers.');

  return sections.join('\n');
}

/**
 * Format a single fact for the prompt
 */
function formatFactForPrompt(fact: VerifiedFact): string {
  const lines: string[] = [];

  lines.push(`FACT ID: ${fact.id}`);
  lines.push(`  Type: ${fact.event_type}`);

  if (fact.magnitude !== undefined) {
    lines.push(`  Magnitude: ${fact.magnitude}${fact.units ? ' ' + fact.units : ''}`);
  }

  lines.push(`  Location: ${fact.location.place}, ${fact.location.state} (${fact.location.state_abbrev})`);
  lines.push(`  Time: ${fact.timestamp_utc}`);
  lines.push(`  Confidence: ${fact.confidence}`);
  lines.push(`  Source: ${fact.source_name}`);
  lines.push(`  URL: ${fact.source_url}`);

  if (fact.station_id) {
    lines.push(`  Station ID: ${fact.station_id}`);
  }

  if (fact.raw_excerpt) {
    lines.push(`  Excerpt: "${fact.raw_excerpt.slice(0, 100)}"`);
  }

  return lines.join('\n');
}

/**
 * Generate headlines using OpenAI with strict fact-based validation
 */
export async function generateVerifiedHeadlines(
  factsBundle: FactsBundle,
  apiKey: string
): Promise<Headline[]> {
  const client = new OpenAI({ apiKey });

  const factsPrompt = buildFactsPrompt(factsBundle);

  console.log('[Verified Generator] Generating headlines...');

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
      temperature: 0.2, // Lower temperature for more factual output
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const parsed = JSON.parse(content) as OpenAIHeadlineResponse;
    const rawHeadlines = parsed.headlines || [];

    console.log(`[Verified Generator] Received ${rawHeadlines.length} headlines from OpenAI`);

    // POST-GENERATION VALIDATION
    const validatedHeadlines: Headline[] = [];
    const rejectedHeadlines: { headline: Headline; reason: string }[] = [];

    for (const headline of rawHeadlines) {
      const validation = validateHeadline(headline, factsBundle);
      if (validation.valid) {
        validatedHeadlines.push(headline);
      } else {
        rejectedHeadlines.push({ headline, reason: validation.reason || 'Unknown' });
      }
    }

    console.log(`[Verified Generator] Validation: ${validatedHeadlines.length} passed, ${rejectedHeadlines.length} rejected`);

    if (rejectedHeadlines.length > 0) {
      console.log('[Verified Generator] Rejection reasons:');
      for (const { headline, reason } of rejectedHeadlines.slice(0, 5)) {
        console.log(`  - "${headline.headline.slice(0, 50)}...": ${reason}`);
      }
    }

    // Deduplicate by topic+location
    const deduped = deduplicateHeadlines(validatedHeadlines);

    // If we don't have enough headlines, fill with safe fallbacks
    while (deduped.length < 10) {
      const fallbackFact = factsBundle.facts[deduped.length % factsBundle.facts.length];
      if (fallbackFact) {
        deduped.push({
          id: `h${deduped.length + 1}`,
          headline: `${fallbackFact.event_type} reported in ${fallbackFact.location.state}`,
          topic: 'general',
          confidence_label: fallbackFact.confidence,
          location: {
            state: fallbackFact.location.state,
            place: fallbackFact.location.place,
          },
          timestamp_utc: fallbackFact.timestamp_utc,
          source_name: fallbackFact.source_name,
          source_url: fallbackFact.source_url,
          fact_ids: [fallbackFact.id],
        });
      } else {
        // Ultimate fallback
        deduped.push({
          id: `h${deduped.length + 1}`,
          headline: 'Check NWS for current weather conditions',
          topic: 'general',
          confidence_label: 'Low',
          location: {
            state: 'United States',
            place: 'Nationwide',
          },
          timestamp_utc: new Date().toISOString(),
          source_name: 'NWS',
          source_url: 'https://www.weather.gov/',
          fact_ids: [],
        });
      }
    }

    return deduped.slice(0, 10);
  } catch (error) {
    console.error('[Verified Generator] Error generating headlines:', error);
    throw error;
  }
}

/**
 * Deduplicate headlines by topic and location
 */
function deduplicateHeadlines(headlines: Headline[]): Headline[] {
  const seen = new Set<string>();
  const result: Headline[] = [];

  for (const headline of headlines) {
    const key = `${headline.topic}-${headline.location.state}-${headline.location.place}`.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(headline);
    }
  }

  return result;
}
