"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const hash_1 = require("./hash");
(0, node_test_1.default)("stableHashDeep is order-insensitive for object keys", () => {
    const a = { z: 1, a: { b: 2, c: [3, 4] } };
    const b = { a: { c: [3, 4], b: 2 }, z: 1 };
    strict_1.default.equal((0, hash_1.stableHashDeep)(a), (0, hash_1.stableHashDeep)(b));
});
