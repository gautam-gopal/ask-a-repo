# Design conventions

Light theme only. Plain CSS. All values live in `src/styles/tokens.css`; use variables, never raw hex, px font sizes or inline `style` (the CSP blocks inline styles). System fonts only.

## Tokens

- **Surfaces:** page `--color-bg` (off-white), cards `--color-surface` (white), hover/tracks `--color-surface-muted`, lines `--color-border`, input/outline-button borders `--color-border-control` (3:1).
- **Text:** `--color-text`, `--color-text-secondary`, `--color-text-muted`. All pass AA on white.
- **One accent:** `--color-accent` (+ `-hover`, `-active`, `-subtle`, `-subtle-border`). Use for primary buttons, links, focus, selected state, the indexing badge. Nothing else is coloured.
- **Status colours** (`success`, `warning`, `danger`, `neutral`; each has `-text`, `-bg`, `-border`): badges and alerts only. Status is always text plus colour.
- **Type:** `--text-xs..3xl` = 12, 13, 14, 15 (body), 16, 18, 22, 28px. Weights 400, 500, 600. Reading text uses `--leading-relaxed` (1.6) and `--measure` (75ch).
- **Space:** `--space-1..16`, 4px steps. **Radii:** `sm` 4 (badges, chips), `md` 6 (controls), `lg` 8 (cards); `pill` only for the Demo pill.
- **Depth:** `--shadow-1` (cards), `--shadow-2` (auth card, menus). **Focus:** global `:focus-visible` 2px accent outline, 2px offset.
- **Layout:** `--page-max` 1200px, `--page-reading` 800px (chat), `--page-gutter` 16px (24px from 640px).

## Components

- **Buttons:** `.btn` primary (a bare `<button>` is primary too), `.btn-secondary`, `.btn-ghost`, `.btn-danger`; sizes `.btn-sm`, `.btn-lg`; `.btn-block`. Loading: `aria-busy="true"` (spinner appears), also set `disabled`. Inline text action: `<button class="link">`. Mobile and touch: 44px minimum (36px for `.btn-sm`). Use `<Link className="btn">` for navigation.
- **Inputs:** `<div class="field">` with `<label class="field__label" htmlFor>`, the input, optional `.field__hint`, and `.field__error` (`id` linked with `aria-describedby`; set `aria-invalid="true"` on the input). Mobile inputs are 16px.
- **Badges:** `.badge` plus `.badge-queued | -indexing | -ready | -failed`. Always contains the status word.
- **Alerts:** `<Alert variant="info|warning|error|success" role>`; `ErrorMessage` is the error alert. Page-wide: `.banner` (warning, waking) and `.notice-bar` (info, demo).
- **Cards:** `.card` for forms and panels; `.repo-card` inside `.repo-grid` for list items. No hover lift.
- **Page:** `.page` (1200px) or `.page--reading` (chat). Start every page with `<PageHeader title subtitle>`; sections use `.section-title`. Empty: `<EmptyState title>`; loading: `.state` with `<Spinner />`.
- **Progress:** native `<progress class="progress">`; omit `value` for indeterminate.
- **Accessibility:** real buttons and links, a label for every input, never colour alone, motion is minimal and honours `prefers-reduced-motion`.
