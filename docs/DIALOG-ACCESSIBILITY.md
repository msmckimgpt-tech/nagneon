# Dialog Accessibility & Season Start Guidance

Keyboard-accessible modal dialogs for the **settings** and **screen-selection**
modals, plus two small Season-start fixes. Scope was limited to `src/App.tsx`,
`src/Seasons.tsx`, a new `src/AccessibleDialog.tsx`, this doc, and the
`scripts/verify-dialog-accessibility.cjs` renderer test. No server, device,
login, or existing-test files were touched.

## `AccessibleDialog` (`src/AccessibleDialog.tsx`)

A small reusable wrapper that turns the two existing `.modal-backdrop / .modal`
blocks into proper dialogs. It reuses the existing CSS classes, so **no new
stylesheet was required** (`src/dialog.css` was deliberately not created).

What it provides:

- **Role & naming** — renders `role="dialog"` + `aria-modal="true"` on the
  `.modal` element, with `aria-labelledby` pointing at the dialog's `<h2>` and
  `aria-describedby` at its description `<p>`. Callers supply the element `id`s.
- **Initial focus** — on open, focus moves to the dialog container itself (a
  `tabIndex={-1}` element that carries the linked name), so assistive tech
  announces the dialog title/description. An optional `initialFocus` ref can
  override this.
- **Focus trap** — `Tab` / `Shift+Tab` are handled on the dialog's `keydown`.
  At the first/last tabbable (or the container) focus wraps to the opposite end;
  anything that would leave the dialog is pulled back in. The tabbable set is
  computed live (`querySelectorAll` of standard focusable selectors, filtered by
  `offsetParent !== null`) so conditionally-rendered controls are handled.
- **Escape** — closes via the `onClose` callback and stops propagation.
- **Background inert** — while any dialog is open, the app root (`#root`) gets
  both `inert` and `aria-hidden="true"`. The dialog is rendered through
  `createPortal(..., document.body)`, i.e. **outside** `#root`, so it stays
  interactive while everything behind it is removed from the tab order, the
  a11y tree, and pointer interaction. A module-level open-count guards against a
  second dialog prematurely re-enabling the background.
- **Focus return** — the element focused just before opening is remembered and
  re-focused on close. Ordering is important: the background is made
  interactive again *before* the focus is restored (focusing into an inert
  subtree is ignored by the browser).
- **Safe against disappearing triggers** — if the trigger was unmounted while
  the dialog was open (e.g. the login/onboarding flow replaced the whole shell),
  the restore is skipped (`isConnected` / `document.contains` guard, wrapped in
  `try/catch`); focus is simply left where the browser puts it. This is why the
  dialogs only live in the post-onboarding app shell and never fight the
  dynamic login/onboarding screens.

### App wiring (`src/App.tsx`)

- The **settings** modal and **screen-selection** modal now render through
  `AccessibleDialog`. Their titles/descriptions received stable `id`s
  (`settings-dialog-title/-desc`, `screen-dialog-title/-desc`).
- The icon-only close buttons (`<button class="icon"><X/></button>`) gained
  accessible names: `aria-label="방송 설정 창 닫기"` and
  `aria-label="화면 선택 창 닫기"`.
- Every settings control already had a real label — implicit (`<label>text
  <input/></label>`), explicit (`for`/`id` in the onboarding form), or
  `aria-label` (persona/game/discovery controls). The verification test asserts
  there are **zero** unlabeled controls, so this is now enforced, not assumed.

### Deliberately unchanged

- **Backdrop click does not close** the dialog — this matches the previous
  behaviour and avoids accidentally discarding an edited settings draft.
- No device, screen-capture, microphone, or account-login behaviour was altered.
  Dangerous actions are never auto-invoked.

## Season start guidance (`src/Seasons.tsx`)

1. **Compact hero title spacing.** In the compact hero, `.season-hero.compact
   h2 br { display:none }` collapsed `오늘의 방송이<br/>다음 …` into
   `방송이다음`. A space was added before the `<br/>` (`오늘의 방송이 <br/>…`);
   JSX preserves the inline trailing space, so compact renders `방송이 다음`
   while the full-width layout is unchanged. (seasons.css was out of scope, so
   the fix is in the component markup.)
2. **Rehearsal-mode notice.** When a season chapter is ready to start but the
   broadcast mode is not `live`, the `AI 방송 시작` button is disabled. A short
   `field-note` now explains *why* and *how to fix it* ("switch 방송 모드 to
   ‘실제 AI 관객 · ChatGPT 구독’ in 방송 설정"). No prop-shape change was needed —
   `state.settings.mode` was already available in `Seasons`.

## Verification

`scripts/verify-dialog-accessibility.cjs` launches Electron against an **isolated
temp profile** with a **synthetic model** and **stubbed capture sources**
(fabricated strings — `desktopCapturer` is never called). It drives the real
renderer and delivers real `Tab` / `Shift+Tab` / `Escape` through
`webContents.sendInputEvent` (keyDown/keyUp only — no synthetic `char`, which
would type a tab into a focused textarea).

Run (headless):

```
npm run build
xvfb-run -a npx electron scripts/verify-dialog-accessibility.cjs
```

Evidence is preserved at:

- `artifacts/claude-dialog-tests.log` — raw run output.
- `artifacts/dialog-accessibility-test.json` — structured pass/fail + check list.
- `artifacts/dialog-renderer-<ts>/settings-dialog.png`, `screen-dialog.png` —
  captured frames of each open dialog.

### What the test proves (all passing)

1. Onboarding guide is dismissed into the main shell (no device/login touched).
2. Settings dialog exposes `role`/`aria-modal`, linked title+description, a named
   close button, and is portaled outside `#root`.
3. Opening moves focus into the dialog container.
4. `#root` is `inert` + `aria-hidden` while open, and a background control
   genuinely cannot take focus.
5. Every settings input/select/textarea has an associated label (zero unlabeled).
6. `Tab` from the container enters at the close button.
7. `Tab` and `Shift+Tab` keep focus trapped across 24 presses each way.
8. `Tab`/`Shift+Tab` wrap correctly at both boundaries.
9. A **failed save** (injected 500 on `PUT /api/settings`) keeps the dialog open
   and preserves the edited draft.
10. A **successful save** closes the dialog, returns focus to the trigger, and
    re-enables the background.
11. Reopening shows the saved state; `Escape` closes and restores focus.
12. The **screen-selection** dialog exposes role/aria-modal, a linked title, a
    named close button, named source options, an inert background, and container
    focus.
13. The screen dialog traps `Tab`/`Shift+Tab`, closes on `Escape`, returns focus
    to its trigger, and re-enables the background.

### Known limitations / boundaries

- The focus trap reads `keydown` on the dialog element; a child that calls
  `stopPropagation()` on `keydown` could bypass it. None of the current dialog
  contents do this.
- `inert` relies on Chromium support (present in this Electron). In a browser
  that lacks `inert`, the JS focus trap + `aria-hidden` + the full-screen
  backdrop still block keyboard, AT, and pointer access to the background.
- The Seasons changes were verified by building and confirming the compiled
  markup (spaced title literal + rehearsal notice present) plus `tsc`/Vite
  type-checking; they are not exercised by the renderer test above, which is
  scoped to the two dialogs. The parent owns the full `check`/`package` run.
