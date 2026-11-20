# v0.4.4 navigation audit

The supplied red-packet screen identifies a real shared-header defect. `window.Pipi.openPage` was an alias of `openModal`, which always rendered **取消**. `features.js` changed the button artwork after mounting only in `detailPage`. Transfer and red-packet flow pages bypassed that workaround and therefore inherited Cancel. This was a shell/API distinction error, not a red-packet-specific label.

`openPage` now declares Back and renders the existing chat back asset before mounting. `openModal` retains its explicit Cancel default. `data-navigation` records the distinction for testing; no translated title or CSS selector guesses whether a page is navigational. The back control uses the existing 23px artwork and a 44px hit region. Existing close callbacks and history handling retain the originating parent.

## Complete page call-site classification

| Call site | Entry and parent | Leading control |
| --- | --- | --- |
| `walletBalance` / `detailPage` | Wallet → balance | Back |
| `walletBills` / `detailPage` | Balance or wallet → bills | Back |
| `walletTransaction`, message summary / `detailPage` | Chat payment card → transfer/red-packet summary | Back |
| `walletTransaction`, accounting / `detailPage` | Bills or payment summary → accounting | Back |
| `walletTransfer`, recipient / `detailPage` | Balance → recipient selection | Back; this is a drill-down list within a flow |
| `walletTransfer`, payment / `openPage` | Chat → payment, or recipient list → payment | Back; leaves without sending and returns to its origin |
| `favoriteDetail` / `detailPage` | Favorites → saved item | Back; existing audio cleanup retained |
| `manageMoments` / `page` helper | Settings → Moments management | Back |
| `composeMoment`, previously `page` helper | Moments → new composition | Cancel; now explicitly calls `openModal` |

These are all `page`, `openPage`, and `detailPage` call sites in the two product scripts. The generic `page` helper now only serves Moments management. No navigation decision is based on whether a page happens to contain a form.

## Explicit cancel and close layers retained

| Family | Call sites | Reason |
| --- | --- | --- |
| Existing native-style field editors | Contact remark/tags, profile name/WeChat ID/region/signature, profile avatar | Editable draft plus explicit Save/Done; Cancel discards unsaved edits |
| Custom configuration/edit forms | Full profile, role create/edit, persona create/edit/binding, memory create/edit, proactive-message settings, provider preset | Draft editing with explicit submission; no new native evidence justifies replacing Cancel |
| Other forms and selections | Moment composition, generated-moment role selection, ledger create/edit, receipt recognition/draft confirmation, crop selection | Explicit cancelable composition, operation or selection |
| Destructive decisions | `confirmDialog`, backup restore confirmation, legacy fallback in `confirmDelete` | Cancel declines the pending operation |
| Overlay layers | `actionSheet`, top menu, bubble menu, photo lightbox, status picker/editor, recording/dictation cancellation | Existing Cancel, close artwork, mask or gesture is appropriate to that layer; never globally replaced |
| Transfer-description dialog | Note Cancel/Confirm, Escape | Cancel keeps the previously confirmed note and current amount; dismisses only the note layer |

Moments management → generated-moment selection now restores management on Cancel instead of dropping the parent when the child replaces the page shell. Its actual generation action is untouched.

Normal routed pages already use `header(...,{back:true})`, including chat info/search, contact information/settings, profile information, providers and Settings subpages. Their existing Back controls remain. Status creation deliberately keeps its existing close/cancel interaction.

## Verification scope

`tests/navigation044-scenarios.cjs` exercises actual pointer input on the rendered arrows, keyboard Escape and browser Back. It checks both payment types, the originating chat draft, exact wallet/message state remaining unchanged, recipient/balance/bill return chains, nested note cancellation, composition Cancel, same-DOM draft restoration after confirmation cancellation, and management restoration after generated-moment cancellation. It captures the rendered payment and cancellation states for visual inspection.

Syntax checks were run for both product scripts and the scenario file and passed. Execution/screenshot outcomes are recorded by the integrated headless verification, not predeclared here. Existing tests cover transaction-summary → bill → summary and favorites cleanup; those paths must remain in the full regression run.

The user's payment screenshot determines the visible arrow correction. Existing project references (`PAYMENTS-VISUAL-REVIEW.md`, `IOS-8080-REFERENCES.md`) explicitly do not establish a complete original iPhone WeChat 8.0.80 navigation specification. This audit therefore does not claim every retained Cancel or page geometry is pixel-verified against that version. No new source artwork or module was imported; the project's existing attributed back asset is reused.

## Independent adversarial review (2026-11-14)

The scenario now covers both wallet payment types through all three exits (arrow, Escape, browser Back), rather than only the red-packet recipient chain. Additional cases cover confirmation cancellation with Escape and browser Back, generated-moment selection cancellation with both inputs, and action-sheet/photo-layer cancellation with button, Escape and browser Back. Nested composition checks require the original form DOM and draft text to survive, not merely an equivalent page to reopen.

A missing history case was found by static tracing: the transfer-note native `<dialog>` originally had no distinct browser-history entry. Browser Back therefore reached the shared overlay `popstate` handler and closed the payment page, losing its amount and note draft. A regression now requires Back to dismiss only the note dialog, retain the previously confirmed note and amount, and leave the next payment Back available. This case must pass against the corresponding product fix; adding the scenario alone does not establish that the fix works.

The product fix introduces `openChildDialog` / `closeChildDialog`, a dedicated child history entry and a child-first `popstate` branch; transfer-note Cancel/Save and native dialog cancellation use that API. `tests/navigation044-offline.test.cjs` extracts the actual product functions and history listener and executes them with EventTarget and a minimal asynchronous History model. It also extracts the actual `showView` / `goBack` functions; only unrelated UI rendering and chat dependencies are stubbed. This is offline logic verification, not browser verification. The model verifies child-only Back, Cancel/Escape/Save/native close, a subsequent parent Back, repeated reopen and listener removal, forced parent close, queued view and queued Back. An added adversarial case exposed a pending-history race: closing the parent immediately after `closeChildDialog()` left the already closed parent's overlay entry active when the child traversal finished. The product now queues that remaining parent traversal and delays queued views and history waiters until it completes. Independent rerun: `node --test tests/navigation044-offline.test.cjs` passed all 12 cases, including the pending-parent race, queued-view history depth (no obsolete overlay or duplicate origin entry), and one-time waiter delivery after both traversals. Repeated reopen also checks that cancel/close listeners are removed. No browser test result is inferred from the model.

The shared nested-layer implementation was also reviewed for action sheets, confirmation dialogs and photo lightboxes, including Favorites > More > delete confirmation and Favorites > image. These explicitly capture/restore their parent DOM. Payment summary > accounting and bills > accounting use explicit origin callbacks; Favorites detail retains its audio-stop callback. Top and bubble menus use dismissible overlays; their action-to-child transition does not justify converting their close controls into page Back controls. This is a code-level audit, not browser or visual verification of those paths.

Validation in the restricted environment: `node --check tests/navigation044-scenarios.cjs` passed after the added cases. `node tests/headless-ui.cjs --only=navigation044` was attempted with the harness's separate headless profile and temporary server data. It stopped before setup with `Headless Chrome did not expose DevToolsActivePort` at `tests/headless-ui.cjs:79` (0 passed, 1 harness failure). The environment also blocks local sockets, as confirmed by the main verification. No browser interaction, screenshot result or new scenario pass is claimed. No production data or user browser was used, and no elevated retry was attempted. All new scenarios still require execution in an environment that permits the isolated harness.
