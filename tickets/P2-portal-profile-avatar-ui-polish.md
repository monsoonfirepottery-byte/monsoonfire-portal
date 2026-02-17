# P2 — Profile Avatar UI Polish

Status: Completed

Date: 2026-02-17

Problem
- Sidebar/profile affordances intermittently read as non-actionable by users:
  - Profile affordance fallback does not show a consistent profile glyph.
  - Button text alignment in avatar and action controls feels off in some theme states.

Scope
- `web/src/App.tsx`
- `web/src/App.css`
- `web/src/views/ProfileView.tsx`
- `web/src/views/ProfileView.css`

Acceptance
- Use a consistent profile glyph fallback when avatar image URL fails (profile sidebar + profile page preview).
- Keep profile/logout controls visually obvious and clickability clear in both default and Memoria themes.
- Ensure action button text alignment is centered and consistent across normal and reduced-motion variants.
- No inline style objects for newly introduced styling.

Notes
- Prefer shared icon primitives so the fallback can be reused in nav + profile page without data-uri dependency.

Completion notes (2026-02-17)
- Profile fallback glyph is now consistently used in `ProfileView` preview error state.
- Avatar action buttons were tightened for centered, consistent label alignment in `web/src/views/ProfileView.css`.
- Existing sidebar/profile fallback path in `web/src/App.tsx` and `web/src/App.css` remains intact with shared default avatar behavior.
