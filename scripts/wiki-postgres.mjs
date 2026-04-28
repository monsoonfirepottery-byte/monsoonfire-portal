#!/usr/bin/env node

import {
  applyClaimsToDb,
  applyContextPackToDb,
  applyContradictionsToDb,
  applySourceIndexToDb,
  buildDbProbeReport,
  buildSourceIndex,
  detectContradictions,
  extractClaims,
  generateContextPack,
  parseArgs,
  readExtractedFacts,
  runDbExplainProbe,
  validateWikiScaffold,
  writeContextPack,
  writeContradictions,
  writeExtractedFacts,
  writeJsonArtifact,
  writeSourceMap,
} from "./lib/wiki-postgres-utils.mjs";

function printHuman(report) {
  const status = report.status || report.summary?.status || "ok";
  process.stdout.write(`wiki-postgres ${report.schema || "report"}: ${status}\n`);
  if (report.summary) {
    process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
  }
}

function compactForStdout(report, artifactPath) {
  if (!artifactPath) return report;
  if (report?.schema === "wiki-claim-extraction.v1") {
    return {
      schema: report.schema,
      generatedAt: report.generatedAt,
      tenantScope: report.tenantScope,
      status: report.status,
      artifactPath: report.artifactPath,
      markdownPath: report.markdownPath,
      summary: report.summary,
      claimSample: report.claims?.slice(0, 20).map((claim) => ({
        claimId: claim.claimId,
        claimKind: claim.claimKind,
        status: claim.status,
        subjectKey: claim.subjectKey,
        requiresHumanApproval: claim.requiresHumanApproval,
        sourcePath: claim.sourceRefs?.[0]?.sourcePath,
      })) || [],
    };
  }
  if (report?.schema !== "wiki-source-index.v1") return report;
  return {
    schema: report.schema,
    generatedAt: report.generatedAt,
    tenantScope: report.tenantScope,
    status: report.status,
    artifactPath: report.artifactPath,
    snapshotHash: report.snapshotHash,
    summary: report.summary,
    deniedSample: report.denied?.slice(0, 20) || [],
    sourceSample: report.sources?.slice(0, 20).map((source) => ({
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      authorityClass: source.authorityClass,
      chunkCount: source.chunkCount,
    })) || [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let report;

  if (args.command === "validate") {
    report = validateWikiScaffold();
  } else if (args.command === "source-index") {
    report = buildSourceIndex(args);
    if (args.applyDb) {
      report.db = await applySourceIndexToDb(report);
      report.status = report.db.errors.length > 0 ? "warning" : "pass";
    } else {
      report.status = "planned";
    }
    if (args.writeMarkdown) {
      report.markdownPath = writeSourceMap(report);
    }
  } else if (args.command === "extract") {
    const index = buildSourceIndex(args);
    report = extractClaims(index, args);
    report.status = "planned";
    if (args.applyDb) {
      report.db = await applyClaimsToDb(report);
      report.status = report.db.errors.length > 0 ? "warning" : "pass";
    }
    if (args.writeMarkdown) {
      report.markdownPath = writeExtractedFacts(report);
    }
  } else if (args.command === "contradictions") {
    const index = buildSourceIndex(args);
    const extraction = extractClaims(index, args);
    report = detectContradictions(index, extraction.claims);
    report.status = report.contradictions.length > 0 ? "warning" : "pass";
    if (args.applyDb) {
      report.db = await applyContradictionsToDb(report, args.tenantScope);
      report.status = report.db.errors.length > 0 ? "warning" : report.status;
    }
    if (args.writeMarkdown) {
      report.markdownPaths = writeContradictions(report);
    }
  } else if (args.command === "context") {
    let claims = args.freshExtract ? [] : readExtractedFacts();
    if (claims.length === 0) {
      const index = buildSourceIndex(args);
      claims = extractClaims(index, args).claims;
    }
    const contradictionScan = detectContradictions(buildSourceIndex({ ...args, limit: args.limit || 0 }), claims);
    const pack = generateContextPack(claims, contradictionScan.contradictions, args);
    report = {
      schema: "wiki-context-pack-report.v1",
      generatedAt: pack.generatedAt,
      status: "pass",
      contextPack: pack,
      summary: pack.budget,
    };
    if (args.applyDb) {
      report.db = await applyContextPackToDb(pack);
    }
    if (args.writeMarkdown) {
      report.markdownPath = writeContextPack(pack);
    }
  } else if (args.command === "db-probe") {
    report = buildDbProbeReport();
    if (args.applyDb) {
      report = await runDbExplainProbe(report, args.tenantScope);
    }
  } else {
    throw new Error(`Unknown wiki-postgres command: ${args.command}`);
  }

  if (args.artifact) {
    report.artifactPath = writeJsonArtifact(report, args.artifact);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(compactForStdout(report, args.artifact), null, 2)}\n`);
  } else {
    printHuman(report);
  }

  if (args.strict && report.status && !["pass", "planned"].includes(report.status)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
