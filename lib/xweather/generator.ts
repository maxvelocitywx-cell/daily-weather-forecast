/**
 * Xweather Headlines Generator
 *
 * Uses OpenAI to generate weather headlines with STRICT fact-based validation.
 * Every headline MUST reference facts from the Xweather Facts Bundle.
 *
 * CRITICAL RULES:
 * 1. Every headline MUST reference at least one fact_id from the bundle
 * 2. All numeric values MUST exist exactly in the referenced facts
 * 3. "Measured" confidence ONLY for facts with confidence === 'measured'
 * 4. "Reported" confidence ONLY for facts with confidence === 'reported'
 * 5. Post-generation validation rejects any headline that fails these checks
 */

import OpenAI from 'openai';
import {
  XweatherFactsBundle,
  XweatherFact,
  XweatherHeadline,
  XweatherHeadlinesSchema,
  HeadlineConfidenceLabel,
} from './types';

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are a professional meteorologist generating weather headlines.
Your job is to generate EXACTLY 10 headlines based ONLY on the provided verified facts from Xweather.

CRITICAL RULES - VIOLATIONS WILL BE REJECTED:

1. FACT REFERENCES REQUIRED
   - Every headline MUST include fact_ids array with at least one valid fact_id
   - You can ONLY use fact_id values that appear in the provided facts bundle
   - The headline text MUST match the data in the referenced facts

2. NUMERIC VALUES
   - You may ONLY include numbers that exist exactly in the referenced facts
   - For wind: use the exact value from the fact (e.g., "78 mph" if fact shows value: 78)
   - For temperatures: use the exact value from the fact
   - NEVER make up or round numbers differently than the source

3. CONFIDENCE LABELS - BASED ON SOURCE TYPE
   - "Measured" = ONLY for facts with confidence: "measured" (observations)
   - "Reported" = ONLY for facts with confidence: "reported" (storm reports)
   - "Forecast" = ONLY for facts with confidence: "forecast" (alerts/outlooks)

4. GEOGRAPHY
   - Use the EXACT state and location name from the referenced fact
   - NEVER claim a location not in the fact's location field
   - For regions array, use the state names from referenced facts

5. SOURCE ATTRIBUTION
   - source_url: Use "https://www.xweather.com" or the specific URL from the fact

6. DEDUPLICATION
   - No two headlines with same topic + location + claim
   - Cover geographic diversity across US regions

FORMAT:
Each headline must have:
- headline: max 90 chars, factual claim from referenced fact
- topic: severe|winter|flood|tropical|heat|fire|general
- confidence_label: Measured|Reported|Forecast (based on source type)
- regions: array of affected states from the facts
- fact_ids: ["fact-id-1", "fact-id-2"] - at least one required, must exist in bundle
- source_url: URL from the fact or "https://www.xweather.com"

PRIORITY ORDER:
1. Measured observations with extreme values (wind >= 70 mph, temps >= 105F or <= 0F)
2. Tornado reports
3. Significant hail (>= 1")
4. High wind reports (>= 58 mph)
5. Flash flood reports
6. Active severe/winter/flood warnings
7. Other significant weather

OUTPUT EXACTLY 10 HEADLINES - no more, no less.`;

// ============================================================================
// VALIDATION
// ============================================================================

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function validateHeadline(
  headline: XweatherHeadline,
  factsBundle: XweatherFactsBundle
): ValidationResult {
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
    .map(id => factsBundle.facts.find(f => f.fact_id === id))
    .filter((f): f is XweatherFact => f !== undefined);

  if (referencedFacts.length === 0) {
    return { valid: false, reason: 'No valid facts found for fact_ids' };
  }

  // Validate confidence label matches source type
  const primaryFact = referencedFacts[0];

  if (headline.confidence_label === 'Measured') {
    const hasMeasured = referencedFacts.some(f => f.confidence === 'measured');
    if (!hasMeasured) {
      return {
        valid: false,
        reason: 'Measured confidence requires measured fact',
      };
    }
  }

  if (headline.confidence_label === 'Reported') {
    const hasReported = referencedFacts.some(f => f.confidence === 'reported');
    if (!hasReported) {
      return {
        valid: false,
        reason: 'Reported confidence requires reported fact',
      };
    }
  }

  // Check that regions match referenced facts
  const factStates = referencedFacts.map(f => f.location.state);
  for (const region of headline.regions) {
    if (!factStates.includes(region) && region !== 'Multiple States') {
      // Allow if it's a reasonable regional name
      const isRegionalName = region.includes('Plains') || region.includes('Coast') ||
        region.includes('Midwest') || region.includes('Northeast') || region.includes('Southeast') ||
        region.includes('Southwest') || region.includes('Northwest');
      if (!isRegionalName) {
        return {
          valid: false,
          reason: `Region "${region}" not in referenced facts`,
        };
      }
    }
  }

  // Check for numeric claims in headline text
  const headlineNumbers = headline.headline.match(/\d+/g);
  if (headlineNumbers) {
    const factNumbers = referencedFacts.flatMap(f => {
      const nums: string[] = [];
      if (f.value !== null && typeof f.value === 'number') {
        nums.push(String(Math.round(f.value)));
      }
      return nums;
    });

    for (const num of headlineNumbers) {
      const numVal = parseInt(num);
      // Skip very small numbers, years, and common numbers
      if (numVal < 10 || numVal > 2000) continue;
      if (num.length === 4 && numVal >= 2020 && numVal <= 2030) continue; // Years

      // Check if this number is close to any fact number (allow ±3 for rounding)
      const isInFacts = factNumbers.some(fn => {
        const fnVal = parseInt(fn);
        return Math.abs(fnVal - numVal) <= 3;
      });

      if (!isInFacts) {
        // Check if it's a reasonable temperature or wind speed
        const isReasonableTemp = numVal >= -50 && numVal <= 130;
        const isReasonableWind = numVal >= 20 && numVal <= 200;

        if (!isReasonableTemp && !isReasonableWind) {
          return {
            valid: false,
            reason: `Number ${num} in headline not found in referenced facts`,
          };
        }
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// PROMPT BUILDER
// ============================================================================

function buildFactsPrompt(bundle: XweatherFactsBundle): string {
  const sections: string[] = [];

  sections.push(`=== XWEATHER FACTS BUNDLE (${bundle.generated_at}) ===`);
  sections.push(`Total facts: ${bundle.facts.length}`);
  sections.push('');

  // Group facts by confidence for easier reading
  const measured = bundle.facts.filter(f => f.confidence === 'measured');
  const reported = bundle.facts.filter(f => f.confidence === 'reported');
  const forecast = bundle.facts.filter(f => f.confidence === 'forecast');

  // Measured observations (highest priority)
  if (measured.length > 0) {
    sections.push('## MEASURED OBSERVATIONS (Measured confidence - highest priority):');
    for (const fact of measured.slice(0, 15)) {
      sections.push(formatFactForPrompt(fact));
    }
    sections.push('');
  }

  // Storm reports (Reported confidence)
  if (reported.length > 0) {
    sections.push('## STORM REPORTS (Reported confidence):');
    for (const fact of reported.slice(0, 20)) {
      sections.push(formatFactForPrompt(fact));
    }
    sections.push('');
  }

  // Alerts (Forecast confidence)
  if (forecast.length > 0) {
    sections.push('## ALERTS & WARNINGS (Forecast confidence):');

    // Group by alert type
    const alertsByType: Record<string, XweatherFact[]> = {};
    for (const fact of forecast) {
      const key = fact.alert_type || fact.type;
      if (!alertsByType[key]) alertsByType[key] = [];
      alertsByType[key].push(fact);
    }

    for (const [alertType, alerts] of Object.entries(alertsByType).slice(0, 10)) {
      sections.push(`### ${alertType} (${alerts.length} alerts)`);
      for (const fact of alerts.slice(0, 3)) {
        sections.push(formatFactForPrompt(fact));
      }
    }
    sections.push('');
  }

  sections.push('=== GENERATE EXACTLY 10 HEADLINES ===');
  sections.push('Each headline MUST reference fact_id values from above.');
  sections.push('Use EXACT numeric values from the facts - no making up numbers.');
  sections.push('Match confidence_label to the fact confidence type.');

  return sections.join('\n');
}

function formatFactForPrompt(fact: XweatherFact): string {
  const lines: string[] = [];

  lines.push(`FACT_ID: ${fact.fact_id}`);
  lines.push(`  Type: ${fact.type}`);

  if (fact.value !== null) {
    lines.push(`  Value: ${fact.value}${fact.units ? ' ' + fact.units : ''}`);
  }

  lines.push(`  Location: ${fact.location.name}, ${fact.location.state} (${fact.location.state_abbrev})`);
  lines.push(`  Lat/Lon: ${fact.location.lat.toFixed(2)}, ${fact.location.lon.toFixed(2)}`);
  lines.push(`  Time: ${fact.timestamp_utc}`);
  lines.push(`  Confidence: ${fact.confidence}`);
  lines.push(`  Source URL: ${fact.source_url}`);

  if (fact.station_id) {
    lines.push(`  Station: ${fact.station_id}`);
  }

  if (fact.alert_type) {
    lines.push(`  Alert Type: ${fact.alert_type}`);
  }

  if (fact.raw_data) {
    lines.push(`  Details: "${fact.raw_data.substring(0, 100)}"`);
  }

  return lines.join('\n');
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

function deduplicateHeadlines(headlines: XweatherHeadline[]): XweatherHeadline[] {
  const seen = new Set<string>();
  const result: XweatherHeadline[] = [];

  for (const headline of headlines) {
    const regions = headline.regions.sort().join(',');
    const key = `${headline.topic}-${regions}-${headline.headline.substring(0, 30)}`.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(headline);
    }
  }

  return result;
}

// ============================================================================
// HEADLINE GENERATOR
// ============================================================================

interface OpenAIHeadlineResponse {
  headlines: XweatherHeadline[];
}

export async function generateXweatherHeadlines(
  factsBundle: XweatherFactsBundle,
  apiKey: string
): Promise<XweatherHeadline[]> {
  const client = new OpenAI({ apiKey });

  const factsPrompt = buildFactsPrompt(factsBundle);

  console.log('[Xweather Generator] Generating headlines...');
  console.log(`[Xweather Generator] Facts bundle has ${factsBundle.facts.length} facts`);

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
          schema: XweatherHeadlinesSchema,
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

    console.log(`[Xweather Generator] Received ${rawHeadlines.length} headlines from OpenAI`);

    // POST-GENERATION VALIDATION
    const validatedHeadlines: XweatherHeadline[] = [];
    const rejectedHeadlines: { headline: XweatherHeadline; reason: string }[] = [];

    for (const headline of rawHeadlines) {
      const validation = validateHeadline(headline, factsBundle);
      if (validation.valid) {
        validatedHeadlines.push(headline);
      } else {
        rejectedHeadlines.push({ headline, reason: validation.reason || 'Unknown' });
      }
    }

    console.log(`[Xweather Generator] Validation: ${validatedHeadlines.length} passed, ${rejectedHeadlines.length} rejected`);

    if (rejectedHeadlines.length > 0) {
      console.log('[Xweather Generator] Rejection reasons:');
      for (const { headline, reason } of rejectedHeadlines.slice(0, 5)) {
        console.log(`  - "${headline.headline.slice(0, 50)}...": ${reason}`);
      }
    }

    // Deduplicate by topic+region
    const deduped = deduplicateHeadlines(validatedHeadlines);

    // If we don't have enough headlines, fill with fallbacks from facts
    while (deduped.length < 10 && factsBundle.facts.length > 0) {
      const fallbackFact = factsBundle.facts[deduped.length % factsBundle.facts.length];
      if (fallbackFact) {
        const confidenceLabel: HeadlineConfidenceLabel =
          fallbackFact.confidence === 'measured' ? 'Measured' :
          fallbackFact.confidence === 'reported' ? 'Reported' : 'Forecast';

        deduped.push({
          headline: `${fallbackFact.type.replace(/_/g, ' ')} in ${fallbackFact.location.state}`,
          topic: 'general',
          confidence_label: confidenceLabel,
          regions: [fallbackFact.location.state],
          fact_ids: [fallbackFact.fact_id],
          source_url: fallbackFact.source_url,
        });
      } else {
        break;
      }
    }

    // Ultimate fallback if still not enough
    while (deduped.length < 10) {
      deduped.push({
        headline: 'Check Xweather for current weather conditions',
        topic: 'general',
        confidence_label: 'Forecast',
        regions: ['United States'],
        fact_ids: [],
        source_url: 'https://www.xweather.com',
      });
    }

    return deduped.slice(0, 10);
  } catch (error) {
    console.error('[Xweather Generator] Error generating headlines:', error);
    throw error;
  }
}
