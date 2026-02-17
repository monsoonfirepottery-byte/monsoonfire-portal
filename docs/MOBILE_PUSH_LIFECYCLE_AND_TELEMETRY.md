# Mobile Push Lifecycle + Telemetry Contract

Date: 2026-02-12
Owner: Platform

## Scope
Defines deterministic push token lifecycle behavior for iOS/Android and telemetry fields required by backend alerting.

## Token lifecycle contract
- Register token on:
  - first app launch after auth session established
  - permission transition to authorized/provisional
  - APNs/FCM token refresh callback
  - app foreground when token hash differs from last submitted hash
- Unregister token on:
  - user sign-out
  - app detects provider invalidation (token_not_registered)
  - explicit user action: disable push in settings
- Retry submit/unregister when offline:
  - queue operation locally with `operationId` and `tokenHash`
  - exponential backoff: 5s, 30s, 2m, 10m, then every 30m
  - max retry window 24h, then mark `needs_attention`

## Required telemetry write shape
Collection: `notificationDeliveryAttempts`

Required fields:
- `attemptId` (string, deterministic/idempotent)
- `uid` (string)
- `platform` (`ios`|`android`|`web`)
- `provider` (`apns`|`fcm`)
- `tokenHash` (string, never raw token)
- `eventType` (`register`|`unregister`|`send`)
- `status` (`queued`|`sent`|`failed`|`deactivated`)
- `reasonCode` (normalized bucket)
- `providerErrorCode` (raw provider code when available)
- `attemptedAt` (timestamp)
- `requestId` (string)

## Reason code mapping
- APNs `BadDeviceToken`, FCM `messaging/invalid-registration-token` -> `token_invalid`
- APNs `Unregistered`, FCM `messaging/registration-token-not-registered` -> `token_not_registered`
- 5xx/provider unavailable -> `provider_5xx`
- network timeout/connection reset -> `network`
- auth credential failure -> `auth`
- unknown -> `unknown`

## Alert assumptions
- If `token_not_registered` spikes >3x weekly baseline, clients must be unregistering+re-registering within next foreground session.
- If `provider_5xx` exceeds 5% for 15m, on-call throttles non-critical sends and monitors retry drain.
- If `auth` >1% for 10m, rotate credentials and verify relay deployment.

## Client parity requirements
- iOS and Android MUST use same retry schedule, same reason bucket mapping, and same idempotency fields.
- Any platform-specific divergence requires runbook update before release.
