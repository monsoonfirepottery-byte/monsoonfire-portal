# Portal QA Loop - Non-Staff Pages

## Goal
Gate deployments on a consistent non-staff QA loop that covers:
- smoke behavior
- functionality behavior
- user experience quality

Staff console is intentionally excluded from this loop.

## Preconditions
- The QA account used for gate commands must have at least one document in `users/{uid}/notifications` so mark-read authz can be exercised.

## Required Gate Commands
1. `npm run portal:regression:virtual-staff:prod -- --skip-ui-smoke --json`
2. `npm run portal:smoke:playwright -- --base-url https://portal.monsoonfire.com --with-auth --staff-email "$PORTAL_STAFF_EMAIL" --staff-password "$PORTAL_STAFF_PASSWORD" --output-dir output/playwright/portal/qa-loop`

`portal:regression:virtual-staff:prod` must pass:
- Firestore rules release drift check
- Pricing + intake policy check
- My Pieces authz probe
- Notifications mark-read authz probe

Optional deep probe:
1. `npm run portal:smoke:playwright -- --base-url https://portal.monsoonfire.com --deep --with-auth --staff-email "$PORTAL_STAFF_EMAIL" --staff-password "$PORTAL_STAFF_PASSWORD" --output-dir output/playwright/portal/qa-loop-deep`

## Benchmarks
### Smoke benchmark
- Route loads without crash/blank screen.
- No blocking inline failure state.
- No uncaught runtime exception.

### Functionality benchmark
- Primary action on each page is clickable and produces expected state change.
- API-backed data regions load or present a stable partial/empty state.
- Auth-protected regions do not show unauthorized errors for valid users.

### UX benchmark
- Text contrast remains readable in both `portal` and `memoria` themes.
- Loading and error copy is stable (no flashing or bounce loops).
- Interaction latency feels responsive (no obvious stuck controls).
- Automated consistency checks must execute both themes each run (light + dark) for dashboard baseline.

## Page Matrix (Non-Staff)
| Area | Route/View | Smoke check | Functionality check | UX check |
| --- | --- | --- | --- | --- |
| Dashboard | `dashboard` | Hero and cards render | `Open My Pieces` and `Message the studio` nav actions work | Studio updates and chiplets are legible in both themes |
| Kiln Rentals | `kilnRentals` | Overview card renders | Primary CTA opens check-in/queue flow | Queue labels readable on mobile and desktop |
| Ware Check-in | `reservations` | Form renders | Submit-path validation + success path for shelf purchase, whole kiln, and community shelf (including two-step confirm/cancel) | Field errors are readable and anchored near inputs |
| View the Queues | `kilnLaunch` | Queue lane loads | Filter/tab switches update content | Queue status colors and labels remain clear |
| Firings | `kiln` | Schedule view renders | Refresh/filter controls update timeline | Timeline remains readable with no overlapping text |
| Studio Resources | `studioResources` | Overview renders | Step buttons navigate to target views | Step cards retain readable hierarchy |
| My Pieces | `pieces` | List/detail shell renders | Piece list + piece detail tabs load | No `Pieces failed` blocking error; diagnostics readable |
| Glaze Board | `glazes` | Board loads | Save/apply combo interaction works | Swatches and labels remain readable in dark theme |
| Store | `materials` | Product list renders | Add/select workflow updates cart state | Prices and call-to-action controls are clear |
| Membership | `membership` | Plan cards render | Primary action opens next flow | Plan comparison copy is readable and scannable |
| Requests | `requests` | Requests list/form renders | Create request path succeeds | Success/error banners are stable and clear |
| Billing | `billing` | Billing summary renders | Payment/intents actions handle expected responses | Financial labels and totals are high-contrast |
| Community | `community` | Community overview renders | Feed/report controls respond | Moderation/report affordances are clear |
| Workshops | `events` | Event cards render | RSVP state toggles correctly | Capacity/waitlist labels remain readable |
| Lending Library | `lendingLibrary` | Listing renders | Borrow/request action updates state | Availability status chips are readable |
| Notifications | `notifications` | Notification stream renders | Mark-as-read/read transitions work and do not show `Mark read failed: Missing or insufficient permissions.` | Read/unread differentiation is obvious |
| Messages | `messages` | Inbox + announcements render | Thread open/reply flow works | No index/permission blocker; message hierarchy is clear |
| Support | `support` | Support page renders | Submit support request path works | Confirmation/error copy is stable and readable |

## Release Rule
A deploy is considered successful only when:
1. Gate commands pass.
2. No P1/P2 regressions remain in non-staff pages.
3. UX benchmark is met for both themes.
