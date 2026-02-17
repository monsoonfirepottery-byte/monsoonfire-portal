export type IsoDateString = string;

export type ActorType = "human" | "agent" | "staff" | "system";

export type ApprovalState = "required" | "approved" | "rejected" | "exempt";

export type ExternalTarget = "firestore" | "stripe" | "hubitat" | "roborock" | "github" | "calendar" | "website";

export type IntegrityHash = string;
