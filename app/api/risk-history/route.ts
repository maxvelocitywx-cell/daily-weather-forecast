import { kv } from "@vercel/kv";

export const runtime = "nodejs";

const RISK_HISTORY_KEY = "national_risk_history";
const MAX_HISTORY_HOURS = 25; // Keep 25 hours of data

interface RiskEntry {
  timestamp: number;
  risk: number;
}

export async function GET() {
  try {
    const history: RiskEntry[] = (await kv.get(RISK_HISTORY_KEY)) || [];

    const now = Date.now();
    const intervals = [1, 3, 6, 12, 24]; // hours

    // Find the closest entry to each time interval
    const changes: Record<string, { value: number | null; change: number | null }> = {};

    for (const hours of intervals) {
      const targetTime = now - hours * 60 * 60 * 1000;

      // Find closest entry to target time (within 30 min tolerance)
      const tolerance = 30 * 60 * 1000; // 30 minutes
      const closestEntry = history.find(
        (entry) => Math.abs(entry.timestamp - targetTime) < tolerance
      );

      // Also get the most recent entry
      const latestEntry = history.length > 0 ? history[history.length - 1] : null;

      if (closestEntry && latestEntry) {
        changes[`${hours}h`] = {
          value: closestEntry.risk,
          change: Math.round((latestEntry.risk - closestEntry.risk) * 100) / 100,
        };
      } else {
        changes[`${hours}h`] = { value: null, change: null };
      }
    }

    // Get current value
    const currentRisk = history.length > 0 ? history[history.length - 1].risk : null;

    return new Response(
      JSON.stringify({
        current: currentRisk,
        history: changes,
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "s-maxage=300, stale-while-revalidate=60",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching risk history:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch risk history" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}

// POST endpoint to record a new risk value
export async function POST(request: Request) {
  try {
    const { risk } = await request.json();

    if (typeof risk !== "number" || risk < 1 || risk > 10) {
      return new Response(
        JSON.stringify({ error: "Invalid risk value" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const history: RiskEntry[] = (await kv.get(RISK_HISTORY_KEY)) || [];

    const now = Date.now();
    const cutoff = now - MAX_HISTORY_HOURS * 60 * 60 * 1000;

    // Remove entries older than 25 hours
    const filteredHistory = history.filter((entry) => entry.timestamp > cutoff);

    // Add new entry
    filteredHistory.push({ timestamp: now, risk });

    // Save back to KV
    await kv.set(RISK_HISTORY_KEY, filteredHistory);

    return new Response(
      JSON.stringify({ success: true, entriesStored: filteredHistory.length }),
      {
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error storing risk:", error);
    return new Response(
      JSON.stringify({ error: "Failed to store risk" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
    },
  });
}
