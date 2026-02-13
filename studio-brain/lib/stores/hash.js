"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableHash = stableHash;
exports.stableHashDeep = stableHashDeep;
const node_crypto_1 = __importDefault(require("node:crypto"));
function stableHash(value) {
    const serialized = JSON.stringify(value, Object.keys((value ?? {})).sort());
    return node_crypto_1.default.createHash("sha256").update(serialized).digest("hex");
}
function stableHashDeep(value) {
    return node_crypto_1.default.createHash("sha256").update(stableStringify(value)).digest("hex");
}
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
