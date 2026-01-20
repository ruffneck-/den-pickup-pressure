// src/lib/aviationstack.ts
const KEY = process.env.AVIATIONSTACK_API_KEY;
const BASE = process.env.AVIATIONSTACK_BASE_URL || "http://api.aviationstack.com/v1"; // free tier often needs HTTP :contentReference[oaicite:4]{index=4}

export type AviationstackFlight = {
  flight_status?: string | null;

  airline?: { name?: string | null; iata?: string | null; icao?: string | null } | null;
  flight?: { number?: string | null; iata?: string | null; icao?: string | null } | null;

  departure?: {
    iata?: string | null;
    icao?: string | null;
    scheduled?: string | null;
    estimated?: string | null;
    actual?: string | null;
    timezone?: string | null;
  } | null;

  arrival?: {
    iata?: string | null;
    icao?: string | null;
    scheduled?: string | null;
    estimated?: string | null;
    actual?: string | null;
    timezone?: string | null;
  } | null;

  aircraft?: { iata?: string | null; icao?: string | null; registration?: string | null } | null;

  live?: unknown; // optional; depends on plan/status
};

export async function getArrivalsToDEN(opts: { limit?: number; offset?: number }) {
  if (!KEY) throw new Error("Missing AVIATIONSTACK_API_KEY env var");

  const url = new URL(`${BASE}/flights`);
  url.searchParams.set("access_key", KEY); // Aviationstack auth :contentReference[oaicite:5]{index=5}
  url.searchParams.set("arr_iata", "DEN");
  url.searchParams.set("limit", String(opts.limit ?? 100));
  url.searchParams.set("offset", String(opts.offset ?? 0));

  const res = await fetch(url.toString(), {
    // Cache hard to protect free-tier quota :contentReference[oaicite:6]{index=6}
    next: { revalidate: 120 },
    headers: { accept: "application/json" },
  });

  // Aviationstack returns 200 with {error:{...}} sometimes — handle both.
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`Aviationstack HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  if (data?.error) {
    throw new Error(`Aviationstack API error: ${JSON.stringify(data.error)}`);
  }

  return (data?.data ?? []) as AviationstackFlight[];
}
