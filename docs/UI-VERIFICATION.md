# Final v0.4.3 independent UI verification

> Historical 0.4.3 results only. Current 0.4.4 changes and verification blockers are recorded in [RELEASE-044-ZH.md](RELEASE-044-ZH.md). This report does not certify the current source; simulated system chrome described below has since been removed at the user's request.

Complete suite finished **2026-11-14T19:05:47.522Z**: **82 passed, 0 failed, 0 uncaught browser exceptions**, exit 0, **Chrome/157.0.8103.78 on Windows, DPR 3**. All **46 source/harness/asset hashes** were unchanged through that run. Evidence: `C:/Users/<用户名>/AppData/Local/Temp/pipi-v043-ui-final4/results.json` and `ui-output.txt`.

A subsequent, isolated two-selector CSS correction restricted the avatar image overlay to `#pick-avatar`, preventing it from covering the separate removal button. This final CSS received **10/10 targeted checks** (setup, six avatar contexts, three guards), **0 exceptions**, completed **2026-11-14T19:07:15.143Z** in `C:/Users/<用户名>/AppData/Local/Temp/pipi-v043-avatar-css-final`. Profile, role and persona editors at 320/390 each exercised real FileReader upload, removal, reupload, save and reload, plus pseudo-element and visible-text bounds. All 18 upper-editor state captures were actually inspected. Common-source comparison shows **only public/styles.css changed** between the complete and delta snapshots. The 82 complete checks were **not rerun on that final CSS**, and are not represented as having been.

Independent clear confirmation finished **5/5** (setup, one behavior, three guards) in `C:/Users/<用户名>/AppData/Local/Temp/pipi-v043-clear-release`, with the same final app.js hash. The earlier pointer-focused suite passed **9/9** in `C:/Users/<用户名>/AppData/Local/Temp/pipi-v043-pointer-regression2`. These counts overlap setup/guards and are not summed into a fictitious number of independent behaviors. Backend 30/30 is separate.

The actual opened-image index is `C:/Users/<用户名>/AppData/Local/Temp/pipi-v043-ui-final4/ACTUALLY-REVIEWED.json`. Final review includes the three phone-frame crops in `review-frame-sheet.png` and the avatar delta sheet `review-avatar-six-contexts.png`; the full raw screenshots remain alongside them.

## Reproduction and isolation

### Docker 预览交付核验

最终 `pipi-phone:0.4.3` Linux 镜像通过 8 项启动/静态资源检查；镜像内 199 个运行文件与最终本地源码逐文件 SHA-256 相同。原预览地址 `http://127.0.0.1:18768/` 已切换至 `pipi-phone-preview-043`；状态接口返回版本 0.4.3，`setupRequired=false`。另外直接从该预览读取 10 个主要页面/框架/状态图标文件，与最终源码逐字节一致。

切换前停止旧实例，把原数据卷复制到 `pipi-phone-before-v043-20261114190813368`，验证 1 个文件、32768 字节全部相同，再从只读备份复制到隔离临时目录检查数据库。新实例继续挂载原 `pipi-phone-preview-020-data`。切换前后业务 JSON 的原始与规范化哈希、密码指纹、登录会话数量一致；环境变量按键值核对一致（忽略数组顺序）。原容器和备份保留。`astrbot-plugin-test`、`napcat-plugin-test` 仍运行，未参与本次切换。没有把用户数据库、登录材料、供应商密钥或私有参考截图放入源码包。

The complete suite is reproduced with `node tests/headless-ui.cjs --out=<directory>`. The destructive clear-confirm supplement is reproduced with `node tests/headless-ui-clear043.cjs --out=<directory>`; it uses setup, one clear-confirm scenario and three guards. The six-context avatar delta runs with `node tests/headless-ui-avatar-paint043.cjs --out=<directory>`. The deterministic pointer interleave can also run alone with `node tests/headless-ui-emoji-race043.cjs --out=<directory>`. Every runner starts its own temporary server/database/account and hidden headless Chrome profile. None attaches to the user's screen/browser or writes the deployed Docker volume. Test fixture image/audio content is synthetic. Real providers and external payments are not invoked.

## Coverage and evidence meaning

All previous 42 scenarios remain enabled. Added checks cover collection entry/type/search/detail/source/audio/delete/cancel, profile saves and nested editor history, provider tab drafts and late responses, cross-role pending sends, receipt exclusion and partial-failure retry, canceled late recognition, wallet recipient/back navigation, Moments publication/audience/images/comments/management/cover, role/persona/proactive persistence, avatar/chat FileReader rejection and late callbacks, farm pending-action deduplication, backup download/invalid restore/valid reload, authentication retry/logout/401, and 37 distinct unavailable entries with honest feedback and unchanged route/revision. Assertions target results and state transitions, not button or screenshot counts.

The frame cases verify desktop 47px status and 34px gesture areas; coarse/mobile actual and simulated safe areas counted once; root/deep/fullscreen/lightbox/status/payment layouts; short-screen scrollable action sheets/confirmations; focused viewport resize; and comment alignment with the shell. Comment acceptance includes decoded screenshot pixels: more than 90% of the sampled home-indicator strip must be dark. Moments default and chosen covers are checked at top, scrolled and returned-to-top states, including actual header safe offset and status background/glyph color.

Standalone clear confirmation uses visible confirmation, verifies zero messages for the disposable role, exact retained role/memories and unrelated messages, then reloads and verifies an empty conversation. It is reported separately, not added again to the complete-suite count.

## Independent defects and regression history

The 69/69 intermediate full2 snapshot preceded later independently found defects and is not the final release result. Actual inspection found clipped header actions, stretched audience avatars, mismatched home-area backgrounds, status/cover seams and a comment layer painting over the gesture indicator. Empty-avatar upload lacked its removal button, and chat-info used a circled plus inside an already dashed square; a dedicated pre-fix run failed both cases. Final tests verify uploaded preview removal/reupload/persistence and decode the plain-plus painted pixels rather than inspecting the SVG box alone.

The next complete run was stopped after 38 passes and two failures. Its emoji failure was a real product race: holding the first emoji request, pressing a second emoji, releasing the first request, then releasing the pointer detached the second target and swallowed its click. Recorded events were pointerdown on the second token and pointerup without a token, no click, and only the first request/draft token. The More failure followed the residual draft from this failed scenario. The deterministic regression now remains in the full suite; the original rapid-emoji scenario is unchanged. The first pointer-guard candidate exposed a delayed search-field/focus regression, so actual search-tab focus is also asserted. These failures are not classified as random flakes.

## Visual review and limits

Independent review actually opened the More pages, Me versus chat collection artwork, collection detail menus, narrow receipt/audience forms, nested parent-underlay states, profile/avatar previews, plain-plus crop, comment gesture strip, short action-sheet/confirmation images, and default/chosen Moments cover/top/scrolled images. Complete PNG inventory is retained in the result directory, but saved image count is not visual acceptance.

The accepted secondary Android artwork distinguishes the colored outline Me cube from the monochrome filled chat tool cube. Licensed icon-family and actual painted-shape checks close specific misuse; they do not certify every WeChat 8.0.80 pixel. Exact native 8.0.80 deep-page references remain incomplete. Per-control coverage and outstanding reference levels are recorded in CONTROL-REVIEW-043.md and REFERENCE-043.md.

Headless Windows Chromium DPR3 uses Windows fonts, simulated pointer/insets and resized viewports. It does not certify physical iPhone/Safari/Android rendering, real OS keyboard/permissions, genuine microphone input or all codec behavior. Provider success paths marked mock use explicit protocol fixtures; they do not prove real supplier compatibility or model quality. Native visual fidelity, >50MB backup boundaries, real permission denial and other unexecuted sub-states must retain their individual limitations in the coverage ledger. Backend 30/30 is separately documented in ADVERSARIAL-RESULTS.md.

## Complete-suite snapshot and final delta

| File | Complete-suite SHA-256 |
| --- | --- |
| server.cjs | 190069a31d1833a65037269c0a63d7b74acea577c0ce51382c35156e7f42bc90 |
| lib/state.cjs | f7b285c617618dce05b4b603d3efcbff4d349036df901d47722123f9c7f678a7 |
| lib/providers.cjs | f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae |
| public/app.js | 2b8e83413ff6bd35349c69d0b5ad99c68a6d3b8d0ee3a7c87373a552a09c2a16 |
| public/styles.css | 50645d99b921efb6b5c02267c3ab0ed36d4b0fbc518873a2cf1c95b79314a4ad |
| public/status.css | 704a9a11b2b6625b5db4e9bdf079ba672ed466e1f5b2b504c755bc21b0ac3830 |
| public/features.js | c88497be04af5752bfb45ba01b9edcc30fcaa91e49c6e0f9fdb7cc285581b723 |
| public/features.css | 1917fb308041e2918a908b53bef82d25329a2285f5eda5eba512b4a798696cbb |
| public/phone-frame.js | 3f9f24afaf4cd27504f0d3f0a9562637cd2e79606ee80be1dd74a215ccf3a98b |
| public/phone-frame.css | 5432e51d8eaa29cfd55b8cb1f8bff7575c4d4f598447763f49adde314b0ff696 |
| public/index.html | f0cd64c30c9749c522899927bf1d3a07ff054011b70bf5b1ff0042748f199cdf |
| tests/headless-ui.cjs | e5a047b9dcf4aa728194993e5bf62356a93d2df0a9cd719e6664ceebef3b005b |
| tests/native-scenarios.cjs | 719fd05199ab1512abcb1b739e86b611a69715d73df375c5054cfe3761f45e90 |
| tests/ios8080-scenarios.cjs | 35ae1541ecd8924ce16f1f95064f20f948aa7443960afc68f95010e1a7e320d0 |
| tests/responsive-scenarios.cjs | 4726e443118e7976d9d4d73cbc43174947facbc71e72b7c16f9ea11ef818490d |
| tests/deep043-scenarios.cjs | 58d4c7cb6e832e1e62613d147011c6fd43e7458ea77b9c6c252f2d05a9b669d2 |
| tests/frame043-scenarios.cjs | 8ec371bac153a3a4792834de93ebb024c5dc8f725358570839f2db9a8a402176 |
| tests/core043-extra-scenarios.cjs | 15fd0e374c30a2a8ebdc9bbd120b61bb33d4e6040b2eb4aed7ae4cbbfc1c5da0 |
| tests/features043-extra-scenarios.cjs | e8343297438a906f3930816981d70788b7b267da1014965a2fb67d86f7458de6 |
| tests/emoji-race043-scenarios.cjs | 7d9c345b027b9eb3ff0bf59c686f4327ba1ebf397cda6852705b5e2cb1be1147 |
| tests/headless-ui-clear043.cjs | dfd87a1d5be139bafd6987eb160564e32cb44676aadcc559e7da3837205ea9ed |
| tests/clear043-scenarios.cjs | 13127271eecfb0dcbef8cc0870690425856eb94548f734094660588188c6d3fb |

Final CSS SHA-256: **4b667978c8bbe979002ecf623f483ab0e1f5051d247c10791b0ef0b4e0cc9c9d**. Complete-suite CSS SHA-256: **50645d99b921efb6b5c02267c3ab0ed36d4b0fbc518873a2cf1c95b79314a4ad**. The final delta runner and case hashes are:

| File | Final delta SHA-256 |
| --- | --- |
| tests/headless-ui-avatar-paint043.cjs | 51c6d1a163c176f41fb004db5cbc5609f85cb9a654fb26d7715a14d39e105e2b |
| tests/avatar-paint043-scenarios.cjs | eceaf22e1f5ff8d6b305b7921d7499872dfc2a2c2a6620cfe0fdd2afdbbe497b |

Complete machine-readable hashes, assertion names, metrics and browser details are in the two results.json files above. Final source matches the complete snapshot except the stated CSS selector correction and the added standalone delta test files.


---

# Final v0.4.2 independent UI verification

Completed **2026-11-14T17:40:41.725Z**: **42 checks passed, 0 failed, 0 uncaught browser exceptions**. Browser: **Chrome/157.0.8103.78**, Windows, **DPR 3**. All36 previous cases remain enabled; six responsive/status/payment cases were added. All **16 source/harness hashes** match before and after this complete run. Backend verification passed **30/30**; its five verified hashes also match this final source snapshot. See ADVERSARIAL-RESULTS.md.

## Evidence and isolation

Reproduce with: node tests/headless-ui.cjs --out=<directory>. Formal evidence is **168 PNGs**, results.json and ui-output.txt in **%TEMP%/pipi-ui-v042-final3**. Reduced --only runs are diagnostics, never complete acceptance. The harness uses a new headless profile, temporary server/database/account and synthetic fixtures. It never attaches to the user's browser or original phone. No production data, real microphone, paid provider or external payment is used; private reference messages and avatars are not copied.

## Responsive verification

| Matrix | Actual outcome |
| --- | --- |
| Existing regression | 320x700,375x812,390x844,430x932,1440x1000: four roots, chat/emoji/More, chat information, Moments/compose and settings pass. Chat header remains44px. |
| Explicit coarse pointer | 320x568,375x667,430x700,431x700,480x700,481x700,600x700,601x700,568x320,844x390,932x430. Touch emulation and coarse-pointer assertion enabled. Widths<=600 and short landscape fill the viewport;601x700 portrait keeps the430px fallback. |
| Desktop fallback | Touch disabled/mobile false at431/480/481/600/601px. Centered430px frame remains;481px breakpoint gives12px top/bottom margins. Original1440px desktop case also passes. |
| Navigation | Actual four-tab clicks, hit testing, minimum44px targets, label bounds, noncollapsed scrolling content and horizontal overflow checked throughout. |
| Safe-area simulation | 390x844 with47px top/34px bottom;844x390 with47px left/right/21px bottom. Same-viewport zero-inset baselines prove top/bottom reserved exactly once, with tabs inside left/right safe bounds. |
| Dense contacts | Temporary27-letter groups produce28 rail buttons. At568x320 the rail stays between search and tabs; A/M/Z/# actually scroll to their real groups. The fixture is restored afterward. |
| Text200% | At320x568,390x844,844x390, selected root titles/search/tab/profile/status font sizes are doubled while retaining relative line heights. No vertical clipping, label overflow, hidden navigation or collapsed content. Long profile strings may use existing ellipsis. |

These touch, inset and font tests are **explicit browser simulations**, not physical-device, OS Dynamic Type or real Safari keyboard certification. Font enlargement covers the named root controls, not every application paragraph.

## Status and payments

The320px Me workflow rejects61 code points without publishing, retains the local length error at62, clears it immediately after a valid correction, publishes HTML-like text literally without executing a handler or creating an image, verifies server-owned24-hour timestamps, survives reload, cancels edits without publishing and requires confirmation to end. Four backend status tests cover14 presets, Unicode/hostile inputs, atomic rollback, partial-profile isolation, sessions/restart, backup migration and expiry projection.

Payment tests retain fixed recipients, zero rejection, exact-cent debits, notes and automatically visible new cards. The visible note dialog covers cancel, empty confirmation and synthetic composing-Enter without sending. At390x844 it is centered and fully visible. Transfer/red-packet message summaries remain distinct from ordinary bills, with message detail -> bill -> message detail -> chat verified.

The new adaptation case uses **60-character recipients and60-character notes**, transfer and red packet, at320x568 and844x390 coarse landscape with47/47/21 simulated safe insets. After the actual page-entry animation finishes, the original no-overflow assertion remains strict. Amount/submit/dialog/save/detail-note/bill controls are actually scrolled into view and hit-tested. Notes remain complete and wrap without clipping in all four combinations. These are virtual accounting interactions.

## Independent final pixel checks

Formal390-root-chats-zero-safe.png has separator rows y520/521: x228(76 CSS px) through1169 are RGB247/239, while x200/227 remain255. Simulated-safe has the same values at y661/662, exactly47 CSS px lower. This confirms actual paint, beyond computed styles.

Formal390-left-swipe.png moves the second-row line with its white button: x200/300/500 at y736/737 are247/239; x550/600 are the action region199,199,203, without a stationary line over the actions. The image is in the tail of the normal swipe transition.

Final390-clean-emoji-reference.png is1170x2532. The rectangle x0,y1150,width1170,height1382 covering composer/categories/full emoji controls was cropped in memory and PNG-encoded using the accepted0.4.1 method. Both final3 and0.4.1-final4 hash to **789c376811bf89e04e8aaf95fc5c443fded831ebcf42533beea183618562df42**. Those controls retain the accepted pixels exactly in this fixture. Full chat geometry, IME, mocked STT, history/multiline anchoring and exclusion-zone tests also pass; this does not establish unreferenced native-state fidelity.

## Diagnostic history and limits

Interim final1 ended40/41. A search-node assertion captured the node immediately after a synthetic clear had scheduled its normal filter render. The isolated case passed. The helper now settles that preparation for two frames before capturing the node, preserving the original during-composition identity and Chinese-commit assertions. Formal metrics confirm all three clearing nodes were replaced before IME capture; all three actual composition-retention tests pass.

Interim final2 was interrupted after24 completed checks by an auxiliary host-tool reset and has no completed acceptance result. It is excluded. Final3 is the complete release result. Earlier harness escaping was corrected; real fixed tab-label line-height, off-center note dialog, separator-paint and stale status-length-error findings were fixed and formally rechecked.

Early payment diagnostics sampled the180ms translateX(12%) transition as temporary38.4px overflow at320px. Logs confirm the running transform. Stable form/detail checks now await animation.finished without weakening overflow assertions. Initial generic FAIL images were taken after fixture cleanup, so they are not treated as payment-failure images; the specialized case now captures any failure before cleanup.

Windows uses Noto Sans SC rather than iPhone PingFang. Real keyboard/chrome/permissions/audio quality, physical safe areas, OS text settings, exact native status/payment artwork and all unreferenced8.0.80 states remain outside these claims. Native image conclusions are separately recorded in IOS-8080-AUDIT.md and PAYMENTS-VISUAL-REVIEW.md.

## Release-owner deployment observations

The release owner reports successful deployment at **2026-11-14T17:43:12Z**: pipi-phone-preview-042, image pipi-phone:0.4.2, original volume pipi-phone-preview-020-data, same127.0.0.1:18768 address. Status reports0.4.2/setupRequired:false. Offline byte backup pipi-phone-before-v042-20261114174310633 verified one32768-byte file. The backup was copied to temporary tmpfs for SQLite reads; no audit files were written to the original volume. Before/after raw-state hash, business semantics and password fingerprint matched, with two sessions retained; two roles/one message remain. Eight served front-end resources returned HTTP200 and matched final source bytes; server/state/providers image hashes match backend verification. Old0.4.1 is retained stopped; unrelated containers were untouched.

The first deployment attempt stopped the preview but a read-only SQLite audit failed because WAL-sidecar initialization required a writable directory. It automatically restored0.4.1 before backup or0.4.2 startup, with the original state/sessions unchanged. The corrected attempt used the offline byte backup and tmpfs audit above. This was a deployment-audit limitation, not a product regression. These are release-owner observations, separate from independent temporary-data QA.

## Final verified source snapshot

| File | SHA-256 |
| --- | --- |
| server.cjs | 8ee53f3691bd50aed08a9e88c3fc5342a87835416b302538fe766290fa5ffea4 |
| lib/state.cjs | f7b285c617618dce05b4b603d3efcbff4d349036df901d47722123f9c7f678a7 |
| lib/providers.cjs | f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae |
| public/app.js | 2fbcb6b2f5f9d8e364d8ab4a2180e812813048fb5978d4b1bf9c9c5a5a4ab919 |
| public/styles.css | 0a76c946f011621806b62b49a80b6329fe49cf699262a72b597af159be7dcf07 |
| public/status.css | 704a9a11b2b6625b5db4e9bdf079ba672ed466e1f5b2b504c755bc21b0ac3830 |
| public/features.js | 6ab8a728c120f3a2a18be7dd934b2d0012526f6f8599a4e8c032feea846441f5 |
| public/features.css | 10eca6db5ced3c53ed5498b0ae488c36ad9a353f2f44af1fbb5777b3b0abe3e9 |
| public/index.html | d4316c5e26c517066da646ad1a2094d083f7dc651c67a7d35eeb5e60a52c0432 |
| public/emoji.js | e20c4b322dc25dc79fdd7e1417165928ff86da5a64324d10943873921a47b6ef |
| public/vendor/fake-world/emoji-sprite.png | 070fd98a1642505ab310c570f1b9b4e3510eb5e215ce022f2bb62669ac47bb88 |
| public/vendor/fake-world/selfie-expression.png | 09db092f1db934f1c5d6e7d9a19dc6698e45d86e533ae164c7a1ab5b9e49793a |
| tests/native-scenarios.cjs | 4efa36a3cefaf81c81bde3bc69c0a7b76bb706a7513c261fe7f19748379bd602 |
| tests/ios8080-scenarios.cjs | 35ae1541ecd8924ce16f1f95064f20f948aa7443960afc68f95010e1a7e320d0 |
| tests/responsive-scenarios.cjs | c7b79ef67c07f5fc47d1a1d70cf62fbbbc3e4e8cb339ae5df214c65e002b6d01 |
| tests/headless-ui.cjs | 12a6ff07eae9ca85bd08b811f1e6d0f758bd9869a474d186ca1dbf77c5d667d8 |

Historical0.4.1/earlier records follow; their counts and scope are not substituted for this final0.4.2 result.

---

# Independent browser verification — v0.4.1 / iPhone 8.0.80 target

Final complete execution: **2026-11-14T16:45:04.287Z, 36 checks passed, 0 failed, 0 browser exceptions**. Browser: **Headless Chrome 157.0.8103.78**, Windows; every screenshot uses **DPR 3**. Independent backend rerun: **26/26 passed** (5739.1 ms), documented in `ADVERSARIAL-RESULTS.md`. All **14 source/harness hashes** are checked equal before and after the final complete browser execution. Intermediate v0.4/v0.4.1 results below are historical, not the final acceptance snapshot.

## Reproduction, isolation and evidence

Run `node tests/headless-ui.cjs --out=<directory>`. The harness requires both `tests/native-scenarios.cjs` and `tests/ios8080-scenarios.cjs`. DPR defaults to 3; `UI_DPR` can override it for diagnosis, but final visual assertions require3. `--only=<substring>` is a reduced diagnostic run, not a substitute for the final complete run.

The temporary database, account and separate headless Chrome profile are independent of the user's browser and production phone. No user screen, real microphone, production database/container or paid provider is operated. Final evidence is **119 PNGs**, `results.json` and `ui-output.txt` in `%TEMP%/pipi-ui-v041-final4`. The neutral matched-state image is `390-clean-emoji-reference.png`, verified from its PNG header as **1170 × 2532** pixels for 390 × 844 logical CSS pixels at DPR3. The accepted centered desktop frame remains in the1440-wide captures.

The supplied reference was inspected locally and the user identifies its target as iPhone WeChat 8.0.80. Its private messages/avatars are never copied into source, captures or releases. Clean fixtures use neutral avatars, synthetic six-/four-character Chinese strings, one unread peer totaling3, and only the shipped token `[流泪]` in recents because that sprite matches the reference's long-tear glyph. The differently drawn `[大哭]` token is not silently relabeled. See `IOS-8080-AUDIT.md` for normalized native measurements and state-by-state limits.

## Input and recording outcomes

| Area | Actually verified |
| --- | --- |
| Composer IME | Same CDP composition sequence on a fresh ordinary textarea and the app: zhong → 中 → commit 中文. Both end as 中文; the original app textarea remains connected through composition; composing Enter/keyCode229 never sends |
| Real event registration | In this Chrome build, a newly created textarea reports both `oncompositionstart` and `oncompositionend` properties absent. Expando assignment was insufficient; explicit addEventListener plus InputEvent.isComposing now drives the state, with before/after event traces retained |
| Three searches | Contact-list search, per-chat message search and emoji search retain their active composing nodes and commit 中文 without a leftover pinyin prefix |
| Inline microphone | Synthetic real MediaRecorder audio is posted to the app's existing transcription route; the explicit mocked transcript inserts at the caret into an editable draft and does not send a message |
| Transcription failures | Explicit 502 mock retains the draft and displays its error; stop/cancel/route exit end every captured track; cancelled recording makes no transcription request |
| Async isolation | A held response delivered after leaving cannot modify another draft or send a message. A response arriving during active composition leaves AzhongB unchanged, waits, then produces A中文语音草稿B after commit |
| Left voice control | The original hold-to-send synthetic audio/slide-cancel/Escape/favorite playback scenario is rerun in the same final complete suite; it remains distinct from inline dictation |
| Multiline and layout | Actual CDP multiline insertion is bounded at 114px; resizing input, opening/closing the drawer, and shrinking the viewport retain a bottom-pinned last message while preserving a historical reading position |

STT results in these browser cases are **explicit CDP Fetch protocol mocks**, not successful real speech recognition. Exactly **4 intercepted /api/voice/transcribe requests** cover success,502, completion during IME and a late response. Only a deliberately fake loopback STT configuration satisfies the UI guard. No paid request is sent. Synthetic audio is not a user microphone recording.

The viewport shrink to 390 × 514 verifies visible input, retained draft and bottom pinning; it is **not an iOS software keyboard test**. Real candidate bars, keyboard animation, VisualViewport offsets, browser chrome and OS permission UI remain outside this environment.

## Final matched-state geometry

These are logical CSS pixels at390 × 844; measurements of a visible painted path are distinguished from an SVG element's canvas. The reviewer opened the final DPR3 clean image and the320/430/1440 exclusion-zone captures. The separate skeptical reviewer compares the declared control regions against the internal native reference.

| Measured property | Final result |
| --- | --- |
| Input row / category row | 58 /58; combined116 |
| Field rectangle | x50..299, y392.875, height42; corner radius4 |
| Category centers | 31,85,139,193 |
| Inline mic | Button right inset9 and bottom4.5; SVG canvas22 ×24; no horizontal foot on its stem |
| Chat typography | 18px font /24px line; chat title18px; panel headings15px with24px line |
| Incoming neutral avatar / gap / bubble start | 43px /13px /x68 |
| Six-/four-character bubbles | 134 ×43 /98 ×43; first incoming top149 and four-character top269 |
| Message pitch / tail | 60px; tail top17, incoming left−4 / outgoing right−4 |
| Last bubble / row | Last bubble y329..372; row starts384.875 (12.875 gap). Outer footer starts383.875 (11.875 gap). The recorded outer-geometry assertion passes the independently measured native 12.79 ±1 tolerance |
| Recents | Recent heading ink moves−2px and its grid+4px; one long-tear glyph; all-emoji heading's following gap6px |
| Delete/send | y764..810, bottom inset34; delete canvas29 ×29 with vertical scale1.07 |
| Exclusion zone | Backdrop left58%, right0, bottom0, height94px in headless safe-area0; it covers the lower right emoji cells, not merely the button boxes |

At 320/375/390/430/1440 widths, the lower blank region actually receives hit testing; real mouse clicks there neither insert a hidden emoji nor send. Column4 remains visible and clickable in the lower rows, including 320px. Backdrop and actions exist for all/search, and are absent for favorites/selfie. Horizontal overflow checks pass at every tested width. The original desktop centered 430px phone, outline and12px outer margins remain intact.

## Regression coverage and corrected findings

The final complete run also reruns the prior native hierarchy/settings boundary, literal failed messages, safe sprite/token insertion, Unicode caret deletion, rapid emoji choices, virtual payment amounts/notes/recipient and visible new cards, conversation deletion, Moments author filtering and replies, sticker persistence/removal, contact tags/subpages, exact-cent ledger, farm, browser reload and static/runtime checks. The contact rail now scrolls to its real alphabetical group; a hidden conversation still has its contact and no internal hidden-state badge. This is contact/per-chat/emoji search coverage, **not global full-message search**.

An earlier35-check run passed but did not verify the native lower-right exclusion region. Later complete/special runs exposed a **real layout defect**: after opening the drawer, a stale scroll restoration could put the last bubble below the composer (measured gap−5.125 even after two frames). This was not dismissed as a test timing issue. The product now captures pre-change bottom/history state and restores it around composer replacement, multiline growth, trailing control changes, drag height and viewport changes. An8-check focused diagnostic passed, then this final complete36-check run passed against the new JS and final CSS. Earlier 35/36 and7/8 records are superseded, not counted as passes.

The clean driver first proves the closed fixture is at bottom, waits two animation frames after opening, records geometry before asserting, and compares to the native 12.79 ±1 measurement. Long neutral history then verifies both directions: history stays put; an already-bottom chat keeps its last message above the composer during multiline/drawer/viewport changes. The original polling/no-jump test is also rerun.

## State coverage and limits

| State | Evidence available | Claim boundary |
| --- | --- | --- |
| Empty input + all-emoji drawer | Supplied native screenshot plus neutral DPR3 fixture | Selected geometry/ink measurements and exclusion zone compared |
| Empty closed / typed Chinese / whitespace /4- and7-line input | Final clean captures and actual input/layout assertions | No corresponding 8.0.80 native screenshots; exact native glyph choice/max-lines/spacing remains unverified |
| Holding/slide-cancel/inline recording/recognizing/error | Synthetic browser capture and explicit STT mocks | Functional isolation verified; native8.0.80 recording UI and real speech quality are not verified |
| Other tabs, more drawer, contacts, Moments, wallet, settings | Complete app regression captures | No matching8.0.80 native examples supplied; historical components/functionality do not prove current native fidelity |

Windows uses actual Noto Sans SC rather than iPhone PingFang; font rasterization, OS emoji, neutral avatars and licensed artwork differ. The page does not fabricate the system status bar/home indicator. Raw reference PNG color samples lack profile metadata, so tiny channel differences are not proof of exact color intent. Real iPhone/Android hardware, touch timing, audio formats, keyboard/safe-area behavior and commercial model availability/billing/quality remain unverified. Contact gender and some native service/catalog/selfie entries remain unavailable. Virtual transfers are accounting events, not external payments or a real claim/refund lifecycle. No exhaustive 8.0.80-screen or pixel-identical claim is made.

## Release-owner deployment verification — v0.4.1

After final 36/36 and 26/26 verification, the release owner separately deployed the final 0.4.1 image at the existing loopback preview **127.0.0.1:18768** using the existing data volume. The previous 0.4.0 preview was stopped before an offline backup; its one 32768-byte file was verified byte-for-byte. Before/after business-state hashes, role/message counts, sessions and configured password matched. Status reports **version 0.4.1, setupRequired:false**. Seven actually served primary assets return HTTP 200 and match the final tested source bytes. The old preview remains stopped for rollback. These are release-owner observations, separate from the independent temporary-data QA harness.

## Final tested snapshot

| File | SHA-256 |
| --- | --- |
| `server.cjs` | `65c217c819f3a655249cf5b5c3b3b79465bb68ceb10a72633cebc8c8d68256b4` |
| `lib/state.cjs` | `7e9c08dc2df7b0c4b8d87ac65aa0b5f9346fb60bcc524b963935acf30a4e5cf1` |
| `lib/providers.cjs` | `f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae` |
| `public/app.js` | `541804b036571ff04ef3484346bbe3ad83c7435037247f3e0441fa7662d701b8` |
| `public/styles.css` | `98ac47386565795353e2c0bcaa23e34d76b6d2de200992ff94b0f061f21f0db6` |
| `public/features.js` | `0041057687aee7788bc518633106d1982546cdd87136e3d60008335b929cca47` |
| `public/features.css` | `2d983a737de392e421dcccd9bf12c012c4311102b3b6a724e24cbeb7dcd9174a` |
| `public/index.html` | `ad38634c7f3a67c7b7a82fb3f2da7de76c1e488bee0733e3fe7972d971854ecc` |
| `public/emoji.js` | `e20c4b322dc25dc79fdd7e1417165928ff86da5a64324d10943873921a47b6ef` |
| `public/vendor/fake-world/emoji-sprite.png` | `070fd98a1642505ab310c570f1b9b4e3510eb5e215ce022f2bb62669ac47bb88` |
| `public/vendor/fake-world/selfie-expression.png` | `09db092f1db934f1c5d6e7d9a19dc6698e45d86e533ae164c7a1ab5b9e49793a` |
| `tests/native-scenarios.cjs` | `b64612d35162392828b61c975c99d543f1f85aba2db75b0f8abd9c0082a57048` |
| `tests/ios8080-scenarios.cjs` | `371aa8ee9d38ecbed8e6d8b5d6519615e83ae7d7a30f9d5caff88a7efa245f4f` |
| `tests/headless-ui.cjs` | `8817d31af797a8580da34b48e53da5e199f89f4947a6dc8268a19f2c38fa59fd` |

Useful additional files: `390-ime-commit.png`, `390-dictation-recording.png`, `390-dictation-editable-draft.png`, `390-dictation-after-ime.png`, `390-list-search-ime-commit.png`, `390-emoji-search-ime-commit.png`, `390-clean-typed.png`, `390-clean-multiline-4.png`, `390-clean-multiline-7.png`, `390-history-drawer-top.png`, `390-bottom-multiline-pinned.png`, `390-clean-simulated-keyboard-viewport.png`, and each width's `emoji-exclusion-zone.png`. The production deployment observations above are from the release owner; this QA harness makes no production changes. Historical v0.4 evidence follows.

---

# Independent browser verification — v0.4

Final execution completed **2026-11-14T15:42:14.714Z: 29 scenarios passed, 0 failed, 0 browser exceptions**. Browser: **Headless Chrome 157.0.8103.78**, Windows, mobile viewport emulation. The independent backend integration run passed **26/26**; see `ADVERSARIAL-RESULTS.md`. The final browser suite explicitly verifies that all 13 tested source/harness files have identical hashes before and after execution. Earlier v0.3 and intermediate v0.4 runs below do not supersede this final snapshot.

## Reproduction and isolation

Run `node tests/headless-ui.cjs --out=<evidence-directory>`; `tests/native-scenarios.cjs` is required. `CHROME_PATH` selects Chrome. The harness creates a new temporary SQLite data directory and a separate headless Chrome profile, drives visible controls using actual CDP mouse/key input, and closes the test server and browser afterward. It never attaches to the user's visible browser, operates the user's screen, reads the production database or changes production containers. State reads are persistence oracles. A generated green QA sticker, fake account, hostile literal strings and explicitly labeled test moment authors are fixtures. Friend posts are seeded through validated test-only backup import, not generated by a paid model.

Synthetic microphone capture uses Chrome's fake media device. A deliberately fake STT key points to a loopback destination rejected by normal SSRF policy; the test neither records the user nor contacts a paid service. Successful provider protocol tests are separate backend mocks.

Final evidence: **94 PNG screenshots**, `results.json` and `ui-output.txt` in `%TEMP%/pipi-ui-v04-final5`. The private user screenshot was opened locally for internal comparison only. Its messages, avatars and image are not reproduced in the repository, evidence captures or release.

## Executed behavior

| Area | Final assertions |
| --- | --- |
| Native hierarchy | Four roots; anchored home menu; contact profile, chat information and profile settings remain separate; back restores their hierarchy; add friend works from home and contacts |
| Settings boundary | Visible controls on roots and tested native subpages expose no model/API/persona/role management; configuration is reached through Me → Settings |
| Emoji drawer | Search/all/favorites/selfie tabs; drag handle; real recent use; all 109 sprites in seven scrollable columns; no old page-dot pagination; visible bottom-right delete/send controls |
| Editing | Deletes complete bracket tokens, family ZWJ emoji, regional flag, combining mark and surrogate emoji at the caret; rapid consecutive choices retain ordered text, MRU and caret; search filters; HTML remains literal beside inline sprites |
| Favorite stickers | Real browser File/DataTransfer → FileReader import; actual image send; server state survives reload; management route confirms removal; selfie/store unavailable states are explicit |
| Failure/voice | Failed text retains its literal source and creates no assistant; red failure control reveals an error confirmation rather than permanent error paragraphs; long press/Tab/Escape work; real MediaRecorder synthetic audio decodes, cancels correctly and plays from favorites |
| Payment truthfulness | Zero amount disabled; fixed chat recipient; Cancel/Escape/browser Back return correctly; 1.23 red packet debits 123 cents; card hides its amount; new cards are fully visible before any test scrolling; transfer card/detail show 2.34/−2.34 and exact saved note; no invented claimed/pending/refund status |
| Wallet | Services → Wallet → Balance → recipient → amount; title is 钱包; bills and transaction detail are separate; exact stored cents drive the detail amount; ordinary transfer selects a recipient |
| Contact subpages | Tags/phone/description save safely; description textarea has resize:none; contact settings, contact more, personal more, new friends, tag list and matching-contact list preserve back hierarchy |
| Moments | Full-screen compose, private default, publish/like/comment/reply; contact album contains only that friend's actual author ID; Me album only the user's posts; Discover feed includes both; leaving removes the bottom comment bar |
| Historical messages | Search opens the matched old message visibly; real wheel scrolling establishes a stable historical reading position and a subsequent server revision/poll does not jump to bottom |
| Other state/runtime | Swipe deletion retains the contact; Settings role creation validates; ledger stores exact cents; growing crop cannot harvest; reload retains login and fixtures; no static HTTP errors or uncaught browser exceptions |

## Visual comparison and measured geometry

The reviewer directly opened the local user reference and the final app captures, including 320/390/430 mobile and 1440 desktop emoji pages, recent/search/selfie states, red packet/transfer forms, fully visible cards and actual transaction details, contact remark/more/settings, both friend and own albums, wallet, tags, sticker management and desktop Me. The reference informs hierarchy, proportions and positioning; passing DOM/function checks alone is not proof of native visual fidelity.

| Reference/property | Final measured result |
| --- | --- |
| Input + categories + drawer around 54.4% of the supplied screenshot | 460.125 / 844 = **54.52%** at 390px |
| Seven emoji centers normalized to 390px | **33, 87, 141, 195, 249, 303, 357** |
| Composer field | x **50** to **299** at 390px |
| Composer voice / keyboard / plus centers | **25 / 324 / 365**; SVG boxes **33px** (the artwork has internal padding) |
| Recent section spacing | Recent heading bottom margin **0px**; recent grid bottom margin **12px** |
| Floating delete/send | Both within the board's bottom-right visible region, each at least 40px tall; clicks verify hit testing |
| Contact description | Browser resize handle removed; computed resize **none** |

All five viewports traverse the four roots plus chat, emoji, more, chat information, Moments compose and settings. Document/body/shell/view horizontal overflow checks pass. Mobile is edge-to-edge; the accepted desktop outline, centered width and 12px top/bottom margins remain visible.

| Viewport | Phone x/y | Phone size | Outline | Header / row / avatar |
| --- | --- | --- | --- | --- |
| 320 × 700 | 0 / 0 | 320 × 700 | none | 44 / 72 / 48 |
| 375 × 812 | 0 / 0 | 375 × 812 | none | 44 / 72 / 48 |
| 390 × 844 | 0 / 0 | 390 × 844 | none | 44 / 72 / 48 |
| 430 × 932 | 0 / 0 | 430 × 932 | none | 44 / 72 / 48 |
| 1440 × 1000 | 505 / 12 | 430 × 976 | solid | 44 / 72 / 48 |

Useful final files include `390-chat-emoji-first.png`, `390-chat-emoji-message.png`, `320-chat-emoji.png`, `430-chat-emoji.png`, `1440-chat-emoji.png`, `390-chat-redpacket-card.png`, `390-chat-transfer-detail.png`, `390-wallet-index.png`, `390-contact-remark.png`, `390-friend-moments.png`, `390-own-album.png`, `390-sticker-management.png` and `1440-me.png`.

## Actual glyph fonts

A visual suspicion of Song/serif fallback was checked with **CSS.getPlatformFontsForNode**, not merely computed font-family. Every sampled Chinese glyph in transfer controls, contact-more values and wallet detail resolves to **Noto Sans SC**; only headings use its bold face. No Song/serif fallback was reported.

| Actual sampled node | Font / size / CSS weight |
| --- | --- |
| Transfer cancel, amount label, recipient | Noto Sans SC / 16px / 400 |
| Transfer title | Noto Sans SC Bold / 17px / 600 |
| Transfer disclosure | Noto Sans SC / 12px / 400 |
| Wallet transaction status, field label and recipient value | Noto Sans SC / 14px / 400 |
| Contact-more region label and value | Noto Sans SC / 15px / 400 |

The actual platform font records, glyph counts and CSS stacks are retained in `results.json`. This excludes the suspected fallback for these nodes; it does not prove iPhone PingFang rasterization.

## Findings and intermediate-run accounting

- A visually opened early capture showed a newly sent payment card partly behind the composer despite functional checks passing. Final tests now require the entire card inside chat-messages before any helper scroll. The success path explicitly requests bottom positioning; ordinary cancel/back and historical polling preserve reading position. Both final card assertions and opened screenshots pass.
- The wallet root was mislabeled 零钱 and the contact editor exposed a browser textarea resize corner. Final title and resize assertions pass. Emoji columns were widened toward the reference, recent whitespace reduced and composer glyph geometry measured.
- The recovered final4 record was **28 passed / 1 failed**, with source hashes unchanged. Its historical-position setup set scrollTop immediately after entering chat and did not await initial rendering. The final driver first waits two animation frames, uses actual CDP wheel input, asserts the historical position is stable, then changes the server revision and asserts the same no-jump result. No product assertion was relaxed.
- An earlier interrupted run has no final-acceptance standing. The final5 execution above is complete and supersedes intermediate runs.

## Tested source snapshot

| File | SHA-256 |
| --- | --- |
| `server.cjs` | `1181ac150e08206d1568c93c986f793ed90880d91c9248bddff4d1f806fc4137` |
| `lib/state.cjs` | `7e9c08dc2df7b0c4b8d87ac65aa0b5f9346fb60bcc524b963935acf30a4e5cf1` |
| `lib/providers.cjs` | `f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae` |
| `public/app.js` | `7cccd1516dec90875c8324724ef044a184e4b4e11a08dc5297321ab3c78f89d2` |
| `public/styles.css` | `721b4513157cfc6c416e495261cf7a9b9ea9387fbebbe634c43a3e9c0dafa074` |
| `public/features.js` | `0041057687aee7788bc518633106d1982546cdd87136e3d60008335b929cca47` |
| `public/features.css` | `2d983a737de392e421dcccd9bf12c012c4311102b3b6a724e24cbeb7dcd9174a` |
| `public/index.html` | `878b7a8e34f8bfe6c6dd9dd6a43adddd1abc81aae64863fdb8d82ca0a0befb9f` |
| `public/emoji.js` | `e20c4b322dc25dc79fdd7e1417165928ff86da5a64324d10943873921a47b6ef` |
| `public/vendor/fake-world/emoji-sprite.png` | `070fd98a1642505ab310c570f1b9b4e3510eb5e215ce022f2bb62669ac47bb88` |
| `public/vendor/fake-world/selfie-expression.png` | `09db092f1db934f1c5d6e7d9a19dc6698e45d86e533ae164c7a1ab5b9e49793a` |
| `tests/native-scenarios.cjs` | `e74c540028f09273ce4c5418d620ce746cc7e267785f4bbfc4fbe29dbccb09f6` |
| `tests/headless-ui.cjs` | `c00d1b73f1e4dc768742ae1d044efbd8a7dd115aefa676d6c250efaad690c5db` |

## Release-owner deployment verification

After the QA run, the release owner separately reported deploying **pipi-phone:0.4.0** at the existing loopback preview port **18768**, retaining the existing data volume. The old preview was stopped before a read-only-source backup; the single 32768-byte data file matched its backup byte-for-byte by SHA-256. Before/after business-state hashes and counts, configured credentials and sessions matched. The upgraded status reports v0.4.0 with setupRequired:false, and seven actually served primary asset hashes match the final5 source snapshot and the owner's isolated smoke test. The old preview remains stopped for rollback; unrelated containers were unchanged. These are release-owner observations, separate from the independent headless QA run.

## Limits

This is isolated Windows Chrome emulation, **not real iPhone Safari or Android-device certification**. Real microphone hardware/speech quality, system permission sheets/file pickers, software-keyboard resizing, safe areas/browser chrome, touch timing, background OS behavior and iOS audio negotiation remain unverified. The webpage does not fabricate a system status bar or home indicator. Windows fonts and licensed icon/artwork details differ from iPhone. Contact more still has no gender field; selfie expressions, the sticker catalog and some native service entries explicitly remain unavailable. No exhaustive-screen, pixel-identical or complete WeChat-service claim is made.

Wallet events are immediate virtual accounting entries, not a real receipt/refund lifecycle or external payment. Commercial provider availability, billing and response quality were not exercised. Asset provenance/licensing is maintained separately in `THIRD_PARTY_NOTICES.md` and the audit documentation; this visual test does not relicense proprietary reference artwork. No deployment or production-database changes were performed by this QA harness. Historical v0.3 evidence follows.

---

# Independent browser verification — v0.3

Final execution: **2026-11-14T14:48:01.767Z, 23 comprehensive scenarios passed, 0 failed**. Browser: **Headless Chrome 157.0.8103.78**, Windows, Node **24.22.1**. The separately executed backend suite passed **21/21** in an isolated Linux Node 24 container; see `ADVERSARIAL-RESULTS.md`. The old v0.2 result of 81 layout-oriented checks is superseded and is not evidence for the v0.3 native interaction changes.

## Reproduction and isolation

Run `node tests/headless-ui.cjs`. It loads `tests/native-scenarios.cjs`; both files are required. `CHROME_PATH` overrides Chrome. `UI_ARTIFACT_DIR` or `--out=<directory>` chooses the evidence directory. `--only=<scenario substring>` runs setup plus a targeted scenario for diagnosis; a reduced run is not final acceptance.

The dependency-free CDP harness starts `createApp` with a new temporary database and launches a separate `--headless=new` Chrome profile. It does not attach to the user browser, display a window, read production data or use real credentials. Visible controls and real CDP mouse/key input drive navigation; state reads provide the persistence oracle. Pointer targets must be visible and unobscured before clicking. Temporary server, browser and database are closed after the run.

The microphone test uses Chrome synthetic capture and automatic permission response in this isolated browser. Through the real settings UI it saves an explicitly fake STT key pointing at a loopback destination that production SSRF protection rejects. It neither records the user microphone nor contacts a paid provider.

## Executed behavior

| Area | Actual assertions |
| --- | --- |
| Native navigation | Four tabs; home plus opens a right-top anchored four-item menu; add friend opens a native search page from home and contacts; existing friend search opens the separate contact profile |
| Information hierarchy | Profile → send message → chat → ellipsis opens **chat information**; back follows the same hierarchy; personal information uses individual native cells |
| Settings boundary | Model, role and persona configuration lives under **Me → Settings**; interactive controls on the four roots, chat, chat information, add-friend page and composer do not expose configuration |
| Messages | Unconfigured service retains literal failed user text with no assistant reply; long unbroken text fits; HTML stays escaped; real long press opens actions; Tab stays in overlay and Escape restores bubble focus |
| More and emoji | Two more pages; 4×2 first-page grid with actual 64×64 tiles at 390px; location honestly reports unavailable; 109 sprite tokens over five pages; first page 24 items, last 13; smile/question tokens render while adjacent HTML remains inert |
| Voice | Real mouse press waits for recording state, remains held, then release produces decodable WebM; denied STT retains failed user audio; short bubble is 72px; slide-up release and Escape cancel without sending; favorited audio playback actually advances currentTime |
| Payments | Chat amount page fixes its recipient, with no role selector; Cancel, Escape and browser Back return directly to chat; zero rejects; a 1.23 virtual red packet debits 123 cents and retains its note; ordinary wallet transfer first selects a recipient |
| Deletion | Real left drag reveals actions; confirmation deletes messages and the conversation row while retaining its address-book contact |
| Moments | Discover → Moments; camera opens full-screen compose with private default; publish/like persist; comment uses the focused bottom textarea bar; replies retain original comment/author |
| Other flows | Role creation in Settings validates blank name; Services → Wallet/real-life ledger; zero ledger amount rejects and 12.34 stores as 1234 cents; Discover → Farm plants and rejects premature harvest |
| Persistence/runtime | Browser reload retains login, messages, moment/comments; loaded static resources have no HTTP errors; no uncaught browser exception |

All five viewports traversed the four tabs plus chat, more, chat information, Moments compose and settings through visible controls. Document, body, shell and main view remained within their visible widths.

| Viewport | App width | App height | Header | Chat row | Avatar | Avatar left |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 320 × 700 | 320 | 700 | 44 | 72 | 48 | 16 |
| 375 × 812 | 375 | 812 | 44 | 72 | 48 | 16 |
| 390 × 844 | 390 | 844 | 44 | 72 | 48 | 16 |
| 430 × 932 | 430 | 932 | 44 | 72 | 48 | 16 |
| 1440 × 1000 | 430 | 1000 | 44 | 72 | 48 | 16 |

## Visual review and reference comparison

The reviewer directly opened WeChatSwift [screenshot 01](https://github.com/alexiscn/WeChatSwift/blob/master/Screenshots/01.png), [02](https://github.com/alexiscn/WeChatSwift/blob/master/Screenshots/02.png) and [03](https://github.com/alexiscn/WeChatSwift/blob/master/Screenshots/03.png), then actual app captures. The references are 828×1792 pixels, corresponding to 414×896 logical points at 2×. They are historical iPhone layout references, not a recording of the current proprietary WeChat application.

| Reference measurement | Final application | Assessment |
| --- | --- | --- |
| Ref 01 menu: 320 physical px wide, rows 112 high | 160 logical px, four 56px rows | Same logical menu dimensions |
| Ref 01 menu left 246 at viewport 414; right inset 8 | Left 222 at viewport 390; right inset 8 | Same right anchor; width proportion 38.6% vs 41.0% reflects different viewports |
| Ref 01 avatar 48, row 72, left inset 16 | 48, 72, 16 at all five widths | Same measured list density |
| Ref 03 tools: 4 columns, 2 rows, 64-point squares | 4×2, actual 64×64 at 390px; 56px on narrow 320px | Same normal sizing with narrow-screen adaptation |
| Ref 02 short 4-second voice bubble about 69 points | Roughly 1-second synthetic recording uses 72px | Short voice no longer stretches to the earlier 266px width |

Actual final images opened included the anchored menu/circular plus, contact profile, grouped chat information, individual personal-information cells, add friend, failed chat, both more pages, emoji pages and inline tokens, short voice/cancel/favorited voice, payment forms, Moments compose/comment bar, wallet, ledger, farm, narrow contacts and desktop Me. The `[疑问]` sprite is the questioning face with a question mark; it was not mistaken for the hush gesture.

Visual differences remain: Windows uses Noto Sans SC instead of iPhone PingFang; licensed icon shapes/strokes and generic empty avatars differ from reference artwork; the webpage does not fabricate an iOS status bar/home indicator. Farm and the real-life ledger are product-specific modules. Passing behavior and matching some dimensions do **not** establish pixel-identical rendering or complete native WeChat equivalence.

Actual glyph fonts were measured with `CSS.getPlatformFontsForNode`, including payment form nodes rather than only their CSS declarations:

| Actual node text | Actual glyph font | Size / CSS weight |
| --- | --- | --- |
| Cancel `取消` | Noto Sans SC regular | 16px / 400 |
| Transfer title `转账` | Noto Sans SC Bold | 17px / 600 |
| Amount `转账金额` | Noto Sans SC regular | 15px / 400 |
| Note `说明` | Noto Sans SC regular | 14px / 400 |
| Recipient | Noto Sans SC Medium | 17px / 500 |
| Virtual-payment disclosure | Noto Sans SC regular | 12px / 400 |

Chat/list Chinese glyphs also resolve to Noto Sans SC, with the bold face for the title. No serif/Song fallback was reported for sampled payment nodes. Font identification does not prove identical iPhone rasterization.

## Findings fixed before final acceptance

- The initial 320px compose test exposed horizontal overflow; final narrow compose and all five widths pass.
- Short voice originally stretched to 266px; final recorded audio has a 72px body and an independently sized failure explanation.
- More tiles declared 64px but flex shrink reduced actual height to 62.8125px. The implementation now prevents shrink and provides sufficient row height; final rectangles are asserted at 64×64.
- An automated click during the Moments menu transition initially missed its target. The harness now waits and verifies hit testing; like/comment pass. A nested-selector quoting error in the new emoji test was corrected as a harness error, not a product defect.

## Evidence and tested snapshot

The final run produced **66 PNGs**, `results.json` and `ui-output.txt` under `%TEMP%\pipi-ui-v03-final2`. Useful captures: `390-home-plus.png`, `390-add-friend.png`, `390-personal-information.png`, `390-chat-info.png`, `390-chat-emoji-second.png`, `390-chat-emoji-message.png`, `390-chat-voice-failed.png`, `390-chat-voice-cancel.png`, `390-favorite-voice.png`, `390-chat-transfer.png`, `390-chat-redpacket.png`, `390-moment-comment.png`, `320-moment-compose.png`, `1440-me.png`. These contain test data and are reproducible temporary evidence.

| Tested file | SHA-256 |
| --- | --- |
| `public/app.js` | `fc7d31651dbfe9f2eb92dac68a90c2c24f0c031cedc44926ba10e4a566351536` |
| `public/styles.css` | `978065c6d7f401de772589bc4b33566e28dd394219c7bbd6d247cc996b6e33ac` |
| `public/features.js` | `d52e24cc7b6fc328b2318d7f6254a7f3a1bbd9d208b9502d9e65033f2719da34` |
| `public/features.css` | `d8a45d133620ac26ca750b9459d333378ba84054d83ac128b95793547f4cb7f8` |
| `public/index.html` | `15ec9d36794cc023199649213a2ea2676100ebef19997523ddbd48b856ad3672` |
| `public/emoji.js` | `e20c4b322dc25dc79fdd7e1417165928ff86da5a64324d10943873921a47b6ef` |
| `public/vendor/fake-world/emoji-sprite.png` | `070fd98a1642505ab310c570f1b9b4e3510eb5e215ce022f2bb62669ac47bb88` |

The release owner separately verified all 78 original SVG Git blob hashes against their manifest, and the emoji sprite against upstream blob `d642d9272594a61488ecbc4c76e44bb3e9ea313c`. The WeChatSwift code MIT license does not relicense its referenced artwork; incorporated assets and licensing are documented in `THIRD_PARTY_NOTICES.md`.

The release owner built `pipi-phone:0.3.0` for Linux/amd64 and upgraded the isolated port-18768 preview with its existing data volume. A stopped-instance backup was verified first. Business state, credentials and sessions were retained; the upgraded service reports v0.3.0 without requiring setup. Seven actually served HTTP asset hashes match the tested snapshot. The old preview remains stopped; unrelated containers were unchanged. These deployment observations are separate from this browser run.

## Limits

This is Windows Chrome with mobile viewport emulation, not an on-device iPhone Safari/Android test. Real microphone hardware, real system permission sheets, background OS behavior, iOS audio format negotiation, soft-keyboard resizing, safe areas/browser chrome, touch-device timing and audible recording quality remain unverified. Synthetic capture verifies real MediaRecorder/pointer state transitions and audio decode, not real speech recognition. Successful STT/chat/vision protocols use isolated backend mocks; commercial model availability, quality, billing and provider interoperability were not exercised. Cover-photo and other system file pickers were not automated in this UI run. No exhaustive-screen, proprietary-artwork, pixel-identical or production penetration-test claim is made.

## Desktop boundary refinement — targeted follow-up

Execution: **2026-11-14T14:56:53.407Z, 11 targeted checks passed, 0 failed** (isolated setup, eight viewport/page geometry checks, static-resource errors and browser exceptions). This is an additional CSS-only visual check; it does not replace or claim a rerun of the 23-scenario v0.3 result above. No backend suite was rerun. A temporary copy of the existing isolated CDP harness was used; no permanent test was added.

| Viewport | Phone bounds (x, y, width, height) | Outer backdrop / outline | Composer bottom |
| --- | --- | --- | ---: |
| 700 × 900 | 135, 12, 430, 876 | #c8cbd0 / 1px #9ca1a8 | 888 |
| 1440 × 1000 | 505, 12, 430, 976 | #c8cbd0 / 1px #9ca1a8 | 988 |
| 390 × 844 | 0, 0, 390, 844 | #ededed / none | 844 |
| 430 × 932 | 0, 0, 430, 932 | #ededed / none | 932 |

Both Chats and Chat were checked at each size. The desktop phone has 12px top/bottom margins, remains horizontally centered, and all four outlined edges and the full 55px composer fit. Document/body and phone shell have no horizontal or vertical outer overflow. Mobile remains edge-to-edge without an outline. The actual internal chat background remains **#ededed** at every size.

The reviewer opened the two complete desktop chat screenshots plus representative mobile chat/list screenshots. The darker desktop canvas visibly separates the phone, while mobile retains its native full-screen presentation. Evidence: `%TEMP%\pipi-desktop-frame-qa`, including `700x900-chat.png`, `1440x1000-chat.png`, `390x844-chat.png`, `430x932-chats.png`, all eight page captures, `results.json` and `ui-output.txt`.

This follow-up tested `public/styles.css` SHA-256 **bdc1efbca2c5ac671a4cbdf90bb430c454f5aeb36d1fee26f34a75871fa10353**; it supersedes only the stylesheet hash and desktop outer geometry from the earlier snapshot. The on-device limitations above still apply.
