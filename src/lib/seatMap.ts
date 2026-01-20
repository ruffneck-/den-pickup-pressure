// src/lib/seatMap.ts
export const aircraftSeatMap: Record<string, number> = {
  // Common US narrowbodies / regionals (rough defaults)
  A320: 170,
  A319: 140,
  A321: 190,
  B738: 175, // 737-800
  B739: 180, // 737-900/900ER (varies)
  B737: 160,
  B752: 200, // 757-200
  B763: 240, // 767-300 (varies)
  B772: 300, // 777-200 (varies)
  B789: 290, // 787-9 (varies)
  A20N: 180, // A320neo
  A21N: 200, // A321neo

  // Regionals
  E175: 76,
  E170: 70,
  CRJ9: 76,
  CRJ7: 70,
  CRJ2: 50,

  // If unknown
  UNK: 100,
};

export function estimatePassengers(aircraftType?: string | null, loadFactor = 0.82) {
  const key = (aircraftType || "UNK").toUpperCase().trim();
  const seats = aircraftSeatMap[key] ?? aircraftSeatMap.UNK;
  return Math.max(0, Math.round(seats * loadFactor));
}
