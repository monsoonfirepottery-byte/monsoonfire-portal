import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CUSTOMER_SERVICE_POLICY_DIR = path.join(
  ".governance",
  "customer-service-policies"
);
export const DEFAULT_POLICY_PROGRAM_PATH = path.join(
  DEFAULT_CUSTOMER_SERVICE_POLICY_DIR,
  "policy-program.json"
);
export const DEFAULT_POLICY_INVENTORY_PATH = path.join(
  DEFAULT_CUSTOMER_SERVICE_POLICY_DIR,
  "policy-inventory.json"
);
export const DEFAULT_POLICY_RESOLUTION_PATH = path.join(
  DEFAULT_CUSTOMER_SERVICE_POLICY_DIR,
  "policy-resolution-contract.json"
);

const DEFAULT_CONFIG_PATH = path.join(
  "docs",
  "policies",
  "customer-service-policy-program.config.json"
);
const DEFAULT_WEBSITE_FAQ_PATH = path.join("website", "data", "faq.json");
const DEFAULT_WEBSITE_ANNOUNCEMENTS_PATH = path.join("website", "data", "announcements.json");

const MUST_INCLUDE_REPLY_PARTS = [
  "resolved policy answer or current decision state",
  "missing required signals when the answer is incomplete",
  "explicit next step or escalation path",
];

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    )
  );
}

function stripHtml(value) {
  return normalizeText(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function slugifyFragment(value, fallback) {
  const fragment = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fragment || fallback;
}

function phraseVariants(value) {
  const phrase = normalizeText(value).toLowerCase();
  if (!phrase) return [];
  const words = phrase
    .split(/[^a-z0-9]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 4);
  return normalizeStringArray([phrase, ...words]);
}

function summarizeCounts(items) {
  const byKind = items.reduce((acc, item) => {
    const key = normalizeText(item.kind) || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return byKind;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function normalizeArtifact(record, fallback = {}) {
  return {
    id: normalizeText(record.id) || fallback.id,
    kind: normalizeText(record.kind) || fallback.kind || "derived-summary",
    title: normalizeText(record.title) || fallback.title || "Untitled artifact",
    sourcePath: normalizePath(record.sourcePath || fallback.sourcePath || ""),
    sourceType: normalizeOptionalText(record.sourceType || fallback.sourceType),
    summary: normalizeText(record.summary || fallback.summary || ""),
    policySlugs: normalizeStringArray(record.policySlugs || fallback.policySlugs || []),
    policyVersion: normalizeOptionalText(record.policyVersion || fallback.policyVersion),
    routingTerms: normalizeStringArray(record.routingTerms || fallback.routingTerms || []),
    notes: normalizeOptionalText(record.notes || fallback.notes),
    priority: normalizeOptionalText(record.priority || fallback.priority),
    observedPractice: normalizeOptionalText(record.observedPractice),
    canonicalConcern: normalizeOptionalText(record.canonicalConcern),
    discrepancyStatus: normalizeOptionalText(record.discrepancyStatus),
  };
}

function artifactAppliesToPolicy(artifact, policySlug) {
  return artifact.policySlugs.includes("*") || artifact.policySlugs.includes(policySlug);
}

function buildCanonicalArtifacts(policies) {
  return policies.map((policy) =>
    normalizeArtifact(
      {
        id: `canonical-policy:${policy.slug}`,
        kind: "canonical",
        title: policy.title,
        sourcePath: path.join("docs", "policies", `${policy.slug}.md`),
        sourceType: "canonical_summary",
        summary: policy.summary,
        policySlugs: [policy.slug],
        policyVersion: policy.version,
        routingTerms: normalizeStringArray([
          ...phraseVariants(policy.slug.replaceAll("-", " ")),
          ...phraseVariants(policy.title),
          ...phraseVariants(policy.summary),
          ...(policy.tags || []),
        ]),
      },
      {}
    )
  );
}

function buildWebsiteFaqArtifacts(websiteFaq) {
  const entries = Array.isArray(websiteFaq) ? websiteFaq : [];
  const itemArtifacts = entries.map((entry, index) =>
    normalizeArtifact(
      {
        id: `website-faq:${slugifyFragment(entry?.question, String(index + 1))}`,
        kind: "derived-summary",
        title: normalizeText(entry?.question) || `FAQ ${index + 1}`,
        sourcePath: DEFAULT_WEBSITE_FAQ_PATH,
        sourceType: normalizeOptionalText(entry?.sourceType) || "operational_faq",
        summary: stripHtml(entry?.answer),
        policySlugs: normalizeOptionalText(entry?.policySlug) ? [entry.policySlug] : [],
        policyVersion: normalizeOptionalText(entry?.policyVersion),
        routingTerms: normalizeStringArray([
          ...phraseVariants(entry?.question),
          ...normalizeStringArray(entry?.tags || []),
        ]),
      },
      {}
    )
  );

  const linkedSlugs = normalizeStringArray(
    itemArtifacts.flatMap((artifact) => artifact.policySlugs)
  );

  return [
    normalizeArtifact({
      id: "website-faq-feed",
      kind: "derived-summary",
      title: "Website public FAQ feed",
      sourcePath: DEFAULT_WEBSITE_FAQ_PATH,
      sourceType: "operational_faq",
      summary: "Public FAQ entries surfaced on the website for studio, kiln, billing, and access questions.",
      policySlugs: linkedSlugs,
      routingTerms: [],
    }),
    ...itemArtifacts,
  ];
}

function buildAnnouncementArtifacts(announcementsPayload, config) {
  const items = Array.isArray(announcementsPayload?.items) ? announcementsPayload.items : [];
  const linkById = new Map(
    normalizeStringArray(config.announcementLinks ? config.announcementLinks.map((entry) => entry.announcementId) : [])
      .map((id) => [id, config.announcementLinks.find((entry) => entry.announcementId === id)])
  );

  const itemArtifacts = items.map((item, index) => {
    const link = linkById.get(item?.id) || null;
    return normalizeArtifact(
      {
        id: normalizeText(link?.id) || `announcement:${slugifyFragment(item?.id, String(index + 1))}`,
        kind: "announcement",
        title: normalizeText(item?.title) || `Announcement ${index + 1}`,
        sourcePath:
          normalizePath(link?.sourcePath) ||
          normalizePath(path.join("marketing", "announcements", `${item?.sourceId || item?.id}.json`)),
        sourceType: normalizeOptionalText(link?.sourceType) || "announcement_summary",
        summary: normalizeText(item?.summary),
        policySlugs: normalizeStringArray(link?.policySlugs || []),
        policyVersion: normalizeOptionalText(link?.policyVersion),
        routingTerms: normalizeStringArray([
          ...phraseVariants(item?.title),
          ...phraseVariants(item?.summary),
          ...normalizeStringArray(link?.routingTerms || []),
        ]),
      },
      {}
    );
  });

  const linkedSlugs = normalizeStringArray(
    itemArtifacts.flatMap((artifact) => artifact.policySlugs)
  );

  return [
    normalizeArtifact({
      id: "website-announcements-feed",
      kind: "announcement",
      title: "Website public announcements feed",
      sourcePath: DEFAULT_WEBSITE_ANNOUNCEMENTS_PATH,
      sourceType: "announcement_summary",
      summary: "Current public announcements used for broad policy reminders and studio-wide updates.",
      policySlugs: linkedSlugs,
      routingTerms: [],
    }),
    ...itemArtifacts,
  ];
}

function buildPracticeEvidenceArtifacts(config) {
  return (Array.isArray(config.practiceEvidence) ? config.practiceEvidence : []).map((entry, index) =>
    normalizeArtifact(
      {
        id: normalizeText(entry?.id) || `practice-evidence:${index + 1}`,
        kind: "practice-evidence",
        title: normalizeText(entry?.title) || `Practice evidence ${index + 1}`,
        sourcePath: normalizePath(entry?.sourcePath || ""),
        sourceType: normalizeOptionalText(entry?.sourceType) || "customer-facing-support",
        summary: normalizeText(entry?.summary),
        policySlugs: normalizeStringArray(entry?.policySlugs || []),
        routingTerms: normalizeStringArray([
          ...phraseVariants(entry?.title),
          ...normalizeStringArray(entry?.routingTerms || []),
        ]),
        priority: entry?.priority,
        observedPractice: entry?.observedPractice,
        canonicalConcern: entry?.canonicalConcern,
        discrepancyStatus: entry?.discrepancyStatus || "needs_reconciliation",
      },
      {}
    )
  );
}

function buildConfigArtifacts(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry, index) =>
    normalizeArtifact(
      {
        ...entry,
        id: normalizeText(entry?.id) || `artifact:${index + 1}`,
      },
      {}
    )
  );
}

function assertReviewOrder(reviewOrder, policies) {
  const slugs = new Set(policies.map((policy) => policy.slug));
  const missing = [...slugs].filter((slug) => !reviewOrder.includes(slug));
  if (missing.length > 0) {
    throw new Error(`Policy review order is missing slugs: ${missing.join(", ")}`);
  }
}

function sortArtifacts(items) {
  return [...items].sort((left, right) => {
    const kindCompare = String(left.kind).localeCompare(String(right.kind));
    if (kindCompare !== 0) return kindCompare;
    return String(left.id).localeCompare(String(right.id));
  });
}

function buildDiscrepancyRegister(practiceEvidenceArtifacts) {
  const rows = [];
  for (const artifact of practiceEvidenceArtifacts) {
    if (artifact.discrepancyStatus !== "needs_reconciliation") continue;
    for (const policySlug of artifact.policySlugs) {
      rows.push({
        id: `discrepancy:${policySlug}:${artifact.id}`,
        policySlug,
        status: "needs_reconciliation",
        evidenceId: artifact.id,
        title: artifact.title,
        sourcePath: artifact.sourcePath,
        sourceType: artifact.sourceType,
        observedPractice: artifact.observedPractice,
        canonicalConcern: artifact.canonicalConcern,
        priority: artifact.priority,
      });
    }
  }
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

function buildSourceSurfacesForPolicy(policy, inventoryArtifacts) {
  return inventoryArtifacts
    .filter((artifact) => artifactAppliesToPolicy(artifact, policy.slug))
    .map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      sourcePath: artifact.sourcePath,
      sourceType: artifact.sourceType,
      policyVersion: artifact.policyVersion,
      summary: artifact.summary,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildRoutingTerms(policy, inventoryArtifacts, config) {
  const aliasTerms =
    (Array.isArray(config.policyAliases) ? config.policyAliases : []).find(
      (entry) => entry?.policySlug === policy.slug
    )?.terms || [];
  const relatedArtifacts = inventoryArtifacts.filter((artifact) => artifactAppliesToPolicy(artifact, policy.slug));
  return normalizeStringArray([
    ...phraseVariants(policy.slug.replaceAll("-", " ")),
    ...phraseVariants(policy.title),
    ...phraseVariants(policy.summary),
    ...normalizeStringArray(policy.tags || []),
    ...normalizeStringArray(aliasTerms).flatMap((term) => phraseVariants(term)),
    ...relatedArtifacts.flatMap((artifact) =>
      normalizeStringArray(artifact.routingTerms || []).flatMap((term) => phraseVariants(term))
    ),
  ]);
}

function buildPolicyProgramPolicies(policies, inventoryArtifacts, discrepancyRegister, config) {
  const bySlug = new Map(policies.map((policy) => [policy.slug, policy]));
  const reviewOrder = Array.isArray(config.reviewOrder) ? config.reviewOrder : [];
  const orderedPolicies = reviewOrder
    .map((slug) => bySlug.get(slug))
    .filter(Boolean);

  return orderedPolicies.map((policy) => {
    const linkedEvidenceIds = inventoryArtifacts
      .filter((artifact) => artifact.kind === "practice-evidence" && artifact.policySlugs.includes(policy.slug))
      .map((artifact) => artifact.id)
      .sort();
    const discrepancyStatus = discrepancyRegister.some((row) => row.policySlug === policy.slug)
      ? "needs_reconciliation"
      : "clear";

    return {
      slug: policy.slug,
      title: policy.title,
      version: policy.version,
      owner: policy.owner,
      status: policy.status,
      effectiveDate: policy.effectiveDate,
      reviewDate: policy.reviewDate,
      summary: policy.summary,
      decisionDomain: policy.agent?.decisionDomain || "",
      defaultActions: normalizeStringArray(policy.agent?.defaultActions || []),
      requiredSignals: normalizeStringArray(policy.agent?.requiredSignals || []),
      escalateWhen: normalizeStringArray(policy.agent?.escalateWhen || []),
      replyTemplate: normalizeText(policy.agent?.replyTemplate || ""),
      allowedLowRiskActions: normalizeStringArray(policy.agent?.allowedLowRiskActions || []),
      blockedActions: normalizeStringArray(policy.agent?.blockedActions || []),
      routingTerms: buildRoutingTerms(policy, inventoryArtifacts, config),
      sourceSurfaces: buildSourceSurfacesForPolicy(policy, inventoryArtifacts),
      discrepancyStatus,
      linkedEvidenceIds,
    };
  });
}

function buildPolicyResolutionContract(programPolicies, config) {
  return {
    schemaVersion: "customer-service-policy-resolution.v1",
    generatedAt: null,
    authority: {
      allowed: normalizeStringArray(config.authority?.allowed || []),
      blocked: normalizeStringArray(config.authority?.blocked || []),
      conflictHandling: normalizeText(config.authority?.conflictHandling || ""),
    },
    intents: programPolicies.map((policy) => ({
      intentId: `support.policy.${policy.slug}`,
      label: policy.title,
      policySlugs: [policy.slug],
      policyVersion: policy.version,
      matchTerms: policy.routingTerms,
      requiredSignals: policy.requiredSignals,
      escalateWhen: policy.escalateWhen,
      approvedReplyShape: {
        style: "policy-first",
        template: policy.replyTemplate,
        mustInclude: [...MUST_INCLUDE_REPLY_PARTS],
      },
      allowedLowRiskActions: policy.allowedLowRiskActions,
      blockedActions: normalizeStringArray([
        ...policy.blockedActions,
        ...normalizeStringArray(config.authority?.blocked || []),
      ]),
      discrepancyStatus: policy.discrepancyStatus,
    })),
  };
}

export async function buildCustomerServicePolicyArtifacts({
  repoRoot,
  policies,
  generatedAt,
}) {
  const configPath = path.join(repoRoot, DEFAULT_CONFIG_PATH);
  const websiteFaqPath = path.join(repoRoot, DEFAULT_WEBSITE_FAQ_PATH);
  const websiteAnnouncementsPath = path.join(repoRoot, DEFAULT_WEBSITE_ANNOUNCEMENTS_PATH);
  const config = await readJson(configPath);
  const websiteFaq = await readJson(websiteFaqPath);
  const websiteAnnouncements = await readJson(websiteAnnouncementsPath);

  assertReviewOrder(normalizeStringArray(config.reviewOrder || []), policies);

  const inventoryArtifacts = sortArtifacts([
    ...buildCanonicalArtifacts(policies),
    ...buildConfigArtifacts(config.artifactSurfaces),
    ...buildWebsiteFaqArtifacts(websiteFaq),
    ...buildConfigArtifacts(config.portalFaqFallbackLinks),
    ...buildConfigArtifacts(config.portalFaqSeedLinks),
    ...buildAnnouncementArtifacts(websiteAnnouncements, config),
    ...buildPracticeEvidenceArtifacts(config),
  ]);

  const discrepancyRegister = buildDiscrepancyRegister(
    inventoryArtifacts.filter((artifact) => artifact.kind === "practice-evidence")
  );
  const programPolicies = buildPolicyProgramPolicies(
    policies,
    inventoryArtifacts,
    discrepancyRegister,
    config
  );

  const programPayload = {
    schemaVersion: "customer-service-policy-program.v1",
    generatedAt,
    canonicalSource: "docs/policies/*.md",
    reviewOrder: normalizeStringArray(config.reviewOrder || []),
    authority: {
      allowed: normalizeStringArray(config.authority?.allowed || []),
      blocked: normalizeStringArray(config.authority?.blocked || []),
      conflictHandling: normalizeText(config.authority?.conflictHandling || ""),
    },
    policies: programPolicies,
  };

  const inventoryPayload = {
    schemaVersion: "customer-service-policy-inventory.v1",
    generatedAt,
    reviewOrder: normalizeStringArray(config.reviewOrder || []),
    summary: {
      policyCount: programPolicies.length,
      artifactCount: inventoryArtifacts.length,
      discrepancyCount: discrepancyRegister.length,
      byKind: summarizeCounts(inventoryArtifacts),
    },
    artifacts: inventoryArtifacts,
    discrepancyRegister,
  };

  const resolutionPayload = buildPolicyResolutionContract(programPolicies, config);
  resolutionPayload.generatedAt = generatedAt;

  return {
    programPayload,
    inventoryPayload,
    resolutionPayload,
  };
}

export async function writeCustomerServicePolicyArtifacts(artifacts, options = {}) {
  const repoRoot = options.repoRoot;
  const programPath = path.join(repoRoot, DEFAULT_POLICY_PROGRAM_PATH);
  const inventoryPath = path.join(repoRoot, DEFAULT_POLICY_INVENTORY_PATH);
  const resolutionPath = path.join(repoRoot, DEFAULT_POLICY_RESOLUTION_PATH);

  await fs.mkdir(path.dirname(programPath), { recursive: true });
  await fs.writeFile(programPath, `${JSON.stringify(artifacts.programPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(
    inventoryPath,
    `${JSON.stringify(artifacts.inventoryPayload, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    resolutionPath,
    `${JSON.stringify(artifacts.resolutionPayload, null, 2)}\n`,
    "utf8"
  );

  return {
    programPath,
    inventoryPath,
    resolutionPath,
  };
}
