// src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type ApiResponse = {
  generated_at: string;
  provider: string;
  demand: {
    pax_next_60m: number;
    flights_considered: number;
    demand_score: number;
  };
  decision: {
    recommendation: "LEAVE" | "WAIT" | "STAY" | "MOVE_IN";
    confidence: "LOW" | "MED" | "HIGH";
    known_aircraft_rate: number;
    aircraft_inferred_count?: number;
    big_wave_imminent?: boolean;

    rides_next_60m_raw?: number;
    rides_next_60m: number;
    rides_next_60m_high?: number;
    rides_per_min: number;

    pressure_index: number;
    peak_bucket: {
      time: string;
      pax: number;
      minutes_until_peak: number;
    };
  };
  buckets: Array<{
    bucketStartISO: string;
    estimatedPickupPax: number;
    flights?: number;
  }>;
  flights: Array<{
    ident: string;
    operator: string | null;
    origin: string | null;
    aircraft_type: string | null;
    estimated_on: string;
    status: string | null;
    pax: number;
    _aircraft_inferred?: boolean;
  }>;
};

function fmtLocalTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtLocalDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function RecBadge({ rec }: { rec: ApiResponse["decision"]["recommendation"] }) {
  const map: Record<string, string> = {
    MOVE_IN: "bg-green-600",
    STAY: "bg-emerald-600",
    WAIT: "bg-yellow-500",
    LEAVE: "bg-zinc-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-4 py-2 text-white font-semibold tracking-wide ${map[rec] ?? "bg-zinc-600"}`}>
      {rec.replace("_", " ")}
    </span>
  );
}

function ConfidenceBadge({ c }: { c: ApiResponse["decision"]["confidence"] }) {
  const map: Record<string, string> = {
    HIGH: "bg-green-100 text-green-900",
    MED: "bg-yellow-100 text-yellow-900",
    LOW: "bg-zinc-200 text-zinc-900",
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${map[c]}`}>{c} CONFIDENCE</span>;
}

export default function HomePage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFlights, setShowFlights] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/den", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000); // match your server revalidate
    return () => clearInterval(t);
  }, []);

  const maxBucket = useMemo(() => {
    if (!data?.buckets?.length) return 1;
    return Math.max(...data.buckets.map((b) => b.estimatedPickupPax), 1);
  }, [data]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">DEN Pickup Pressure</h1>
            <p className="text-sm text-zinc-400">
              Conservative mode • Provider: <span className="font-semibold text-zinc-200">{data?.provider ?? "—"}</span>
            </p>
          </div>

          <button
            onClick={load}
            className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold hover:bg-zinc-700 active:scale-[0.99]"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {err && (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            Error: {err}
          </div>
        )}

        {!data && !err && (
          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 text-zinc-300">
            Loading…
          </div>
        )}

        {data && (
          <>
            {/* Decision Card */}
            <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <RecBadge rec={data.decision.recommendation} />
                  <ConfidenceBadge c={data.decision.confidence} />
                </div>

                <div className="text-sm text-zinc-400">
                  Updated: <span className="text-zinc-200 font-semibold">{fmtLocalDateTime(data.generated_at)}</span>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl bg-zinc-950/60 p-4 border border-zinc-800">
                  <div className="text-xs uppercase tracking-wide text-zinc-400">Est rides (60m)</div>
                  <div className="mt-1 text-2xl font-bold">{data.decision.rides_next_60m}</div>
                  {typeof data.decision.rides_next_60m_high === "number" && (
                    <div className="mt-1 text-xs text-zinc-400">
                      Range: {data.decision.rides_next_60m}–{data.decision.rides_next_60m_high}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-zinc-400">~{data.decision.rides_per_min} / min</div>
                </div>

                <div className="rounded-2xl bg-zinc-950/60 p-4 border border-zinc-800">
                  <div className="text-xs uppercase tracking-wide text-zinc-400">Peak wave</div>
                  <div className="mt-1 text-2xl font-bold">
                    {data.decision.peak_bucket.minutes_until_peak} min
                  </div>
                  <div className="mt-1 text-sm text-zinc-300">
                    {data.decision.peak_bucket.pax} pax @ {fmtLocalTime(data.decision.peak_bucket.time)}
                  </div>
                  {data.decision.big_wave_imminent && (
                    <div className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                      Big wave imminent
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-zinc-950/60 p-4 border border-zinc-800">
                  <div className="text-xs uppercase tracking-wide text-zinc-400">Pressure index</div>
                  <div className="mt-1 text-2xl font-bold">{data.decision.pressure_index}/100</div>
                  <div className="mt-2 h-2 w-full rounded-full bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-white"
                      style={{ width: `${Math.max(2, data.decision.pressure_index)}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-400">
                    Calibrated to rides (not pax)
                  </div>
                </div>

                <div className="rounded-2xl bg-zinc-950/60 p-4 border border-zinc-800">
                  <div className="text-xs uppercase tracking-wide text-zinc-400">Data quality</div>
                  <div className="mt-1 text-2xl font-bold">
                    {Math.round(data.decision.known_aircraft_rate * 100)}%
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">Aircraft types known</div>
                  <div className="mt-2 text-xs text-zinc-400">
                    Inferred: {data.decision.aircraft_inferred_count ?? 0} • Flights: {data.demand.flights_considered}
                  </div>
                </div>
              </div>

              <div className="mt-4 text-sm text-zinc-400">
                Pax next 60m: <span className="text-zinc-200 font-semibold">{data.demand.pax_next_60m}</span>
              </div>
            </section>

            {/* Buckets */}
            <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Next 2 hours</h2>
                <div className="text-xs text-zinc-500">15-minute buckets</div>
              </div>

              <div className="mt-4 space-y-3">
                {data.buckets.map((b) => {
                  const pct = Math.round((b.estimatedPickupPax / maxBucket) * 100);
                  return (
                    <div key={b.bucketStartISO} className="flex items-center gap-3">
                      <div className="w-16 text-sm text-zinc-300">{fmtLocalTime(b.bucketStartISO)}</div>
                      <div className="flex-1">
                        <div className="h-3 rounded-full bg-zinc-800">
                          <div className="h-3 rounded-full bg-white" style={{ width: `${Math.max(1, pct)}%` }} />
                        </div>
                      </div>
                      <div className="w-24 text-right text-sm text-zinc-200 tabular-nums">
                        {b.estimatedPickupPax} pax
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Flights (optional debug) */}
            <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Flights</h2>
                <button
                  onClick={() => setShowFlights((v) => !v)}
                  className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-semibold hover:bg-zinc-700"
                >
                  {showFlights ? "Hide" : "Show"}
                </button>
              </div>

              {showFlights && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-zinc-400">
                      <tr className="border-b border-zinc-800">
                        <th className="py-2 text-left">ETA</th>
                        <th className="py-2 text-left">Flight</th>
                        <th className="py-2 text-left">From</th>
                        <th className="py-2 text-left">Op</th>
                        <th className="py-2 text-left">Type</th>
                        <th className="py-2 text-right">Pax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.flights
                        .slice()
                        .sort((a, b) => new Date(a.estimated_on).getTime() - new Date(b.estimated_on).getTime())
                        .slice(0, 50)
                        .map((f) => (
                          <tr key={`${f.ident}-${f.estimated_on}`} className="border-b border-zinc-900">
                            <td className="py-2 text-zinc-300">{fmtLocalTime(f.estimated_on)}</td>
                            <td className="py-2 font-semibold text-zinc-100">
                              {f.ident}
                              {f._aircraft_inferred ? <span className="ml-2 text-xs text-zinc-400">(inferred)</span> : null}
                            </td>
                            <td className="py-2 text-zinc-300">{f.origin ?? "—"}</td>
                            <td className="py-2 text-zinc-300">{f.operator ?? "—"}</td>
                            <td className="py-2 text-zinc-300">{f.aircraft_type ?? "UNK"}</td>
                            <td className="py-2 text-right tabular-nums text-zinc-200">{f.pax}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>

                  <div className="mt-3 text-xs text-zinc-500">
                    Showing first 50 flights • (We can add paging later)
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
