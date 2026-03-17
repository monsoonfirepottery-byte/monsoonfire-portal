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
    preferredNumber: 350,
    title: "Portal QA Reliability (Rolling)",
    marker: "automation-family:portal-qa",
    labels: [AUTOMATION_LABELS.automation, AUTOMATION_LABELS.portalQa],
    body:
      "Primary rolling thread for portal QA automation and reliability coordination. Replaces legacy tracker #116 and collects workflow failures, canary state changes, tuning snapshots, and digest updates.",
  },
  portalInfra: {
    key: "portal-infra",
    preferredNumber: 349,
    title: "Portal Infra and Security Coordination (Rolling)",
    marker: "automation-family:portal-infra",
    labels: [AUTOMATION_LABELS.automation, AUTOMATION_LABELS.infra, AUTOMATION_LABELS.security],
    body:
      "Primary rolling thread for portal infra and security automation coordination. Replaces legacy tracker #103 and collects index, credential, and branch integrity updates.",
  },
  codexAutomation: {
    key: "codex-automation",
    preferredNumber: 348,
    title: "Codex Automation Coordination (Rolling)",
    marker: "automation-family:codex-automation",
    labels: [AUTOMATION_LABELS.automation, AUTOMATION_LABELS.codexReporting],
    body:
      "Primary rolling thread for Codex automation reporting and coordination. Replaces legacy tracker #84 and collects improvement, interaction, PR-green, and backlog autopilot updates.",
  },
  governanceTuning: {
    key: "governance-tuning",
    preferredNumber: 351,
    title: "Governance Tuning Coordination (Rolling)",
    marker: "automation-family:governance-tuning",
    labels: [AUTOMATION_LABELS.governance],
    body:
      "Primary rolling thread for weekly governance tuning coordination. Replaces legacy tracker #309 and collects threshold proposals, tuning summaries, and governance follow-through.",
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
