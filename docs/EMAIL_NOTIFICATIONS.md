# Email Notifications (Trigger Email Extension)

We use the Firebase **Trigger Email** extension by writing documents to the `mail` collection.
The extension is responsible for actually sending email.

## Install (recommended)
From repo root:

```bash
firebase ext:install firebase/firestore-send-email --project monsoonfire-portal \
  --params="MAIL_COLLECTION=mail,SMTP_CONNECTION_URI=<SMTP_URI>,DEFAULT_FROM=Monsoon Fire <studio@monsoonfire.com>"
```

Notes:
- `SMTP_CONNECTION_URI` is required by the extension (SMTP host/user/pass).
- `DEFAULT_FROM` should match a verified sender for your SMTP provider.
- The extension will watch `mail` for new docs and send email.

## Configuration Checklist
1. Confirm the extension instance exists in the Firebase Console.
2. Verify the `MAIL_COLLECTION` is `mail` (matches this repo).
3. Use a verified sender address.
4. Test by marking a firing as unloaded and confirming a mail doc appears.

## How the app writes emails
The notification job processor writes:
```
/mail/{hash(dedupeKey:email)} {
  to,
  message: { subject, text },
  data: { firingId, kilnId, firingType },
  createdAt
}
```

If you replace the extension with a different provider, keep the `mail` collection
or update `functions/src/notifications.ts`.

## SMS provider contract
SMS delivery is implemented in `functions/src/notifications.ts` with an explicit runtime mode:
- `NOTIFICATION_SMS_PROVIDER=disabled` (default, safe no-send)
- `NOTIFICATION_SMS_PROVIDER=mock` (deterministic CI/dev behavior, no external calls)
- `NOTIFICATION_SMS_PROVIDER=twilio` (live provider)

Required runtime variables for live Twilio sends:
- `NOTIFICATION_SMS_FROM_E164` (sender number, E.164 format)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

Optional mock runtime variable:
- `NOTIFICATION_SMS_MOCK_MODE=success|auth|provider_4xx|provider_5xx|network`

Phone lookup order for SMS:
1. Firebase Auth user phone (`adminAuth.getUser(uid).phoneNumber`)
2. Profile fallback fields (`profiles/{uid}.phoneE164`, `phone`, `mobilePhone`)

All SMS attempt telemetry is written to `notificationDeliveryAttempts` with:
- `channel: "sms"`
- provider metadata (`provider`, `providerCode`)
- hashed phone marker (`phoneHash`)
- optional fallback status fields when SMS hard-failure email fallback is triggered

## Recipient Routing Segments
Notification routing in `functions/src/notifications.ts` now supports audience segments:
- `members`: include only non-staff accounts.
- `staff`: include only staff accounts (`staff: true` claim or `roles` containing `staff`).
- `all`: include both.

Current kiln unload flow uses `members` by default, which prevents staff-only users from receiving member unload notifications.

Reservation notification flow now emits customer-facing jobs for:
- status transitions (`CONFIRMED`, `WAITLISTED`, `CANCELLED`)
- ETA/estimate window shifts
- ready-for-pickup (`loadStatus=loaded`)
- pickup/storage reminders (72h, 120h, 168h cadence after ready-for-pickup)
- delayed ETA follow-ups (12h initial reminder, then 24h cadence while still delayed)

Reservation sends respect both:
- `users/{uid}/prefs/notifications` global/channel toggles
- `profiles/{uid}.notifyReservations` (defaults to `true` when unset)

Fallback behavior:
- If recipient claim lookup fails, that user is treated as non-staff.
- If no eligible recipients remain after filtering, no jobs are queued for that segment.
- If SMS hard-fails with provider 4xx recipient errors (for example invalid/opted-out phone), email fallback is attempted in the same job.
- SMS throttling/network/provider 5xx failures remain retryable and do not auto-convert to hard-failure fallback.

## Push telemetry baseline
- Push-enabled jobs now emit telemetry docs in `notificationDeliveryAttempts`.
- Current reasons include:
  - `NO_ACTIVE_DEVICE_TOKENS`
  - `PUSH_PROVIDER_SENT`
  - `PUSH_PROVIDER_PARTIAL`
  - relay failure messages (when adapter send fails)
- APNs relay adapter requires `APNS_RELAY_URL` and `APNS_RELAY_KEY`.
- Invalid provider responses can deactivate tokens (for example `BadDeviceToken`, `Unregistered`).

## Reliability + Operations
- Notification jobs retry for retryable failure classes with exponential backoff (max 5 attempts).
- Non-retryable or exhausted jobs are copied to `notificationJobDeadLetters`.
- Delivery aggregate snapshot is written every 30 minutes to `notificationMetrics/delivery_24h`.
