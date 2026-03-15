import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAnnouncementArtifacts } from "./lib/marketing-announcements.mjs";

async function setupFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "marketing-announcements-"));
  await mkdir(join(rootDir, "marketing", "announcements"), { recursive: true });
  await mkdir(join(rootDir, "website", "assets", "images"), { recursive: true });
  await writeFile(join(rootDir, "website", "assets", "images", "bulletin.jpg"), "fixture", "utf8");
  return {
    rootDir,
    sourceDir: join(rootDir, "marketing", "announcements"),
  };
}

async function writeAnnouncement(sourceDir, id, data) {
  await writeFile(join(sourceDir, `${id}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function baseAnnouncement(overrides = {}) {
  return {
    id: "base-announcement",
    status: "approved",
    audience: {
      publicWebsite: true,
      portalMembers: false,
    },
    category: "ops_update",
    publishAt: "2026-03-10T16:00:00.000Z",
    expiresAt: null,
    title: "Base announcement",
    summary: "Base summary",
    body: "First paragraph.\n\nSecond paragraph.",
    ctaLabel: "Read more",
    ctaUrl: "/updates/",
    homepageTeaser: true,
    portalPinned: false,
    assetRefs: [
      {
        "repoPath": "website/assets/images/bulletin.jpg"
      }
    ],
    ...overrides,
  };
}

test("draft announcements stay out of website and portal outputs", async () => {
  const { rootDir, sourceDir } = await setupFixture();
  await writeAnnouncement(
    sourceDir,
    "draft-announcement",
    baseAnnouncement({
      id: "draft-announcement",
      status: "draft",
      audience: { publicWebsite: true, portalMembers: true },
    })
  );

  const artifacts = await buildAnnouncementArtifacts({
    rootDir,
    sourceDir,
    now: "2026-03-14T18:00:00.000Z",
  });

  assert.equal(artifacts.websitePayload.items.length, 0);
  assert.equal(artifacts.portalPayload.items.length, 0);
  assert.equal(artifacts.buildSummary.inactive.draft, 1);
});

test("public-only announcements render only in website payload", async () => {
  const { rootDir, sourceDir } = await setupFixture();
  await writeAnnouncement(
    sourceDir,
    "public-only",
    baseAnnouncement({
      id: "public-only",
      audience: { publicWebsite: true, portalMembers: false },
    })
  );

  const artifacts = await buildAnnouncementArtifacts({
    rootDir,
    sourceDir,
    now: "2026-03-14T18:00:00.000Z",
  });

  assert.equal(artifacts.websitePayload.items.length, 1);
  assert.equal(artifacts.websitePayload.items[0].id, "public-only");
  assert.equal(artifacts.portalPayload.items.length, 0);
});

test("portal-only announcements render only in portal payload", async () => {
  const { rootDir, sourceDir } = await setupFixture();
  await writeAnnouncement(
    sourceDir,
    "portal-only",
    baseAnnouncement({
      id: "portal-only",
      audience: { publicWebsite: false, portalMembers: true },
    })
  );

  const artifacts = await buildAnnouncementArtifacts({
    rootDir,
    sourceDir,
    now: "2026-03-14T18:00:00.000Z",
  });

  assert.equal(artifacts.websitePayload.items.length, 0);
  assert.equal(artifacts.portalPayload.items.length, 1);
  assert.equal(artifacts.portalPayload.items[0].sourceId, "portal-only");
});

test("dual-audience announcements publish to both outputs", async () => {
  const { rootDir, sourceDir } = await setupFixture();
  await writeAnnouncement(
    sourceDir,
    "dual-audience",
    baseAnnouncement({
      id: "dual-audience",
      audience: { publicWebsite: true, portalMembers: true },
      portalPinned: true,
    })
  );

  const artifacts = await buildAnnouncementArtifacts({
    rootDir,
    sourceDir,
    now: "2026-03-14T18:00:00.000Z",
  });

  assert.equal(artifacts.websitePayload.items.length, 1);
  assert.equal(artifacts.portalPayload.items.length, 1);
  assert.equal(artifacts.portalPayload.items[0].pinned, true);
});

test("expired announcements stay out of active outputs", async () => {
  const { rootDir, sourceDir } = await setupFixture();
  await writeAnnouncement(
    sourceDir,
    "expired-announcement",
    baseAnnouncement({
      id: "expired-announcement",
      expiresAt: "2026-03-11T16:00:00.000Z",
    })
  );

  const artifacts = await buildAnnouncementArtifacts({
    rootDir,
    sourceDir,
    now: "2026-03-14T18:00:00.000Z",
  });

  assert.equal(artifacts.websitePayload.items.length, 0);
  assert.equal(artifacts.portalPayload.items.length, 0);
  assert.equal(artifacts.buildSummary.inactive.expired, 1);
});

test("missing assets fail validation cleanly", async () => {
  const { rootDir, sourceDir } = await setupFixture();
  await writeAnnouncement(
    sourceDir,
    "broken-asset",
    baseAnnouncement({
      id: "broken-asset",
      assetRefs: [{ repoPath: "website/assets/images/missing.jpg" }],
    })
  );

  await assert.rejects(
    () =>
      buildAnnouncementArtifacts({
        rootDir,
        sourceDir,
        now: "2026-03-14T18:00:00.000Z",
      }),
    /assetRefs\[0\]\.repoPath not found/
  );
});
