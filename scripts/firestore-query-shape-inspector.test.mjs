import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { runFirestoreQueryShapeInspector } from "./firestore-query-shape-inspector.mjs";

test("runFirestoreQueryShapeInspector flags missing index and Firestore write hazards from file-backed query shapes", async () => {
  const fixtureDir = await mkdtemp(resolve(tmpdir(), "mf-firestore-query-inspector-"));
  const sourcePath = resolve(fixtureDir, "fixture.ts");
  const reportJsonPath = resolve(fixtureDir, "report.json");
  const reportMarkdownPath = resolve(fixtureDir, "report.md");

  try {
    await writeFile(
      sourcePath,
      `
      import { addDoc, collection, orderBy, query, where } from "firebase/firestore";

      export function buildQueries(db, uid, maybeStatus, maybeClosedAt) {
        const coveredQuery = query(
          collection(db, "batches"),
          where("ownerUid", "==", uid),
          where("isClosed", "==", false),
          orderBy("updatedAt", "desc")
        );

        const missingIndexQuery = query(
          collection(db, "eventCharges"),
          where("uid", "==", uid),
          where("paymentStatus", "==", "open"),
          orderBy("createdAt", "desc")
        );

        return { coveredQuery, missingIndexQuery };
      }

      export async function writeRisk(db, maybeStatus, maybeClosedAt) {
        return addDoc(collection(db, "eventCharges"), {
          paymentStatus: maybeStatus ?? null,
          kilnName: undefined,
          closedAt: maybeClosedAt ?? null,
        });
      }
      `,
      "utf8"
    );

    const summary = await runFirestoreQueryShapeInspector([
      "--path",
      fixtureDir,
      "--report-json",
      reportJsonPath,
      "--report-markdown",
      reportMarkdownPath,
    ]);

    assert.equal(summary.queryShapes.some((shape) => shape.collectionGroup === "batches"), true);
    assert.equal(
      summary.findings.some(
        (finding) =>
          finding.code === "firestore-query-index-gap" && finding.collectionGroup === "eventCharges"
      ),
      true
    );
    assert.equal(
      summary.findings.some(
        (finding) =>
          finding.code === "firestore-undefined-write-risk" && finding.fieldPath === "kilnName"
      ),
      true
    );
    assert.equal(
      summary.findings.some(
        (finding) =>
          finding.code === "firestore-nullability-query-risk" && finding.fieldPath === "paymentStatus"
      ),
      true
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
