# Memoria Enhanced Motion QA

## Scope
- Portal app motion preference behavior (`profiles.uiEnhancedMotion` + `mf:enhancedMotion`).
- Theme/motion state attributes:
  - `html[data-portal-theme]`
  - `html[data-portal-motion]`

## Precedence Rules
1. First run default comes from runtime heuristics:
   - reduced defaults on mobile, save-data, or low-power device profiles.
2. Local user toggle persists to `localStorage` key `mf:enhancedMotion`.
3. Signed-in profile value (`profiles/{uid}.uiEnhancedMotion`) overrides local storage.
4. `prefers-reduced-motion: reduce` always wins in rendered mode (`data-portal-motion="reduced"`).

## Automated Checks
- Unit tests:
  - `web/src/theme/motionPreference.test.ts`
  - validates heuristic defaulting and final mode resolution.
- Accessibility smoke checks:
  - `npm --prefix web run a11y:smoke`
  - included in `.github/workflows/ci-smoke.yml`.

## Manual QA Matrix
- Non-macOS desktop environments:
  - Toggle Enhanced motion in Profile and verify immediate behavior change.
  - Reload and verify persistence.
- Narrow viewport (`<=720px`):
  - Verify first-run default is reduced unless user opts in.
- Reduced motion OS setting:
  - Enable `prefers-reduced-motion` and verify portal mode remains reduced.
- Signed-in sync:
  - Toggle in Profile, sign out/in, verify persisted profile value is respected.
- iOS Safari / simulator:
  - Validate same precedence and reduced-motion behavior once Xcode simulator tooling is available.
  - Known current environment limitation: iOS simulator execution is deferred.

## Firestore Rule Coverage
- `firestore.rules` permits `uiEnhancedMotion` as `bool | null` in profile writes.

## Exit Criteria
- No white screens or console runtime errors.
- Enhanced motion toggle updates UI without refresh.
- Persistence works across reloads and signed-in sessions.
