// src/app/page.tsx
"use client";

import { useEffect, useState } from "react";

type ApiPayload = {
  generated_at: string;
  demand: { pax_next_60m: number; flights_next_60m: number; demand_score: number };
  buckets: Array<{ bucketStartISO: string; estimatedPickupPax: number; flights: number }>;
  flights: Array<{ ident: string; operator: string | null; origin: string | null; aircraft_type: string | null; estimated_on: string; pax: number; status: string | null }>;
};

export default function Home() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const res = await fetch("/api/den", { cache: "no-store" });
    if (!res.ok) {
      setErr(`API error ${res.status}`);
      return;
    }
    setData(await res.json());
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="min-h-screen p-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">DEN Pickup Pressure</h1>
        <button
          className="px-3 py-2 rounded-xl border text-sm"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {err && <p className="mt-4 text-red-600">{err}</p>}
      {!data && !err && <p className="mt-4">Loading…</p>}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Demand score" value={data.demand.demand_score} big />
            <Stat label="Pax (next 60m)" value={data.demand.pax_next_60m} />
            <Stat label="Flights (next 60m)" value={data.demand.flights_next_60m} />
          </div>

          <p className="mt-3 text-xs opacity-70">
            Updated {new Date(data.generated_at).toLocaleTimeString()}
          </p>

          <h2 className="mt-6 text-lg font-semibold">Next 2 hours (15-min buckets)</h2>
          <div className="mt-2 space-y-2">
            {data.buckets.map((b) => (
              <div key={b.bucketStartISO} className="rounded-2xl border p-3">
                <div className="flex justify-between">
                  <div className="font-medium">
                    {new Date(b.bucketStartISO).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="text-sm opacity-70">{b.flights ? `${b.flights} flights` : ""}</div>
                </div>
                <div className="mt-2 text-2xl font-bold">{b.estimatedPickupPax} pax</div>
              </div>
            ))}
            {data.buckets.length === 0 && <p className="opacity-70">No buckets in horizon.</p>}
          </div>

          <h2 className="mt-6 text-lg font-semibold">Arrivals list</h2>
          <div className="mt-2 space-y-2">
            {data.flights.slice(0, 25).map((f) => (
              <div key={f.ident + f.estimated_on} className="rounded-2xl border p-3">
                <div className="flex justify-between gap-2">
                  <div className="font-semibold">{f.operator ?? "?"} {f.ident}</div>
                  <div className="text-sm">
                    {new Date(f.estimated_on).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div className="mt-1 text-sm opacity-80">
                  From {f.origin ?? "?"} • {f.aircraft_type ?? "UNK"} • ~{f.pax} pax
                </div>
                {f.status && <div className="mt-1 text-xs opacity-60">{f.status}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div className="rounded-2xl border p-3">
      <div className="text-xs opacity-70">{label}</div>
      <div className={big ? "text-3xl font-bold mt-1" : "text-xl font-bold mt-1"}>{value}</div>
    </div>
  );
}
