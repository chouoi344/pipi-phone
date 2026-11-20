# v0.4.3 scene-specific reference review

Research date: 2026-11-14. This reviewer owns only this document. Product assets/code remain with their assigned owners. No private screenshot was transmitted to a search engine, GitHub, image service or external account.

## Evidence and acceptance boundary

The final target is the user's own iPhone WeChat 8.0.80 appearance. Existing direct screenshots certify only their visible states. A repository version, package version or article heading never certifies unseen native controls. Searches in this pass did not produce a version-bound, original 8.0.80 image set for the More panel, message context menu, favorites detail, chat info, friend profile, settings/status, Moments or wallet. None of those native states is marked passed here.

Previously inspected official App Store developer marketing and the user's two direct screenshots remain in `IOS-8080-REFERENCES.md` and `NATIVE-ROOT-042-AUDIT.md`. App Store marketing has no per-image 8.0.80 binding. Historical Swift clones and the accepted Android simulator are implementation/secondary evidence.

## Favorites: actual artwork inspected, not inferred from names

The accepted simulator APK is 做图 4.0.1 / package `com.moyingyuncai.zuotu`; it is not the iOS WeChat app. Its pre-existing decoded materials are under `../安卓文件/分析/resources`. Exact parent-folder spelling may be resolved by enumerating the single directory under 安卓文件. The APK's recorded SHA-256 is `067e6912d06f20922f7de091806466150db7b27356a5942222ac22095fdd6420`. This pass read existing decoded files; it did not execute or change the APK.

A local inspection montage `%TEMP%/v043-android-glyphs.png` was generated from the accepted materials and actually opened. The source artwork was not copied into the product or release.

| Scene / source filename under images/drawable | Actually visible artwork | Consequence / limit |
| --- | --- | --- |
| `icon_xwyyds_moreboard_collect__v01.webp` | Black filled three-face cube; transparent/white Y-shaped gaps between faces, on a white rounded tile | Chat More Favorites must have its own mapping. It is not the colored Me cube and not a star. Secondary simulator evidence, not certified iOS 8.0.80. |
| `ic_wx_mine_collect__v01.webp` | Blue top, yellow left and red right cube outlines | Appropriate subject family for Me > Favorites; preserve its independent colored mapping. |
| `icon_we_chat_list_collect__v01.webp` | Dark gray outline cube | A separate monochrome outline exists. Actual runtime caller was not recovered; do not claim this file alone proves the message-long-press scene. |
| `icon_xwyyds_chatings_collection__v01.webp` | Orange outline five-point star on white rounded tile | Exact trigger unresolved; cannot substitute this merely because its filename says collection. |
| User's direct emoji-panel screenshot (previous audit) | Heart-shaped category mark for favorite/custom emoji | Emoji favorites is another distinct semantic scene; cube changes must not affect it. |

The initial application used `icons.star = assetIcon('favorites', true)`, where the existing GPL SVG consists of three colored outline paths. That is a concrete scene-sharing defect when used in the chat More tile. A CSS mask can remove its color but still leaves an outline cube; it does not turn three outline faces into a filled cube. Review the painted interior/Y-gap, not just black color or SVG bounds.

Recommended public API names: `meFavorites`, `toolFavorites`, `messageFavorites`, and a separate emoji category glyph. It is acceptable for two verified scene mappings to reference the same bytes; a shared vague `star` key must not silently decide all scenes.

## All accepted simulator More-panel glyphs inspected

The montage includes the following actual art. These are static assets, not a running screenshot; their precise page order and account-dependent visibility cannot be recovered from filenames alone.

| Source stem | Visible subject / fill | Current mapping concern |
| --- | --- | --- |
| `moreboard_photo` | Filled photo frame and solid mountain silhouette | Use a scene-specific filled photo glyph, not the global outlined album. |
| `moreboard_take_photo` | Solid camera body with white lens | Keep chat camera independent from an outlined camera elsewhere. |
| `chatings_videocall` (separate file) | Actually opened: black filled camcorder body and projecting triangle on white tile; `chatting_videocall` is a tiny untiled icon and `chatting_videocall2` a pale variant | Solid WeUI video-call is the appropriate family; static filenames do not establish runtime caller or iOS version. |
| `moreboard_location` | Solid pin with white circular center | Current global location outline is a different treatment. |
| `moreboard_red_package` | Solid rectangular envelope, curved white flap and small white circle | A generic outline envelope/currency symbol is not visually equivalent. |
| `moreboard_entry_value` | Two opposite solid angular/slanted arrows, like a lightning zigzag | WeUI `transfer.svg` is actually a translation glyph; names must be inspected. |
| `moreboard_voice` | Solid slanted microphone with curved lower support | Upright mic is a recognizable approximation, not exact artwork. |
| `moreboard_collect` | Solid cube with white Y gaps | Must be split from Me colored outline cube. |
| `moreboard_persion` | Solid single shoulder silhouette | Generic contact-card rectangle differs. |
| `moreboard_people` | Two overlapping shoulder silhouettes | Distinct from the single-person file; caller unresolved. |
| `moreboard_file` | Solid folder body with white top separator | Current outlined folder is a different treatment. |
| `moreboard_gift` | Filled gift/bow silhouette with white ribbon | Keep independent from Me/card scenes. |
| `moreboard_entry_value_fast` | Filled payment-card rectangle with white short lines | Caller unresolved; not proof it is the Cards/Coupons slot. |
| `moreboard_timestamp` | Solid round clock face | Caller unresolved; not proof of native chat panel entry. |
| `moreboard_change_role` | Orange outlined person and short arrows | Simulator customization; do not add to native iPhone More panel by inference. |

The existing `layout_xwyyds_detail_moreboard__v01.xml` has a ViewPager and two 5dp dots, plus a 0.1dp top separator. `item_xwyyds_detail_moreboard__v01.xml` describes a 90dp-tall item, 50dp image at 15dp top, 10dip label and 3dp image-to-label margin. These are simulator static constants, not iPhone measurements. Neither XML includes the populated data order, so this review does not pass the app's 14-entry order, extra Gift/Pat slots or exact first-page membership.

## Public GitHub sources read and reuse assessment

### WeChatSwift: useful historical scene evidence, proprietary artwork excluded

Pinned repository: <https://github.com/alexiscn/WeChatSwift/tree/75d83cd281cd7cf2f9a7153292ab3fca260293bd>.

Actually read `WeChatSwift/Models/ChatRoomTool.swift`, blob `4c0e6f0e62d824bc4a5c47a9c0e91851679e90d0`. Its 2019 enum order is album, camera, videoCall, location, redPacket, transfer, voice, favorites, contactCard, files, coupons. Favorites maps to `ChatRomm_ToolPanel_Icon_MyFav_64x64_`, unlike Me's colorful asset. This is a historical implementation and must not be called 8.0.80 order.

Actually read `WeChatSwift/Resources/Icons/icons_filled_favorites.svg`, blob `9b5d7af15e50fa39c21884b45602fcf2381f5328`. It is visibly defined as three separate black cube-face paths divided by Y-shaped gaps, consistent with the simulator's filled cube family. This is source-shape evidence rather than just a filename.

The repository README assigns resources/App Design to WeChat; MIT code does not establish redistribution rights for those images. Do not copy its icons, tool-tile PNGs or screenshots into the release.

Actually fetched and opened historical screenshots `Screenshots/04.png` (Discover, blob `611653bd7032ee31ef2d21b44a82eba8e3aea30f`) and `Screenshots/07.png` (Me, blob `f808f158e2a222b854058769006f11e914167863`). Screenshot 07 visibly has a colored outline cube only in Me > Favorites. Its old Me hierarchy includes Pay, Favorites, Album, Stickers, Settings and a top camera; it does not certify today's Me entries, status pill or camera. Screenshot 04's old Discover list likewise must not impose old Shake/Nearby People on 8.0.80. Temporary files `%TEMP%/v043-swift04.png` and `v043-swift07.png` are internal research only.

Other downloaded base64 responses were not persisted or viewed; no visual outcome is claimed for them.

### WeUI: official public MIT glyphs inspected

Pinned tree: <https://github.com/weui/weui-icon/tree/c9dc64ea1a9c4ba87c018bed214eb8731e6e2e04>. `package.json` explicitly declares MIT; the actual distributed SVG headers state WeUI Icon v1.0.2, Copyright 2021 Tencent, Inc., MIT. The README describes it as WeUI's icon library. This is official reusable web design material, not a native WeChat 8.0.80 specification.

| Public source path | Blob SHA | Actual source shape / suitable scene |
| --- | --- | --- |
| `dist/filled/album.svg` | `aa2fc64cd13935333515d37afeb6cfce1a89c93a` | Filled photo family; existing local licensed filled album available. |
| `dist/filled/camera.svg` | `9bbd94a3841e562e9a904c1000d2610eeaaacf06` | Filled camera family; existing local licensed filled camera available. |
| `dist/filled/location.svg` | `a6fac1c09898cd7d46776ff7d5ccb6e17da1d1f1` | Solid teardrop pin with circular hole. |
| `dist/filled/folder.svg` | `68127665791879c8f10500080ddc2eb87bc29da9` | Solid folder with a white horizontal internal separator. |
| `dist/filled/me.svg` | `bfc969d037c252d723650be7a52cdbe43ba7716e` | Solid single shoulder silhouette. |
| `dist/filled/mike.svg` | `7c7911a3678e00f7d6d0a9c92b7f7ba77a119d17` | Solid upright mic with support; simulator is slanted, so this remains approximate. |
| `dist/filled/video-call.svg` | `7c4532bbea638852b6f0d296322514f904660d38` | Solid camcorder body and separate triangular projection. |
| `dist/filled/transfer.svg` | `2f19f188d441bdf19f7dbe471c98a68f7cdb1ef8` | **Chinese/Latin translation sheets, not money-transfer arrows. Reject for Transfer.** |
| `dist/filled/transfer2.svg` | `6f5c02711f95ff5ce0ee44f057ab283300c74dae` | Black circle containing two arrows. Different from accepted standalone zigzag arrows. |
| `src/assets/outlined/star.svg` | `7dbf827724b196ef128740cace0972e4cc5fa072` | Five-point outline star. No evidence supports using it for chat Favorites. |

No cube/favorites SVG exists in the inspected WeUI tree. Do not invent a source path or describe a generic star as the native Favorites icon. If the product derives a filled cube from the already licensed GPL fake-world outline geometry, preserve original bytes/notice, identify the derivation and compare its painted three faces separately. That is a licensed geometric adaptation, not a copied native asset or a native-passed state.

Other candidates actually read: Templarian MaterialDesign `svg/cube.svg` has a hollow top-face cutout and is not the three-face white-Y target; `cube-outline.svg` is an outline. Its LICENSE identifies Apache-2.0 for icons. Bootstrap `icons/box-fill.svg` is MIT with actual license read, but its box proportions/edge cuts differ; it is only a generic alternative. Tabler `icons/filled/cube.svg` and `filled/box.svg` returned 404; these are not available verified candidates.

### Community theme resource table: secondary textual corroboration only

Actually read the complete source file at <https://github.com/natsumecy/wechat-theme-guide/blob/main/docs/WeChat/WeChat_8.0.54及以上图标汇总.md>. It separates Me colorful Favorites from official chat More filled Favorites and says long-press Favorites follows the latter. The table includes third-party plugin sections, unresolved entries and version caveats. It supplies no inspected original 8.0.80 screenshot or transferable Tencent-artwork license. Use only to locate potential scenes, not as visual acceptance or authority to copy art.

## Deeper-page evidence and limits

Accepted simulator `wei_act_moments__v01.xml` was read in full. It uses a 280dp cover image with scaleType 6, a 55dp avatar at top245/right15 (overlapping the cover bottom by20dp), a white18dip name at the cover's bottom-right beside the avatar, an overlaid white back button and white camera, and a title initially GONE. This supports the **hierarchy** of cover, overlapping identity and overlaid controls. Those constants and default visibility cannot be promoted into native iPhone geometry or runtime scroll-transition proof.

Accepted simulator `wei_act_address_book_detail__v01.xml` was inspected. It contains a profile/header section, separate remark/permissions area, signature row, media strip, more-information/source rows and separate action regions. These are editable simulator layouts with conditionally hidden items; they do not certify native iPhone visible membership or exact sizes.

A current primary **textual** source was opened: <https://oper.my-qcloud.com/cgi-bin/readtemplate?lang=zh_CN&s=privacy&t=weixin_agreement>, “微信隐私保护指引”, updated2026-08-17. The equivalent weixin.qq.com URL failed in this retrieval. Relevant independently located statements establish only feature semantics: section1.29 describes server-stored Favorites and tags/note editing/deletion; section1.4 lists Moments text, media, comments, likes and cover; section1.24 identifies chosen status icon, background and location; section1.32 lists editable profile fields. This is not a visual source and does not prove 8.0.80 page geometry.

A Tencent Ads-hosted2024 training PDF was surfaced by search with a long-press-menu image description, but actual PDF open timed out then returned403. No page was visually inspected, so no artwork pass is claimed. A Xiaomi-hosted teaching PDF exceeded the research browser's content-size limit; its search description of newer panel entries is insufficient for a native screenshot judgment. Public tutorials with explicitly old versions and generic search-result image descriptions were not promoted into acceptance evidence.

## Final visual handoff

Product freeze review still must open actual DPR3 neutral captures. Priority checks: filled cube interior/Y-gap; independent Me colored cube; all More first/second-page actual fill shapes and labels; context-menu white/black monochrome behavior; contact/person versus card; Cards color separation; persistent root geometry; profile/media-strip hierarchy; Moments cover overlap and camera contrast; Favorites detail controls and return path.

Functional tests or DOM counts cannot close native visual gaps. If a native reference is missing, record the implementation screenshot as reviewed for legibility/coherence only and leave native fidelity pending. No unviewed screenshot or unopened state is marked passed.

## Implementation and diagnostic review update

The authorized five filled WeUI tool assets were added at `public/vendor/native-icons/tool-{location,folder,mike,video-call,me}-filled.svg`, with unique same-name originals in `originals/`. All five original Git blob SHA values matched, all five MIT headers remained, and reversing the single root-fill addition reproduced each original byte string. Source records and third-party notice were updated. The core owner was given the new scene-specific names.

The independent DPR3 product diagnostic `%TEMP%/pipi-v043-diagnostic2/043-chat-favorite-art.png` was actually opened. Its Favorites tile now visibly contains three dark filled cube faces separated by white Y gaps; the old Me-style colored outlines are absent. This closes that specific wrong-scene-artwork defect against the accepted secondary family. It does **not** close iPhone 8.0.80 native fidelity. This early diagnostic still shows outline video/location/red-packet/transfer and the circular wave in the Voice Input slot; the subsequent tool-glyph change must be reviewed in a newer capture. It also predates the requested desktop phone status/bottom-area work.

## Phone-frame reference check

Actually read the existing licensed fake-world `packages/web/src/components/StatusBar/index.tsx`, pinned revision `de336cfc469772bccdf00ef1f91bfbf8d3953d08`, blob `a6b4accb664677f4481a0bc85a274ce7d3d1359b`. The structure is left current `HH:mm`, right separate signal/network/battery group, independent background and dark/light theme; it refreshes each second. Its Tailwind padding is implementation history, not native iPhone inset measurement. Reusing the structure/art requires retaining GPL source notice; simulated signal/battery are desktop phone-preview chrome and must not pretend to read the user's actual device hardware.

Official WebKit source opened: <https://webkit.org/blog/7929/designing-websites-for-iphone-x/>. It documents viewport-fit cover and four safe-area environment values; content padding then protects the sensor/home-indicator regions. Safe insets are distinct from ordinary content margins, and max(default margin, env inset) preserves a minimum side margin. For this product the implication is that desktop simulated47/34 and real mobile env insets need one coordinated owner, never both summed. A desktop preview may render the user-requested time/status/gesture frame; actual mobile system chrome must not be duplicated in webpage content. Historical source values cannot prove a modern iPhone's safe-area size.

The desktop-frame owner also authorized three GPL fake-world StatusBar SVGs. `signal.svg` blob `8e9f658643c678faab62caa262383a9e43910157` (709bytes), `wifi.svg` blob `8497d355f74c8f74d60ab663d51be150db47d686` (1518bytes), and `battery.svg` blob `fe495efd0cb73313c0e9120993294d6699166f73` (405bytes) were fetched from the pinned StatusBar/assets path, their original Git blobs matched, and unchanged bytes were saved in `icons/`. Independent mask derivatives change only root fill from none to black. Manifest/notice record the source and desktop-only illustrative use. The battery's original interior is partially filled, not a measured or full charge; no numeric hardware state should be attached to it. The clock is current client time, not the private reference's frozen time.

A second diagnostic review opened `043-favorite-detail.png` and `043-profile-more.png` from diagnostic2. The literal escaping fixture, source footer and profile-row text were legible; no native fidelity is inferred. The Favorites detail More control visibly had only two dots. The feature owner inspected its upstream `more-2-outlined` SVG and confirmed it really contains two circles, so this was a wrong-artwork selection rather than clipping. The owner changed that scene to licensed `more-filled` (three dots). Final screenshot verification of this correction remains pending.

The core owner reports project-authored filled envelope/angular-transfer/gift glyphs and the separate GPL-family cube adaptation, with tool-only mappings. These are recorded in the third-party notice as secondary-reference geometric approximations. This source handoff is not a visual pass; final captures must still show their actual paint.

## Final phone-frame implementation boundary

The frame owner's v0.4.3 implementation uses a47px top and34px bottom simulated region only in a fine-pointer, non-mobile desktop preview. Those are this preview's chosen dimensions; they are neither a WeChat specification nor a standard for all iPhones. The status artwork is fixed illustration with no network/battery telemetry. The clock uses current client timezone/time. On mobile/coarse-pointer devices the simulated bars are hidden and only actual CSS safe-area environment insets are reserved; content must not add a second47/34 region on top. Deep pages, sheets, dialogs and the bottom composer need actual screenshot review under this same boundary. This is the product's declared model, not a claim that a device's native safe values have been measured. The WebKit source and separate inset-versus-margin principle were inspected above.

## Targeted frame and avatar images actually reviewed

Opened a contact sheet made only from diagnostic7's actual DPR3 desktop captures: chats, Me, emoji, profile-editor, payment, note-dialog, photo-overlay and dark-status. The sheet crops the centered phone region from each4320x3000 image (x1512..2808) and scales for overview; individual source files remain the detail evidence. The time plus three status symbols and gesture bar are visible across root/deep pages, dark/photo use white glyphs, dialog shading covers the phone frame, Me retains its colored cube, and the editor fits between the preview system regions. The frame owner separately identified a bottom background color seam on root tabs in this diagnostic and changed the surface-priority logic; diagnostic7 does not close that later fix.

Also directly opened diagnostic7 `043-frame-short-editor-430x320.png`, `043-frame-coarse-safe-chats.png`, and `043-frame-coarse-safe-profile-editor.png`: short-screen content/Save/gesture region remain visible; coarse mode has no simulated time/status/home bar and retains the test-injected safe padding; no real device was inspected. Directly opened diagnostic6 `043-modal-moment-audience-320.png`: both chosen-contact avatars are square again, with names and checkboxes separated; the former horizontally stretched avatar is absent in this viewed state. These are implementation-layout judgments only, not native WeChat screenshot matches. Final all-state capture and the bottom-surface correction remain pending.

### Corrected frame recheck

Actually opened a new contact sheet from `pipi-v043-frame-status-recheck` desktop chats, Contacts, Discover, Me, profile-editor and dark-status. The root-tab bottom surface now visibly continues through the gesture region; the earlier gray/light seam is absent in these reviewed images. Dark status uses white status/gesture marks over the dark surface and its content remains readable. Profile editor has separate top/bottom preview regions. The four root titles, symbols and labels are readable without visible overlap. This closes the identified preview color-seam/layout defect in the tested captures; it is not a native system-chrome or iOS8.0.80 certification.

## Frozen-source full2 More-panel and inner-page images

Actually opened `pipi-v043-ui-final2/390-chat-more.png` and `390-chat-more-second.png` individually at their DPR3 source resolution. First page now visibly paints filled photo/camera/camcorder/pin/envelope/angular opposing arrows/upright mic/three-face cube. The cube has a clear internal Y gap; the envelope has white curved flap/dot; transfer has no outer circle; Voice Input is no longer mistakenly the circular waveform. Second page visibly paints filled shoulder/folder/gift; Cards is monochrome rather than Me's colored card artwork. Both pages have separate tiles/labels and no observed glyph overlap or clipping. WeUI alpha makes some glyphs slightly lighter than the existing full-alpha photo/camera; exact native contrast is not certified.

This supports completion of the wrong-scene/mixed-outline-family repairs against the accepted secondary family. It leaves native14-entry membership/order, Cards/Music/Pat exact art, microphone slant and native iOS8.0.80 geometry pending. Those cannot be closed by the functional suite.

Also actually opened full2 `390-contact-profile.png` and `390-chat-info.png`. Profile avatar/identity/rows/actions are separated and the header has three dots. Chat-info rows/toggles/member areas are legible. Its dashed square Add Member still contains an extra circular-plus glyph; the earlier native audit had identified this historical mismatch. It was reported to the core owner for a freeze decision, not silently approved as native-correct.

Additional full2 images actually opened: `390-me.png` confirms Me's blue/yellow/red outline cube remains separate after chat-tool changes, with status pill/QR/arrow spaced apart. `390-friend-moments.png` shows the selected friend's name/avatar over an overlapping cover and that friend's fixture post; no publish-camera control is visible in this friend view. `390-message-menu.png` shows a readable text-only dark action menu with Favorites among its actions, not the new filled cube. This text-only state does not certify icon-bearing native long-press artwork, membership or order. These three are reviewed only for scene separation and coherent actual paint.

### Final Favorites and Moments closure

Actually opened full2 `043-favorite-detail.png`: the top-right More glyph now has **three visible dots**, and the four-character title remains one line. This closes the previously observed two-dot wrong-asset defect in the product image. Literal content and source footer remain readable; the green return-button outline is the QA focus indication, not a claimed native style.

Actually opened full2 `043-moment-audience-image-draft.png`: selected/unselected contact avatars remain square, selected checkbox and names are separated, long names truncate, and the validation message is visible. This independently confirms that the stretched-avatar defect is absent in the final expanded state as well as the earlier320px image. No native8.0.80 acceptance is inferred for this custom audience implementation.

Review completion: all source/license/hash statements above were checked directly as described, and only the enumerated images were visually opened. Functional suite results, unviewed states and exact native dimensions remain the QA owner's separate evidence. The retained native pending list covers More membership/order and exact glyphs, typed/native-keyboard/voice states, other root selected-state exactness, profile/chat-info/Me/settings/status, Moments and personal album, payment/wallet and Favorites-detail native geometry. Implementation coherence and corrected artwork family are explicitly separate from native acceptance.

## Last targeted fixes: final document closure

Actually opened `%TEMP%/pipi-v043-last-fixes.png`, a three-image composite of the final targeted fixes. In `core043-member-add-plain-plus`, the member tile now contains a plain plus inside the dashed square; the extra circular ring is absent. This closes the specific wrong-scene circle-plus artwork issue raised during this review. In `core043-avatar-reupload-preview`, the avatar preview, Change control and Save are visible; the misleading Remove entry is absent. In `043-frame-desktop-comment`, the comment field and Send remain entirely above the separate gesture area, and the gesture mark is unobscured. This closes the observed preview layering problem for this shown state.

Actually opened `%TEMP%/pipi-v043-final-cover-review.png`, a four-image composite covering default cover top, chosen cover top, chosen cover scrolled and short-screen long confirmation. The default and chosen cover surfaces extend behind the desktop-preview status text/symbols; top-overlay back/camera and status marks are white with readable contrast. With the chosen cover scrolled away, the header becomes a light bar with a centered one-line Moments title, dark back/camera and dark status marks; feed text remains clear below it. The short-screen confirmation keeps Cancel and destructive Clear visible while the long explanatory body has its own scroll region, and the bottom gesture region stays separate. These observations close the concrete cover/status-surface, scroll-header and short-confirmation preview defects shown in the composite.

The composites provide the last targeted visual evidence for these explicitly identified implementation defects. They do not certify the exact native iPhone WeChat8.0.80 dimensions, glyph shapes, native system chrome, keyboard or all unpictured input states. The native-pending list above remains in force. The final full3 functional run is separate evidence owned by QA; no full3 result is claimed by this document before that run completes. No further product edits were made by this reviewer.
