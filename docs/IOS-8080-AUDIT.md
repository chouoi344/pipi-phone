# iPhone WeChat 8.0.80: independent skeptical visual audit

Date: 2026-11-14. This audit reviews the supplied native screenshot first, then the v0.4 final5 captures. **The historical findings below describe that old snapshot. Current source implementation and v0.4.1 DPR3 results are recorded in the later dated subsections; do not read old findings as proof of current unfixed defects.** It does not accept the earlier functional pass as a visual pass. No product files, production state, or user-visible browser were changed.

## Evidence and comparison limits

- Native evidence: `reference-v04/IMG_0463.PNG`, 945 x 2048, internally inspected. The user identifies the target as iPhone WeChat 8.0.80. The image itself does not show its version; its direct coverage is a one-to-one chat with an empty input and the all-emoji drawer open. No private image, avatar, contact name, or conversation is copied into this document or release.
- Current evidence: `%TEMP%/pipi-ui-v04-final5`, especially `390-chat-emoji.png`, `390-chat-emoji-first.png`, `390-chat-more.png`, `390-chat-failed.png`, `390-chat-voice-failed.png`, `390-chat-voice-cancel.png`, four 390-wide root captures, settings and chat-information captures. These are the previous final5 state, not proof of future working-tree changes.
- Native measurements use scale 390/945 = 0.412698; multiply original pixels by this number. Approximate visual measurements have about 1 CSS px tolerance unless an exact pixel run is given. Screenshots are not equivalent to device certification.
- Native is roughly 2.423 screenshot pixels per normalized CSS px; final5 captures are DPR 1. Enlargement makes current edges blurrier. Do not infer wrong stroke weight from this sampling difference. Recheck SVG geometry at DPR 3 before changing stroke weight.
- The native and current PNGs contain only IHDR/IDAT/IEND chunks: no iCCP, sRGB, gAMA, cHRM or eXIf. Raw RGB values are measurable, but the original color-space intent cannot be proven. One-channel differences are low-priority evidence, not a reason to replace all CSS colors blindly.
- Historical WeChatSwift and fake-world sources are useful implementation/provenance material. They do not establish the appearance of WeChat 8.0.80.
- Additional official evidence: the App Store message-list marketing image, independently opened locally at `reference-v05/research/appstore-list.webp`, shows a single chat bubble, a person with horizontal lines, a compass circle and a shoulder silhouette. This supports the broad four-tab glyph family. It is developer-supplied current marketing imagery, not a screenshot explicitly bound to build8.0.80. Source URLs and retrieval details are recorded in [IOS-8080-REFERENCES.md](IOS-8080-REFERENCES.md).

## Historical v0.4 final5 findings (not a current unfixed-defect list)

| Area / skeptical question | Native evidence | Current final5 difference | Acceptance method |
| --- | --- | --- | --- |
| Chat text: is 17px actually the right size? | Six-character short bubble spans x164..486 inclusive = 323 native px = 133.30 normalized px. A four-character bubble spans x164..400 inclusive = 237 = 97.81 normalized px. Width difference / two characters = 17.75 px/character; character starts near 197,240,283,327,371,416 imply approximately 18px advance. | Source and captures use 17px text, Noto Sans SC on the Windows runner. An 18px advance is better supported by the native screenshot. This is a size finding; it does not prove an identical font face. | Use synthetic, nonprivate Chinese strings of four and six characters with the same character count. Compare bubble width and glyph advances at DPR 3; verify short bubble height separately. |
| Chat geometry: do avatar and text start in the same place? | Avatar about x30..132: 42.5px wide after normalization. Bubble left x164 = 67.68px; avatar-to-bubble gap about 12.8px. | Current avatar is 40px at x12 and body starts x62: body is approximately 5.7px too far left. Current gap is 10px. | Compare both incoming and outgoing neutral-avatar fixtures; assert 42-43px avatar, approximately 13px gap and approximately x68 incoming body. Do not copy supplied avatars. |
| One-line bubble: should increasing font size also increase the whole bubble? | Native short bubble height approximately 104 original px = 42.9px. Corners about 4-5px normalized. | Current 17px x 1.45 + 18px padding yields approximately 42.65px: its one-line height is already close. Raising font-size with the same proportional line-height can accidentally increase height to 44.1px. | Measure text advance, line-height, padding and final height separately, including two-line Chinese text and narrow viewports. |
| Empty emoji input row: is the entire row wrongly sized? | Top y934 = 385.46px. Field x121..724 = approximately 50..299px; field height approximately 41-42px. Outer voice/keyboard/plus circles about 27-28px. | Current top y385, field x50..299 and height42 are close. A blanket claim that every input-row dimension is wrong is unsupported. | Preserve the well-supported field geometry while testing internal glyphs and vertical alignment independently. |
| Category toolbar: are centers correctly aligned? | Search / smile / heart / selfie centers approximately x31 / 85 / 140 / 194; active white tile starts approximately x62. | Current centers approximately x39 / 93 / 147 / 201; active tile starts x70. The toolbar is shifted right about 7-8px. | Overlay only the nonprivate control regions at equal normalized scale; compare center positions, not CSS icon-box width alone. |
| Input microphone: is it the same symbol? | Native microphone has a rounded capsule, surrounding U, and a short stem below. | Current self-drawn microphone has a horizontal foot at its stem; its visual center is about 3px farther right. DPR cannot explain the extra foot. | Inspect both SVG path and DPR 3 output; compare capsule width/height, U clearance, stem and center relative to field right edge. |
| Emoji grid: is its vertical rhythm aligned after the headings? | Visible saturated-pixel centers of first-column emojis: y670.22,719.75,769.89,819.62. All-emoji title visible bounds y621.11..634.32. | Current visible-pixel centers y677.5,727.5,777.5,827.5: about7-8px lower. Current all-emoji title bounds y621..634 already align. Seven horizontal centers are close; this is a title-to-grid gap finding. | Match neutral recents count or compare from the all-emoji heading baseline; inspect every visible row center, not just overall drawer percentage. |
| Floating delete/send: does being in the bottom-right prove fidelity? | Native buttons approximately y764..810, leaving about34px below them at normalized844px height. | Current approximately y773..819, bottom gap25px. They are about9px too low although within the board and clickable. | Assert target bottom inset and actual button outlines with safe-area conditions stated; a broad within-board check is insufficient. |
| Colors: are current named grays the exact sampled native colors? | Raw samples: chat #ECEDEC; composer/categories #F5F6F5; white field/bubble/active tile #FEFFFE; board #ECECEC; green bubble #95EC69; disabled keys #E0E0E0. | Current #EDEDED / #F6F6F6 / #FFFFFF / #ECECEC / #95EC69 / #DEDEDE respectively. Color intent is unknown because profile metadata is absent. | Retain raw measurements as evidence. Prioritize geometry and shape; confirm color-managed device capture before treating tiny channel differences as exact CSS targets. |
| Navigation material: is a uniform gray really native? | Native left/center background around y80..219 is #ECEDEC, while x700 varies from #E7EDE3 to #E6EDE1 and #E7EDE5; the right edge also varies. Green/photo content lies below this area. | Current topbar is uniform gray. A translucent blur material is a plausible explanation of the native tint; a single screenshot cannot establish scroll-under behavior. | Capture a neutral native screen and a screen with contrasting content beneath the navigation bar before implementing material/scroll changes. |

## State coverage and uncertain areas

| Area / skeptical question | Available native evidence | Current evidence and remaining uncertainty | Acceptance method |
| --- | --- | --- | --- |
| Top navigation: title size, back hit area, ellipsis | Supplied native chat navigation only. | Current title appears smaller; differing contact names, missing system status bar and different unread state prevent direct full-header pixel comparison. A gray unread circle must not be reported missing merely because the current fixture has no unread messages. | Compare same-length synthetic title at normalized scale; measure glyph advance and icon bounds; validate unread=0,1,99 independently. Separate web viewport chrome from app navigation. |
| Voice/keyboard/plus/search/smile/heart/selfie glyphs | Native empty emoji state exposes all these symbols. | Field and outer circles are close, but internal strokes/curves still need DPR 3 inspection. The enlarged DPR1 capture is insufficient to prove weight differences. Toolbar shift and mic foot are the strong findings above. | Compare visible-path bounds, circle radius, ray/arc count, key count, plus arm length, mouth gap and heart-lobe curve on normalized DPR 3 controls. |
| Empty input outside emoji mode | No supplied native closed-drawer capture. | `390-chat-failed.png` shows an empty row. The original screenshot proves the open-emoji state only. | Obtain an 8.0.80 closed-drawer state and compare field height, row insets and left/right symbol selection. |
| One-line typed / whitespace / long typed input | No supplied native typed input. | Final5 functional tests cover text entry and token deletion but the reviewed final captures do not prove the typed row's visual geometry. The current source swaps plus for send outside emoji mode and retains an internal mic. Whether each typed state matches native is unproven. | Capture empty, one Chinese character, several words, whitespace-only, caret-selected text and emoji-only text at DPR3; obtain corresponding native states. |
| Multiline input | No supplied native multiline input. | Final5 chat captures mostly show long sent bubbles, which are not multiline-editor evidence. Source permits textarea growth up to116px; exact native max-lines and scrolling remain unknown. | Capture 2,3,max lines, then one additional line; verify scroll, cursor visibility, row baseline, send width and icon anchoring on iPhone keyboard. |
| More drawer and page two | No supplied 8.0.80 more screenshot. | Current shows a four-by-two grid and two pages. Historical 64px tiles and 2019 layouts establish history, not today's entry order, labels, artwork, heights or paging. | Obtain target-version both-page screenshots and swipe behavior before claiming current order/spacing is verified. |
| Voice idle / holding / slide-cancel | No supplied native voice states. | Current has press-to-talk button and a full red cancel overlay. Functional recording/cancel success does not verify native overlay, waveform, wording, color or transition. | Native target screenshots/video for idle, hold, upward drag, release, too-short and permission denial; test visible touch timing and real keyboard transitions. |
| Four-root bottom tab bar | Supplied private screenshot has no tab bar. Official App Store message-list marketing image does show the single bubble / person-and-lines / compass / shoulder glyph family. | Current glyph subjects agree with that broad official evidence. Source and CSS explicitly select outlined inactive / filled active glyphs, including the chat path. Exact8.0.80 curve, weight, label baseline and safe-area geometry remain unverified; single-versus-double-bubble speculation is withdrawn. | Obtain all four native selected states; compare each selected/unselected visible path, label baseline, unread badge and home-safe-area spacing at matched scale. |
| Chat list / contacts root | No target-version root screenshot. | 72px rows,48px avatars and grouping derive partly from historical sources. Final5 fixtures include long test names, which are not useful visual proof. The historical captures must not be treated as proof of the current working tree. | Use short neutral fixtures; compare search, header, row separator, name/time/preview baseline, tool order and alphabet rail against current native. |
| Discover / Me roots | No target-version root screenshot. | Current has custom farm entry and historical native-like sections; icon provenance and clickable routes do not establish8.0.80 order, section spacing or profile header. | Compare every section and icon to target native; mark intended product-specific additions separately. |
| Chat information / contact profile / contact more / remark / tags / personal information | No target-version native examples supplied. | Current pages exist and functional routing is tested; exact typography, group gaps, add-member glyph, switches and row labels remain unverified. | One target screenshot per distinct page; inspect each row, separator inset, control scale and navigation return. |
| Moments feed / friend album / own album / compose / comments | No target-version native examples supplied. | Current data filtering, compose and comments work. Their native geometry and photo/text arrangement are not thereby verified. | Target-version reference for each distinct layout and nonempty state; compare cover, avatar, author text, image grid, action menu and comment input. |
| Wallet / Services / transfers / red packets / details | No target-version native screenshots supplied. | Current states are virtual-accounting product behavior. Historical source and functional cent accuracy do not prove native typography, number glyphs, card artwork or receipt layout. | Review target forms/cards/details separately; retain truthful virtual labels and test exact stored amounts independently of appearance. |
| Sticker management / search / favorites / selfie / store | Native only shows the all-emoji category. | Current unavailable/empty/search states are product decisions, not proof of native8.0.80 blank states or headers. | Obtain references for the states intended to be visually matched; clearly distinguish unavailable service handling. |
| Settings and AI pages / ledger / farm | No native equivalence expected for custom business functions. | Settings hierarchy is product-specific. These pages should be coherent with the chosen native row system; claiming exact WeChat pages would be misleading. | Check type scale, groups, separators, navigation and touch targets against the accepted design system; assess functionality separately. |

## Initial v0.4 final5 acceptance conclusion (superseded below for revised states)

The supplied screenshot was enough to identify several concrete v0.4 deviations, especially Chinese text advance, avatar/body offset, category-toolbar horizontal shift, microphone foot and emoji-grid/floating-action vertical offset. It is not enough to certify four root tabs or the other pages as iPhone WeChat8.0.80. Final5 behavioral passes and close composer percentages cannot close these visual questions. A revised build needs new matched-state evidence and DPR3 visual inspection; no such revised-build pass is claimed here.


## Additional visible-path measurements

These bounds use RGB channels below100 for dark icons, avoiding confusion between an SVG canvas and its painted path. Native figures are normalized to390px. CurrentDPR1 edge thresholds carry approximately1px uncertainty and need DPR3 confirmation. Centers are measured from the visible bounds, not button boxes.

| Symbol | Native visible width x height; center x,y | Current final5 visible width x height; center x,y |
| --- | --- | --- |
| Category search | 19.81 x19.40;31.16,470.48 | 18 x18;38.5,472.5 |
| Category smile | 23.94 x23.94;85.22,470.27 | 22 x24;92.5,472.5 |
| Category heart | 22.29 x18.98;139.29,471.10 | 21 x18;147,473.5 |
| Category selfie | 19.81 x25.59;193.35,470.27 | 19 x26;201,472.5 |
| Voice outer circle | 27.65 x27.65;24.76,413.94 | 27 x27;25,415 |
| Keyboard outer circle | 27.65 x27.65;323.56,413.94 | 27 x27;324,415 |
| Plus outer circle | 27.65 x27.65;365.24,413.94 | 27 x27;365,415 |

Recent heading visible native bounds arey532.83..546.00 versus current535..548. The native recent emoji visible center isy582.11; current first recent visible center577.5, but these are different glyphs. Do not move the whole recent block based on that center difference alone. Native all-emoji title already aligns with current; reducing its following gap approximately8px is better supported than moving the title. Row pitch is native49.52/50.14/49.73px versus current50px, which is already close.


## Corner and disabled-send measurements

The empty field corner was measured directly from the supplied native image rather than inferred from its topmost white run. At the mid-tone boundary R=249.5 between background245 and white254, the left edge for original y954..960 is approximately x125.83,124.30,123.30,122.50,121.70,121.36,120.90. A least-squares circular-corner fit gives radius10.43 original pixels =4.30 normalized px, inferred straight edges x120.44/y952.71. This supports a4px field corner more strongly than the prior6px. Antialiasing and the circular model prevent claiming a precise fractional CSS value.

The selected category tile, fitted by the same method over original y1085..1100, gives radius20.45 original pixels =8.44 normalized px. This is a weaker model-based discrepancy from current10px; it is not an independent proof that10px exactly matches the native tile. Keep the distinction between stronger input-field evidence and smaller category-corner uncertainty.

Native disabled-send text has visible bounds x803..884/y1887..1926 =82x40 original pixels =33.84x16.51 normalized px. Current final5 bounds x333..365/y789..803 =33x15px. Native two-character advance approximately43 original pixels supports18px font size over17px. Native foreground mode isRGB191 against approximately224 background; current text foreground185 against222. Thresholded dark-pixel area normalizes to approximately232 versus current234 pixels, so the screenshot does not establish that changing weight400 to500/600 is justified. Size18 is supported; heavier weight is unproven without matched DPR3 glyph inspection.

## v0.4.1 frozen-source review (before new visual captures)

The current source was reviewed again after the fixes. This is an implementation check, not a visual pass. Chat and pending-message avatars are43px; ordinary text bubbles are18px/24px with9px13px padding and43px minimum height; image/payment overrides are excluded. The composer row is58px, field radius4px, microphone has no horizontal foot and its stem ends atV21, and its22x24px SVG is flex-centered at right9px/bottom4.5px. Categories use58px height with4px top/8px bottom padding,8px left padding,9px tile radius, search30px and heart29px icon canvases. All-emoji title margin is6px, floating bottom inset ismax(34px,safe-area), and send text is18px with inherited400 weight. These overrides occur after the older rules, so the reviewed selectors take precedence. The contacts hidden-conversation badge is now absent from the current render source.

No omitted implementation of these specific approved measurements was found in this source read. The source check cannot resolve actual glyph bounds, font rasterization, microphone curves or native keyboard behavior. RevisedDPR3 same-state captures still require independent inspection; no revised screenshot is claimed reviewed in this subsection.

## Additional v0.4.1 finding: reserved lower-right emoji region

The native screenshot has no emoji artwork in the rightmost three columns of rows3 and4, including the portions above and below the two action buttons. A direct pixel scan of original x550..944/y1800..2040 finds zero pixels with channel saturation(max-min)>30. This area contains only panel gray, disabled-button gray and the black system home indicator. The prior v0.4.1 diagnostic `pipi-ui-v041-diagnostic/FAIL-2.png`, independently opened, still shows third-row emoji tops and fourth-row full emojis behind/under its floating buttons. Positioning only46px-high buttons does not reproduce the supplied state.

The visible result supports a reserved blank region across the lower-right grid. The screenshot cannot distinguish an actual native mask from omitted grid slots. Its invisible gray-on-gray boundary cannot be precisely measured. Constraints from neighboring artwork are: left boundary approximately between211px(the fourth-column artwork's right edge) and234px(the fifth-column expected artwork's left edge); top boundary between approximately735px(second-row artwork bottom) and754px(third-row expected artwork top). A panel-colored overlay beginning nearx226/y750 and extending to the right/bottom is an implementation candidate, not a directly visible native rectangle. Any overlay must also block hit testing of hidden emoji and retain access through scrolling. New revised capture and interaction evidence are required before closing this finding.


## v0.4.1 final1 DPR3 independent visual measurements

Actually opened `pipi-ui-v041-final1/390-clean-emoji-reference.png` at1170x2532(390x844 atDPR3). Neutral fixtures use synthetic names, avatars and short Chinese text; the recent glyph now matches the native crying face. This capture predates the final action-area backdrop and the tail/list/recent refinements; it is not a final screenshot pass. Direct reference remains only the supplied empty/all-emoji state.

| Region | Native normalized measurement | final1 DPR3 result / assessment |
| --- | --- | --- |
| Body left and short-bubble width | Body left67.68; six-character bubble133.30px; four-character97.81px | Body left68px; fixture six-character bubble approximately134px and four-character98px. The prior17px/40px-avatar compression is substantially resolved. Font-face rasterization remains different. |
| Category search | Visible19.81x19.40,center31.16,470.48 | 20.33x20.33,center31,470.0. Within approximately1px; prior horizontal shift resolved. |
| Category smile | Visible23.94x23.94,center85.22,470.27 | 23.33x23.33,center84.83,469.83. Within approximately1px. |
| Category heart | Visible22.29x18.98,center139.29,471.10 | 22.33x19.33,center139.67,470.50. Within approximately1px. |
| Category selfie | Visible19.81x25.59,center193.35,470.27 | 20x26,center193.17,469.83. Within approximately1px. |
| Inner mic | Visible13.62x18.16,center275.68,414.56 | 13.33x18,center275.83,413.83; no horizontal foot remains. Size and visible contour are close, current about0.73px higher. No further adjustment justified from this sampling alone. |
| Same-glyph recent crying face | Saturated-pixel center582.11; visible height31.37 | Center577.83; visible height31.33. Current is4.28px high: a targeted4px translation is supported. |
| Tail vertical center relative to bubble top | Three incoming bubbles20.63/20.63/20.84px | Approximately17.83px: tail is approximately2.8-3px high, supporting top14→17. Tail height itself is close(approximately11.1 native/10.7current). |
| Last bubble to composer gap | Approximately12.79px | Approximately36.5px; source bottom padding20 plus final-row margin16 explains the excess. |
| Short-bubble row pitch | 146 original px =60.25px | 177/3=59px; increasing ordinary row margin by1px is supported. |
| Lower-right emoji reserved zone | No colored emoji behind/below controls | final1 still exposes third-row tips and fourth-row emojis. Backdrop needed and subsequently implemented. |
| Delete inner glyph | Visible51x40 original px =21.05x16.51 | Visible56x42 screenshot px /3 =18.67x14. Current inner glyph remains approximately2.4-2.5px smaller. Button box position being close does not close this path-bound discrepancy. |

The final source was then refined with ordinary tail top17px, message-list bottom padding12px and last-row margin0, normal row margin17px, recent-grid-only translateY(4px), and a panel-colored lower-right backdrop with left58%, right0, bottom0, height60px+max(34px,safe-area). Mic and category glyphs were left unchanged after theDPR3 evidence. These are verified source changes, **pending final2 visual/interaction confirmation**. Exact native keyboard, typed/multiline native appearance, More/voice fidelity, all four version-bound tab states and the other unreferenced native subpages remain unverified; do not convert their functional passes into native visual passes.

## Consolidated pre-final2 residuals and explicit unknowns

No additional visual expansion is planned beyond the following already measured changes and final-state closure. The following final1 residuals were reported together for owner decisions:

- Tail horizontal extent, normalized against the local gray-to-white contrast: native tip is approximately5.0-5.4px outside the bubble body at20/50/80% brightness thresholds; final1 is6.33px. A1px reduction of ordinary incoming left/outgoing right offset is supported.
- Both panel headings have approximately15px native character advance versus16px current. Native recent-label glyph starts42/78/113/150 imply approximately14.86 normalized px; current starts50/98/145/194 atDPR3 imply approximately16px. Native visible text56.54x13.62px versus current61.67x14.67px supports font-size15 while retaining24px line-height. Existing all-heading ink center already aligns.
- Native chat-title first four Chinese glyph starts256/299/343/386 imply approximately17.88px advance; final1 synthetic title starts434/485/536/587/637/689 atDPR3 imply17px. This supports18px for the chat title, without deriving other-page title sizes from a missing reference.
- The delete glyph discrepancy is being corrected separately by retaining the button box and increasing the icon canvas to29px with vertical scale1.07, yielding expected painted approximately20.84x16.49px. Final2 must confirm actual visible bounds.

Explicit unknowns retained after this review:

| Region / behavior | Known evidence | What remains unknown; no pass claimed |
| --- | --- | --- |
| Native top navigation | Supplied chat state and measured glyph advance | Translucent material, under-scroll behavior, ellipsis hit box, long-title truncation, other-page title sizes and real device safe-area integration. |
| Message typography |18px native advance and near43px single-line bubble | Exact PingFang-versus-Noto rasterization, weight matching, uncommon glyphs, long paragraph line wrapping and max-width behavior relative to8.0.80. |
| Avatar/bubble geometry |43px avatars, approximately13px gap, short bubbles and measured tail | Native avatar artwork, exact corner curve, media bubbles and payment bubbles beyond supplied state. Neutral placeholders are intentionally synthetic. |
| Empty/all-emoji composer | Supplied direct native screenshot | Exact native disabled text color under a color-managed capture and the native implementation behind the reserved lower-right zone. Final screenshot can verify visible result only. |
| Typed/multiline/IME input | Current isolated functional andDPR3 state tests | Native8.0.80 typed-state microphone policy, exact editor max-lines, real system keyboard geometry and transition. Functionality does not establish native appearance. |
| Voice/dictation | Current synthetic capture and controls | Native hold/drag/permission/voice-to-text visual states, waveform and animation; no supplied matching native state. |
| More panel | Historical four-by-two implementation and current render |8.0.80 entry order, glyph shapes, tile size, page height, swipe/dismiss motion and keyboard switch. |
| Four root tabs | Official current marketing confirms broad glyph family; current outlined/filled selection implemented | Version-bound exact curves, stroke weights, labels, baselines, badges and safe-area dimensions across all four selected states. |
| Chat list / contacts | Current rows, groups, search, alphabet rail | Version-bound row geometry, tool order and exact baseline/separator artwork. Historical72/48px constants are not a fresh8.0.80 certificate. |
| Discover / Me / settings | Current route hierarchy and sections | Version-bound exact root sections, profile/header typography and icon curves; custom farm/AI settings are product additions. |
| Contact subpages / chat information | Current routing and fields | Version-bound row labels, switches, member controls, spacing and interaction transitions. |
| Moments / albums / compose / comments | Current behavior and data filtering | Matching native geometry for each distinct page and nonempty state. |
| Services / wallet / cards / payments | Current virtual accounting behavior | Native8.0.80 service screens, number fonts, card artwork and detail layouts; virtual states must remain truthful. |
| Stickers / search / favorites / selfie / store | Supplied all-emoji view only | Matching native empty/unavailable/search/store headers and layouts. |
| Scientific accuracy of colors | Exact raw pixels and missing color-profile metadata | Original color-space intent; near-gray one-channel deltas do not prove different intended CSS. |
| Real hardware | Desktop isolated emulation | Real iPhone Safari keyboard, safe area, audio permission/codec behavior and touch timing. |

## Final-code visual closure: scroll diagnostic, 2026-11-14T16:41Z

Independently opened and measured `pipi-ui-v041-scroll-diagnostic/390-clean-emoji-reference.png`(1170x2532,DPR3). This is the final-code clean same-state fixture after scroll anchoring and the complete measured refinements. The screenshot is not a copy of the private reference. Source hashes match both the on-disk files and diagnostic `results.json`:

- `public/app.js`: `541804b036571ff04ef3484346bbe3ad83c7435037247f3e0441fa7662d701b8`
- `public/styles.css`: `98ac47386565795353e2c0bcaa23e34d76b6d2de200992ff94b0f061f21f0db6`

| Previously measured issue | Final-code visible result | Closure |
| --- | --- | --- |
| Text compression / avatar offset |18px Chinese advance,43px neutral avatars,13px gap, near68px incoming body start; short bubble widths near reference | Corrected to measured geometry; font-face rendering remains platform-dependent. |
| Chat title17px | Current title now18px advance | Size corrected; other-page title sizes are not inferred from this chat. |
| Field radius6px | Current radius4px, compared with native circular-fit approximately4.3px | Corrected within model/capture precision. |
| Category position, symbol size, tile corner | PriorDPR3 centers within approximately0.7px; category tile now9px against model8.44px | Prior7-8px horizontal shift resolved; no exact vector-identity claim. |
| Inner microphone foot and placement | Foot absent; visible13.33x18px,center275.83,413.83 versus native13.62x18.16,275.68,414.56 | Corrected; remaining displacement below approximately1px. |
| Recent-face position | Current same-glyph center581.83px, native582.11px; heights31.33/31.37px | Corrected. |
| Panel heading text size | Recent visible center539.17px versus native539.40; all-heading627.17 versus627.71 |15px size now closely matches; glyph rasterization differs. |
| All-grid first-row vertical offset | Current visible center669.83px versus native670.22px | Corrected; subsequent approximately50px row pitch remains close. |
| Bubble-tail height and projection | Center relative to bubble top20.83px versus native20.63-20.84; projection5.33px versus nativeapproximately5.0-5.4 | Corrected. |
| Final-message lower gap / emoji opening | Last bubble fully visible nearbottom372px, visible input row384.875px: gap12.875px versus nativeapproximately12.79 | Corrected in this final-code capture after the anchoring fix. Long/history-scroll behavior is separately tested byQA. |
| Right-lower reserved zone | Pixel scan over screenshot x680..1169/y2250..2531 finds no saturated emoji pixels | Third/fourth-row rightmost artwork no longer leaks around/below action buttons. Mask hit interception is a separateQA assertion. |
| Delete inner glyph too small | Current visible21x16.33px versus native21.05x16.51px | Corrected. |
| Send text too small / floating action position | Current visible34.67x17px versus native33.84x16.51; button bottom inset34px | Corrected to within approximately1px ink-bound difference; weight400 retained because heavier weight lacked evidence. |

The listed corrections are visually closed for the **supplied empty/all-emoji state at390x844** on this exact final-code snapshot. This means the prior concrete deltas are resolved within screenshot/model precision; it does not mean pixel identity, real-device certification, matching all8.0.80 rollout variants, or certification of unreferenced pages/states. The explicit unknowns above remain in force. Final full-suite execution is recorded byQA separately; this visual closure does not pre-claim its result.

## Final full-run evidence confirmation, 2026-11-14T16:45Z

Independently opened the formal final capture `pipi-ui-v041-final4/390-clean-emoji-reference.png` and read its `results.json`. This formal run reports36 checks, an empty failures array and an empty errors array. Its app/CSS hashes exactly match the final-code snapshot above. The clean image visibly preserves the closed-list corrections: complete final bubble with the intended lower gap, corrected tails/text scale, aligned categories, matching recent-face position, and the lower-right reserved action zone.

For a stronger same-state check, both the diagnostic and formal clean images were cropped internally to screenshot rectangle(0,1150,1170,1382), covering the composer, category strip and full emoji board. Re-encoded PNG SHA-256 is identical for both crops: `789c376811bf89e04e8aaf95fc5c443fded831ebcf42533beea183618562df42`. Thus the formal run's complete lower controls reproduce the already measured final-code visual result exactly; no new geometry claim is substituted for actual inspection.

The previous pending final-run note is closed by this formal evidence. The outcome remains scoped to the measured supplied native state and the explicit unknown-state table;36 functional checks do not establish unobserved native8.0.80 visual fidelity. No product source was modified by this reviewer.
