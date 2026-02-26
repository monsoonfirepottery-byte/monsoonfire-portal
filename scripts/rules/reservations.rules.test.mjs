import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { addDoc, collection, doc, getDocs, orderBy, query, setDoc, where } from "firebase/firestore";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const [host, portText] = EMULATOR_HOST.split(":");
const port = Number(portText || "8085");
const projectId = `rules-reservations-${Date.now()}`;
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const OWNER_UID = "reservation-owner";
const OTHER_UID = "reservation-other";
const STAFF_UID = "reservation-staff";

let testEnv;

function authedDb(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

async function seedReservations() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "reservations", "owner-1"), {
      ownerUid: OWNER_UID,
      status: "REQUESTED",
      firingType: "bisque",
      shelfEquivalent: 1,
      preferredWindow: "next",
      linkedBatchId: null,
      createdAt: new Date("2026-02-26T02:00:00.000Z"),
      updatedAt: new Date("2026-02-26T02:00:00.000Z"),
    });

    await setDoc(doc(db, "reservations", "owner-2"), {
      ownerUid: OWNER_UID,
      status: "REQUESTED",
      firingType: "glaze",
      shelfEquivalent: 2,
      preferredWindow: "next",
      linkedBatchId: null,
      createdAt: new Date("2026-02-26T03:00:00.000Z"),
      updatedAt: new Date("2026-02-26T03:00:00.000Z"),
    });

    await setDoc(doc(db, "reservations", "other-1"), {
      ownerUid: OTHER_UID,
      status: "REQUESTED",
      firingType: "bisque",
      shelfEquivalent: 1,
      preferredWindow: "next",
      linkedBatchId: null,
      createdAt: new Date("2026-02-26T04:00:00.000Z"),
      updatedAt: new Date("2026-02-26T04:00:00.000Z"),
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedReservations();
});

after(async () => {
  await testEnv.cleanup();
});

describe("reservations rules", () => {
  it("allows owner check-ins query shape (ownerUid + createdAt desc)", async () => {
    const db = authedDb(OWNER_UID);
    const reservationsQuery = query(
      collection(db, "reservations"),
      where("ownerUid", "==", OWNER_UID),
      orderBy("createdAt", "desc")
    );
    const snap = await assertSucceeds(getDocs(reservationsQuery));
    assert.equal(snap.size, 2);
    assert.equal(snap.docs[0]?.id, "owner-2");
  });

  it("denies outsider from querying another owner's check-ins", async () => {
    const db = authedDb(OTHER_UID);
    const reservationsQuery = query(
      collection(db, "reservations"),
      where("ownerUid", "==", OWNER_UID),
      orderBy("createdAt", "desc")
    );
    await assertFails(getDocs(reservationsQuery));
  });

  it("allows staff to query reservations by owner and sort by createdAt", async () => {
    const db = authedDb(STAFF_UID, { staff: true, roles: ["staff"] });
    const reservationsQuery = query(
      collection(db, "reservations"),
      where("ownerUid", "==", OWNER_UID),
      orderBy("createdAt", "desc")
    );
    const snap = await assertSucceeds(getDocs(reservationsQuery));
    assert.equal(snap.size, 2);
  });

  it("allows owner to create a reservation with valid shape", async () => {
    const db = authedDb(OWNER_UID);
    await assertSucceeds(
      addDoc(collection(db, "reservations"), {
        ownerUid: OWNER_UID,
        status: "REQUESTED",
        firingType: "bisque",
        shelfEquivalent: 1,
        preferredWindow: "next",
        linkedBatchId: null,
        createdAt: new Date("2026-02-26T05:00:00.000Z"),
        updatedAt: new Date("2026-02-26T05:00:00.000Z"),
      })
    );
  });

  it("denies owner from creating reservation for a different uid", async () => {
    const db = authedDb(OWNER_UID);
    await assertFails(
      addDoc(collection(db, "reservations"), {
        ownerUid: OTHER_UID,
        status: "REQUESTED",
        firingType: "bisque",
        shelfEquivalent: 1,
        preferredWindow: "next",
        linkedBatchId: null,
        createdAt: new Date("2026-02-26T05:00:00.000Z"),
        updatedAt: new Date("2026-02-26T05:00:00.000Z"),
      })
    );
  });
});
