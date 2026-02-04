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

const kilnId = getArg("--kilnId");
const matchName = getArg("--matchName") || "Reduction Raku Kiln";
const status = getArg("--status") || "offline";
const name = getArg("--name") || "Raku";

async function resolveKilnRef() {
  if (kilnId) return db.collection("kilns").doc(kilnId);

  const snap = await db
    .collection("kilns")
    .where("name", "==", matchName)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].ref;
}

async function update() {
  const ref = await resolveKilnRef();
  if (!ref) {
    console.error(
      "Kiln not found. Provide --kilnId or ensure a kiln named 'Reduction Raku Kiln' exists."
    );
    process.exit(1);
  }

  const payload = {
    status,
    name,
    updatedAt: Timestamp.now(),
  };

  await ref.set(payload, { merge: true });
  console.log("Updated kiln", ref.id, payload);
}

update()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
