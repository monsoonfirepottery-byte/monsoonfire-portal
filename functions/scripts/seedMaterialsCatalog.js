/* eslint-disable no-console */
const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_EMULATOR_HOST = "127.0.0.1:8080";

const products = [
  {
    sku: "DAY_PASS",
    name: "Day Pass",
    description:
      "Reserve your creative time in our fully equipped west-side studio. Full access to workspace, tools, wheels, glazes, and materials. Drop-offs and pickups do not require a pass, but work sessions do.",
    category: "Studio Access",
    priceCents: 4000,
    trackInventory: false,
  },
  {
    sku: "LAGUNA_BMIX_5_25",
    name: "Laguna WC-401 B-Mix Cone 5/6 (25 lb)",
    description:
      "Wet clay direct from Laguna in a 25 lb bag. Mid-fire stoneware, smooth porcelain texture, fires to a cream color in oxidation.",
    category: "Clays",
    priceCents: 4000,
    trackInventory: false,
  },
  {
    sku: "LAGUNA_BMIX_5_50",
    name: "Laguna WC-401 B-Mix Cone 5/6 (50 lb)",
    description:
      "Wet clay direct from Laguna in a 50 lb box. Mid-fire stoneware, smooth porcelain texture, fires to a cream color in oxidation.",
    category: "Clays",
    priceCents: 8000,
    trackInventory: false,
  },
  {
    sku: "LAGUNA_BMIX_10_25",
    name: "Laguna WC-401 B-Mix Cone 10 (25 lb)",
    description:
      "Wet clay direct from Laguna in a 25 lb bag. High-fire stoneware, smooth porcelain texture, fires to a cream color in oxidation.",
    category: "Clays",
    priceCents: 4000,
    trackInventory: false,
  },
  {
    sku: "LAGUNA_BMIX_10_50",
    name: "Laguna WC-401 B-Mix Cone 10 (50 lb)",
    description:
      "Wet clay direct from Laguna in a 50 lb box. High-fire stoneware, smooth porcelain texture, fires to a cream color in oxidation.",
    category: "Clays",
    priceCents: 8000,
    trackInventory: false,
  },
  {
    sku: "LAGUNA_BMIX_SPECKS_5_25",
    name: "Laguna B-Mix w/ Specks Cone 5/6 (25 lb)",
    description:
      "Wet clay direct from Laguna in a 25 lb bag. Mid-fire stoneware with specks, smooth and workable. Prefers slow drying and ample compression.",
    category: "Clays",
    priceCents: 4500,
    trackInventory: false,
  },
  {
    sku: "LAGUNA_BMIX_SPECKS_5_50",
    name: "Laguna B-Mix w/ Specks Cone 5/6 (50 lb)",
    description:
      "Wet clay direct from Laguna in a 50 lb box. Mid-fire stoneware with specks, smooth and workable. Prefers slow drying and ample compression.",
    category: "Clays",
    priceCents: 9000,
    trackInventory: false,
  },
  {
    sku: "RECYCLED_CLAY_MIDFIRE",
    name: "Recycled Clay - Mixed MidFire (per lb)",
    description:
      "Freshly pugged clay from the studio. Budget friendly option for practice. Sold by the lb.",
    category: "Clays",
    priceCents: 100,
    trackInventory: false,
  },
  {
    sku: "MAYCO_WAX_RESIST_PINT",
    name: "Mayco AC-302 Wax Resist (pint)",
    description:
      "Water-based coating that repels glaze and keeps surfaces clean. Blue in the jar so you can see where it is applied.",
    category: "Glaze Supplies",
    priceCents: 800,
    trackInventory: false,
  },
  {
    sku: "MAYCO_WAX_RESIST_GALLON",
    name: "Mayco AC-302 Wax Resist (gallon)",
    description:
      "Water-based coating that repels glaze and keeps surfaces clean. Blue in the jar so you can see where it is applied.",
    category: "Glaze Supplies",
    priceCents: 7000,
    trackInventory: false,
  },
  {
    sku: "LOCKER_ACCESS_MONTH",
    name: "Locker Access - One Month",
    description:
      "Rent a studio locker for a month. Supply your own lock. Locker dimensions are 11\" x 9\" x 16\". Best for tools, dry components, and bagged clays.",
    category: "Studio Add-ons",
    priceCents: 500,
    trackInventory: false,
  },
  {
    sku: "GLAZES_TAKE_HOME_4OZ",
    name: "Glazes (Take Home) - 4 oz",
    description:
      "Take any of our studio glazes home. Includes a glass storage jug. Rotating tap of glazes, including specialty options.",
    category: "Glaze Supplies",
    priceCents: 400,
    trackInventory: false,
  },
  {
    sku: "GLAZES_TAKE_HOME_16OZ",
    name: "Glazes (Take Home) - 16 oz",
    description:
      "Take any of our studio glazes home. Includes a glass storage jug. Rotating tap of glazes, including specialty options.",
    category: "Glaze Supplies",
    priceCents: 1600,
    trackInventory: false,
  },
  {
    sku: "GLAZES_TAKE_HOME_32OZ",
    name: "Glazes (Take Home) - 32 oz",
    description:
      "Take any of our studio glazes home. Includes a glass storage jug. Rotating tap of glazes, including specialty options.",
    category: "Glaze Supplies",
    priceCents: 2800,
    trackInventory: false,
  },
  {
    sku: "GLAZES_TAKE_HOME_64OZ",
    name: "Glazes (Take Home) - 64 oz",
    description:
      "Take any of our studio glazes home. Includes a glass storage jug. Rotating tap of glazes, including specialty options.",
    category: "Glaze Supplies",
    priceCents: 5600,
    trackInventory: false,
  },
];

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function seed() {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID;

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const t = admin.firestore.Timestamp.now();

  const batch = db.batch();
  products.forEach((product) => {
    const ref = db.collection("materialsProducts").doc(slugify(product.sku));
    batch.set(
      ref,
      {
        name: product.name,
        description: product.description ?? null,
        category: product.category ?? null,
        sku: product.sku,
        priceCents: product.priceCents,
        currency: "USD",
        stripePriceId: null,
        imageUrl: null,
        trackInventory: product.trackInventory,
        inventoryOnHand: product.trackInventory ? 0 : null,
        inventoryReserved: product.trackInventory ? 0 : null,
        active: true,
        createdAt: t,
        updatedAt: t,
      },
      { merge: true }
    );
  });

  await batch.commit();
  console.log(`Seeded materialsProducts: ${products.length}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
