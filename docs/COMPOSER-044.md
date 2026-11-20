# Composer 0.4.4 independent review

Date: 2026-11-14. Scope: rich composer implementation in `public/app.js`, `public/composer.css`, and `public/emoji.js`.

## Executed evidence

`node tests/composer044-scenarios.cjs --offline` passes 12 checks. The tests extract actual product functions and event callbacks, then execute them in a Node VM with minimal DOM-shaped nodes and explicit state fixtures:

- Middle insertion / selection replacement, atomic token deletion, Unicode family grapheme deletion, composition guard, token and newline serialization.
- `historyUndo` and `historyRedo` restore token text and caret; ordinary insertion records its prior state.
- Actual composition start/end callbacks create one undo unit; undo/redo restore pre/post-composition text and caret.
- New edits invalidate redo; histories remain scoped to each role; sending blocks undo restoration.
- Actual accepted-send cleanup block clears history for the matching sent draft, preserves another role and a newer draft, and preserves history when the send was not accepted.

The first review reproduced three failures: undo/redo callbacks were unhandled and ordinary insertion did not record history. These regressions now pass after the product fix.

## Browser coverage prepared, not executed

`node tests/composer044-scenarios.cjs` reuses the existing headless harness in memory without editing it. It creates a separate temporary account, data directory, and Chrome profile. The attempted run failed before setup because Chrome did not create `DevToolsActivePort`; zero browser scenarios executed. No elevation or alternate browser attachment was attempted.

Prepared browser scenarios cover visible sprite rendering, mixed text and tokens, middle insertion, forward/backward deletion, selection replacement, consecutive pointer clicks, browser text insertion, CDP composition, route draft restoration, paste, and Ctrl+Z.

## Limits

The offline VM does not implement browser editing, Selection/Range, native undo, layout, persistence, or operating-system IME. In the ordinary-input test the post-edit state is assigned explicitly; composition callbacks use stubbed DOM reads and frame scheduling. Send cleanup is exercised as the actual isolated cleanup block, not an end-to-end server send. These passes must not be reported as browser, visual, mobile keyboard, or OS IME acceptance. Actual selection after blur and mobile keyboard behavior remain unverified. No additional reproducible blocking defect was established within the offline scope.
