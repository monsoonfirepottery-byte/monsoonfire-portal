# Source-of-Truth Index

Date: 2026-02-18  
Owner: Platform

This file is the canonical registry for source-of-truth artifacts used by Epic-08 gates:
contract parity, deployment gates, smoke profiles, and mobile store-readiness checks.

## 1) Contract Sources

### API Contracts

| Domain | Authoritative Source | Derived/Validated By | Trust |
|---|---|---|---|
| Web API contract surface | `web/src/api/portalContracts.ts` | `scripts/source-of-truth-contract-matrix.mjs` | authoritative |
| Human-readable API doc | `docs/API_CONTRACTS.md` | `scripts/source-of-truth-contract-matrix.mjs` | derived |
| Legacy endpoint behavior | `functions/src/index.ts` + `functions/src/apiV1.ts` | `scripts/source-of-truth-contract-matrix.mjs` | authoritative |
| API docs/tests alignment | `functions/src/apiV1.ts` | `scripts/source-of-truth-contract-matrix.mjs` | authoritative |
| iOS API contract mirror | `ios/PortalContracts.swift` | `scripts/source-of-truth-contract-matrix.mjs` | derived |
| Android API contract mirror | `android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt` | `scripts/source-of-truth-contract-matrix.mjs` | derived |

### Deep Links

| Domain | Authoritative Source | Derived/Validated By | Trust |
|---|---|---|---|
| Mobile/web deep-link behavior | `docs/DEEP_LINK_CONTRACT.md` | `scripts/mobile-store-readiness-gate.mjs` | authoritative |
| iOS deep-link parser | `ios/DeepLinkRouter.swift` | `scripts/mobile-store-readiness-gate.mjs` | derived |
| Android deep-link parser | `android/app/src/main/java/com/monsoonfire/portal/reference/DeepLinkRouter.kt` | `scripts/mobile-store-readiness-gate.mjs` | derived |
| Host link associations | `website/.well-known/apple-app-site-association` | `scripts/validate-well-known.mjs` | authoritative |
| Android app links | `website/.well-known/assetlinks.json` | `scripts/validate-well-known.mjs` | authoritative |
| Android intent links | `android/app/src/main/AndroidManifest.xml` | `scripts/mobile-store-readiness-gate.mjs` | authoritative |

## 2) Deployment/Environment Sources

| Domain | Authoritative Source | Derived/Validated By | Trust |
|---|---|---|---|
| Deployment gate matrix definition | `scripts/source-of-truth-deployment-gate-matrix.json` | `scripts/source-of-truth-deployment-gates.mjs` | authoritative |
| CI smoke (staging) | `.github/workflows/ci-smoke.yml` | `scripts/source-of-truth-deployment-gates.mjs` | authoritative |
| Production portal smoke | `.github/workflows/portal-prod-smoke.yml` | `scripts/source-of-truth-deployment-gates.mjs` | authoritative |
| Production website smoke | `.github/workflows/website-prod-smoke.yml` | `scripts/source-of-truth-deployment-gates.mjs` | authoritative |
| iOS build gate | `.github/workflows/ios-build-gate.yml` | `scripts/source-of-truth-deployment-gates.mjs` | authoritative |
| iOS smoke gate | `.github/workflows/ios-macos-smoke.yml` | `scripts/source-of-truth-deployment-gates.mjs` | authoritative |
| Android compile gate | `.github/workflows/android-compile.yml` | `scripts/source-of-truth-deployment-gates.mjs` | authoritative |
| PR and cutover gate | `scripts/pr-gate.mjs`, `scripts/studio-cutover-gate.mjs` | `scripts/phased-smoke-gate.mjs` | authoritative |
| Emulator and host policy | `scripts/scan-studiobrain-host-contract.mjs`, `scripts/studio-network-profile.mjs`, `scripts/studiobrain-network-check.mjs` | `scripts/scan-studiobrain-host-contract.mjs`, `scripts/studiobrain-network-check.mjs` | authoritative |
| Vite/Firebase stack profile evidence | `scripts/studio-stack-profile-snapshot.mjs` | `docs/EMULATOR_RUNBOOK.md` | authoritative |
| Vite dev/proxy profile evidence | `web/vite.config.js`, `web/.env.local.example` | `scripts/studio-stack-profile-snapshot.mjs` | authoritative |
| Firebase emulator contract profile evidence | `web/.env.local.example`, `scripts/validate-emulator-contract.mjs`, `scripts/studio-stack-profile-snapshot.mjs` | `docs/EMULATOR_RUNBOOK.md` | authoritative |
| Website deploy target profile evidence | `website/scripts/deploy.mjs`, `website/scripts/serve.mjs` | `docs/EMULATOR_RUNBOOK.md` | authoritative |
| Network runtime contract and host state | `scripts/studiobrain-network-check.mjs`, `studio-brain/.env.network.profile`, `studio-brain/.env.local` | `scripts/studiobrain-network-check.mjs` | authoritative |

## 3) MCP & External Sources

| Domain | Authoritative Source | Derived/Validated By | Trust |
|---|---|---|---|
| Ubuntu server administration | `.codex/config.toml` (`mcp_servers.ubuntu*`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Ubuntu server administration | `.codex/config.toml` (`mcp_servers.ubuntuServerAdministrationReference`, `mcp_servers.ubuntuServerInstallationGuide`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Ubuntu server networking | `.codex/config.toml` (`mcp_servers.ubuntuNetworkingGuide`, `mcp_servers.ubuntuCloudInitGuide`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Ubuntu server lifecycle policy | `.codex/config.toml` (`mcp_servers.ubuntuSecurityGuide`, `mcp_servers.ubuntuSystemdGuide`, `mcp_servers.ubuntuBackupGuide`, `mcp_servers.ubuntuFirewallGuide`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Server operations tooling | `.codex/config.toml` (`mcp_servers.serverOperationsDocker`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Home automation (Home Assistant base/connectors) | `.codex/config.toml` (`mcp_servers.homeAssistantMcpServer`, `mcp_servers.homeAssistantMcpServerAi`, `mcp_servers.homeAssistantMcpCommunityServer`, `mcp_servers.homeAssistantMcpServerDocs`, `mcp_servers.homeAssistantMcpIntegration`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Home automation (Hubitat / cameras) | `.codex/config.toml` (`mcp_servers.hubitatMCP`, `mcp_servers.hubitatMakerAPI`, `mcp_servers.homeAssistantCameraIntegration`, `mcp_servers.homeAssistantOnvifIntegration`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Home automation vendor integrations | `.codex/config.toml` (`mcp_servers.homeAssistantStreamIntegration`, `mcp_servers.homeAssistantFFmpegIntegration`, `mcp_servers.homeAssistantAqaraIntegration`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Agent orchestration runtime | `.codex/config.toml` (`mcp_servers.agentOrchestrationKubernetes`, `mcp_servers.agentOrchestrationDocker`, `mcp_servers.agentOrchestrationAnsible`, `mcp_servers.agentOrchestrationJenkins`, `mcp_servers.agentOrchestrationNomad`, `mcp_servers.agentOrchestrationPodman`, `mcp_servers.serverOperationsAnsible`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Agent orchestration control-plane references | `.codex/config.toml` (`mcp_servers.agentOrchestrationKubernetesDocs`, `mcp_servers.agentOrchestrationDockerDocs`, `mcp_servers.agentOrchestrationDockerComposeDocs`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Apple Home / associated domains | `.codex/config.toml` (`mcp_servers.appleHomeDocumentation`, `mcp_servers.appleHomeKitAppStoreGuidance`, `mcp_servers.appleHomeAppSiteAssociation`, `mcp_servers.appleHomeKitAccess`, `mcp_servers.appleAssociatedDomains`) | `scripts/source-of-truth-index-audit.mjs` | advisory |
| Open-home ops/remote access docs | `.codex/config.toml` (`mcp_servers.serverOperationsSsh`) | `scripts/source-of-truth-index-audit.mjs` | advisory |

## 4) Evidence Evidence Bundle Outputs

| Phase/Profile | Artifact | Producer |
|---|---|---|
| Contract matrix | `output/source-of-truth-contract-matrix/latest.json` | `scripts/source-of-truth-contract-matrix.mjs` |
| Deployment matrix definition | `scripts/source-of-truth-deployment-gate-matrix.json` | `docs/SOURCE_OF_TRUTH_INDEX.md` |
| Deployment gates | `output/source-of-truth-deployment-gates/latest.json` | `scripts/source-of-truth-deployment-gates.mjs` |
| Well-known validation | `output/well-known/latest.json` | `scripts/validate-well-known.mjs` |
| Studio network contract runtime | `output/studio-network-check/latest.json`, `output/studio-network-check/pr-gate.json`, `output/studio-network-check/cutover-gate.json` | `scripts/studiobrain-network-check.mjs` |
| Store readiness | `output/mobile-store-readiness/latest.json` | `scripts/mobile-store-readiness-gate.mjs` |
| Phased smoke evidence | `output/phased-smoke-gate/latest.json`, `output/phased-smoke-gate/staging/*.json`, `output/phased-smoke-gate/beta/*.json`, `output/phased-smoke-gate/production/*.json`, `output/phased-smoke-gate/store-readiness/*.json` | `scripts/phased-smoke-gate.mjs` |
| PR gate | `artifacts/pr-gate.json` | `scripts/pr-gate.mjs` |
| Source-of-truth index audit | `output/source-of-truth-index-audit/latest.json` | `scripts/source-of-truth-index-audit.mjs` |
| Vite/Firebase stack profile snapshot | `output/studio-stack-profile/latest.json` | `scripts/studio-stack-profile-snapshot.mjs` |

## 5) Operator Runbooks

- `docs/EMULATOR_RUNBOOK.md` (environment profile and emulator contract assumptions)
- `docs/runbooks/PR_GATE.md`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
- `docs/IOS_RUNBOOK.md`

## 6) Gate Ownership

- `scripts/source-of-truth-contract-matrix.mjs`: Platform + API
- `scripts/source-of-truth-deployment-gates.mjs`: Platform + SRE + Release
- `scripts/phased-smoke-gate.mjs`: Platform + QA + Mobile
- `scripts/validate-well-known.mjs`: Mobile + Security
- `scripts/mobile-store-readiness-gate.mjs`: Mobile + Product
- `scripts/epic-hub.mjs`: Product + Ops Coordination
