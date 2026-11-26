# iPhone WeChat 8.0.80 reference research

Research date: 2026-11-14. Research only; no product code changed. Public screenshots downloaded for internal comparison are outside the application in `../../参考资料/reference-v05/research/`. They are not licensed release assets.

## Evidence boundaries

The Apple App Store currently lists WeChat 8.0.80, October 23, with only the generic bug-fix release note. This establishes the version's existence. It does **not** establish exact tab-bar/composer geometry or which account received which UI experiment.

Primary source: <https://apps.apple.com/cn/app/%E5%BE%AE%E4%BF%A1/id414478124> (version-history section inspected). The corresponding US listing is <https://apps.apple.com/us/app/wechat/id414478124>. The WeChat website <https://weixin.qq.com/> failed to open through the research service; no content from that failed request is claimed as checked.

The App Store screenshot gallery is official developer-supplied marketing imagery. It is current at retrieval, but the screenshot content is not explicitly tied to build 8.0.80. Use it to verify broad structure and icon family, not as a per-version pixel specification.

The user's `reference-v04/IMG_0463.PNG` is the accepted direct visual reference for the visible emoji-open state. The image itself has no version/About screen. Its UI must not be overwritten with a different media screenshot solely because the latter names a version number.

## What was actually viewed

| Reference | Local research image | Visible evidence | Limit |
|---|---|---|---|
| User's iPhone chat | `../../参考资料/reference-v04/IMG_0463.PNG` | Empty text box with plain gray microphone inside its right edge; circle wave button to the left; circle keyboard and circle plus to the right. Emoji category strip below composer, then a distinct panel with drag handle, recent section, full emoji section, disabled delete/send controls. | Only this state is visible; no root tabs, typed text, native keyboard, or More panel. |
| Official App Store message list | `../../参考资料/reference-v05/research/appstore-list.webp` | Four bottom tabs: 微信 / 通讯录 / 发现 / 我. Selected chat is solid green. Other visible glyphs are thin dark outlines: person with horizontal lines, compass circle, shoulder silhouette. | Marketing phone is scaled into a green poster; exact iOS points and safe-area dimensions cannot be inferred. |
| Official App Store group chat | `../../参考资料/reference-v05/research/appstore-group.webp` | Empty composer with circular wave, white text box, circular smile and plus. No microphone is visible inside this particular marketing image. | Not a complete 8.0.80 state sample. |
| Official voice/voice-to-text marketing | `../../参考资料/reference-v05/research/appstore-voice.webp`, `appstore-voice-to-text.webp` | Recording overlay and gesture targets for cancellation / text conversion. | Does not establish normal empty/typed composer layout. |
| Official emoji-search marketing | `../../参考资料/reference-v05/research/appstore-emoji-search.webp` | Search appears as a distinct sheet with search field and result tabs. | Not the normal emoji grid panel. |
| IT Home 8.0.78 composer crop | `../../参考资料/reference-v05/research/ithome-8078-composer.png` | Gray microphone combined with a partial rectangular speech/text outline inside the text box. | Third-party report; different from user's plain microphone. |
| Keyboard-swift preview | `../../参考资料/reference-v05/research/keyboard-swift-preview.png` | Old paged emoji panel and category strip. | 2017 imitation, visibly different from the user's current panel; never a contemporary original WeChat reference. |

## Public reports and gray-release uncertainty

IT Home's 8.0.78 report explicitly describes repeated composer experiments, including a fourth change that removes the centered hold-to-transcribe hint and adds a new right-side voice-to-text icon. It explicitly says the reported changes remain in gray rollout. This is third-party observation, not a Tencent specification. It supports the practical limit that a version label alone does not uniquely specify the account's composer appearance.

Source and inspected image:

- <https://www.ithome.com/1/000/420.htm> (2026-09-09, composer section and final gray-rollout caveat).
- <https://img.ithome.com/newsuploadfiles/2026/9/3eba193f-0973-440a-bc8e-2014c6d8c5ec.png>.

IT Home's 8.0.80 report describes a setting to hide the hold-to-transcribe hint, while retaining the gesture. It also mentions four bottom sections on the folding-device layout. Its image links retrieved by the text browser initially resolved to lazy-load placeholders; the article HTML was then inspected for real image URLs. Do not claim those placeholders are screenshots or infer ordinary iPhone tab geometry from folding-device discussion.

Source: <https://www.ithome.com/1/017/244.htm> (2026-10-23; equivalent mobile page <https://m.ithome.com/html/1017244.htm>).

These reports are useful context for conflicting screenshots. They do not prove that every 8.0.80 account has any one of the three observed composer variants (no mic, plain mic, mic with rectangular outline).

## Official image URLs

The following URLs were extracted from the App Store page HTML, downloaded, and visually inspected:

- Message list: <https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/3a/7c/c0/3a7cc040-d052-2e73-e960-ae82a1a73d95/f16bbc2e-b684-4522-ada1-296d50023e2c_1_U6d88_U606f_U5217_U8868_ios_1242_U00d72688.png/600x1300bb.webp>
- Group chat: <https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/14/fe/c5/14fec578-2c78-1013-e936-2bbaf52e5468/20ccefe0-5aa4-4178-99ef-3cfc4c403703_2_U7fa4_U804a_ios_1242_U00d72688.png/600x1300bb.webp>
- Voice: <https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/7f/3f/86/7f3f866b-5770-469d-c664-ecb5ba36e808/_U8bed_U97f3_U8f93_U5165_1242_U00d72688.png/600x1300bb.webp>
- Voice-to-text: <https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/39/a7/5b/39a75b8a-3171-86e7-8cbf-cbb2ead6af30/_U8bed_U97f3_U8f6c_U6587_U5b57_1242_U00d72688.png/600x1300bb.webp>
- Emoji search: <https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/34/84/5e/34845e07-3160-3c11-3412-cacfd44792f6/7134e97d-a290-4866-bc61-a90074386843_6_U8868_U60c5_U641c_U7d22_ios_1242_U00d72688.png/600x1300bb.webp>

## GitHub search and reuse assessment

Actual searches included `site.github.com "8.0.80" "wechat"` and iOS WeChat composer/keyboard searches. No inspected GitHub repository supplied a verified original 8.0.80 screenshot set covering root tabs plus empty, typed, keyboard, emoji and More states. An Android 8.0.80 APK archive appeared; it is irrelevant to iPhone UI and was excluded as a target reference.

An additional licensed historical module was inspected:

- Repository: <https://github.com/cwwise/Keyboard-swift>.
- Pinned latest commit inspected: `f6ad139812423f1b8ef268758ea1027156836ef6`, dated 2017-10-24.
- License: MIT, copyright 2017 cwwise; license body inspected at <https://github.com/cwwise/Keyboard-swift/blob/f6ad139812423f1b8ef268758ea1027156836ef6/LICENSE>.
- Concrete code inspected: `Sources/Keyboard/ToolView.swift`, Git blob `9fe73d39da15477f1512519c79e5baf577b02460`, via GitHub API. It models none / keyboard / audio / emoticon / more, swaps keyboard glyphs when a panel is open, and reports state changes to a delegate. Its old constants (42×49 button frames and 36 text height) are implementation history, **not 8.0.80 measurements**.
- Concrete preview inspected: `Preview/Emoticon_1.png`, Git blob `0e6d98930d6c8c5693674d385060e63592dc450a`.
- Useful reuse scope: historical state-model ideas or MIT code with notice preserved. No code/assets were copied into the product in this research task. A repository-wide MIT notice is not independent proof of rights to extracted WeChat artwork.

The already-known WeChatSwift repository was also re-opened: <https://github.com/alexiscn/WeChatSwift>. Its own README says resources/App Design belong to WeChat and prohibits commercial app use. Its MIT code license therefore must not be described as blanket permission for Tencent artwork. It is historical implementation evidence, not proof of 8.0.80 visual fidelity.

## Current product comparison and remaining gaps

The current `public/app.js` uses four root tabs with fake-world address-book / discover / people assets. Their inspected SVG paths match the broad icon subjects shown in Apple's official marketing image. The 390px Contacts and Me renders in `C:/Users/<用户名>/AppData/Local/Temp/pipi-ui-v04-final5/` were visually inspected. This broad similarity is not evidence of exact target fidelity.

The chat glyph has an unfilled inactive state through `public/styles.css` (`.tab .chat-mark`) and a filled active state through `.tab.active .chat-mark`. Looking only at its filled SVG path would incorrectly report an always-solid icon; that claim is withdrawn.

Still unverified by a version-bound original screenshot or recording:

- All four root tabs active/inactive at the same iPhone size, including exact outline weight, icon bounds and baseline.
- Typed composer, native keyboard appearance and native keyboard transition for 8.0.80.
- More panel, panel switching and dismissal at 8.0.80.
- Exact composer pt dimensions, hit regions and safe-area behavior.
- Which account/gray configuration the user's plain microphone screenshot represents.

Do not invent dimensions or fill these gaps by combining different versions and different experiments. The user's visible state remains the direct comparison target; additional states need direct evidence or an explicitly labeled approximation.
