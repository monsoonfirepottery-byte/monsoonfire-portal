#!/usr/bin/env node

/* eslint-disable no-console */

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  buildAnnouncementArtifacts,
  defaultAnnouncementSourceDir,
  marketingSourceSystem,
  writeAnnouncementArtifacts,
} from "../../scripts/lib/marketing-announcements.mjs";

const DEFAULT_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "monsoonfire-portal";
const MAX_BATCH_SIZE = 400;

function parseArgs(argv) {
  const options = {
    apply: false,
    json: false,
    projectId: DEFAULT_PROJECT_ID,
    sourceDir: defaultAnnouncementSourceDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--project") {
      options.projectId = String(next).trim() || options.projectId;
      index += 1;
      continue;
    }
    if (arg === "--source-dir") {
      options.sourceDir = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function toTimestamp(value) {
  return value ? Timestamp.fromDate(new Date(value)) : null;
}

function normalizeReadBy(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
}

async function commitOperations(db, operations) {
  for (let index = 0; index < operations.length; index += MAX_BATCH_SIZE) {
    const batch = db.batch();
    const slice = operations.slice(index, index + MAX_BATCH_SIZE);
    for (const operation of slice) {
      if (operation.kind === "delete") {
        batch.delete(operation.ref);
      } else {
        batch.set(operation.ref, operation.payload);
      }
    }
    await batch.commit();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifacts = await buildAnnouncementArtifacts({
    sourceDir: options.sourceDir,
  });
  const outputs = await writeAnnouncementArtifacts(artifacts);

  if (!options.apply) {
    const result = {
      status: "ok",
      mode: "dry-run",
      writeAttempts: 0,
      summary: artifacts.buildSummary,
      outputs,
      portalItems: artifacts.portalPayload.items.map((item) => ({
        docId: item.docId,
        sourceId: item.sourceId,
        title: item.title,
        pinned: item.pinned,
      })),
    };

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write("Marketing announcement sync dry-run complete.\n");
      process.stdout.write(`- portal rows: ${artifacts.portalPayload.items.length}\n`);
      process.stdout.write(`- payload: ${outputs.portalPayloadPathRelative}\n`);
    }
    return;
  }

  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          projectId: options.projectId,
        });
  const db = getFirestore(app);
  const collectionRef = db.collection("announcements");
  const managedSnap = await collectionRef.where("sourceSystem", "==", marketingSourceSystem).get();
  const existingManaged = new Map(managedSnap.docs.map((docSnap) => [docSnap.id, docSnap]));
  const nextDocIds = new Set(artifacts.portalPayload.items.map((item) => item.docId));
  const operations = [];

  for (const item of artifacts.portalPayload.items) {
    const ref = collectionRef.doc(item.docId);
    const existing = existingManaged.get(item.docId);
    const payload = {
      title: item.title,
      summary: item.summary,
      body: item.body,
      type: item.type,
      category: item.category,
      pinned: item.pinned,
      ctaLabel: item.ctaLabel ?? null,
      ctaUrl: item.ctaUrl ?? null,
      readBy: normalizeReadBy(existing?.get("readBy")),
      createdAt: existing?.get("createdAt") ?? toTimestamp(item.createdAt),
      publishAt: toTimestamp(item.publishAt),
      expiresAt: toTimestamp(item.expiresAt),
      updatedAt: Timestamp.now(),
      archived: false,
      homepageTeaser: item.homepageTeaser === true,
      sourceId: item.sourceId,
      sourceSystem: item.sourceSystem,
      assetRefs: item.assetRefs.map((asset) => ({
        repoPath: asset.repoPath,
        sitePath: asset.sitePath ?? null,
        dropboxSource: asset.dropboxSource ?? null,
        alt: asset.alt ?? null,
      })),
    };

    operations.push({
      kind: "set",
      ref,
      payload,
      docId: item.docId,
      title: item.title,
    });
  }

  for (const [docId, docSnap] of existingManaged.entries()) {
    if (nextDocIds.has(docId)) continue;
    operations.push({
      kind: "delete",
      ref: collectionRef.doc(docId),
      docId,
      title: String(docSnap.get("title") || docId),
    });
  }

  await commitOperations(db, operations);

  const result = {
    status: "ok",
    mode: "apply",
    writeAttempts: operations.length,
    upserts: operations.filter((operation) => operation.kind === "set").length,
    deletes: operations.filter((operation) => operation.kind === "delete").length,
    summary: artifacts.buildSummary,
    outputs,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write("Marketing announcement sync applied.\n");
    process.stdout.write(`- upserts: ${result.upserts}\n`);
    process.stdout.write(`- deletes: ${result.deletes}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync-marketing-announcements failed: ${message}`);
  process.exit(1);
});
