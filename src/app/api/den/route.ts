// src/app/api/den/route.ts
import { NextResponse } from "next/server";
import { getArrivalsToDEN } from "@/lib/aviationstack";
import { estimatePassengers } from "@/lib/seatMap";
import { flightsToBuckets } from "@/lib/demand";

export const runtime = "nodejs";

function pickBestArrivalTimeISO(f: any): string | null {
  return (
    f?.arrival?.actual ??
    f?.arrival?.estimated ??
    f?.arrival?.scheduled ??
    null
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

type Recommendation = "LEAVE" | "WAIT" | "STAY" | "MOVE_IN";
type Confidence = "LOW" | "MED" | "HIGH";

/**
 * Conservative, low-risk heuristics to infer aircraft size ONLY when we’re very confident.
 * This helps nudge confidence upward without overestimating demand.
 *
 * - WN (Southwest): almost always 737 variants
 * - F9 (Frontier): almost always A320 family at DEN
 *
 * Everything else stays unknown (UNK), which is conservative in seatMap.
 */
function conservativeAircraftHintByOperator(operator: string | null): string | null {
  if (!operator) return null;
  const op = operator.toUpperCase();
  if (op === "WN") return "B738";
  if (op === "F9") return "A320";
  return null;
}

export async function GET() {
  // ----------------------------
  // Conservative knobs (tune later)
  // ----------------------------
  const LOAD_FACTOR = 0.78; // lower than 0.82
  const RIDESHARE_RATE = 0.18;
  const AVG_PARTY_SIZE = 1.9;
  const PICKUP_FRACTION = 0.85;

  // When confidence is LOW, apply a haircut so we don't get optimistic
  const LOW_CONFIDENCE_HAIRCUT = 0.85; // 15% reduction

  // Time window to avoid old flights polluting results
  const now = new Date();
  const nowMs = now.getTime();
  const windowStart = new Date(nowMs - 10 * 60 * 1000); // allow 10 min grace
  const windowEnd = new Date(nowMs + 3 * 60 * 60 * 1000); // next 3 hours

  // Fetch arrivals (Aviationstack)
  const raw = await getArrivalsToDEN({ limit: 100, offset: 0 });

  // Map + conservative aircraft hinting
  const mapped = raw.map((f) => {
    const eta = pickBestArrivalTimeISO(f);

    const operator = f?.airline?.iata || f?.airline?.name || null;

    // Aviationstack often lacks aircraft type; use tiny operator-based hints only when safe.
    const aircraftTypeFromApi = f?.aircraft?.iata || f?.aircraft?.icao || null;
    const aircraftHint = aircraftTypeFromApi ?? conservativeAircraftHintByOperator(
      // If airline name is in operator, hinting won't work; we want IATA code, but this is still safe.
      // If operator is a name like "United Airlines", hint returns null.
      typeof operator === "string" && operator.length <= 3 ? operator : null
    );

    const pax = estimatePassengers(aircraftHint, LOAD_FACTOR);

    return {
      ident: f?.flight?.iata || f?.flight?.icao || f?.flight?.number || "UNKNOWN",
      operator,
      origin: f?.departure?.iata || f?.departure?.icao || null,
      aircraft_type: aircraftHint, // note: may be inferred for WN/F9
      estimated_on: eta,
      status: f?.flight_status || null,
      pax,
      // Keep a flag so you can debug how often we inferred:
      _aircraft_inferred: !aircraftTypeFromApi && !!aircraftHint,
    };
  });

  // Filter: require ETA and keep only a tight time window
  const flights = mapped.filter((x) => {
    if (!x.estimated_on) return false;
    const t = new Date(x.estimated_on);
    if (Number.isNaN(t.getTime())) return false;
    return t >= windowStart && t <= windowEnd;
  });

  // Confidence = proportion with aircraft type (including our safe inferences)
  const withType = flights.filter((f) => !!f.aircraft_type).length;
  const knownAircraftRate = flights.length ? withType / flights.length : 0;

  const confidence: Confidence =
    knownAircraftRate >= 0.6 ? "HIGH" :
    knownAircraftRate >= 0.3 ? "MED" : "LOW";

  const lowConfidence = confidence === "LOW";

  // Buckets (existing model)
  const buckets = flightsToBuckets({ flights, horizonMinutes: 120, bucketMinutes: 15 });

  // Pax next 60m from buckets
  const sixtyMs = 60 * 60 * 1000;
  const pax60 = buckets
    .filter((b) => {
      const t = new Date(b.bucketStartISO).getTime();
      return t >= nowMs && t < nowMs + sixtyMs;
    })
    .reduce((sum, b) => sum + b.estimatedPickupPax, 0);

  // Peak bucket (wave)
  const peak = buckets.reduce(
    (best, b) => (b.estimatedPickupPax > best.estimatedPickupPax ? b : best),
    buckets[0] ?? { bucketStartISO: new Date(nowMs).toISOString(), estimatedPickupPax: 0, flights: 0 }
  );

  const peakTimeMs = new Date(peak.bucketStartISO).getTime();
  const minutesUntilPeak = Math.max(0, Math.round((peakTimeMs - nowMs) / 60000));

  // Pax -> estimated rides (base, then adjusted for confidence)
  const rides60Raw = Math.round((pax60 * RIDESHARE_RATE / AVG_PARTY_SIZE) * PICKUP_FRACTION);
  const rides60 = lowConfidence ? Math.round(rides60Raw * LOW_CONFIDENCE_HAIRCUT) : rides60Raw;

  // Helpful “range” for UI (doesn't affect decisions)
  const rides60High = Math.round(rides60 * 1.25);

  const ridesPerMin = rides60 / 60;

  // Pressure index (0–100) based on rides (not pax)
  const pressureIndex = clamp(Math.round((rides60 / 400) * 100), 0, 100);

// Conservative recommendation rules
let recommendation: Recommendation = "LEAVE";

const peakPax = peak.estimatedPickupPax;

// Big-wave override: if a large wave is imminent, do NOT say LEAVE.
// (This avoids false negatives when aircraft types are missing.)
const bigWaveImminent = peakPax >= 1200 && minutesUntilPeak <= 35;
const urgentBigWave = bigWaveImminent && minutesUntilPeak <= 20 && peakPax >= 1400;


// MOVE_IN: require strong proof if low confidence
const moveIn =
  (lowConfidence &&
    (
      (rides60 >= 320 && minutesUntilPeak <= 35 && peakPax >= 900) ||
      (urgentBigWave && rides60 >= 280)
    )
  ) ||
  (!lowConfidence && (rides60 >= 260 || (peakPax >= 900 && minutesUntilPeak <= 35)));

const stay =
  // normal stay band
  (rides60 >= 180 && rides60 < 260 && peakPax >= 650 && minutesUntilPeak <= 40) ||
  // big-wave safety net
  (bigWaveImminent && rides60 >= 220);

const wait =
  // normal wait band
  (rides60 >= 120 && rides60 < 180 && peakPax >= 450 && minutesUntilPeak <= 45) ||
  // if big wave is imminent but rides estimate is still modest, default to WAIT not LEAVE
  (bigWaveImminent && rides60 >= 160);

if (moveIn) recommendation = "MOVE_IN";
else if (stay) recommendation = "STAY";
else if (wait) recommendation = "WAIT";
else recommendation = bigWaveImminent ? "WAIT" : "LEAVE";

  // Keep demand_score but make it meaningful (estimated rides)
  const demand_score = rides60;

  // Debug counts
  const inferredCount = flights.filter((f) => f._aircraft_inferred).length;

  return NextResponse.json({
    generated_at: now.toISOString(),
    provider: "aviationstack",

    demand: {
      pax_next_60m: pax60,
      flights_considered: flights.length,
      demand_score, // now equals rides60
    },

    decision: {
      recommendation,
      confidence,
      known_aircraft_rate: Number(knownAircraftRate.toFixed(2)),
      aircraft_inferred_count: inferredCount,
      big_wave_imminent: bigWaveImminent,

      rides_next_60m_raw: rides60Raw,
      rides_next_60m: rides60,
      rides_next_60m_high: rides60High,
      rides_per_min: Number(ridesPerMin.toFixed(2)),

      pressure_index: pressureIndex,

      peak_bucket: {
        time: peak.bucketStartISO,
        pax: peakPax,
        minutes_until_peak: minutesUntilPeak,
      },
    },

    buckets,
    flights,
  });
}
