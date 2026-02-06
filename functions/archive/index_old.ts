import * as admin from "firebase-admin";
import {onRequest} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {setGlobalOptions} from "firebase-functions/v2";

setGlobalOptions({region: "us-central1"});

admin.initializeApp();

const adminToken = defineSecret("ADMIN_TOKEN");

export const hello = onRequest((_req, res) => {
  res.status(200).send("ok");
});
export const assignFiring = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    const body = req.body ?? {};
    const batchId = String(body.batchId || "").trim();
    const firingId = String(body.firingId || "").trim();

    if (!batchId || !firingId) {
      res.status(400).json({ok: false, message: "Missing batchId or firingId"});
      return;
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const batchRef = db.collection("batches").doc(batchId);
    const timelineRef = batchRef.collection("timeline").doc();
    const firingRef = db.collection("firings").doc(firingId);

    await db.runTransaction(async (tx) => {
      const batchSnap = await tx.get(batchRef);
      if (!batchSnap.exists) {
        throw new Error("Batch not found");
      }

      const firingSnap = await tx.get(firingRef);
      if (!firingSnap.exists) {
        throw new Error("Firing not found");
      }

      const firing = firingSnap.data() || {};
      const firingTitle = String(firing.title || firing.summary || firingId);
      const kilnName = firing.kilnName ? String(firing.kilnName) : null;

      tx.update(batchRef, {
        currentFiringId: firingId,
        state: "ASSIGNED_TO_FIRING",
        updatedAt: now,
      });

      tx.set(timelineRef, {
        at: now,
        type: "FIRING_ASSIGNED",
        performedByUid: null,
        performedByName: "Monsoon Fire Staff",
        performedByRole: "staff",
        visibility: "CLIENT",
        message: `Assigned to firing: ${firingTitle}`,
        stateAfter: "ASSIGNED_TO_FIRING",
        firingId,
        kilnId: null,
        kilnName,
        notesClient: null,
        notesStaff: null,
        media: [],
      });
    });

    res.status(200).json({ok: true});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
});

export const kilnLoad = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    const body = req.body ?? {};
    const batchId = String(body.batchId || "").trim();
    const firingId = String(body.firingId || "").trim();
    const kilnName = String(body.kilnName || "").trim(); // e.g. "Electric #1"
    const performedByName = String(body.performedByName || "Monsoon Fire Staff").trim();

    const notesClient = body.notesClient ? String(body.notesClient) : null;
    const notesStaff = body.notesStaff ? String(body.notesStaff) : null;

    if (!batchId || !firingId || !kilnName) {
      res.status(400).json({ok: false, message: "Missing batchId, firingId, or kilnName"});
      return;
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const batchRef = db.collection("batches").doc(batchId);
    const timelineRef = batchRef.collection("timeline").doc();
    const firingRef = db.collection("firings").doc(firingId);

    await db.runTransaction(async (tx) => {
      const batchSnap = await tx.get(batchRef);
      if (!batchSnap.exists) throw new Error("Batch not found");

      const batch = batchSnap.data() || {};
      const currentFiringId = String(batch.currentFiringId || "");
      if (currentFiringId && currentFiringId !== firingId) {
        throw new Error(`Batch currentFiringId is ${currentFiringId}, not ${firingId}`);
      }

      const firingSnap = await tx.get(firingRef);
      if (!firingSnap.exists) throw new Error("Firing not found");

      tx.update(batchRef, {
        currentFiringId: firingId,
        currentKilnName: kilnName,
        state: "LOADED",
        location: "KILN_ROOM",
        updatedAt: now,
      });

      tx.set(timelineRef, {
        at: now,
        type: "KILN_LOAD",
        performedByUid: null,
        performedByName,
        performedByRole: "staff",
        visibility: "CLIENT", // loader identity + load event visible
        message: `Loaded into ${kilnName}`,
        stateAfter: "LOADED",
        firingId,
        kilnId: null,
        kilnName,
        notesClient,
        notesStaff,
        media: [], // photos later
      });
    });

    res.status(200).json({ok: true});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
});

export const kilnUnload = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    const body = req.body ?? {};
    const batchId = String(body.batchId || "").trim();
    const firingId = String(body.firingId || "").trim();
    const kilnName = String(body.kilnName || "").trim();
    const performedByName = String(body.performedByName || "Monsoon Fire Staff").trim();

    const notesClient = body.notesClient ? String(body.notesClient) : null;
    const notesStaff = body.notesStaff ? String(body.notesStaff) : null;

    if (!batchId || !firingId || !kilnName) {
      res.status(400).json({ok: false, message: "Missing batchId, firingId, or kilnName"});
      return;
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const batchRef = db.collection("batches").doc(batchId);
    const timelineRef = batchRef.collection("timeline").doc();
    const firingRef = db.collection("firings").doc(firingId);

    await db.runTransaction(async (tx) => {
      const batchSnap = await tx.get(batchRef);
      if (!batchSnap.exists) throw new Error("Batch not found");

      const batch = batchSnap.data() || {};
      const currentFiringId = String(batch.currentFiringId || "");
      if (currentFiringId && currentFiringId !== firingId) {
        throw new Error(`Batch currentFiringId is ${currentFiringId}, not ${firingId}`);
      }

      const firingSnap = await tx.get(firingRef);
      if (!firingSnap.exists) throw new Error("Firing not found");

      tx.update(batchRef, {
        currentFiringId: firingId,
        currentKilnName: kilnName,
        state: "UNLOADED",
        location: "KILN_ROOM",
        updatedAt: now,
      });

      tx.set(timelineRef, {
        at: now,
        type: "KILN_UNLOAD",
        performedByUid: null,
        performedByName,
        performedByRole: "staff",
        visibility: "CLIENT",
        message: `Unloaded from ${kilnName}`,
        stateAfter: "UNLOADED",
        firingId,
        kilnId: null,
        kilnName,
        notesClient,
        notesStaff,
        media: [], // photos later
      });
    });

    res.status(200).json({ok: true});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
});

export const shelveBatch = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    const body = req.body ?? {};
    const batchId = String(body.batchId || "").trim();
    const shelfLabel = String(body.shelfLabel || "").trim(); // e.g. "Shelf A3"
    const performedByName = String(body.performedByName || "Monsoon Fire Staff").trim();

    const notesClient = body.notesClient ? String(body.notesClient) : null;
    const notesStaff = body.notesStaff ? String(body.notesStaff) : null;

    if (!batchId || !shelfLabel) {
      res.status(400).json({ok: false, message: "Missing batchId or shelfLabel"});
      return;
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const batchRef = db.collection("batches").doc(batchId);
    const timelineRef = batchRef.collection("timeline").doc();

    await db.runTransaction(async (tx) => {
      const batchSnap = await tx.get(batchRef);
      if (!batchSnap.exists) throw new Error("Batch not found");

      tx.update(batchRef, {
        state: "SHELVED",
        location: "SHELF",
        shelfLabel,
        updatedAt: now,
      });

      tx.set(timelineRef, {
        at: now,
        type: "SHELVED",
        performedByUid: null,
        performedByName,
        performedByRole: "staff",
        visibility: "CLIENT",
        message: `Shelved at ${shelfLabel}`,
        stateAfter: "SHELVED",
        firingId: null,
        kilnId: null,
        kilnName: null,
        notesClient,
        notesStaff,
        media: [],
      });
    });

    res.status(200).json({ok: true});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
});

export const readyForPickup = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    const body = req.body ?? {};
    const batchId = String(body.batchId || "").trim();
    const performedByName = String(body.performedByName || "Monsoon Fire Staff").trim();
    const notesClient = body.notesClient ? String(body.notesClient) : "Ready for pickup.";
    const notesStaff = body.notesStaff ? String(body.notesStaff) : null;

    if (!batchId) {
      res.status(400).json({ok: false, message: "Missing batchId"});
      return;
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const batchRef = db.collection("batches").doc(batchId);
    const timelineRef = batchRef.collection("timeline").doc();

    await db.runTransaction(async (tx) => {
      const batchSnap = await tx.get(batchRef);
      if (!batchSnap.exists) throw new Error("Batch not found");

      tx.update(batchRef, {
        state: "READY_FOR_PICKUP",
        location: "PICKUP",
        updatedAt: now,
      });

      tx.set(timelineRef, {
        at: now,
        type: "READY_FOR_PICKUP",
        performedByUid: null,
        performedByName,
        performedByRole: "staff",
        visibility: "CLIENT",
        message: "Ready for pickup",
        stateAfter: "READY_FOR_PICKUP",
        firingId: null,
        kilnId: null,
        kilnName: null,
        notesClient,
        notesStaff,
        media: [],
      });
    });

    res.status(200).json({ok: true});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
});

export const pickedUpAndClose = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    const body = req.body ?? {};
    const batchId = String(body.batchId || "").trim();
    const performedByName = String(body.performedByName || "Monsoon Fire Staff").trim();
    const pickedUpByName = body.pickedUpByName ? String(body.pickedUpByName) : null;

    const notesClient = body.notesClient ? String(body.notesClient) : "Picked up. Thank you!";
    const notesStaff = body.notesStaff ? String(body.notesStaff) : null;

    if (!batchId) {
      res.status(400).json({ok: false, message: "Missing batchId"});
      return;
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const batchRef = db.collection("batches").doc(batchId);
    const timelinePickedUpRef = batchRef.collection("timeline").doc();
    const timelineClosedRef = batchRef.collection("timeline").doc();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(batchRef);
      if (!snap.exists) throw new Error("Batch not found");

      const batch = snap.data() || {};
      const prevState = String(batch.state || "");

      // Update snapshot to CLOSED
      tx.update(batchRef, {
        state: "CLOSED",
        location: "OUT",
        closedAt: now,
        closedByName: performedByName,
        closeReason: "PICKED_UP",
        pickedUpByName,
        updatedAt: now,
      });

      // Timeline: PICKED_UP
      tx.set(timelinePickedUpRef, {
        at: now,
        type: "PICKED_UP",
        performedByUid: null,
        performedByName,
        performedByRole: "staff",
        visibility: "CLIENT",
        message: pickedUpByName ? `Picked up by ${pickedUpByName}` : "Picked up",
        stateAfter: "PICKED_UP",
        firingId: null,
        kilnId: null,
        kilnName: null,
        notesClient,
        notesStaff,
        media: [],
        meta: {prevState},
      });

      // Timeline: CLOSED (explicit archive marker)
      tx.set(timelineClosedRef, {
        at: now,
        type: "CLOSED",
        performedByUid: null,
        performedByName,
        performedByRole: "staff",
        visibility: "CLIENT",
        message: "Batch closed",
        stateAfter: "CLOSED",
        firingId: null,
        kilnId: null,
        kilnName: null,
        notesClient: null,
        notesStaff: null,
        media: [],
        meta: {reason: "PICKED_UP"},
      });
    });

    res.status(200).json({ok: true});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
});

export const continueJourney = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    const body = req.body ?? {};
    const fromBatchId = String(body.fromBatchId || "").trim();
    const performedByName = String(body.performedByName || "Monsoon Fire Staff").trim();

    // Optional prefills for the new draft
    const title = body.title ? String(body.title).trim() : null;
    const nextStage = body.nextStage ? String(body.nextStage).trim() : null; // e.g. "GLAZE"
    const ownerUid = body.ownerUid ? String(body.ownerUid).trim() : null;
    const ownerDisplayName = body.ownerDisplayName ? String(body.ownerDisplayName).trim() : null;

    if (!fromBatchId) {
      res.status(400).json({ok: false, message: "Missing fromBatchId"});
      return;
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const fromRef = db.collection("batches").doc(fromBatchId);
    const newRef = db.collection("batches").doc();
    const newTimelineRef = newRef.collection("timeline").doc();

    await db.runTransaction(async (tx) => {
      const fromSnap = await tx.get(fromRef);
      if (!fromSnap.exists) throw new Error("Source batch not found");

      const from = fromSnap.data() || {};
      const fromOwnerUid = String(from.ownerUid || "");
      const fromOwnerDisplayName = String(from.ownerDisplayName || "");
      const fromState = String(from.state || "");

      // v1 rule: you can continue from any batch, but it’s most sane from CLOSED
      // We won’t hard block; we’ll store it for auditing.
      const journeyRootBatchId = String(from.journeyRootBatchId || fromBatchId);

      const finalOwnerUid = ownerUid || fromOwnerUid;
      const finalOwnerDisplayName = ownerDisplayName || fromOwnerDisplayName;

      if (!finalOwnerUid || !finalOwnerDisplayName) {
        throw new Error("Owner info missing on source batch (ownerUid/ownerDisplayName)");
      }

      const derivedTitle =
        title ||
        (nextStage
          ? `${from.title || "Batch"} → ${nextStage}`
          : `${from.title || "Batch"} → Continued`);

      tx.set(newRef, {
        ownerUid: finalOwnerUid,
        ownerDisplayName: finalOwnerDisplayName,
        title: derivedTitle,
        intakeMode: "CLIENT_SUBMIT",

        // Draft mode
        state: "DRAFT",
        location: "CLIENT",

        // Journey linkage
        continuedFromBatchId: fromBatchId,
        journeyRootBatchId,

        // Optional “intent” hint for UI
        nextStage: nextStage || null,

        estimate: null,
        actual: null,

        createdAt: now,
        updatedAt: now,

        meta: {
          continuedFromState: fromState,
        },
      });

      tx.set(newTimelineRef, {
        at: now,
        type: "DRAFT_CREATED",
        performedByUid: null,
        performedByName,
        performedByRole: "staff",
        visibility: "CLIENT",
        message: "Draft created (continue journey).",
        stateAfter: "DRAFT",
        firingId: null,
        kilnId: null,
        kilnName: null,
        notesClient: null,
        notesStaff: null,
        media: [],
        meta: {
          continuedFromBatchId: fromBatchId,
          journeyRootBatchId,
        },
      });
    });

    res.status(200).json({ok: true, newBatchId: newRef.id});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
});

export const createBatch = onRequest({secrets: [adminToken]}, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ok: false, message: "Use POST"});
      return;
    }

    // Simple shared-secret auth (temporary for v1/dev)
    const token = String(req.headers["x-admin-token"] || "");
    if (!token || token !== adminToken.value()) {
      res.status(401).json({ok: false, message: "Unauthorized"});
      return;
    }

    // Minimal v1 input
    const body = req.body ?? {};
    const ownerUid = String(body.ownerUid || "").trim();
    const ownerDisplayName = String(body.ownerDisplayName || "").trim();
    const title = String(body.title || "").trim();
    const intakeMode = String(body.intakeMode || "STAFF_HANDOFF").trim(); // STAFF_HANDOFF|CLIENT_SUBMIT
    const estimatedCostCentsRaw = body.estimatedCostCents;
    const estimateNotes = body.estimateNotes ? String(body.estimateNotes) : null;

    if (!ownerUid || !ownerDisplayName || !title) {
      res.status(400).json({
        ok: false,
        message: "Missing required fields: ownerUid, ownerDisplayName, title",
      });
      return;
    }

    const estimatedCostCents =
      Number.isFinite(Number(estimatedCostCentsRaw)) ? Number(estimatedCostCentsRaw) : null;

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const batchRef = db.collection("batches").doc();
    const timelineRef = batchRef.collection("timeline").doc();

    await db.runTransaction(async (tx) => {
      tx.set(batchRef, {
        ownerUid,
        ownerDisplayName,
        title,
        intakeMode,
        state: "RECEIVED",
        location: "INTAKE",
        estimate: {
          estimatedCostCents,
          notes: estimateNotes,
        },
        actual: null,
        createdAt: now,
        updatedAt: now,
      });

      tx.set(timelineRef, {
        at: now,
        type: "INTAKE_ACCEPTED",
        performedByUid: null,
        performedByName: "Monsoon Fire Staff",
        performedByRole: "staff",
        visibility: "CLIENT",
        message: "Batch checked in at intake.",
        stateAfter: "RECEIVED",
        firingId: null,
        kilnId: null,
        kilnName: null,
        notesClient: null,
        notesStaff: null,
        media: [],
      });
    });

    res.status(200).json({ok: true, batchId: batchRef.id});
  } catch (e: any) {
    res.status(500).json({ok: false, message: e?.message ?? String(e)});
  }
  
});
