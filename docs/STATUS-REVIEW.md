# Me status: scope, sources and checks

Review date: 2026-11-14. The requested final target is the user's iPhone WeChat 8.0.80. No user screenshot of the status pages has been supplied. This implementation does not claim a pixel-accurate 8.0.80 reproduction.

## Search before implementation

GitHub repository searches for `wechat status web UI 微信 状态` and `wechat vue status` returned no usable module. A code search for `状态` within `LiangNiang/fake-world` found status-bar metadata, transaction states and generic state code, but no personal-status workflow. The already-integrated `LiangNiang/fake-world` GPL-3.0-only icon set and this application's existing modal/route/action helpers are reused with their existing attribution. No unlicensed source or proprietary status artwork was copied.

Local references were checked: `docs/IOS-8080-REFERENCES.md` and the existing `reference-v04/IMG_0463.PNG` concern the chat composer; `reference-v05/research/` contains App Store/chat/voice research rather than the user's status-page reference. These do not establish native status geometry.

## Visible structural reference

The iOS 8.0 tutorial at <https://m.i4.cn/article/45767.html> was opened and its linked picker/editor screenshots were downloaded and visually inspected, outside the release tree:

- Picker: <https://d-image.i4.cn/i4web/image/upload/20210129/1611902957248088505.png>, local research copy `../../参考资料/reference-v042/research/ios80-status-picker.png`.
- Editor: <https://d-image.i4.cn/i4web/image/upload/20210129/1611903106460084836.png>, local research copy `../../参考资料/reference-v042/research/ios80-status-editor.png`.

The picker visibly has a dark gradient, centered title, separate category headings, and three-column square icon tiles. The editor visibly has a colored background, top-left dismissal, status glyph and label near the top, large white description text, and a green bottom-right “就这样” button. Those page relationships and composition inform this implementation. Its icons, exact colors, font sizes and curated status list are implementation choices rather than verified 8.0.80 assets or measurements.

The contemporaneous report <https://www.ifanr.com/1397320> independently documents the Me entry below the WeChat ID and selecting a status before editing a description. These are secondary, early-version references; they do not establish all modern native capabilities.

## Product behavior

- The avatar and profile information retain their original profile navigation. A separate status control sits below the ID; its current label and optional brief description display on Me.
- New status: Me → grouped picker → themed editor → “就这样”. The selected label opens the picker again without losing the draft description. Existing status has a viewing page with modification and an explicit end action. Cancelling discards the draft and returns to Me.
- The finite 14-choice catalog, optional 60-Unicode-code-point single-line description, deterministic theme colors and 24-hour lifetime are explicit product choices. The 24-hour lifetime appears in historical reporting (for example <https://cloud.tencent.com/developer/news/990300>); it is not presented as independently verified 8.0.80 behavior. Editing and saving starts a new 24-hour period.
- State belongs to this independent server account. It does not connect to WeChat, expose real social contacts, fabricate friend counts, or publish status externally. The editor states that status displays only in this phone. AI configuration remains under Me → Settings.
- Unsupported native features such as status photo/video backgrounds, location, social visibility, visitor counts and friend status feeds are absent. The viewing page and limited status glyphs still require visual comparison against a future user-supplied reference.

## Data and failure guarantees

`profile.status` is `null` or `{preset, description, startedAt, expiresAt}`. `status.save` validates a fixed preset whitelist and plain string, Unicode length and control characters before assignment. Server time determines both timestamps; client timestamps are ignored. `status.end` clears the field idempotently. Ordinary profile edits preserve it, and cannot set it through `profile.save`.

The existing transactional action store persists status across sessions and server restarts. Public state hides expired statuses and the Me/viewing screen schedules an expiry refresh. Backups contain only current public status; import rebuilds each known field, validates timestamps and the exact duration, and accepts old backups with no status as `null`. Expired imported status stays expired. Unknown imported fields are discarded.

Descriptions are treated as literal text and escaped at every HTML rendering boundary. HTML-like text is allowed as ordinary text; control characters and malformed Unicode are rejected. Invalid actions and invalid restore payloads must leave both state and revision untouched.

## Executed verification

`node --check public/app.js` and `node --check lib/state.cjs` passed. `node --test tests/status.test.cjs` passed all four tests, covering timestamp authority, all accepted preset values, plain-text hostile strings, 60 astral characters, malformed/oversized input, no partial state or revision changes, normal profile edits, fresh login, server restart, backup/restore, corrupt restore atomicity, unknown-field filtering, old backup migration, idempotent ending and expiry projection.

These checks establish behavior and server persistence, not native visual fidelity. Independent device-size UI/short-screen/font-size checks are run by the release reviewer, separately from these module tests. No user browser, production database or running production Docker instance was used by this implementation task.
