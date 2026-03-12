export const AUTOMATION_LABELS = {
  automation: {
    name: "automation",
    color: "0e8a16",
    description: "Automated monitoring and remediation.",
  },
  portalQa: {
    name: "portal-qa",
    color: "0e8a16",
    description: "Portal QA automation",
  },
  infra: {
    name: "infra",
    color: "5319e7",
    description: "Infrastructure and operational controls.",
  },
  security: {
    name: "security",
    color: "d73a4a",
    description: "Security and credential hygiene.",
  },
  governance: {
    name: "governance-tuning",
    color: "ededed",
    description: "Governance tuning summaries and threshold proposals.",
  },
  codexReporting: {
    name: "epic:codex-reporting",
    color: "0e8a16",
    description: "Codex automation reporting",
  },
};

export const AUTOMATION_FAMILIES = {
  portalQa: {
    key: "portal-qa",
    preferredNumber: 116,
    title: "Portal QA Automation (Rolling)",
    marker: "automation-family:portal-qa",
    labels: [AUTOMATION_LABELS.automation, AUTOMATION_LABELS.portalQa],
    body:
      "Canonical rolling thread for portal QA automation. Use this issue for workflow failures, canary state changes, tuning snapshots, and digest updates.",
  },
  portalInfra: {
    key: "portal-infra",
    preferredNumber: 103,
    title: "Portal Infra and Security Guards (Rolling)",
    marker: "automation-family:portal-infra",
    labels: [AUTOMATION_LABELS.automation, AUTOMATION_LABELS.infra, AUTOMATION_LABELS.security],
    body:
      "Canonical rolling thread for portal infra and security guard automation. Use this issue for index, credential, and branch integrity updates.",
  },
  codexAutomation: {
    key: "codex-automation",
    preferredNumber: 84,
    title: "Codex Automation (Rolling)",
    marker: "automation-family:codex-automation",
    labels: [AUTOMATION_LABELS.automation, AUTOMATION_LABELS.codexReporting],
    body:
      "Canonical rolling thread for Codex automation reporting. Use this issue for improvement, interaction, PR-green, and backlog autopilot updates.",
  },
  governanceTuning: {
    key: "governance-tuning",
    preferredNumber: 309,
    title: "Governance Weekly Tuning (Rolling)",
    marker: "automation-family:governance-tuning",
    labels: [AUTOMATION_LABELS.governance],
    body:
      "Canonical rolling thread for weekly governance tuning summaries and threshold proposals.",
  },
};

export function buildAutomationFamilyBody(family) {
  return `${family.body}\n\n<!-- ${family.marker} -->\n`;
}

export function getAutomationFamily(key) {
  return Object.values(AUTOMATION_FAMILIES).find((family) => family.key === key) || null;
}

export function getWorkflowFailureFamilyKey(workflowName) {
  const value = String(workflowName || "").trim();
  if (
    /^(Portal Load Test|Smoke Tests|Lighthouse Audit|Portal Fixture Steward|Portal Daily Authenticated Canary|Portal Automation Health Daily|Portal Automation Weekly Digest)$/i.test(
      value
    )
  ) {
    return "portal-qa";
  }
  if (/^Governance Weekly Tuning$/i.test(value)) {
    return "governance-tuning";
  }
  return "";
}
