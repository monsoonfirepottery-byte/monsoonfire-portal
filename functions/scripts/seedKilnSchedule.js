/* eslint-disable no-console */
const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_EMULATOR_HOST = "127.0.0.1:8080";

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.split("=").slice(1).join("=") : null;
};

const projectId = getArg("--projectId") || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const allowProduction = args.includes("--allowProduction");

if (!allowProduction) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_EMULATOR_HOST;
}

admin.initializeApp({ projectId });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const now = new Date();
const baseYear = now.getFullYear();
const baseMonth = now.getMonth();

const makeDate = (monthOffset, day, hour, minute = 0) =>
  new Date(baseYear, baseMonth + monthOffset, day, hour, minute, 0, 0);

const kilns = [
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
    name: "Raku",
    type: "Gas reduction",
    volume: "Outdoor",
    maxTemp: "Variable",
    status: "offline",
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

const firings = [
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

async function seed() {
  const batch = db.batch();
  kilns.forEach((kiln) => {
    batch.set(db.collection("kilns").doc(kiln.id), {
      ...kiln,
      updatedAt: Timestamp.now(),
    });
  });
  firings.forEach((firing) => {
    batch.set(db.collection("kilnFirings").doc(firing.id), {
      ...firing,
      startAt: Timestamp.fromDate(firing.startAt),
      endAt: Timestamp.fromDate(firing.endAt),
      updatedAt: Timestamp.now(),
    });
  });
  await batch.commit();
}

seed()
  .then(() => {
    console.log("Seeded kilns + kilnFirings.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
