"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLibraryIndex = buildLibraryIndex;
exports.classifyFabricationRequest = classifyFabricationRequest;
exports.planFabricationJob = planFabricationJob;
exports.sortQueueByPriority = sortQueueByPriority;
exports.suggestMaintenanceTasks = suggestMaintenanceTasks;
exports.captureLearning = captureLearning;
const urgencyWeight = {
    ops_critical: 400,
    repeatable_tooling: 300,
    maintenance: 200,
    experiment: 100,
};
function normalizeLookup(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}
function buildLibraryIndex(library) {
    const index = new Map();
    for (const item of library) {
        index.set(normalizeLookup(item.name), item);
        for (const alias of item.aliases) {
            index.set(normalizeLookup(alias), item);
        }
    }
    return index;
}
function classifyFabricationRequest(request, library) {
    const libraryByName = buildLibraryIndex(library);
    const matched = libraryByName.get(normalizeLookup(request.title)) ?? null;
    if (matched) {
        return {
            route: "library_reuse",
            reason: `Matched approved library item "${matched.name}".`,
            matchedLibraryItem: matched,
            requiredEvent: "fabrication.request",
        };
    }
    if (!request.dimensionsKnown && !request.linkedSource) {
        return {
            route: "escalate",
            reason: "Request is missing measurements or a linked source, so a human should clarify before planning.",
            matchedLibraryItem: null,
            requiredEvent: "fabrication.fail",
        };
    }
    return {
        route: "custom_job",
        reason: "Request has enough source or measurement detail to plan a custom fabrication job.",
        matchedLibraryItem: null,
        requiredEvent: "fabrication.plan",
    };
}
function availableStockGrams(stock, material) {
    return stock
        .filter((row) => row.material === material && row.status !== "quarantined")
        .reduce((sum, row) => sum + row.remainingGrams, 0);
}
function resolveDisposition(route) {
    return route === "library_reuse" ? "library_reuse" : "custom_build";
}
function resolveReuseDecision(request, matchedLibraryItem) {
    if (matchedLibraryItem)
        return "keep_existing_library_item";
    return request.repeatableIntent ? "promote_to_library" : "one_off_only";
}
function planFabricationJob(request, printer, library, stock, now = new Date()) {
    const intake = classifyFabricationRequest(request, library);
    if (intake.route === "escalate") {
        return {
            outcome: "escalated",
            eventType: "fabrication.fail",
            route: "escalate",
            reason: intake.reason,
            matchedLibraryItem: null,
        };
    }
    const matched = intake.matchedLibraryItem;
    const material = request.desiredMaterial ?? matched?.approvedMaterial ?? "PLA";
    if (!printer.safeMaterials.includes(material)) {
        return {
            outcome: "escalated",
            eventType: "fabrication.fail",
            route: "escalate",
            reason: `${material} is outside the approved v1 material boundary for ${printer.name}.`,
            matchedLibraryItem: null,
        };
    }
    const estimatedGrams = request.estimatedGrams ?? matched?.estimatedGrams ?? 0;
    const estimatedRuntimeMinutes = request.estimatedRuntimeMinutes ?? matched?.estimatedRuntimeMinutes ?? 0;
    const availableGrams = availableStockGrams(stock, material);
    if (estimatedGrams > availableGrams) {
        return {
            outcome: "stock_alert",
            eventType: "fabrication.stock_alert",
            route: intake.route,
            reason: `${material} stock is too low for this job.`,
            matchedLibraryItem: matched,
            material,
            requiredGrams: estimatedGrams,
            availableGrams,
        };
    }
    return {
        outcome: "planned",
        eventType: "fabrication.plan",
        route: intake.route,
        reason: intake.reason,
        matchedLibraryItem: matched,
        job: {
            id: `job.${request.id}`,
            createdAt: now.toISOString(),
            title: request.title,
            category: request.laneHint,
            urgency: request.urgency,
            requester: request.requester,
            linkedSource: request.linkedSource,
            material,
            estimatedGrams,
            estimatedRuntimeMinutes,
            status: "planned",
            disposition: resolveDisposition(intake.route),
            reuseDecision: resolveReuseDecision(request, matched),
            libraryItemId: matched?.id ?? null,
            notes: [request.purpose, request.notes].filter((value) => Boolean(value && value.trim().length > 0)),
        },
    };
}
function sortQueueByPriority(jobs) {
    return [...jobs].sort((left, right) => {
        const byUrgency = urgencyWeight[right.urgency] - urgencyWeight[left.urgency];
        if (byUrgency !== 0)
            return byUrgency;
        const leftLibraryBias = left.libraryItemId ? 1 : 0;
        const rightLibraryBias = right.libraryItemId ? 1 : 0;
        if (leftLibraryBias !== rightLibraryBias)
            return rightLibraryBias - leftLibraryBias;
        return left.createdAt.localeCompare(right.createdAt);
    });
}
function openTaskExists(existingTasks, taskType) {
    return existingTasks.some((task) => task.taskType === taskType && (task.status === "open" || task.status === "scheduled"));
}
function suggestMaintenanceTasks(signals, existingTasks, now = new Date()) {
    const nextTasks = [];
    const createTask = (taskType, title, description, conditionSignals) => {
        if (openTaskExists(existingTasks, taskType))
            return;
        nextTasks.push({
            id: `maint.${taskType}.${now.getTime().toString(36)}`,
            taskType,
            title,
            description,
            conditionSignals,
            status: "open",
            dueAfterHours: null,
            dueAt: now.toISOString(),
            createdAt: now.toISOString(),
            lastCompletedAt: null,
        });
    };
    if (signals.includes("first_layer_failure") || signals.includes("bed_adhesion_noise")) {
        createTask("build_plate_cleaning", "Clean and reset build plate", "Restore first-layer reliability before the next queue item starts.", ["first_layer_failure", "bed_adhesion_noise"]);
    }
    if (signals.includes("under_extrusion") || signals.includes("toolhead_vibration")) {
        createTask("nozzle_inspection", "Inspect nozzle and toolhead path", "Check for partial clogging, wear, or mounting looseness before another repeatable tooling job.", ["under_extrusion", "toolhead_vibration"]);
    }
    return nextTasks;
}
function captureLearning(job, outcome) {
    if (outcome.result === "failed") {
        return {
            eventType: "fabrication.fail",
            reuseDecision: "escalate_review",
            notes: [
                ...outcome.operatorNotes,
                `Failure signals: ${outcome.failureSignals.join(", ") || "none recorded"}.`,
            ],
            nominatedLibraryItem: null,
        };
    }
    if (job.libraryItemId) {
        return {
            eventType: "fabrication.complete",
            reuseDecision: "keep_existing_library_item",
            notes: [
                ...outcome.operatorNotes,
                `Captured ${outcome.evidencePhotos.length} photo(s) for the approved library item.`,
            ],
            nominatedLibraryItem: null,
        };
    }
    if (outcome.repeatable) {
        return {
            eventType: "fabrication.complete",
            reuseDecision: "promote_to_library",
            notes: [
                ...outcome.operatorNotes,
                outcome.replacedPurchase
                    ? `Candidate replaced a purchased part or ad-hoc expense: ${outcome.replacedPurchase}.`
                    : "Candidate proved repeatable and should be reviewed for library promotion.",
            ],
            nominatedLibraryItem: {
                id: `library.${normalizeLookup(job.title).replace(/\s+/g, "_")}`,
                name: job.title,
                lane: job.category,
                intendedUse: job.notes[0] ?? "Promoted from successful custom fabrication job.",
                aliases: [job.title],
                approvedMaterial: job.material,
                approvedSettings: {
                    layerHeightMm: 0.2,
                    nozzleMm: 0.4,
                    infillPct: 30,
                    supportStrategy: "minimal",
                    buildPlate: "textured PEI",
                },
                estimatedGrams: job.estimatedGrams,
                estimatedRuntimeMinutes: job.estimatedRuntimeMinutes,
                evidenceChecklist: ["photo on printer bed", "installed use photo", "fit check"],
                replacementTrigger: outcome.replacedPurchase ? `Reprint instead of re-buying: ${outcome.replacedPurchase}.` : null,
            },
        };
    }
    return {
        eventType: "fabrication.complete",
        reuseDecision: "one_off_only",
        notes: [...outcome.operatorNotes, "Useful as a one-off print, but not promoted into the repeat library."],
        nominatedLibraryItem: null,
    };
}
