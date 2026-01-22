const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  DEFAULT_PROJECT_ID;

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
process.env.GCLOUD_PROJECT = projectId;

admin.initializeApp({ projectId });

const db = admin.firestore();
const { Timestamp } = admin.firestore;

function atLocalTime(daysFromNow, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function buildEvent({
  id,
  title,
  summary,
  description,
  location,
  timezone,
  startAt,
  endAt,
  capacity,
  priceCents,
  includesFiring,
  firingDetails,
  addOns,
}) {
  const now = Timestamp.now();
  return {
    id,
    doc: {
      templateId: null,
      title,
      summary,
      description,
      location,
      timezone,
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      capacity,
      priceCents,
      currency: "USD",
      includesFiring,
      firingDetails: firingDetails || null,
      policyCopy:
        "You won't be charged unless you attend. If plans change, no worries - cancel anytime up to 3 hours before the event.",
      addOns: addOns || [],
      waitlistEnabled: true,
      offerClaimWindowHours: 12,
      cancelCutoffHours: 3,
      status: "published",
      ticketedCount: 0,
      offeredCount: 0,
      checkedInCount: 0,
      waitlistCount: 0,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    },
  };
}

async function run() {
  const events = [
    buildEvent({
      id: "seed_raku_night",
      title: "Raku Night",
      summary: "Live-fire glazing, snacks, and a shared kiln crew.",
      description:
        "An evening raku session with studio staff guiding the firing. Bring bisque-ready pieces and stay for the glow.",
      location: "Monsoon Fire Studio",
      timezone: "America/Phoenix",
      startAt: atLocalTime(7, 18, 0),
      endAt: atLocalTime(7, 21, 0),
      capacity: 16,
      priceCents: 8500,
      includesFiring: true,
      firingDetails: "Raku firing included, plus glaze station access.",
      addOns: [
        { id: "extra-clay", title: "Extra clay bag", priceCents: 1500, isActive: true },
        { id: "glaze-pack", title: "Specialty glaze pack", priceCents: 1200, isActive: true },
      ],
    }),
    buildEvent({
      id: "seed_kiln_social",
      title: "Kiln Social + Demo",
      summary: "Watch the unload, ask questions, and connect with the community.",
      description:
        "A relaxed studio gathering with a live kiln unload demo. Great for meeting other artists and getting feedback.",
      location: "Monsoon Fire Studio",
      timezone: "America/Phoenix",
      startAt: atLocalTime(14, 17, 30),
      endAt: atLocalTime(14, 19, 30),
      capacity: 30,
      priceCents: 3500,
      includesFiring: false,
      firingDetails: null,
      addOns: [
        { id: "studio-tea", title: "Studio tea flight", priceCents: 800, isActive: true },
      ],
    }),
  ];

  const writes = events.map((event) =>
    db.collection("events").doc(event.id).set(event.doc, { merge: true })
  );

  await Promise.all(writes);

  console.log("Seeded events:");
  events.forEach((event) => {
    console.log(`- ${event.id} (${event.doc.title})`);
  });
  console.log(`Project: ${projectId}`);
  console.log(`Firestore emulator host: ${emulatorHost}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed", err);
    process.exit(1);
  });
