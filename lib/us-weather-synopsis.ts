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
          minItems: 7,
          maxItems: 7,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "name",
              "days",
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
                  "west",
                  "rockies",
                  "plains",
                  "midwest_greatlakes",
                  "south",
                  "southeast",
                  "northeast",
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
    max_tokens: 8000,
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

Paragraph rules (per region per day):
- Each paragraph MUST contain at least 4 sentences.
- If risk_scale is 3.0 or lower: use 1 paragraph (minimum 4 sentences).
- If risk_scale is above 3.0: use 2 paragraphs (each with at least 4 sentences).
- Use 3 paragraphs only if very active or historic (risk_scale 6.0+).

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
- regions MUST include exactly these 7 ids in this order:
  west, rockies, plains, midwest_greatlakes, south, southeast, northeast
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

