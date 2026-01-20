// src/lib/aeroapi.ts
const BASE = process.env.AEROAPI_BASE_URL || "https://aeroapi.flightaware.com/aeroapi";
const KEY = process.env.AEROAPI_KEY;

export type AeroScheduledArrival = {
  ident: string;
  operator?: string | null;
  operator_iata?: string | null;
  flight_number?: string | null;
  origin?: { code?: string | null; code_iata?: string | null; code_icao?: string | null; city?: string | null; name?: string | null } | null;
  destination?: { code?: string | null; code_iata?: string | null; code_icao?: string | null } | null;
  aircraft_type?: string | null;
  estimated_on?: string | null;
  scheduled_on?: string | null;
  actual_on?: string | null;
  cancelled?: boolean;
  diverted?: boolean;
  status?: string;
  arrival_delay?: number | null; // seconds
};

export async function getScheduledArrivalsKDEN(opts: { startISO: string; endISO: string; maxPages?: number }) {
  if (!KEY) throw new Error("Missing AEROAPI_KEY env var");

  const url = new URL(`${BASE}/airports/KDEN/flights/scheduled_arrivals`);
  url.searchParams.set("start", opts.startISO);
  url.searchParams.set("end", opts.endISO);
  url.searchParams.set("max_pages", String(opts.maxPages ?? 1));

  const res = await fetch(url.toString(), {
    headers: {
      "x-apikey": KEY, // AeroAPI auth :contentReference[oaicite:4]{index=4}
      "accept": "application/json",
    },
    // Vercel/Next caching hint — helps stay within free tier
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AeroAPI error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data?.scheduled_arrivals as AeroScheduledArrival[] | undefined;
}
