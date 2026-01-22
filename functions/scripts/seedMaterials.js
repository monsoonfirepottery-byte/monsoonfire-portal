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

function buildProduct({
  id,
  name,
  description,
  category,
  sku,
  priceCents,
  trackInventory,
  inventoryOnHand,
}) {
  const now = Timestamp.now();
  return {
    id,
    doc: {
      name,
      description: description || null,
      category: category || null,
      sku: sku || null,
      priceCents,
      currency: "USD",
      stripePriceId: null,
      imageUrl: null,
      trackInventory,
      inventoryOnHand: trackInventory ? inventoryOnHand || 0 : null,
      inventoryReserved: trackInventory ? 0 : null,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  };
}

async function run() {
  const products = [
    buildProduct({
      id: "seed_laguna_bmix_25",
      name: "Laguna B-Mix Cone 5/6 (25 lb)",
      description: "Smooth, white mid-fire body for everyday throwing.",
      category: "Clays",
      sku: "LAGUNA_BMIX_5_25",
      priceCents: 4000,
      trackInventory: true,
      inventoryOnHand: 24,
    }),
    buildProduct({
      id: "seed_tool_kit",
      name: "Studio Tool Kit",
      description: "Basic trimming and shaping tools for class nights.",
      category: "Tools",
      sku: "STUDIO_TOOL_KIT",
      priceCents: 2200,
      trackInventory: false,
      inventoryOnHand: 0,
    }),
  ];

  const writes = products.map((product) =>
    db.collection("materialsProducts").doc(product.id).set(product.doc, { merge: true })
  );

  await Promise.all(writes);

  console.log("Seeded materials products:");
  products.forEach((product) => {
    console.log(`- ${product.id} (${product.doc.name})`);
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
