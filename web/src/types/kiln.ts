export type KilnStatus =
  | "idle"
  | "loading"
  | "firing"
  | "cooling"
  | "unloading"
  | "maintenance"
  | "offline";

export type KilnCycle = {
  id: string;
  name: string;
  typicalDurationHours: number;
  tempRange: string;
  notes?: string | null;
};

export type Kiln = {
  id: string;
  name: string;
  type: string;
  volume: string;
  maxTemp: string;
  status: KilnStatus;
  isAvailable: boolean;
  typicalCycles: KilnCycle[];
  notes?: string | null;
};

export type KilnFiringStatus = "scheduled" | "in-progress" | "completed" | "cancelled";

export type KilnFiring = {
  id: string;
  kilnId: string;
  title: string;
  cycleType: string;
  startAt: unknown;
  endAt: unknown;
  status: KilnFiringStatus;
  confidence: "scheduled" | "estimated";
  notes?: string | null;
};
