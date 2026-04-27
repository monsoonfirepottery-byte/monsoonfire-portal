"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KilnAidReadOnlyProvider = void 0;
exports.createKilnAidReadOnlyProvider = createKilnAidReadOnlyProvider;
const node_fs_1 = require("node:fs");
class KilnAidReadOnlyProvider {
    sessionPath;
    id = "kilnaid";
    mode = "read_only";
    constructor(sessionPath = null) {
        this.sessionPath = sessionPath;
    }
    describeSupport() {
        const configured = Boolean(this.sessionPath && (0, node_fs_1.existsSync)(this.sessionPath));
        return {
            providerId: this.id,
            mode: this.mode,
            supportsStatus: configured,
            supportsDiagnostics: false,
            supportsHistory: false,
            supportedWriteActions: [],
            configured,
            notes: configured
                ? ["Session material detected. Read-only snapshot integration can be added later."]
                : ["No KilnAid session material configured. Provider remains a placeholder in MVP."],
        };
    }
    async health() {
        const support = this.describeSupport();
        return {
            ok: support.configured,
            availability: support.configured ? "degraded" : "down",
            latencyMs: 0,
            message: support.notes[0] ?? "KilnAid read-only provider is unavailable.",
        };
    }
    async readStatus(_kilnId) {
        throw new Error("KilnAid status observation is not configured in MVP.");
    }
    async readDiagnostics(_kilnId) {
        throw new Error("KilnAid diagnostics observation is not configured in MVP.");
    }
}
exports.KilnAidReadOnlyProvider = KilnAidReadOnlyProvider;
function createKilnAidReadOnlyProvider(sessionPath = null) {
    return new KilnAidReadOnlyProvider(sessionPath);
}
