import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const [host, portText] = EMULATOR_HOST.split(":");
const port = Number(portText || "8085");
const projectId = `rules-profile-notification-prefs-${Date.now()}`;
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const OWNER_UID = "profile-owner";
const OTHER_UID = "profile-other";

let testEnv;

function authedDb(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

function buildNotificationPrefs(overrides = {}) {
  return {
    enabled: true,
    channels: {
      inApp: true,
      email: true,
      push: false,
      sms: false,
    },
    events: {
      kilnUnloaded: true,
      kilnUnloadedBisque: true,
      kilnUnloadedGlaze: true,
      reservationStatus: true,
      reservationEtaShift: true,
      reservationPickupReady: true,
      reservationDelayFollowUp: true,
      reservationPickupReminder: true,
      ...(overrides.events ?? {}),
    },
    quietHours: {
      enabled: false,
      startLocal: "22:00",
      endLocal: "07:00",
      timezone: "America/Phoenix",
    },
    frequency: {
      mode: "immediate",
      digestHours: null,
    },
    updatedAt: new Date("2026-04-13T06:00:00.000Z"),
    ...overrides,
  };
}

async function seedDocs() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "profiles", OWNER_UID), {
      createdAt: new Date("2026-04-13T04:30:00.000Z"),
      displayName: "Owner",
      notifyReservations: true,
      updatedAt: new Date("2026-04-13T05:00:00.000Z"),
    });

    await setDoc(doc(db, "users", OWNER_UID), {
      email: "owner@example.com",
      displayName: "Owner",
      updatedAt: new Date("2026-04-13T05:00:00.000Z"),
    });

    await setDoc(
      doc(db, "users", OWNER_UID, "prefs", "notifications"),
      buildNotificationPrefs({
        updatedAt: new Date("2026-04-13T05:30:00.000Z"),
      })
    );
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
  await seedDocs();
});

after(async () => {
  await testEnv.cleanup();
});

describe("profile notification preference rules", () => {
  it("allows owner to update notifyReservations on their profile", async () => {
    const db = authedDb(OWNER_UID);
    const ref = doc(db, "profiles", OWNER_UID);

    await assertSucceeds(
      updateDoc(ref, {
        notifyReservations: false,
        updatedAt: new Date("2026-04-13T06:10:00.000Z"),
      })
    );

    const snap = await assertSucceeds(getDoc(ref));
    assert.equal(snap.data()?.notifyReservations, false);
    assert.equal(snap.data()?.createdAt?.toDate().toISOString(), "2026-04-13T04:30:00.000Z");
  });

  it("allows owner to update notification prefs with reservation event keys", async () => {
    const db = authedDb(OWNER_UID);
    const ref = doc(db, "users", OWNER_UID, "prefs", "notifications");

    await assertSucceeds(
      setDoc(
        ref,
        buildNotificationPrefs({
          events: {
            reservationPickupReady: false,
            reservationPickupReminder: false,
            reservationDelayFollowUp: false,
          },
          updatedAt: new Date("2026-04-13T06:20:00.000Z"),
        })
      )
    );

    const snap = await assertSucceeds(getDoc(ref));
    assert.equal(snap.data()?.events?.reservationPickupReady, false);
    assert.equal(snap.data()?.events?.reservationPickupReminder, false);
    assert.equal(snap.data()?.events?.reservationDelayFollowUp, false);
  });

  it("denies notification prefs writes with unknown event keys", async () => {
    const db = authedDb(OWNER_UID);
    const ref = doc(db, "users", OWNER_UID, "prefs", "notifications");

    await assertFails(
      setDoc(
        ref,
        buildNotificationPrefs({
          events: {
            reservationMysteryEvent: true,
          },
          updatedAt: new Date("2026-04-13T06:30:00.000Z"),
        })
      )
    );
  });

  it("denies outsiders from updating another user's notification prefs", async () => {
    const db = authedDb(OTHER_UID);
    const ref = doc(db, "users", OWNER_UID, "prefs", "notifications");

    await assertFails(
      setDoc(
        ref,
        buildNotificationPrefs({
          updatedAt: new Date("2026-04-13T06:40:00.000Z"),
        })
      )
    );
  });
});
