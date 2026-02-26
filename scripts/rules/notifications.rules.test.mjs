import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc } from "firebase/firestore";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const [host, portText] = EMULATOR_HOST.split(":");
const port = Number(portText || "8085");
const projectId = `rules-notifications-${Date.now()}`;
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const OWNER_UID = "notif-owner";
const OTHER_UID = "notif-other";
const STAFF_UID = "notif-staff";

let testEnv;

function authedDb(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

async function seedNotificationData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = new Date("2026-02-26T05:30:00.000Z");

    await setDoc(doc(db, "users", OWNER_UID), {
      email: "owner@example.com",
      displayName: "Owner",
      updatedAt: now,
    });
    await setDoc(doc(db, "users", OTHER_UID), {
      email: "other@example.com",
      displayName: "Other",
      updatedAt: now,
    });

    await setDoc(doc(db, "users", OWNER_UID, "notifications", "notif-1"), {
      title: "Studio update",
      body: "QA seeded notification",
      createdAt: now,
      updatedAt: now,
      readAt: null,
    });

    await setDoc(doc(db, "users", OWNER_UID, "notifications", "notif-2"), {
      title: "Kiln ready",
      body: "Pickup window open",
      createdAt: new Date("2026-02-26T05:45:00.000Z"),
      updatedAt: new Date("2026-02-26T05:45:00.000Z"),
      readAt: null,
    });

    await setDoc(doc(db, "users", OTHER_UID, "notifications", "notif-foreign"), {
      title: "Foreign",
      body: "Not for owner",
      createdAt: now,
      updatedAt: now,
      readAt: null,
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
  await seedNotificationData();
});

after(async () => {
  await testEnv.cleanup();
});

describe("notifications rules", () => {
  it("allows owner to list notifications ordered by createdAt", async () => {
    const db = authedDb(OWNER_UID);
    const notificationsQuery = query(
      collection(db, "users", OWNER_UID, "notifications"),
      orderBy("createdAt", "desc")
    );

    const snap = await assertSucceeds(getDocs(notificationsQuery));
    assert.equal(snap.size, 2);
    assert.equal(snap.docs[0]?.id, "notif-2");
    assert.equal(snap.docs[1]?.id, "notif-1");
  });

  it("allows owner to mark notification as read", async () => {
    const db = authedDb(OWNER_UID);
    const ref = doc(db, "users", OWNER_UID, "notifications", "notif-1");
    await assertSucceeds(
      updateDoc(ref, {
        readAt: new Date("2026-02-26T06:00:00.000Z"),
        updatedAt: new Date("2026-02-26T06:00:00.000Z"),
      })
    );

    const updated = await assertSucceeds(getDoc(ref));
    assert.equal(updated.exists(), true);
  });

  it("denies owner from mutating protected fields", async () => {
    const db = authedDb(OWNER_UID);
    const ref = doc(db, "users", OWNER_UID, "notifications", "notif-1");
    await assertFails(
      updateDoc(ref, {
        title: "Tamper",
      })
    );
  });

  it("denies outsiders from reading another user's notifications", async () => {
    const db = authedDb(OTHER_UID);
    await assertFails(getDoc(doc(db, "users", OWNER_UID, "notifications", "notif-1")));
  });

  it("denies staff from bypassing notification ownership", async () => {
    const db = authedDb(STAFF_UID, { staff: true, roles: ["staff"] });
    await assertFails(getDoc(doc(db, "users", OWNER_UID, "notifications", "notif-1")));
  });
});
