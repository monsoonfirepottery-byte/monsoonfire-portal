export const fabricationEventTypes = [
  "fabrication.request",
  "fabrication.plan",
  "fabrication.stock_alert",
  "fabrication.maintenance_due",
  "fabrication.complete",
  "fabrication.fail",
] as const;

export type FabricationEventType = (typeof fabricationEventTypes)[number];

export const fabricationMaterials = ["PLA", "PETG"] as const;
export type FabricationMaterial = (typeof fabricationMaterials)[number];

export const fabricationLanes = ["ceramics_tooling", "studio_infrastructure"] as const;
export type FabricationLane = (typeof fabricationLanes)[number];

export const fabricationUrgencies = ["ops_critical", "repeatable_tooling", "maintenance", "experiment"] as const;
export type FabricationUrgency = (typeof fabricationUrgencies)[number];

export const printJobStatuses = ["requested", "planned", "blocked_stock", "queued", "in_progress", "completed", "failed", "escalated"] as const;
export type PrintJobStatus = (typeof printJobStatuses)[number];

export const printJobDispositions = [
  "library_reuse",
  "custom_build",
  "stock_blocked",
  "escalated_review",
  "keep_in_rotation",
  "discard_after_use",
] as const;
export type PrintJobDisposition = (typeof printJobDispositions)[number];

export const reuseDecisions = ["keep_existing_library_item", "promote_to_library", "one_off_only", "escalate_review"] as const;
export type ReuseDecision = (typeof reuseDecisions)[number];

export const consumableStatuses = ["ready", "low", "drying", "quarantined"] as const;
export type ConsumableStatus = (typeof consumableStatuses)[number];

export const maintenanceTaskStatuses = ["open", "scheduled", "completed", "dismissed"] as const;
export type MaintenanceTaskStatus = (typeof maintenanceTaskStatuses)[number];

export const failureSignals = [
  "first_layer_failure",
  "bed_adhesion_noise",
  "under_extrusion",
  "toolhead_vibration",
  "material_runout",
  "ambiguous_request",
] as const;
export type FailureSignal = (typeof failureSignals)[number];

export type PrinterStatus = "idle" | "printing" | "maintenance_due" | "blocked";

export type LibraryApprovedSettings = {
  layerHeightMm: number;
  nozzleMm: number;
  infillPct: number;
  supportStrategy: "minimal" | "organic" | "none";
  buildPlate: string;
};

export type MaintenanceInterval = {
  taskType: string;
  intervalHours: number;
  rationale: string;
};

export type PrinterAsset = {
  id: string;
  name: string;
  model: string;
  safeMaterials: FabricationMaterial[];
  nozzleSetup: string;
  buildPlate: string;
  operatingConstraints: string[];
  maintenanceIntervals: MaintenanceInterval[];
  status: PrinterStatus;
  notes: string[];
};

export type PrintLibraryItem = {
  id: string;
  name: string;
  lane: FabricationLane;
  intendedUse: string;
  aliases: string[];
  approvedMaterial: FabricationMaterial;
  approvedSettings: LibraryApprovedSettings;
  estimatedGrams: number;
  estimatedRuntimeMinutes: number;
  evidenceChecklist: string[];
  replacementTrigger: string | null;
};

export type PrintJobRequest = {
  id: string;
  title: string;
  requester: string;
  purpose: string;
  laneHint: FabricationLane;
  urgency: FabricationUrgency;
  linkedSource: string | null;
  desiredMaterial: FabricationMaterial | null;
  estimatedGrams: number | null;
  estimatedRuntimeMinutes: number | null;
  dimensionsKnown: boolean;
  repeatableIntent: boolean;
  notes: string | null;
};

export type PrintJob = {
  id: string;
  createdAt: string;
  title: string;
  category: FabricationLane;
  urgency: FabricationUrgency;
  requester: string;
  linkedSource: string | null;
  material: FabricationMaterial;
  estimatedGrams: number;
  estimatedRuntimeMinutes: number;
  status: PrintJobStatus;
  disposition: PrintJobDisposition;
  reuseDecision: ReuseDecision;
  libraryItemId: string | null;
  notes: string[];
};

export type ConsumableStock = {
  id: string;
  material: FabricationMaterial;
  label: string;
  remainingGrams: number;
  dryingState: "dry_box" | "ambient" | "recently_dried";
  status: ConsumableStatus;
  notes: string[];
};

export type MaintenanceTask = {
  id: string;
  taskType: string;
  title: string;
  description: string;
  conditionSignals: FailureSignal[];
  status: MaintenanceTaskStatus;
  dueAfterHours: number | null;
  dueAt: string | null;
  createdAt: string;
  lastCompletedAt: string | null;
};

export type FabricationOutcomeInput = {
  result: "completed" | "failed";
  evidencePhotos: string[];
  operatorNotes: string[];
  repeatable: boolean;
  replacedPurchase: string | null;
  failureSignals: FailureSignal[];
};
