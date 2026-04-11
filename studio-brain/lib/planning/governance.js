"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPlanningRepoRoot = findPlanningRepoRoot;
exports.loadPlanningControlPlaneModule = loadPlanningControlPlaneModule;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
function findPlanningRepoRoot(startDir = process.cwd()) {
    let current = node_path_1.default.resolve(startDir);
    for (let index = 0; index < 8; index += 1) {
        if (node_fs_1.default.existsSync(node_path_1.default.join(current, ".governance", "planning")) &&
            node_fs_1.default.existsSync(node_path_1.default.join(current, "contracts"))) {
            return current;
        }
        const parent = node_path_1.default.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    throw new Error("Unable to locate planning control-plane root from current working directory.");
}
let cachedModulePromise = null;
const dynamicImport = new Function("modulePath", "return import(modulePath);");
async function loadPlanningControlPlaneModule(repoRoot = findPlanningRepoRoot()) {
    if (!cachedModulePromise) {
        const moduleUrl = (0, node_url_1.pathToFileURL)(node_path_1.default.join(repoRoot, "scripts", "lib", "planning-control-plane.mjs")).href;
        cachedModulePromise = dynamicImport(moduleUrl);
    }
    return cachedModulePromise;
}
