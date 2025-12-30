import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateUSWeatherSynopsis(context: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const jsonSchema = {
    name: "us_weather_synopsis",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["updated_utc", "day_labels", "regions"],
      properties: {
        updated_utc: { type: "string" },

        day_labels: {
          type: "object",
          additionalProperties: false,
          required: ["day1", "day2", "day3"],
          properties: {
            day1: { type: "string" },
            day2: { type: "string" },
            day3: { type: "string" },
          },
        },

        regions: {
          type: "array",
          minItems: 6,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "name",
              "days",
              "day_risks",
              "long_range",
              "impacts",
              "pattern_callout",
              "timing_windows",
              "focus_area",
              "key_uncertainty",
              "preparedness_note",
              "not_happening",
              "analog_context",
              "forecast_change",
              "changed_since_last",
              "why_this_matters",
              "risk_scale",
              "highlights",
              "cta",
            ],
            properties: {
              id: {
                type: "string",
                enum: [
                  "west_coast",
                  "rockies",
                  "great_plains",
                  "midwest",
                  "northeast",
                  "southeast",
                ],
              },
              name: { type: "string" },

              days: {
                type: "object",
                additionalProperties: false,
                required: ["day1", "day2", "day3"],
                properties: {
                  day1: { type: "string" },
                  day2: { type: "string" },
                  day3: { type: "string" },
                },
              },

              day_risks: {
                type: "object",
                additionalProperties: false,
                required: ["day1", "day2", "day3"],
                properties: {
                  day1: { type: "number" },
                  day2: { type: "number" },
                  day3: { type: "number" },
                },
              },

              long_range: { type: "string" },
              impacts: {
                type: "array",
                items: { type: "string" },
                minItems: 0,
                maxItems: 4,
              },
              pattern_callout: { type: "string" },
              timing_windows: {
                type: "array",
                items: { type: "string" },
                minItems: 0,
                maxItems: 2,
              },
              focus_area: { type: "string" },
              key_uncertainty: { type: "string" },
              preparedness_note: { type: "string" },
              not_happening: { type: "string" },
              analog_context: { type: "string" },
              forecast_change: { type: "string" },
              changed_since_last: { type: "boolean" },
              why_this_matters: { type: "string" },
              risk_scale: { type: "number" },
              highlights: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 5,
              },
              cta: { type: "string" },
            },
          },
        },
      },
    },
  } as const;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    max_tokens: 16000,
    messages: [
      {
        role: "system",
        content: `
You must return STRICT JSON only.
No markdown. No commentary. No explanations.

Fill in the provided JSON schema exactly.
Do not add, remove, or rename any keys.

Content requirements for each region/day:
- Include temperature ranges every day: highs and lows stated in plain language (e.g., "highs in the 50s, lows in the 20s"). Use approximate ranges if needed.
- Include winds every day when relevant (direction and/or gusts if mentioned in the context; otherwise describe generally).
- Describe expected conditions each day (rain/snow/ice, clouds, fog, heat/cold, etc.).
- Mention notable weather phenomena if applicable (lake-effect snow, atmospheric river, blizzard conditions, ice accretion, squall line, severe storm mode, coastal flooding, etc.).
- Discuss severe weather, winter storms, tropical activity, and hurricanes ONLY if the provided context indicates a credible threat.

Detailed explanation requirements:
- Provide DETAILED explanations for all weather impacts. Do not be vague.
- For SNOW events: Always include expected snowfall accumulation ranges (e.g., "2-4 inches", "6-10 inches"). Specify which cities, towns, or areas will see the most snow vs. the least. Example: "Buffalo could see 8-12 inches of lake-effect snow, while Rochester sees 2-4 inches and Syracuse remains on the edge with 1-2 inches."
- For RAIN events: Include expected rainfall amounts when significant (e.g., "1-2 inches of rain expected").
- For WIND events: Always specify wind speeds and gusts (e.g., "sustained winds of 25-35 mph with gusts to 50 mph").
- For TEMPERATURE extremes: Explain the impacts (e.g., "Wind chills dropping to -10°F will make exposed skin vulnerable to frostbite within 30 minutes").
- For ICE/FREEZING RAIN: Specify ice accretion amounts (e.g., "0.25 to 0.5 inches of ice accretion possible").
- Name specific cities and towns that will be most affected. Integrate them naturally but be specific about who sees what.

==============================================================================
MANDATORY PARAGRAPH LENGTH RULES - THIS IS THE MOST IMPORTANT SECTION
==============================================================================

YOU MUST FOLLOW THESE RULES EXACTLY. NO SHORTCUTS. NO EXCEPTIONS.

STEP 1: CHECK THE DAY'S RISK SCORE
Look at day_risks.day1, day_risks.day2, day_risks.day3 for each day.

STEP 2: APPLY THESE RULES FOR EACH DAY:

IF day_risks <= 3.0:
  - Write 1 paragraph
  - Minimum 5 sentences
  - Include: temps (highs AND lows), sky conditions, winds, travel/activity impacts

IF day_risks > 3.0 (this includes 3.1, 3.5, 4.0, 4.5, etc.):
  - Write 2 SEPARATE paragraphs
  - Each paragraph must have AT LEAST 4 sentences
  - Separate paragraphs with \\n\\n in the JSON string
  - Paragraph 1: Main weather story, conditions, temperatures
  - Paragraph 2: Impacts, timing, specific locations affected, travel concerns

IF day_risks >= 6.0:
  - Write 3 SEPARATE paragraphs
  - Each paragraph must have AT LEAST 4 sentences
  - Total: 12+ sentences minimum

STEP 3: COUNT YOUR SENTENCES
Before finalizing each day's forecast, COUNT the periods. If you don't have enough sentences, ADD MORE.

EXAMPLE FOR RISK 4.0 (requires 2 paragraphs, 8+ sentences):
"Rain will spread across the region during the morning hours, becoming heavy at times by afternoon. Highs will only reach the upper 30s due to cloud cover and precipitation. Winds will be from the northeast at 15-25 mph with gusts to 35 mph possible along the coast. Temperatures will feel even colder with wind chills in the upper 20s.\\n\\nTravel conditions will deteriorate through the day, especially on secondary roads. Motorists should allow extra time for commutes and maintain safe following distances. Ponding water on roadways could create hydroplaning risks during heavier rain. The evening commute will likely be the most impacted period."

WHAT MAKES A SENTENCE:
- A complete thought ending in a period counts as 1 sentence
- "Highs in the 40s." = 1 sentence
- "Winds will be light." = 1 sentence

COMMON TOPICS TO ADD MORE SENTENCES:
- Temperature details (highs, lows, wind chill, heat index)
- Wind (direction, speed, gusts)
- Sky conditions (clouds, sun, visibility)
- Precipitation details (type, amount, timing)
- Travel impacts
- Outdoor activity recommendations
- Specific city/area conditions
- Timing of weather changes

DO NOT SUBMIT FORECASTS THAT VIOLATE THESE RULES.
==============================================================================

Day risk scores (day_risks):
- Assign a risk score from 1.0 to 10.0 for EACH individual day (day1, day2, day3).
- These scores can differ day-to-day based on that day's expected impacts.
- The overall region risk_scale should reflect the maximum or average risk across the period.

Long-range (Days 4–7) rules:
- Provide a single broad overview per region covering Days 4–7.
- Focus on overall trends, not daily details.
- Mention temperature trends (warming/cooling/near normal).
- Mention precipitation chances and any pattern signals.
- Do not invent specific storm timing.
- Use 1 paragraph only.

Highlights rules:
- Every region MUST have at least 2 highlights, maximum 5.
- More highlights (3-5) for active weather, but never fewer than 2.
- Each highlight must be short, scannable, and impact-focused.

Geography rules:
- Reference states, metro areas, or up to 3 representative cities per region when relevant.
- Do not list locations separately; integrate them naturally into the narrative.
- Avoid excessive city lists.

Style rules:
- Professional, clear, and concise.
- No emojis.
- No hype unless impacts clearly warrant it.

Ordering rule:
- Write the day-by-day forecast first.
- Write the long-range overview next.
- Write highlights last as a concise summary of the most important impacts.

Additional fields rules:

Impact categories:
- Populate "impacts" with 1–4 items (e.g., Travel, Power, Flooding, Wind, Severe, Winter).
- Only include categories supported by the context.

Pattern / setup:
- Provide a short meteorological pattern callout (e.g., "Active northern jet", "Strong frontal passage", "Blocking pattern").
- Keep to one concise phrase.

Timing windows:
- Include 0–2 timing windows when impacts are time-sensitive.
- Use clear windows (e.g., "Tuesday afternoon–Tuesday night").
- Omit if timing is not well defined.

Analog / historical context:
- Include only if a meaningful comparison exists.
- Otherwise return an empty string.

What's NOT happening:
- Include one reassuring statement when applicable (e.g., "No major winter storms expected").
- Avoid repeating obvious information.

Forecast change:
- If the outlook meaningfully changed from the prior update, summarize briefly.
- Otherwise return an empty string.

Why this matters:
- One sentence explaining real-world impacts (travel, safety, infrastructure, daily life).

Risk scale:
- Assign a Max Velocity Risk Scale value from 1.0 to 10.0 (decimals allowed).
- Base the value on coverage, impact severity, and confidence.
- Quiet patterns should generally fall between 1.0–2.5.
- Major widespread events should exceed 6.0.

Highlights:
- Write highlights LAST.
- Highlights should summarize the most important takeaways after the full forecast is written.

Additional interpretation fields rules:

Geographic focus:
- Populate "focus_area" with a short sentence describing where impacts are most likely.
- Example: "Highest impacts favor northern portions of the region."
- Leave empty if impacts are evenly distributed.

Key uncertainty:
- Populate "key_uncertainty" with the primary factor that could change the forecast.
- Example: "Exact storm track" or "Timing of cold air arrival."
- Leave empty if confidence is high.

Preparedness note:
- Include a soft preparedness cue when impacts are meaningful.
- Example: "Monitor updates if traveling Tuesday night."
- Avoid alarmist language.
- Leave empty if not needed.

Forecast change flag:
- Set "changed_since_last" to true only if the outlook meaningfully changed from the prior update.
- If true, summarize briefly in "forecast_change".
- If false, leave "forecast_change" empty.

Call to action (CTA):
- Populate "cta" ONLY if risk_scale is 4.5 or higher, or if changed_since_last is true.
- CTA should reference watching the latest Max Velocity weather forecast on YouTube.
- CTA must be professional and non-promotional in tone.
- Leave empty otherwise.

Additional rules:
- updated_utc MUST be a current ISO-8601 UTC timestamp ending in Z
- regions MUST include exactly these 6 ids in this order:
  west_coast, rockies, great_plains, midwest, northeast, southeast

REGION DEFINITIONS (states included in each):
- west_coast: California, Oregon, Washington, Idaho, Nevada, Arizona, Utah
- rockies: New Mexico, Colorado, Wyoming, Montana
- great_plains: North Dakota, South Dakota, Nebraska, Kansas, Oklahoma, Texas, Arkansas, Louisiana
- midwest: Minnesota, Iowa, Missouri, Illinois, Indiana, Ohio, Michigan, Wisconsin
- northeast: Pennsylvania, New York, New Jersey, Rhode Island, Connecticut, Massachusetts, New Hampshire, Vermont, Maine
- southeast: Kentucky, Tennessee, Mississippi, Alabama, Georgia, Florida, South Carolina, North Carolina, Virginia, West Virginia, Washington DC, Maryland, Delaware
        `.trim(),
      },
      {
        role: "user",
        content: context,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: jsonSchema,
    },
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Empty OpenAI response");

  return JSON.parse(text);
}

