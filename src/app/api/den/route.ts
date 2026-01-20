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

export async function GET() {
  // Conservative knobs
  const LOAD_FACTOR = 0.78;         // lower than 0.82
  const RIDESHARE_RATE = 0.18;      // conservative
  const AVG_PARTY_SIZE = 1.9;       // conservative (bigger parties => fewer rides)
  const PICKUP_FRACTION = 0.85;     // conservative (connections/rental/etc.)
  const DISPATCH_FRICTION = 0.70;   // for expected wait calc if you later add queue size

  // Time window to avoid old flights polluting results
  const now = new Date();
  const windowStart = new Date(now.getTime() - 10 * 60 * 1000);      // allow tiny grace
  const windowEnd = new Date(now.getTime() + 3 * 60 * 60 * 1000);    // next 3 hours

  const raw = await getArrivalsToDEN({ limit: 100, offset: 0 });

  const mapped = raw.map((f) => {
    const eta = pickBestArrivalTimeISO(f);
    const aircraftType = f?.aircraft?.iata || f?.aircraft?.icao || null;

    const pax = estimatePassengers(aircraftType, LOAD_FACTOR);

    return {
      ident: f?.flight?.iata || f?.flight?.icao || f?.flight?.number || "UNKNOWN",
      operator: f?.airline?.iata || f?.airline?.name || null,
      origin: f?.departure?.iata || f?.departure?.icao || null,
      aircraft_type: aircraftType,
      estimated_on: eta,
      status: f?.flight_status || null,
      pax,
    };
  });

  // Filter out junk: missing time + anything far in the past/future window
  const flights = mapped.filter((x) => {
    if (!x.estimated_on) return false;
    const t = new Date(x.estimated_on);
    if (Number.isNaN(t.getTime())) return false;
    return t >= windowStart && t <= windowEnd;
  });

  // Confidence = how many flights have aircraft_type (right now yours is mostly null)
  const withType = flights.filter((f) => !!f.aircraft_type).length;
  const knownAircraftRate = flights.length ? withType / flights.length : 0;

  const confidence: Confidence =
    knownAircraftRate >= 0.6 ? "HIGH" :
    knownAircraftRate >= 0.3 ? "MED" : "LOW";

  // Buckets (your existing model)
  const buckets = flightsToBuckets({ flights, horizonMinutes: 120, bucketMinutes: 15 });

  // Pax next 60m from buckets
  const nowMs = now.getTime();
  const sixtyMs = 60 * 60 * 1000;

  const pax60 = buckets
    .filter((b) => {
      const t = new Date(b.bucketStartISO).getTime();
      return t >= nowMs && t < nowMs + sixtyMs;
    })
    .reduce((sum, b) => sum + b.estimatedPickupPax, 0);

  // Peak bucket (for “wave incoming”)
  const peak = buckets.reduce(
    (best, b) => (b.estimatedPickupPax > best.estimatedPickupPax ? b : best),
    buckets[0] ?? { bucketStartISO: new Date(nowMs).toISOString(), estimatedPickupPax: 0, flights: 0 }
  );

  const peakTimeMs = new Date(peak.bucketStartISO).getTime();
  const minutesUntilPeak = Math.max(0, Math.round((peakTimeMs - nowMs) / 60000));

  // Convert pax -> estimated ride requests (conservative)
  const rides60 = Math.round((pax60 * RIDESHARE_RATE / AVG_PARTY_SIZE) * PICKUP_FRACTION);
  const ridesPerMin = rides60 / 60;

  // Optional “pressure index” (0–100) based on rides, not pax
  const pressureIndex = clamp(Math.round((rides60 / 400) * 100), 0, 100);

  // Conservative recommendation rules
  let recommendation: Recommendation = "LEAVE";

  if (rides60 >= 260 || (peak.estimatedPickupPax >= 900 && minutesUntilPeak <= 35)) {
    recommendation = "MOVE_IN";
  } else if (rides60 >= 180 && rides60 < 260 && peak.estimatedPickupPax >= 650 && minutesUntilPeak <= 40) {
    recommendation = "STAY";
  } else if (rides60 >= 120 && rides60 < 180 && peak.estimatedPickupPax >= 450 && minutesUntilPeak <= 45) {
    recommendation = "WAIT";
  } else {
    recommendation = "LEAVE";
  }

  // Keep your old demand_score if you want, but make it meaningful too
  // (or you can delete it later once UI is updated)
  const demand_score = rides60; // simple: “estimated rides next 60m”

  return NextResponse.json({
    generated_at: now.toISOString(),
    provider: "aviationstack",

    // old fields (still present)
    demand: {
      pax_next_60m: pax60,
      flights_considered: flights.length,
      demand_score,
    },

    // new decision-ready fields
    decision: {
      recommendation,          // LEAVE / WAIT / STAY / MOVE_IN
      confidence,              // LOW / MED / HIGH
      known_aircraft_rate: Number(knownAircraftRate.toFixed(2)),
      rides_next_60m: rides60,
      rides_per_min: Number(ridesPerMin.toFixed(2)),
      pressure_index: pressureIndex,
      peak_bucket: {
        time: peak.bucketStartISO,
        pax: peak.estimatedPickupPax,
        minutes_until_peak: minutesUntilPeak,
      },
    },

    buckets,
    flights,
  });
}
