const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  DEFAULT_PROJECT_ID;

process.env.GCLOUD_PROJECT = projectId;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;

admin.initializeApp({ projectId });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const billingUid = process.env.BILLING_TEST_UID || "billing-test-user";
const billingEmail = process.env.BILLING_TEST_EMAIL || "billing@monsoonfire.com";

const now = Timestamp.now();

const signups = [
  {
    id: "billing_sample_checkin",
    doc: {
      eventId: "seed_raku_night",
      uid: billingUid,
      status: "checked_in",
      paymentStatus: "unpaid",
      displayName: "Billing Sample",
      email: billingEmail,
      checkedInAt: now,
      checkInMethod: "self",
      createdAt: now,
      updatedAt: now,
    },
  },
];

const charges = [
  {
    id: "billing_sample_charge",
    doc: {
      eventId: "seed_raku_night",
      signupId: "billing_sample_checkin",
      uid: billingUid,
      lineItems: [
        { id: "ticket", title: "Raku Night ticket", priceCents: 8500, quantity: 1 },
        { id: "extra-clay", title: "Extra clay bag", priceCents: 1500, quantity: 1 },
      ],
      totalCents: 10000,
      currency: "USD",
      paymentStatus: "paid",
      stripeCheckoutSessionId: "cs_test_billing_sample",
      stripePaymentIntentId: "pi_test_billing_sample",
      createdAt: now,
      updatedAt: now,
      paidAt: now,
    },
  },
];

const materials = [
  {
    id: "billing_order_pending",
    doc: {
      uid: billingUid,
      displayName: "Billing Sample",
      email: billingEmail,
      status: "checkout_pending",
      totalCents: 4000,
      currency: "USD",
      items: [
        { name: "Laguna WC-401 B-Mix", quantity: 1, unitPrice: 4000 },
      ],
      checkoutUrl: null,
      pickupNotes: "Pick up before the next kiln load.",
      createdAt: now,
      updatedAt: now,
    },
  },
  {
    id: "billing_order_paid",
    doc: {
      uid: billingUid,
      displayName: "Billing Sample",
      email: billingEmail,
      status: "paid",
      totalCents: 2200,
      currency: "USD",
      items: [
        { name: "Day Pass", quantity: 1, unitPrice: 2200 },
      ],
      checkoutUrl: "https://stripe.com/receipt/sample",
      pickupNotes: null,
      createdAt: now,
      updatedAt: now,
      paidAt: now,
    },
  },
];

async function seedCollection(section) {
  const { collectionName, entries } = section;
  for (const entry of entries) {
    await db.collection(collectionName).doc(entry.id).set(entry.doc, { merge: true });
  }
  console.log(`Seeded ${entries.length} item(s) into ${collectionName}`);
}

(async () => {
  try {
    await seedCollection({ collectionName: "eventSignups", entries: signups });
    await seedCollection({ collectionName: "eventCharges", entries: charges });
    await seedCollection({ collectionName: "materialsOrders", entries: materials });

    console.log("Billing seed complete 👌");
    console.log(`Project: ${projectId}`);
    console.log(`Firestore emulator host: ${emulatorHost}`);
    process.exit(0);
  } catch (err) {
    console.error("Billing seed failed", err);
    process.exit(1);
  }
})();
