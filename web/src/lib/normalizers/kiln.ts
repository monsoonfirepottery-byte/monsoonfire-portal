import type { Kiln, KilnFiring } from "../../types/kiln";

export function normalizeKilnDoc(id: string, raw: Partial<Kiln>): Kiln {
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "Kiln",
    type: typeof raw.type === "string" ? raw.type : "electric",
    volume: typeof raw.volume === "string" ? raw.volume : "",
    maxTemp: typeof raw.maxTemp === "string" ? raw.maxTemp : "",
    status: raw.status ?? "idle",
    isAvailable: typeof raw.isAvailable === "boolean" ? raw.isAvailable : true,
    typicalCycles: Array.isArray(raw.typicalCycles) ? raw.typicalCycles : [],
    notes: raw.notes ?? null,
  };
}

export function normalizeFiringDoc(id: string, raw: Partial<KilnFiring>): KilnFiring {
  return {
    id,
    kilnId: typeof raw.kilnId === "string" ? raw.kilnId : "",
    title: typeof raw.title === "string" ? raw.title : "Firing",
    cycleType: typeof raw.cycleType === "string" ? raw.cycleType : "unknown",
    startAt: raw.startAt ?? null,
    endAt: raw.endAt ?? null,
    status: raw.status ?? "scheduled",
    confidence: raw.confidence ?? "estimated",
    notes: raw.notes ?? null,
    unloadedAt: raw.unloadedAt ?? null,
    unloadedByUid: raw.unloadedByUid ?? null,
    unloadNote: raw.unloadNote ?? null,
    batchIds: Array.isArray(raw.batchIds) ? raw.batchIds : [],
    pieceIds: Array.isArray(raw.pieceIds) ? raw.pieceIds : [],
    kilnName: raw.kilnName ?? null,
  };
}
