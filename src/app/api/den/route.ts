// src/app/api/den/route.ts
import { NextResponse } from "next/server";
import { getScheduledArrivalsKDEN } from "@/lib/aeroapi";
import { estimatePassengers } from "@/lib/seatMap";
import { flightsToBuckets } from "@/lib/demand";

export const runtime = "nodejs"; // keep it simple for headers/env access

export async function GET() {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 60 * 1000); // include slightly past (delays)
  const end = new Date(now.getTime() + 3 * 60 * 60 * 1000); // next 3 hours

  const flightsRaw = (await getScheduledArrivalsKDEN({
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    maxPages: 1,
  })) ?? [];

  const flights = flightsRaw
    .filter(f => !f.cancelled && !f.diverted)
    .map(f => {
      const pax = estimatePassengers(f.aircraft_type, 0.82);
      const eta = f.estimated_on || f.scheduled_on || null;
      return {
        ident: f.ident,
        operator: f.operator_iata || f.operator || null,
        origin: f.origin?.code_iata || f.origin?.code || null,
        aircraft_type: f.aircraft_type || null,
        estimated_on: eta,
        arrival_delay_sec: f.arrival_delay ?? null,
        status: f.status ?? null,
        pax,
      };
    })
    .filter(f => !!f.estimated_on);

  const buckets = flightsToBuckets({ flights, horizonMinutes: 120, bucketMinutes: 15 });

  // Simple “Demand Score”: pax hitting pickup in next 60 min, scaled a bit for bunching
  const nowMs = Date.now();
  const sixtyMs = 60 * 60 * 1000;
  const pax60 = buckets
    .filter(b => {
      const t = new Date(b.bucketStartISO).getTime();
      return t >= nowMs && t < nowMs + sixtyMs;
    })
    .reduce((sum, b) => sum + b.estimatedPickupPax, 0);

  const flights60 = flights.filter(f => {
    const wavePeak = new Date(f.estimated_on!).getTime() + 35 * 60 * 1000;
    return wavePeak >= nowMs && wavePeak < nowMs + sixtyMs;
  }).length;

  const demandScore = Math.round(pax60 * (1 + Math.min(0.6, flights60 / 40)));

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    window: { start: start.toISOString(), end: end.toISOString() },
    demand: { pax_next_60m: pax60, flights_next_60m: flights60, demand_score: demandScore },
    buckets,
    flights,
  });
}
