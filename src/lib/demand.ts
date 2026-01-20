// src/lib/demand.ts
export type DemandBucket = {
  bucketStartISO: string;
  estimatedPickupPax: number;
  flights: number;
};

export function roundDownToBucket(d: Date, minutes = 15) {
  const ms = minutes * 60 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

// People hit rideshare later than runway touchdown.
// Simple model: peak around +35 minutes (spread +/- 15).
export function pickupWaveTimes(estimatedOnISO: string): Date[] {
  const t = new Date(estimatedOnISO);
  // three “lumps” that sum ~1.0
  return [
    new Date(t.getTime() + 20 * 60 * 1000),
    new Date(t.getTime() + 35 * 60 * 1000),
    new Date(t.getTime() + 50 * 60 * 1000),
  ];
}

export function flightsToBuckets(opts: {
  flights: Array<{ estimated_on?: string | null; pax: number }>;
  horizonMinutes: number;
  bucketMinutes?: number;
}): DemandBucket[] {
  const bucketMinutes = opts.bucketMinutes ?? 15;
  const now = new Date();
  const horizon = new Date(now.getTime() + opts.horizonMinutes * 60 * 1000);

  const map = new Map<number, { pax: number; flights: number }>();

  for (const f of opts.flights) {
    if (!f.estimated_on) continue;
    const waves = pickupWaveTimes(f.estimated_on);

    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i];
      if (wave < now || wave > horizon) continue;

      const weight = i === 1 ? 0.5 : 0.25; // 25% + 50% + 25%
      const bucket = roundDownToBucket(wave, bucketMinutes).getTime();
      const cur = map.get(bucket) ?? { pax: 0, flights: 0 };
      cur.pax += Math.round(f.pax * weight);
      cur.flights += (i === 1 ? 1 : 0); // count flight once (at peak)
      map.set(bucket, cur);
    }
  }

  const buckets: DemandBucket[] = [];
  for (const [bucketStartMs, v] of map.entries()) {
    buckets.push({
      bucketStartISO: new Date(bucketStartMs).toISOString(),
      estimatedPickupPax: v.pax,
      flights: v.flights,
    });
  }

  buckets.sort((a, b) => a.bucketStartISO.localeCompare(b.bucketStartISO));
  return buckets;
}
