import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from "firebase/firestore";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const [host, portText] = EMULATOR_HOST.split(":");
const port = Number(portText || "8085");
const projectId = `rules-mypieces-${Date.now()}`;
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const OWNER_UID = "owner-user";
const EDITOR_UID = "editor-user";
const OUTSIDER_UID = "outsider-user";
const STAFF_UID = "staff-user";

const OWNER_BATCH_ID = "batch-owner";
const OTHER_BATCH_ID = "batch-other";

let testEnv;

function authedDb(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).firestore();
}

async function seedMyPiecesData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const baseCreatedAt = Date.parse("2026-02-26T01:00:00.000Z");

    await setDoc(doc(db, "batches", OWNER_BATCH_ID), {
      ownerUid: OWNER_UID,
      title: "Owner batch",
      editors: [EDITOR_UID],
      isClosed: false,
      updatedAt: new Date(baseCreatedAt),
    });

    await setDoc(doc(db, "batches", OTHER_BATCH_ID), {
      ownerUid: "other-owner",
      title: "Other batch",
      isClosed: false,
      updatedAt: new Date(baseCreatedAt),
    });

    for (let index = 1; index <= 12; index += 1) {
      const id = `piece-${String(index).padStart(2, "0")}`;
      await setDoc(doc(db, "batches", OWNER_BATCH_ID, "pieces", id), {
        pieceCode: `QA-${String(index).padStart(2, "0")}`,
        shortDesc: `Seeded piece ${index}`,
        ownerName: "Maker",
        stage: "GREENWARE",
        wareCategory: "STONEWARE",
        isArchived: false,
        createdAt: new Date(baseCreatedAt - index * 60_000),
        updatedAt: new Date(baseCreatedAt + index * 60_000),
      });
    }

    await setDoc(doc(db, "batches", OTHER_BATCH_ID, "pieces", "piece-foreign-1"), {
      pieceCode: "FOREIGN-1",
      shortDesc: "Other owner piece",
      ownerName: "Other Maker",
      stage: "BISQUE",
      wareCategory: "STONEWARE",
      isArchived: false,
      createdAt: new Date(baseCreatedAt),
      updatedAt: new Date(baseCreatedAt + 10_000),
    });

    await setDoc(doc(db, "batches", OWNER_BATCH_ID, "pieces", "piece-01", "clientNotes", "client-note-1"), {
      text: "client note",
      at: new Date(baseCreatedAt + 2_000),
      authorUid: OWNER_UID,
      authorName: "Maker",
      searchTokens: ["client", "note"],
    });

    await setDoc(doc(db, "batches", OWNER_BATCH_ID, "pieces", "piece-01", "studioNotes", "studio-note-1"), {
      text: "studio note",
      at: new Date(baseCreatedAt + 4_000),
      authorUid: STAFF_UID,
      authorName: "Staff",
      searchTokens: ["studio", "note"],
    });

    await setDoc(doc(db, "batches", OWNER_BATCH_ID, "pieces", "piece-01", "audit", "audit-1"), {
      type: "NOTE_ADDED",
      at: new Date(baseCreatedAt + 6_000),
      actorUid: OWNER_UID,
      actorName: "Maker",
      notes: "audit note",
      noteStream: "client",
      noteId: "client-note-1",
    });

    await setDoc(doc(db, "batches", OWNER_BATCH_ID, "pieces", "piece-01", "media", "media-1"), {
      url: "https://example.com/piece-01.jpg",
      type: "image/jpeg",
      title: "Piece photo",
      notes: "",
      at: new Date(baseCreatedAt + 8_000),
      createdAt: new Date(baseCreatedAt + 8_000),
      updatedAt: new Date(baseCreatedAt + 8_500),
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
  await seedMyPiecesData();
});

after(async () => {
  await testEnv.cleanup();
});

describe("My Pieces rules", () => {
  it("allows owner to list pieces with the same ordered query shape as My Pieces", async () => {
    const db = authedDb(OWNER_UID);
    const piecesQuery = query(
      collection(db, "batches", OWNER_BATCH_ID, "pieces"),
      orderBy("updatedAt", "desc"),
      limit(50)
    );
    const snap = await assertSucceeds(getDocs(piecesQuery));
    assert.equal(snap.size, 12);
    assert.equal(snap.docs[0]?.id, "piece-12");
    assert.equal(snap.docs[snap.docs.length - 1]?.id, "piece-01");
  });

  it("allows batch editors to list pieces", async () => {
    const db = authedDb(EDITOR_UID);
    const piecesQuery = query(
      collection(db, "batches", OWNER_BATCH_ID, "pieces"),
      orderBy("updatedAt", "desc"),
      limit(50)
    );
    const snap = await assertSucceeds(getDocs(piecesQuery));
    assert.equal(snap.size, 12);
  });

  it("denies outsiders from reading another user's pieces", async () => {
    const db = authedDb(OUTSIDER_UID);
    const piecesQuery = query(
      collection(db, "batches", OWNER_BATCH_ID, "pieces"),
      orderBy("updatedAt", "desc"),
      limit(50)
    );
    await assertFails(getDocs(piecesQuery));
  });

  it("allows staff to read pieces across batches", async () => {
    const db = authedDb(STAFF_UID, { staff: true, roles: ["staff"] });
    await assertSucceeds(getDoc(doc(db, "batches", OTHER_BATCH_ID, "pieces", "piece-foreign-1")));
  });

  it("allows owner to read piece detail subcollections", async () => {
    const db = authedDb(OWNER_UID);
    const prefix = ["batches", OWNER_BATCH_ID, "pieces", "piece-01"];
    const [clientNotes, studioNotes, auditEvents, mediaItems] = await Promise.all([
      assertSucceeds(
        getDocs(query(collection(db, ...prefix, "clientNotes"), orderBy("at", "desc"), limit(40)))
      ),
      assertSucceeds(
        getDocs(query(collection(db, ...prefix, "studioNotes"), orderBy("at", "desc"), limit(40)))
      ),
      assertSucceeds(getDocs(query(collection(db, ...prefix, "audit"), orderBy("at", "desc"), limit(60)))),
      assertSucceeds(getDocs(query(collection(db, ...prefix, "media"), orderBy("at", "desc"), limit(30)))),
    ]);

    assert.equal(clientNotes.size, 1);
    assert.equal(studioNotes.size, 1);
    assert.equal(auditEvents.size, 1);
    assert.equal(mediaItems.size, 1);
  });
});
