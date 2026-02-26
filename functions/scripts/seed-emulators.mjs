#!/usr/bin/env node

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "monsoonfire-portal";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

const seedUsers = {
  client: {
    uid: "seed-client-001",
    email: "seed.client@monsoonfire.local",
    password: "SeedPass!123",
    displayName: "Seed Client",
  },
  staff: {
    uid: "seed-staff-001",
    email: "seed.staff@monsoonfire.local",
    password: "SeedPass!123",
    displayName: "Seed Staff",
  },
};

function ts(ms) {
  return Timestamp.fromMillis(ms);
}

function chunked(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function ensureAuthUser({ uid, email, password, displayName }) {
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, {
      email,
      password,
      displayName,
      emailVerified: true,
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "auth/user-not-found") {
      await auth.createUser({
        uid,
        email,
        password,
        displayName,
        emailVerified: true,
      });
      return;
    }
    throw error;
  }
}

async function seedUsersAndProfiles(nowMs) {
  await ensureAuthUser(seedUsers.client);
  await ensureAuthUser(seedUsers.staff);

  await auth.setCustomUserClaims(seedUsers.staff.uid, {
    staff: true,
    roles: ["staff"],
  });

  const writes = [
    {
      path: `users/${seedUsers.client.uid}`,
      data: {
        uid: seedUsers.client.uid,
        email: seedUsers.client.email,
        displayName: seedUsers.client.displayName,
        isActive: true,
        role: "member",
        createdAt: ts(nowMs - 9 * 24 * 60 * 60 * 1000),
        updatedAt: ts(nowMs),
      },
    },
    {
      path: `users/${seedUsers.staff.uid}`,
      data: {
        uid: seedUsers.staff.uid,
        email: seedUsers.staff.email,
        displayName: seedUsers.staff.displayName,
        isActive: true,
        role: "staff",
        createdAt: ts(nowMs - 9 * 24 * 60 * 60 * 1000),
        updatedAt: ts(nowMs),
      },
    },
    {
      path: `profiles/${seedUsers.client.uid}`,
      data: {
        displayName: seedUsers.client.displayName,
        uiTheme: "portal",
        uiEnhancedMotion: true,
        updatedAt: ts(nowMs),
      },
    },
    {
      path: `profiles/${seedUsers.staff.uid}`,
      data: {
        displayName: seedUsers.staff.displayName,
        uiTheme: "portal",
        uiEnhancedMotion: true,
        updatedAt: ts(nowMs),
      },
    },
    {
      path: `users/${seedUsers.client.uid}/prefs/notifications`,
      data: {
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
        },
        frequency: {
          mode: "immediate",
          digestHours: 24,
        },
        updatedAt: ts(nowMs),
      },
    },
  ];

  await Promise.all(
    writes.map(async (entry) => {
      await db.doc(entry.path).set(entry.data, { merge: true });
    })
  );
}

async function seedAnnouncements(nowMs) {
  await db.doc("announcements/seed-announcement-001").set(
    {
      title: "Seeded studio update",
      body: "This seeded announcement keeps the studio tab populated during emulator checks.",
      type: "info",
      readBy: [],
      createdAt: ts(nowMs - 2 * 60 * 60 * 1000),
    },
    { merge: true }
  );
}

async function seedMessages(nowMs) {
  const threadId = "seed-thread-client-staff";
  const threadRef = db.doc(`directMessages/${threadId}`);

  const totalMessages = 130;
  const firstSentAt = nowMs - totalMessages * 5 * 60 * 1000;
  const lastMessageId = `seed-msg-${String(totalMessages).padStart(3, "0")}`;

  await threadRef.set(
    {
      subject: "Seed telemetry thread",
      kind: "support",
      participantUids: [seedUsers.client.uid, seedUsers.staff.uid],
      createdAt: ts(firstSentAt),
      updatedAt: ts(nowMs),
      lastMessagePreview: "Seed message 130",
      lastMessageAt: ts(nowMs),
      lastMessageId,
      lastSenderName: seedUsers.staff.displayName,
      lastSenderEmail: seedUsers.staff.email,
      references: [],
      lastReadAtByUid: {
        [seedUsers.client.uid]: ts(nowMs - 10 * 60 * 1000),
        [seedUsers.staff.uid]: ts(nowMs),
      },
    },
    { merge: true }
  );

  const messageWrites = [];
  for (let index = 1; index <= totalMessages; index += 1) {
    const id = `seed-msg-${String(index).padStart(3, "0")}`;
    const sentAtMs = firstSentAt + index * 5 * 60 * 1000;
    const fromStaff = index % 2 === 0;
    const from = fromStaff ? seedUsers.staff : seedUsers.client;
    const to = fromStaff ? seedUsers.client : seedUsers.staff;

    messageWrites.push({
      path: `directMessages/${threadId}/messages/${id}`,
      data: {
        messageId: `<${id}@monsoonfire.local>`,
        subject: "Seed telemetry thread",
        body: `Seed message ${index}`,
        fromUid: from.uid,
        fromName: from.displayName,
        fromEmail: from.email,
        replyToEmail: from.email,
        toUids: [to.uid],
        toEmails: [to.email],
        sentAt: ts(sentAtMs),
        inReplyTo: index > 1 ? `<seed-msg-${String(index - 1).padStart(3, "0")}@monsoonfire.local>` : null,
        references: [],
      },
    });
  }

  for (const batch of chunked(messageWrites, 250)) {
    const writeBatch = db.batch();
    for (const entry of batch) {
      writeBatch.set(db.doc(entry.path), entry.data, { merge: true });
    }
    await writeBatch.commit();
  }
}

async function seedBatchesAndPieces(nowMs) {
  const statuses = ["SUBMITTED", "SHELVED", "LOADED", "FIRED", "READY_FOR_PICKUP"];

  for (let batchIndex = 1; batchIndex <= 10; batchIndex += 1) {
    const batchId = `seed-batch-${String(batchIndex).padStart(2, "0")}`;
    const isClosed = batchIndex > 5;
    const updatedAtMs = nowMs - batchIndex * 4 * 60 * 60 * 1000;
    const closedAtMs = isClosed ? updatedAtMs + 90 * 60 * 1000 : null;

    await db.doc(`batches/${batchId}`).set(
      {
        ownerUid: seedUsers.client.uid,
        ownerDisplayName: seedUsers.client.displayName,
        title: `Seed Check-in ${batchIndex}`,
        status: statuses[batchIndex % statuses.length],
        intakeMode: "SHELF_PURCHASE",
        isClosed,
        createdAt: ts(updatedAtMs - 2 * 60 * 60 * 1000),
        updatedAt: ts(updatedAtMs),
        closedAt: closedAtMs ? ts(closedAtMs) : null,
        currentKilnName: batchIndex % 2 === 0 ? "Cone 6 Electric" : "Cone 10 Gas",
      },
      { merge: true }
    );

    const pieceWrites = [];
    for (let pieceIndex = 1; pieceIndex <= 6; pieceIndex += 1) {
      const pieceId = `seed-piece-${String(pieceIndex).padStart(2, "0")}`;
      const pieceUpdatedAtMs = updatedAtMs + pieceIndex * 60_000;
      pieceWrites.push({
        path: `batches/${batchId}/pieces/${pieceId}`,
        data: {
          pieceCode: `${batchId.toUpperCase()}-P${pieceIndex}`,
          shortDesc: `Seeded piece ${pieceIndex} for batch ${batchIndex}`,
          ownerName: seedUsers.client.displayName,
          stage: isClosed ? "FINISHED" : pieceIndex % 2 === 0 ? "BISQUE" : "GREENWARE",
          wareCategory: pieceIndex % 3 === 0 ? "PORCELAIN" : "STONEWARE",
          isArchived: false,
          createdAt: ts(pieceUpdatedAtMs - 20 * 60_000),
          updatedAt: ts(pieceUpdatedAtMs),
          selectedGlazes:
            pieceIndex % 2 === 0
              ? [
                  {
                    baseGlazeId: "seed-base-01",
                    topGlazeId: "seed-top-01",
                    comboId: 1,
                  },
                ]
              : [],
        },
      });
    }

    for (const entry of pieceWrites) {
      await db.doc(entry.path).set(entry.data, { merge: true });
    }

    await db.doc(`batches/${batchId}/timeline/seed-event-001`).set(
      {
        type: "SEEDED",
        actorName: "Seed Script",
        kilnName: "Studio",
        notes: "Seeded for emulator telemetry",
        at: ts(updatedAtMs),
      },
      { merge: true }
    );
  }
}

async function seedGlazeBoard(nowMs) {
  const glazeWrites = [];
  for (let index = 1; index <= 24; index += 1) {
    glazeWrites.push(
      db.doc(`glazes/seed-glaze-${String(index).padStart(2, "0")}`).set(
        {
          glazyUrl: `https://glazy.org/materials/${1000 + index}`,
          defaultTags: index % 2 === 0 ? ["stable", "cone6"] : ["experimental"],
          updatedAt: ts(nowMs - index * 10 * 60_000),
          updatedBy: "Seed Script",
        },
        { merge: true }
      )
    );
  }

  const comboWrites = [];
  for (let comboId = 1; comboId <= 40; comboId += 1) {
    comboWrites.push(
      db.doc(`comboTiles/${comboId}`).set(
        {
          comboId,
          notes: `Seed combo tile ${comboId}`,
          coneNotes: comboId % 3 === 0 ? "Witness cone available" : null,
          flags: comboId % 5 === 0 ? ["needs_retest"] : [],
          photos: [],
          updatedAt: ts(nowMs - comboId * 5 * 60_000),
          updatedBy: "Seed Script",
        },
        { merge: true }
      )
    );
  }

  const singleWrites = [];
  for (let index = 1; index <= 24; index += 1) {
    singleWrites.push(
      db.doc(`singleTiles/seed-single-${String(index).padStart(2, "0")}`).set(
        {
          glazeId: `seed-glaze-${String(index).padStart(2, "0")}`,
          notes: `Seed single tile ${index}`,
          flags: index % 4 === 0 ? ["stable"] : [],
          photos: [],
          updatedAt: ts(nowMs - index * 3 * 60_000),
          updatedBy: "Seed Script",
        },
        { merge: true }
      )
    );
  }

  await Promise.all([...glazeWrites, ...comboWrites, ...singleWrites]);
}

async function main() {
  const nowMs = Date.now();

  console.log(`[seed] Project: ${PROJECT_ID}`);
  console.log(`[seed] Firestore emulator: ${FIRESTORE_HOST}`);
  console.log(`[seed] Auth emulator: ${AUTH_HOST}`);

  await seedUsersAndProfiles(nowMs);
  await seedAnnouncements(nowMs);
  await seedMessages(nowMs);
  await seedBatchesAndPieces(nowMs);
  await seedGlazeBoard(nowMs);

  console.log("[seed] Complete.");
  console.log("[seed] Client login:", seedUsers.client.email, seedUsers.client.password);
  console.log("[seed] Staff login:", seedUsers.staff.email, seedUsers.staff.password);
}

await main();
