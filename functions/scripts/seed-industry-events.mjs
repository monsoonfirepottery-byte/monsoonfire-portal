#!/usr/bin/env node

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

function parseArgs(argv) {
  const out = {
    projectId: process.env.FIREBASE_PROJECT_ID || "monsoonfire-portal",
    dryRun: false,
    publish: false,
    overwrite: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--publish") out.publish = true;
    else if (arg === "--overwrite") out.overwrite = true;
    else if (arg === "--json") out.json = true;
    else if ((arg === "--project" || arg === "-p") && argv[index + 1]) {
      out.projectId = String(argv[index + 1]).trim() || out.projectId;
      index += 1;
    }
  }

  return out;
}

function tsFromIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Timestamp.fromDate(parsed);
}

function buildSeedRows({ publish }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const status = publish ? "published" : "draft";
  const prefix = publish ? "" : "[Verification draft] ";

  return [
    {
      id: "industry-nceca-marquee",
      title: `${prefix}NCECA Annual Conference`,
      summary: "Major US ceramics gathering with talks, exhibitions, and community programming.",
      description:
        "Seeded as a marquee industry event lane. Verify final schedule and registration details before long-term publishing.",
      mode: "hybrid",
      status,
      startAt: "2026-03-26T15:00:00.000Z",
      endAt: "2026-03-29T01:00:00.000Z",
      timezone: "America/Chicago",
      location: "Convention host city (varies by year)",
      city: "Annual host city",
      region: "US",
      country: "US",
      remoteUrl: "https://nceca.net",
      registrationUrl: "https://nceca.net",
      sourceName: "NCECA",
      sourceUrl: "https://nceca.net",
      featured: true,
      tags: ["conference", "national", "marquee"],
      verifiedAt: nowIso,
    },
    {
      id: "industry-ceramic-school-congress",
      title: `${prefix}Ceramics Congress (The Ceramic School)`,
      summary: "Remote-first talks and demonstrations from ceramic artists and educators worldwide.",
      description:
        "Good remote access option for members who want national exposure without travel. Verify session calendar and access windows.",
      mode: "remote",
      status,
      startAt: "2026-05-14T14:00:00.000Z",
      endAt: "2026-05-17T01:00:00.000Z",
      timezone: "UTC",
      location: "Online",
      city: "",
      region: "",
      country: "US",
      remoteUrl: "https://ceramic.school/congress",
      registrationUrl: "https://ceramic.school/congress",
      sourceName: "The Ceramic School",
      sourceUrl: "https://ceramic.school",
      featured: true,
      tags: ["remote", "talks", "community"],
      verifiedAt: nowIso,
    },
    {
      id: "industry-american-craft-council-programming",
      title: `${prefix}American Craft Council - Clay/Craft Programming`,
      summary: "Cross-discipline craft events relevant to studio business, audience growth, and sales.",
      description:
        "Seeded for broader industry learning. Staff should verify current clay-forward sessions before promoting prominently.",
      mode: "hybrid",
      status,
      startAt: "2026-06-10T16:00:00.000Z",
      endAt: "2026-06-12T23:00:00.000Z",
      timezone: "America/Chicago",
      location: "ACC host venues + online programming",
      city: "Varies",
      region: "US",
      country: "US",
      remoteUrl: "https://www.craftcouncil.org",
      registrationUrl: "https://www.craftcouncil.org",
      sourceName: "American Craft Council",
      sourceUrl: "https://www.craftcouncil.org",
      featured: false,
      tags: ["craft", "business", "hybrid"],
      verifiedAt: nowIso,
    },
    {
      id: "industry-amoca-clay-community",
      title: `${prefix}AMOCA Community Clay Programs`,
      summary: "Museum-led clay programming and exhibitions with regional relevance for Southwest members.",
      description:
        "Useful for members tracking museum-context ceramic programming and artist talks. Confirm specific dates for each cycle.",
      mode: "local",
      status,
      startAt: "2026-04-18T17:00:00.000Z",
      endAt: "2026-04-18T22:00:00.000Z",
      timezone: "America/Los_Angeles",
      location: "AMOCA",
      city: "Pomona",
      region: "CA",
      country: "US",
      remoteUrl: "",
      registrationUrl: "https://www.amoca.org",
      sourceName: "AMOCA",
      sourceUrl: "https://www.amoca.org",
      featured: false,
      tags: ["museum", "regional", "community"],
      verifiedAt: nowIso,
    },
    {
      id: "industry-phoenix-metro-clay-roundup",
      title: `${prefix}Phoenix Metro Clay Opportunities Roundup`,
      summary: "Curated local feed row for announced classes, meetups, and conventions in the Phoenix area.",
      description:
        "This seed row is intended as a local placeholder to aggregate sourced Phoenix-area opportunities and should be refreshed weekly.",
      mode: "local",
      status,
      startAt: "2026-04-03T01:00:00.000Z",
      endAt: "2026-04-03T02:00:00.000Z",
      timezone: "America/Phoenix",
      location: "Phoenix metro area",
      city: "Phoenix",
      region: "AZ",
      country: "US",
      remoteUrl: "",
      registrationUrl: "https://www.mesaartscenter.com",
      sourceName: "Phoenix-area arts calendars",
      sourceUrl: "https://www.mesaartscenter.com",
      featured: false,
      tags: ["phoenix", "local", "roundup"],
      verifiedAt: nowIso,
    },
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          projectId: options.projectId,
        });
  const db = getFirestore(app);

  const rows = buildSeedRows(options);
  const summary = {
    projectId: options.projectId,
    dryRun: options.dryRun,
    publish: options.publish,
    overwrite: options.overwrite,
    requested: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    targetCollection: "industryEvents",
    previewIds: [],
  };

  for (const row of rows) {
    const ref = db.collection("industryEvents").doc(row.id);
    let existingCreatedAt = null;
    let existingCreatedByUid = null;
    let exists = false;
    if (!options.dryRun) {
      const existing = await ref.get();
      exists = existing.exists;
      existingCreatedAt = existing.get("createdAt") ?? null;
      existingCreatedByUid = existing.get("createdByUid") ?? null;
      if (exists && !options.overwrite) {
        summary.skipped += 1;
        continue;
      }
    }

    const payload = {
      title: row.title,
      summary: row.summary,
      description: row.description,
      mode: row.mode,
      status: row.status,
      startAt: tsFromIso(row.startAt),
      endAt: tsFromIso(row.endAt),
      timezone: row.timezone || null,
      location: row.location || null,
      city: row.city || null,
      region: row.region || null,
      country: row.country || null,
      remoteUrl: row.remoteUrl || null,
      registrationUrl: row.registrationUrl || null,
      sourceName: row.sourceName || null,
      sourceUrl: row.sourceUrl || null,
      featured: row.featured === true,
      tags: row.tags,
      verifiedAt: tsFromIso(row.verifiedAt),
      sourceVerifiedAt: tsFromIso(row.verifiedAt),
      createdAt: existingCreatedAt ?? Timestamp.now(),
      createdByUid: existingCreatedByUid ?? "seed-script",
      updatedAt: Timestamp.now(),
      updatedByUid: "seed-script",
    };

    if (!options.dryRun) {
      await ref.set(payload, { merge: true });
    }

    if (options.dryRun) summary.previewIds.push(row.id);
    if (exists) summary.updated += 1;
    else summary.created += 1;
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } else {
    console.log(
      [
        `Industry seed complete (${summary.projectId})`,
        `- requested: ${summary.requested}`,
        `- created: ${summary.created}`,
        `- updated: ${summary.updated}`,
        `- skipped: ${summary.skipped}`,
        `- dryRun: ${summary.dryRun ? "yes" : "no"}`,
      ].join("\n")
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
