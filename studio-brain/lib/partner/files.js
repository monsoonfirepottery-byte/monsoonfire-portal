"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partnerRoot = partnerRoot;
exports.partnerLatestBriefPath = partnerLatestBriefPath;
exports.partnerCheckinsPath = partnerCheckinsPath;
exports.partnerOpenLoopsPath = partnerOpenLoopsPath;
exports.partnerArtifactPaths = partnerArtifactPaths;
exports.readLatestPartnerBrief = readLatestPartnerBrief;
exports.writeLatestPartnerBrief = writeLatestPartnerBrief;
exports.readPartnerOpenLoops = readPartnerOpenLoops;
exports.writePartnerOpenLoops = writePartnerOpenLoops;
exports.appendPartnerCheckin = appendPartnerCheckin;
exports.readPartnerCheckins = readPartnerCheckins;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const PARTNER_ROOT = ["output", "studio-brain", "partner"];
const LATEST_BRIEF_FILE = "latest-brief.json";
const CHECKINS_FILE = "checkins.jsonl";
const OPEN_LOOPS_FILE = "open-loops.json";
function readJsonFile(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return null;
    try {
        return JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
    }
    catch {
        return null;
    }
}
function partnerRoot(repoRoot) {
    return (0, node_path_1.resolve)(repoRoot, ...PARTNER_ROOT);
}
function partnerLatestBriefPath(repoRoot) {
    return (0, node_path_1.resolve)(partnerRoot(repoRoot), LATEST_BRIEF_FILE);
}
function partnerCheckinsPath(repoRoot) {
    return (0, node_path_1.resolve)(partnerRoot(repoRoot), CHECKINS_FILE);
}
function partnerOpenLoopsPath(repoRoot) {
    return (0, node_path_1.resolve)(partnerRoot(repoRoot), OPEN_LOOPS_FILE);
}
function partnerArtifactPaths() {
    return {
        latestBriefPath: [...PARTNER_ROOT, LATEST_BRIEF_FILE].join("/"),
        checkinsPath: [...PARTNER_ROOT, CHECKINS_FILE].join("/"),
        openLoopsPath: [...PARTNER_ROOT, OPEN_LOOPS_FILE].join("/"),
    };
}
function readLatestPartnerBrief(repoRoot) {
    return readJsonFile(partnerLatestBriefPath(repoRoot));
}
function writeLatestPartnerBrief(repoRoot, brief) {
    (0, node_fs_1.mkdirSync)(partnerRoot(repoRoot), { recursive: true });
    (0, node_fs_1.writeFileSync)(partnerLatestBriefPath(repoRoot), `${JSON.stringify(brief, null, 2)}\n`, "utf8");
}
function readPartnerOpenLoops(repoRoot) {
    const payload = readJsonFile(partnerOpenLoopsPath(repoRoot));
    return Array.isArray(payload?.rows) ? payload.rows : [];
}
function writePartnerOpenLoops(repoRoot, rows, updatedAt) {
    (0, node_fs_1.mkdirSync)(partnerRoot(repoRoot), { recursive: true });
    (0, node_fs_1.writeFileSync)(partnerOpenLoopsPath(repoRoot), `${JSON.stringify({ schema: "studio-brain.partner-open-loops.v1", updatedAt, rows }, null, 2)}\n`, "utf8");
}
function appendPartnerCheckin(repoRoot, record) {
    (0, node_fs_1.mkdirSync)(partnerRoot(repoRoot), { recursive: true });
    (0, node_fs_1.appendFileSync)(partnerCheckinsPath(repoRoot), `${JSON.stringify(record)}\n`, "utf8");
}
function readPartnerCheckins(repoRoot, limit = 40) {
    const target = partnerCheckinsPath(repoRoot);
    if (!(0, node_fs_1.existsSync)(target))
        return [];
    const rows = [];
    for (const line of (0, node_fs_1.readFileSync)(target, "utf8").split(/\r?\n/)) {
        if (!line.trim())
            continue;
        try {
            rows.push(JSON.parse(line));
        }
        catch {
            continue;
        }
    }
    return rows.slice(-Math.max(1, limit));
}
