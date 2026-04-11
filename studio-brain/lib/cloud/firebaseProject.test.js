"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const firebaseProject_1 = require("./firebaseProject");
(0, node_test_1.default)("resolveFirebaseProjectId prefers explicit project id", () => {
    const resolved = (0, firebaseProject_1.resolveFirebaseProjectId)("custom-project", {
        FIREBASE_PROJECT_ID: "env-project",
    });
    strict_1.default.equal(resolved, "custom-project");
});
(0, node_test_1.default)("resolveFirebaseProjectId falls back through known env keys", () => {
    const resolved = (0, firebaseProject_1.resolveFirebaseProjectId)(undefined, {
        PORTAL_PROJECT_ID: "portal-project",
    });
    strict_1.default.equal(resolved, "portal-project");
});
(0, node_test_1.default)("resolveFirebaseProjectId reads FIREBASE_CONFIG json when present", () => {
    const resolved = (0, firebaseProject_1.resolveFirebaseProjectId)(undefined, {
        FIREBASE_CONFIG: JSON.stringify({ projectId: "firebase-config-project" }),
    });
    strict_1.default.equal(resolved, "firebase-config-project");
});
(0, node_test_1.default)("resolveFirebaseProjectId falls back to the repo default", () => {
    const resolved = (0, firebaseProject_1.resolveFirebaseProjectId)(undefined, {});
    strict_1.default.equal(resolved, firebaseProject_1.DEFAULT_FIREBASE_PROJECT_ID);
});
