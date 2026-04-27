"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryKilnStore = void 0;
function sortByIsoDescending(items, readIso) {
    return [...items].sort((left, right) => {
        const leftIso = readIso(left) ?? "";
        const rightIso = readIso(right) ?? "";
        return rightIso.localeCompare(leftIso);
    });
}
class MemoryKilnStore {
    kilns = new Map();
    capabilityDocs = new Map();
    artifacts = new Map();
    importRuns = new Map();
    firingRuns = new Map();
    firingEvents = new Map();
    telemetry = new Map();
    healthSnapshots = new Map();
    operatorActions = new Map();
    async upsertKiln(kiln) {
        this.kilns.set(kiln.id, { ...kiln });
    }
    async getKiln(id) {
        return this.kilns.get(id) ?? null;
    }
    async listKilns() {
        return [...this.kilns.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
    }
    async saveCapabilityDocument(document) {
        const current = this.capabilityDocs.get(document.kilnId) ?? [];
        const next = current.filter((entry) => entry.id !== document.id);
        next.push({ ...document });
        this.capabilityDocs.set(document.kilnId, sortByIsoDescending(next, (entry) => entry.generatedAt));
    }
    async getLatestCapabilityDocument(kilnId) {
        return this.capabilityDocs.get(kilnId)?.[0] ?? null;
    }
    async saveArtifactRecord(record) {
        this.artifacts.set(record.id, { ...record, metadata: { ...record.metadata } });
    }
    async getArtifactRecord(id) {
        return this.artifacts.get(id) ?? null;
    }
    async findArtifactBySha256(sha256) {
        return [...this.artifacts.values()].find((entry) => entry.sha256 === sha256) ?? null;
    }
    async listArtifactsForKiln(kilnId, limit = 20) {
        return sortByIsoDescending([...this.artifacts.values()].filter((entry) => entry.kilnId === kilnId), (entry) => entry.observedAt).slice(0, Math.max(1, limit));
    }
    async saveImportRun(run) {
        this.importRuns.set(run.id, { ...run, diagnostics: { ...run.diagnostics } });
    }
    async getImportRun(id) {
        return this.importRuns.get(id) ?? null;
    }
    async saveFiringRun(run) {
        this.firingRuns.set(run.id, {
            ...run,
            rawArtifactRefs: [...run.rawArtifactRefs],
            linkedPortalRefs: {
                batchIds: [...run.linkedPortalRefs.batchIds],
                pieceIds: [...run.linkedPortalRefs.pieceIds],
                reservationIds: [...run.linkedPortalRefs.reservationIds],
                portalFiringId: run.linkedPortalRefs.portalFiringId,
            },
        });
    }
    async getFiringRun(id) {
        return this.firingRuns.get(id) ?? null;
    }
    async findCurrentRunForKiln(kilnId) {
        const openStatuses = new Set(["queued", "armed", "firing", "cooling"]);
        const matches = [...this.firingRuns.values()].filter((entry) => entry.kilnId === kilnId && openStatuses.has(entry.status));
        return sortByIsoDescending(matches, (entry) => entry.startTime ?? entry.operatorConfirmationAt ?? null)[0] ?? null;
    }
    async listFiringRuns(query = {}) {
        let items = [...this.firingRuns.values()];
        if (query.kilnId) {
            items = items.filter((entry) => entry.kilnId === query.kilnId);
        }
        if (query.statuses?.length) {
            const allowed = new Set(query.statuses);
            items = items.filter((entry) => allowed.has(entry.status));
        }
        if (query.queueStates?.length) {
            const allowed = new Set(query.queueStates);
            items = items.filter((entry) => allowed.has(entry.queueState));
        }
        return sortByIsoDescending(items, (entry) => entry.startTime ?? entry.operatorConfirmationAt ?? null).slice(0, Math.max(1, query.limit ?? 50));
    }
    async appendFiringEvents(events) {
        for (const event of events) {
            const current = this.firingEvents.get(event.firingRunId) ?? [];
            current.push({ ...event, payloadJson: { ...event.payloadJson } });
            this.firingEvents.set(event.firingRunId, sortByIsoDescending(current, (entry) => entry.ts));
        }
    }
    async listFiringEvents(firingRunId, limit = 100) {
        return sortByIsoDescending(this.firingEvents.get(firingRunId) ?? [], (entry) => entry.ts)
            .slice(0, Math.max(1, limit))
            .reverse();
    }
    async appendTelemetryPoints(points) {
        for (const point of points) {
            const current = this.telemetry.get(point.firingRunId) ?? [];
            current.push({ ...point, rawPayload: { ...point.rawPayload } });
            current.sort((left, right) => left.ts.localeCompare(right.ts));
            this.telemetry.set(point.firingRunId, current);
        }
    }
    async listTelemetryPoints(firingRunId, limit = 500) {
        const points = this.telemetry.get(firingRunId) ?? [];
        return points.slice(Math.max(0, points.length - Math.max(1, limit)));
    }
    async saveHealthSnapshot(snapshot) {
        const current = this.healthSnapshots.get(snapshot.kilnId) ?? [];
        const next = current.filter((entry) => entry.id !== snapshot.id);
        next.push({ ...snapshot, warnings: [...snapshot.warnings], confidenceNotes: [...snapshot.confidenceNotes] });
        this.healthSnapshots.set(snapshot.kilnId, sortByIsoDescending(next, (entry) => entry.ts));
    }
    async getLatestHealthSnapshot(kilnId) {
        return this.healthSnapshots.get(kilnId)?.[0] ?? null;
    }
    async saveOperatorAction(action) {
        this.operatorActions.set(action.id, {
            ...action,
            checklistJson: { ...action.checklistJson },
        });
    }
    async listOperatorActions(query = {}) {
        let items = [...this.operatorActions.values()];
        if (query.kilnId) {
            items = items.filter((entry) => entry.kilnId === query.kilnId);
        }
        if (query.firingRunId) {
            items = items.filter((entry) => entry.firingRunId === query.firingRunId);
        }
        if (query.incompleteOnly) {
            items = items.filter((entry) => !entry.completedAt);
        }
        return sortByIsoDescending(items, (entry) => entry.requestedAt).slice(0, Math.max(1, query.limit ?? 50));
    }
}
exports.MemoryKilnStore = MemoryKilnStore;
