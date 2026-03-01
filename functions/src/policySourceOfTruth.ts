export type CanonicalPolicyRule = {
  id: string;
  title: string;
  description: string;
  severityHint: "low" | "medium" | "high";
};

export type CanonicalPolicyRecord = {
  id: string;
  version: string;
  title: string;
  summary: string;
  status: "published";
  sourceOfTruth: "website_policies";
  sourceSlug: string;
  sourceVersion: string;
  sourceUrl: string;
  rules: CanonicalPolicyRule[];
};

export const WEBSITE_POLICY_SOURCE_SLUG = "community-conduct";
export const WEBSITE_POLICY_SOURCE_VERSION = "2026-02-17";
export const WEBSITE_POLICY_SOURCE_URL = "/policies/community-conduct/";
export const WEBSITE_POLICY_CANONICAL_VERSION = `website-${WEBSITE_POLICY_SOURCE_SLUG}-${WEBSITE_POLICY_SOURCE_VERSION}`;

const WEBSITE_COMMUNITY_CONDUCT_RULES: CanonicalPolicyRule[] = [
  {
    id: "community.respectful_conduct",
    title: "Respectful conduct",
    description: "Harassment, discrimination, and degrading conduct are not allowed in studio or support channels.",
    severityHint: "high",
  },
  {
    id: "community.safety_first",
    title: "Safety first",
    description: "Unsafe interruptions, threats, or actions that endanger people or equipment require immediate escalation.",
    severityHint: "high",
  },
  {
    id: "community.shared_space_etiquette",
    title: "Shared-space etiquette",
    description: "Members are expected to keep shared spaces tidy and operate in ways compatible with studio workflow.",
    severityHint: "medium",
  },
  {
    id: "community.noise_tool_flow",
    title: "Noise and tool-flow compatibility",
    description: "Noise and tool usage should support cooperative studio flow and avoid disruptive interference.",
    severityHint: "medium",
  },
];

export function websiteCommunityConductFallbackPolicy(): CanonicalPolicyRecord {
  return {
    id: WEBSITE_POLICY_CANONICAL_VERSION,
    version: WEBSITE_POLICY_CANONICAL_VERSION,
    title: "Community conduct",
    summary: "Respect, safety, and shared-space etiquette are required across studio and support channels.",
    status: "published",
    sourceOfTruth: "website_policies",
    sourceSlug: WEBSITE_POLICY_SOURCE_SLUG,
    sourceVersion: WEBSITE_POLICY_SOURCE_VERSION,
    sourceUrl: WEBSITE_POLICY_SOURCE_URL,
    rules: WEBSITE_COMMUNITY_CONDUCT_RULES,
  };
}
