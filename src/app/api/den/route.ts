// src/app/api/den/route.ts
import { NextResponse } from "next/server";
import { getArrivalsToDEN } from "@/lib/aviationstack";
import { estimatePassengers } from "@/lib/seatMap";
import { flightsToBuckets } from "@/lib/demand";

export const runtime = "nodejs";

function pickBestArrivalTimeISO(f: any): string | null {
  // prefer actual, then estimated, then scheduled
  return (
    f?.arrival?.actual ??
    f?.arrival?.estimated ??
    f?.arrival?.scheduled ??
    null
  );
}

export async function GET() {
  // Aviationstack free tier can be restrictive with filters/params,
  // so we keep it simple: arr_iata=DEN + limit.
  const raw = await getArrivalsToDEN({ limit: 100, offset: 0 });

  const flights = raw
    .map((f) => {
      const eta = pickBestArrivalTimeISO(f);
      const aircraftType = f?.aircraft?.iata || f?.aircraft?.icao || null;

      const pax = estimatePassengers(aircraftType, 0.82);

      return {
        ident: f?.flight?.iata || f?.flight?.icao || f?.flight?.number || "UNKNOWN",
        operator: f?.airline?.iata || f?.airline?.name || null,
        origin: f?.departure?.iata || f?.departure?.icao || null,
        aircraft_type: aircraftType,
        estimated_on: eta,
        status: f?.flight_status || null,
        pax,
      };
    })
    .filter((x) => !!x.estimated_on);

  const buckets = flightsToBuckets({ flights, horizonMinutes: 120, bucketMinutes: 15 });

  const nowMs = Date.now();
  const sixtyMs = 60 * 60 * 1000;

  const pax60 = buckets
    .filter((b) => {
      const t = new Date(b.bucketStartISO).getTime();
      return t >= nowMs && t < nowMs + sixtyMs;
    })
    .reduce((sum, b) => sum + b.estimatedPickupPax, 0);

  const flights60 = flights.filter((f) => {
    // peak pickup is ~+35m from arrival time per our model
    const wavePeak = new Date(f.estimated_on!).getTime() + 35 * 60 * 1000;
    return wavePeak >= nowMs && wavePeak < nowMs + sixtyMs;
  }).length;

  const demandScore = Math.round(pax60 * (1 + Math.min(0.6, flights60 / 40)));

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    provider: "aviationstack",
    demand: { pax_next_60m: pax60, flights_next_60m: flights60, demand_score: demandScore },
    buckets,
    flights,
  });
}
