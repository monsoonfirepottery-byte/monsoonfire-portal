# Studio OS v3 Risk Register

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Legend
- Probability: Low / Medium / High
- Impact: Low / Medium / High

## Risks
1. Local state treated as source of truth  
   - Probability: Medium | Impact: High  
   - Mitigation: derived-state labeling + drift checks + rebuild drills

2. Agent acts outside delegated scope  
   - Probability: Medium | Impact: High  
   - Mitigation: strict delegation enforcement + owner binding + denial audits

3. Approval bypass through side-channel endpoint  
   - Probability: Low | Impact: High  
   - Mitigation: centralized policy middleware + kill switch + CI route audits

4. Secrets leak via logs/config dumps  
   - Probability: Medium | Impact: High  
   - Mitigation: config redaction + lint checks + startup secret scanner

5. Connector outage causes silent failures  
   - Probability: Medium | Impact: Medium  
   - Mitigation: health checks + circuit breaker + degraded mode UI

6. Physical connectors accidentally gain write powers  
   - Probability: Low | Impact: High  
   - Mitigation: read-only defaults + capability whitelist + explicit approval class

7. Replay attacks on write pilot endpoint  
   - Probability: Medium | Impact: High  
   - Mitigation: idempotency keys + nonce windows + audit trace checks

8. Quota/rate limits too loose under swarm load  
   - Probability: Medium | Impact: Medium  
   - Mitigation: per-actor and per-capability caps + adaptive throttles

9. Audit coverage gaps over time  
   - Probability: Medium | Impact: High  
   - Mitigation: deny-on-missing-audit hooks + governance lint

10. Manual review queue overload  
   - Probability: Medium | Impact: Medium  
   - Mitigation: risk tiering + SLA dashboards + staffing runbook

11. Legal/IP-compliance misses for agent requests  
   - Probability: Medium | Impact: High  
   - Mitigation: intake classification + mandatory review categories

12. Drift detector produces noisy false positives  
   - Probability: Medium | Impact: Medium  
   - Mitigation: threshold tuning + confidence scoring + suppress windows

13. DR playbook becomes stale  
   - Probability: Medium | Impact: High  
   - Mitigation: quarterly tabletop + owner assignment + drill artifacts

14. Multi-studio readiness introduces cross-tenant bleed risk  
   - Probability: Low | Impact: High  
   - Mitigation: tenant-scoped policies + explicit tenant context in every action

15. Team ships features without updated specs  
   - Probability: Medium | Impact: Medium  
   - Mitigation: CI policy lint and mandatory ADR metadata
