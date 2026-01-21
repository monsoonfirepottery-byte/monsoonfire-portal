# Direct Messages Schema (Firestore)

Purpose: Model email-style "direct messages" with threading, headers, and read tracking.

## Collections

### users (live users list)
Document ID: user UID

Fields
- displayName: string (optional)
- email: string (optional)
- role: string (optional)
- isActive: boolean (optional, default true)
- photoURL: string (optional)
- updatedAt: Timestamp (optional)

Notes
- Used to populate recipient pickers.
- Client filters out the current user and users where isActive === false.

### directMessages (thread/inbox level)
Document ID: auto ID or support_<uid>

Fields
- subject: string (optional)
- kind: string ("direct" | "support" | custom)
- participantUids: string[] (required for inbox queries)
- lastMessagePreview: string (optional)
- lastMessageId: string (optional, RFC5322 Message-ID style)
- lastMessageAt: Timestamp (optional)
- lastSenderName: string (optional)
- lastSenderEmail: string | null (optional)
- lastReadAtByUid: map<string, Timestamp> (optional)
- references: string[] (optional, RFC5322 References chain)
- createdAt: Timestamp (optional)
- updatedAt: Timestamp (optional)

Notes
- Inbox query: where participantUids contains current uid, orderBy lastMessageAt desc.
- Avoid undefined: omit fields or use null (e.g., lastSenderEmail).

### directMessages/{threadId}/messages (email-style message docs)
Document ID: auto

Fields
- messageId: string (RFC5322 Message-ID format: `<uuid@monsoonfire.local>`)
- subject: string (optional)
- body: string (optional)
- fromUid: string (optional)
- fromName: string (optional)
- fromEmail: string | null (optional)
- replyToEmail: string | null (optional)
- toUids: string[] (optional)
- toEmails: string[] (optional)
- ccUids: string[] (optional)
- ccEmails: string[] (optional)
- bccUids: string[] (optional)
- bccEmails: string[] (optional)
- sentAt: Timestamp (optional)
- inReplyTo: string | null (optional, Message-ID)
- references: string[] (optional, Message-ID chain)

Notes
- Client reply uses inReplyTo + references to chain messages.
- sentAt is used for ordering (orderBy sentAt asc).

### announcements
Document ID: auto

Fields
- title: string (optional)
- body: string (optional)
- type: string (optional, e.g. "update" | "alert")
- createdAt: Timestamp (optional)
- pinned: boolean (optional)
- readBy: string[] (optional, user UIDs)
- ctaLabel: string (optional)
- ctaUrl: string (optional)

## Indexes
- directMessages: (participantUids array-contains) + orderBy lastMessageAt desc
- announcements: orderBy createdAt desc

## Security notes
- Clients must read only docs where participantUids contains their uid.
- Clients may write new threads/messages containing their uid and set their own lastReadAtByUid.
- Ensure writes disallow undefined values; prefer null or omit fields.

## Migration notes (threads -> directMessages)
- Existing data in `threads` will not show in the new inbox. Options:
  1) One-time migration script to copy `threads` docs into `directMessages`, mapping fields:
     - `title` -> `subject`
     - `memberUids` -> `participantUids`
     - `lastMessage` -> `lastMessagePreview`
     - `lastMessageAt` -> `lastMessageAt`
     - `lastSenderName` -> `lastSenderName`
     - `lastReadAtByUid` -> `lastReadAtByUid`
  2) Temporary fallback query in the UI to read `threads` if `directMessages` is empty.
- If migrating messages, copy `threads/{id}/messages` -> `directMessages/{id}/messages` and map:
  - `body` -> `body`
  - `senderUid` -> `fromUid`
  - `senderName` -> `fromName`
  - `createdAt` -> `sentAt`
- After migration, lock `threads` in rules to avoid drift.
