/* eslint-disable no-console */
const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_EMULATOR_HOST = "127.0.0.1:8080";

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.split("=").slice(1).join("=") : null;
};

const ownerUid = getArg("--ownerUid") || process.env.OWNER_UID;
if (!ownerUid) {
  console.error("Missing owner UID. Run with --ownerUid=YOUR_UID or set OWNER_UID.");
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_EMULATOR_HOST;

admin.initializeApp({ projectId });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const now = Timestamp.now();

function daysAgo(days) {
  return Timestamp.fromDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function toTokens(text) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean)
    )
  ).slice(0, 24);
}

async function createBatch({ title, isClosed, status, updatedAt, closedAt, estimatedCostCents, priceCents }) {
  const ref = db.collection("batches").doc();
  const payload = {
    title,
    ownerUid,
    status,
    isClosed,
    updatedAt,
    createdAt: updatedAt,
    estimatedCostCents,
    priceCents,
  };
  if (closedAt) payload.closedAt = closedAt;

  await ref.set(payload);
  return ref;
}

async function addTimelineEvent(batchRef, { type, notes, actorName }) {
  await batchRef.collection("timeline").add({
    type,
    notes,
    actorName,
    at: now,
  });
}

async function addPiece(batchRef, { pieceCode, shortDesc, ownerName, stage, isArchived }) {
  const pieceRef = batchRef.collection("pieces").doc();
  await pieceRef.set({
    pieceCode,
    shortDesc,
    ownerName,
    stage,
    isArchived,
    createdAt: now,
    updatedAt: now,
  });
  return pieceRef;
}

async function addAudit(pieceRef, event) {
  await pieceRef.collection("audit").add(event);
}

async function addNote(pieceRef, stream, { text, authorName, authorUid }) {
  const ref = await pieceRef.collection(stream === "client" ? "clientNotes" : "studioNotes").add({
    text,
    at: now,
    updatedAt: null,
    authorUid,
    authorName,
    searchTokens: toTokens(text),
  });
  return ref;
}

async function addMedia(pieceRef, { stage, storagePath, caption, uploadedByName, uploadedByUid }) {
  await pieceRef.collection("media").add({
    stage,
    storagePath,
    caption,
    at: now,
    uploadedByName,
    uploadedByUid,
    searchTokens: caption ? toTokens(caption) : [],
  });
}

async function seed() {
  console.log("Seeding emulator with owner UID:", ownerUid);

  const batchActive = await createBatch({
    title: "Test batch (active)",
    isClosed: false,
    status: "In progress",
    updatedAt: now,
    estimatedCostCents: 2400,
    priceCents: null,
  });

  const batchClosed = await createBatch({
    title: "Test batch (closed)",
    isClosed: true,
    status: "Complete",
    updatedAt: daysAgo(2),
    closedAt: daysAgo(2),
    estimatedCostCents: 3200,
    priceCents: 3500,
  });

  await addTimelineEvent(batchActive, {
    type: "CREATED",
    notes: "Batch opened",
    actorName: "Studio",
  });

  const pieceActive = await addPiece(batchActive, {
    pieceCode: "A-001",
    shortDesc: "Speckled mug",
    ownerName: "Test Client",
    stage: "GREENWARE",
    isArchived: false,
  });

  const pieceArchived = await addPiece(batchActive, {
    pieceCode: "A-002",
    shortDesc: "Tall vase",
    ownerName: "Test Client",
    stage: "GLAZED",
    isArchived: true,
  });

  const pieceClosed = await addPiece(batchClosed, {
    pieceCode: "B-101",
    shortDesc: "Serving bowl",
    ownerName: "Test Client",
    stage: "FINISHED",
    isArchived: false,
  });

  await addAudit(pieceActive, {
    type: "CREATED",
    at: now,
    actorUid: ownerUid,
    actorName: "Member",
    notes: "Piece created",
  });

  const clientNote = await addNote(pieceActive, "client", {
    text: "Please keep the glaze matte.",
    authorName: "Member",
    authorUid: ownerUid,
  });

  await addAudit(pieceActive, {
    type: "NOTE_ADDED",
    at: now,
    actorUid: ownerUid,
    actorName: "Member",
    noteStream: "client",
    noteId: clientNote.id,
    notes: "Please keep the glaze matte.",
  });

  await addNote(pieceArchived, "client", {
    text: "Archived test note",
    authorName: "Member",
    authorUid: ownerUid,
  });

  await addAudit(pieceArchived, {
    type: "ARCHIVED",
    at: now,
    actorUid: ownerUid,
    actorName: "Member",
    notes: "Archived piece",
  });

  await addAudit(pieceClosed, {
    type: "CREATED",
    at: now,
    actorUid: ownerUid,
    actorName: "Member",
    notes: "Piece created",
  });

  await addMedia(pieceClosed, {
    stage: "FINISHED",
    storagePath: "pieces/B-101/final.jpg",
    caption: "Finished bowl",
    uploadedByName: "Studio",
    uploadedByUid: "studio-seed",
  });

  console.log("Seeded batches:", batchActive.id, batchClosed.id);
  console.log("Seeded pieces:", pieceActive.id, pieceArchived.id, pieceClosed.id);
}

seed()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
