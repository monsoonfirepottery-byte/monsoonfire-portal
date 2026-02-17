"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
function parseServices(raw) {
    const services = [];
    const lines = raw.split(/\r?\n/);
    let inServices = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || /^\s*#/.test(line)) {
            continue;
        }
        const indent = line.length - line.trimStart().length;
        if (indent === 0 && trimmed === "services:") {
            inServices = true;
            continue;
        }
        if (indent === 0 && trimmed !== "services:" && inServices) {
            inServices = false;
        }
        if (!inServices) {
            continue;
        }
        if (indent === 2 && /^[^:\s]+:\s*$/.test(trimmed)) {
            services.push(trimmed.slice(0, -1));
        }
    }
    return services;
}
(0, node_test_1.default)("docker-compose includes required backend services", async () => {
    const composePath = node_path_1.default.join(process.cwd(), "docker-compose.yml");
    const raw = await promises_1.default.readFile(composePath, "utf8");
    const services = parseServices(raw);
    strict_1.default.ok(services.includes("postgres"), "postgres service missing from compose config");
    strict_1.default.ok(services.includes("redis"), "redis service missing from compose config");
    strict_1.default.ok(services.includes("minio"), "minio service missing from compose config");
});
