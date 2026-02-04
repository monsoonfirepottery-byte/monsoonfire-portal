import type { Kiln, KilnFiring } from "../types/kiln";

const now = new Date();
const baseYear = now.getFullYear();
const baseMonth = now.getMonth();

const makeDate = (monthOffset: number, day: number, hour: number, minute = 0) =>
  new Date(baseYear, baseMonth + monthOffset, day, hour, minute, 0, 0);

export const mockKilns: Kiln[] = [
  {
    id: "kiln-ll-eq2827-3",
    name: "L&L eQ2827-3",
    type: "Electric oxidation",
    volume: "Production",
    maxTemp: "Cone 10",
    status: "loading",
    isAvailable: true,
    typicalCycles: [
      {
        id: "ll-bisque",
        name: "Bisque",
        typicalDurationHours: 9,
        tempRange: "Cone 04",
        notes: "Slow ramp, overnight cool.",
      },
      {
        id: "ll-glaze",
        name: "Mid-fire glaze",
        typicalDurationHours: 8,
        tempRange: "Cone 6",
        notes: "Standard cone 6 glaze.",
      },
    ],
    notes: "Genesis touch screen controller. Cone fire + ramp/hold programs.",
  },
  {
    id: "kiln-raku-reduction",
    name: "Reduction Raku Kiln",
    type: "Gas reduction",
    volume: "Outdoor",
    maxTemp: "Variable",
    status: "idle",
    isAvailable: true,
    typicalCycles: [
      {
        id: "raku-reduction",
        name: "Reduction firing",
        typicalDurationHours: 8,
        tempRange: "Reduction",
        notes: "Normal reduction firing window.",
      },
      {
        id: "raku-glaze",
        name: "Raku glaze fire",
        typicalDurationHours: 3,
        tempRange: "Raku",
        notes: "45 min glaze fire + 2 hour reduction cool-down.",
      },
    ],
    notes: "Raku + reduction firing by scheduled request.",
  },
];

export const mockFirings: KilnFiring[] = [
  {
    id: "firing-201",
    kilnId: "kiln-ll-eq2827-3",
    title: "Bisque firing",
    cycleType: "bisque",
    startAt: makeDate(0, 3, 8, 30),
    endAt: makeDate(0, 3, 18, 0),
    status: "scheduled",
    confidence: "scheduled",
    notes: "Drop-off deadline 7:00 AM.",
  },
  {
    id: "firing-202",
    kilnId: "kiln-ll-eq2827-3",
    title: "Mid-fire glaze",
    cycleType: "glaze",
    startAt: makeDate(0, 5, 9, 0),
    endAt: makeDate(0, 5, 20, 30),
    status: "in-progress",
    confidence: "scheduled",
    notes: "Cone 6 glaze load.",
  },
  {
    id: "firing-203",
    kilnId: "kiln-raku-reduction",
    title: "Reduction firing",
    cycleType: "reduction",
    startAt: makeDate(0, 7, 9, 0),
    endAt: makeDate(0, 7, 17, 0),
    status: "scheduled",
    confidence: "scheduled",
    notes: "Standard reduction firing window.",
  },
  {
    id: "firing-204",
    kilnId: "kiln-raku-reduction",
    title: "Raku glaze fire",
    cycleType: "raku",
    startAt: makeDate(0, 10, 13, 0),
    endAt: makeDate(0, 10, 16, 0),
    status: "scheduled",
    confidence: "scheduled",
    notes: "45 min glaze fire + 2 hour reduction cool-down.",
  },
  {
    id: "firing-205",
    kilnId: "kiln-ll-eq2827-3",
    title: "Bisque firing",
    cycleType: "bisque",
    startAt: makeDate(1, 2, 8, 30),
    endAt: makeDate(1, 2, 18, 0),
    status: "scheduled",
    confidence: "estimated",
    notes: "Next month preview.",
  },
  {
    id: "firing-206",
    kilnId: "kiln-raku-reduction",
    title: "Reduction firing",
    cycleType: "reduction",
    startAt: makeDate(1, 6, 10, 0),
    endAt: makeDate(1, 6, 18, 0),
    status: "scheduled",
    confidence: "estimated",
    notes: "Subject to load availability.",
  },
];
