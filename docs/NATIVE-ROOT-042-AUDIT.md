# v0.4.2 native root-page geometry audit

Date: 2026-11-14. Measurement-only review; no product files changed. The supplied native home screenshot was opened before the current render. It is945x2048 with red user annotations. The comparison render is `%TEMP%/pipi-ui-v041-final4/390-chats.png`,1170x2532 atDPR3(390x844). Private avatars, names, message previews and email text are not reproduced. Only geometry of navigation/search/tabs is recorded.

## Scale, annotations and coordinate limits

Native pixels are normalized by390/945 =26/63 =0.412698. This makes the supplied image390x845.206, not exactly390x844. CurrentDPR3 coordinates divide by3. All measurements below use visible painted pixels; SVG canvas size and touch area are separate.

The red rectangles are annotations, never application chrome. The upper frame masks part of the possible app/status transition and part of the search section's lower edge. The lower frame masks the real tab-bar top: native y1813 is still list white, while y1824 is tab gray. Therefore the actual tab start can only be bounded to about1814..1824(native), or748.64..752.76 normalized. The native line at1805 is a conversation-row separator; it must not be mistaken for the tab-bar top.

The screenshot includes a system status region and a home-indicator region; the current app capture has neither physical system UI nor a nonzero simulated safe area. Absolute y coordinates must not be compared without accounting for this. The screenshot alone cannot uniquely separate a44px versus48px app header from an approximately44..48px status inset. It also does not reveal the hard boundary between bottom interactive tabs and bottom safe area. Native system margins are estimates, not measured CSS environment values.

## Top title and action

| Measurement | Native raw pixels | Native normalized | Current final4 | Interpretation |
| --- | --- | --- | --- | --- |
| Two Chinese title glyphs painted box | x399..482/y146..185 |34.67x16.51px |33x16px, current root font17/600 | Native advance supports approximately18px; exact font weight is not identifiable from the PNG. |
| Full title painted center, including count |471,167 |194.38,68.92 | Current title center194.67,22.5 with no status inset | Horizontal centering is already close. Native center relative to an assumed44..48px system inset is20.92..24.92px, bracketing current22.5px. |
| Plus-circle painted box | x849..899/y141..191 |21.05x21.05px |24x24px | Current circle is approximately3px too large; its action touch area can remain44px. |
| Plus center |874,166 |360.70,68.51 |361.83,21.83 | A44px action box ending atx382 gives center360, closer than the current40px box. |
| Outer ring horizontal center-line stroke | Left x849..852/right897..899 | Approximately1.24..1.65px | Approximately1.33px | Weight is close; reduce overall circle scale rather than thicken it. |
| Plus horizontal arm at center | x862..886 |10.32px |12px | Scale down with the outer circle. |

Header-height recommendation is constrained rather than a literal native measurement: use a root header around48px if the design needs more application breathing room, keep title18px, and supply genuine `safe-area-inset-top` separately. A44px header with a different status inset also fits the supplied geometry. Do not claim that this screenshot proves48px exactly, and do not turn its status time into a fake application row.

The native title appears less heavy than the currentNoto600 render;18px/500 is a reasonable visual candidate, but this remains an implementation choice to inspect in the newDPR3 image, not a proven native CSS weight. Same-glyph ink area and stroke shapes depend on the actual PingFang/Noto face.

## Search section

| Measurement | Native normalized | Current final4 | Suggested target |
| --- | --- | --- | --- |
| White field horizontal bounds | Approximatelyx8.3..381.8; left corner partially occluded by annotation |x8..382 | Preserve8px side insets and fluid width. |
| White field vertical bounds | Original top242/bottom332; approximatelyy99.87..137.02, inclusive height37.56px |y52..88, height36px |38px field height. Absolute native y includes the unknown system inset. |
| Search section total | Lower boundary partly hidden by red frame; approximately54..56px after allowing about8px upper inset |54px |54..56px, not a large proportional expansion. A38px field plus8px top/bottom gives54px. |
| Magnifier painted box |41x42 original =16.92x17.33px |35x35 screenshot /3 =11.67x11.67px | Painted approximately17px. Existing17px SVG canvas is insufficient because its path has internal padding; canvas24..25px is the appropriate candidate. |
| Magnifier painted center |174.98,118.65 |176.33,70.33 without status inset | Keep the combined icon/text group centered. |
| Placeholder painted box |80x40 original =33.02x16.51px |90x45 screenshot /3 =30x15px | Approximately18px text rather than16px. |
| Placeholder painted center |209.03,118.65 |206.17,70.67 without status inset | The native wider group naturally places the text center farther right. |
| Visible magnifier-to-text gap | Approximately9.08px | Approximately9px | Already close. Do not blindly add CSS gap after enlarging the SVG canvas. |
| Combined painted group center | Approximately196.03px | Approximately195.83px | Already centered to about1px; preserve this while changing internal sizes. |

The search corner radius cannot be independently fitted on both sides because the annotation covers the left edge. Retaining a modest6..8px radius is an explicit approximation. Focused-search text entry, cancel control and native keyboard states are not shown and are not passed by this audit.

## Four-tab bar and safe area

Visible tab icons are centered at original x118/355/592/828.5, normalized48.70/146.51/244.32/341.92. Equal-width four-column centers at390px are48.75/146.25/243.75/341.25. Preserve four equal columns; no proportional left/right displacement is needed.

| Painted symbol | Native box normalized | Current final4 box | Canvas candidate using existing assets |
| --- | --- | --- | --- |
| Selected chat bubble |24.35x21.87px |22.67x20.67px |30px versus current28px |
| Contacts person/lines |26.83x21.87px |26x21.33px |29px |
| Discover compass |24.35x24.35px |23.33x23.33px |29px |
| Me shoulder |23.11x21.87px |21.33x20.33px |30px |

A common30px canvas is also a reasonable coherent implementation candidate: it would leave approximately1px size variation in contacts/compass. The new render should be checked against the painted boxes rather than approving the declared canvas dimensions.

| Vertical measurement | Native normalized | Current final4 | Assessment |
| --- | --- | --- | --- |
| Icon painted center |Approximately774.22px(all four) |Approximately811.83px, current bar has no system safe region | Absolute positions are not directly comparable; use bar-relative positions and real safe insets. |
| Label painted center |Approximately797.13..797.33px |Approximately834..834.17px | Native icon-to-label center distance approximately22.9px; current approximately22.2px. |
| Labels painted height |9.08..9.90px |8.67..9px | Native approximately11px label size is a better candidate than current10px. |
| Chat label painted width |20.63px |19px | Supports modestly increasing label size. |
| Contacts label painted width |30.54px |29px | Same direction; exact font-face match remains unavailable. |
| Visible icon-to-label gap |Approximately7.0..7.4px depending glyph |Approximately7.0..7.7px | Existing apparent gap is already close. CSS gap1px can remain while canvas/text sizes grow. |
| Visible interactive cluster top/bottom |Approximately762.25..801.87px |Approximately800.33..838.67px | Cluster height is close; the native bar has more surrounding vertical room. |
| Actual bar top |748.64..752.76px, occluded by red annotation |Approximately794px | Native top is an interval, not the red rectangle's exact top. |
| Total bar to screen bottom |92.44..96.57px |50px with simulated safe inset0 | Most of the difference combines system safe area and a taller tab body. |
| Interactive body if bottom safe inset were34px |58.44..62.57px |50px | Approximately62px body is supported as a candidate;34px safe area is an assumption, not a visible hard boundary. |

Recommended initial root-tab parameters: body62px plus the actual bottom-safe inset; upper padding around10..12px and lower padding around4px; labels11px/15px line height; CSS gap1px; icon canvases above; retain four25% columns. The visible glyph-to-label gap should remain approximately7..8px. Increasing both canvas/text and CSS gap would overcorrect.

A62px body plus a real34px safe region gives96px total, placing the bar top near749.2px in the normalized native image, within the annotation-occluded748.6..752.8 interval. This is a coherent fit, not proof that the native code uses62px. Where `env(safe-area-inset-bottom)` is0, the app must not add an invented34px phone-only strip merely to resemble a full-device screenshot. Never render a fake home indicator.

The screenshot cannot determine invisible touch bounds. Keep each tab at least44px high and its full equal-width column clickable; place badges relative to the icon/column without shrinking the hit target. Badge count and discovery-dot geometry are account-state details and should be checked with neutral fixtures, not copied from this private image.

## Device adaptation principles and one-pass acceptance scope

- Keep title/search/tab dimensions in stable CSS pixels. Do not multiply the entire phone UI by viewport width/390. The screenshot normalization is an analysis technique, not a responsive-layout rule.
- Use real safe-area environment insets exactly once: top inset outside the application header, bottom inset outside the interactive tab body. Avoid duplicate padding in both parent and child.
- Use a fluid search field, four equal tab columns and a truncating centered title between fixed action regions. At320px the columns remain80px wide, comfortably above44px touch width.
- Make list content `flex:1; min-height:0; overflow:auto`; preserve header and tab geometry on short screens instead of squeezing their fonts/icons. Preserve keyboard/focus behavior through actual viewport changes.
- Test0 safe inset and representative nonzero top/bottom insets separately; include320/375/390/430 widths, short/landscape heights and desktop framing. A browser screenshot with no status area should be compared after removing the native system-region offset.
- Verify newDPR3 captures once across all listed regions: title center/advance and plus scale,38px search field,17px painted magnifier,18px placeholder, tab-body height, painted icon boxes,11px label ink, visible7..8px gap, padding and safe-area layout. Do not approve only the CSS constants.
- Existing chat-composer measurements fromv0.4.1 are a separate accepted state; this root-page audit does not authorize changing that geometry by blanket global scaling.

Unknowns are concentrated here: exact native status height and navigation split; exact tab/safe-area boundary hidden by annotation; native CSS font weight; precise search corner radius under the annotation; invisible touch rectangles; search focus/keyboard and label accessibility behavior; other selected-tab states; landscape-specific native behavior; additional devices' safe-area values. These remain explicit limits rather than passed native states. NewDPR3 product screenshots can close implementation geometry; they cannot manufacture missing native references.

## v0.4.2 final1 independent DPR3 root review

All eight `390-root-{chats,contacts,discover,me}-{zero-safe,simulated-safe}.png` captures in `%TEMP%/pipi-ui-v042-final1` were actually opened. The simulated variant injects top47px/bottom34px CSS safe variables; it does not display native system time, battery, browser chrome or a home indicator. The zero-safe variant reserves neither system region. Both are neutral fixtures, not copies of the supplied private screenshot.

| Measured region | NewDPR3 render | Comparison / outcome |
| --- | --- | --- |
| Root header |48px body, top0 or47px | Header/body and safe region are separate. Native status/header split remains ambiguous; the simulated top47 causes an approximately3-4px absolute title/search difference from the supplied image that must not be described as a verified native inset. |
| Title Chinese painted box |35x17px | Native34.67x16.51: type size is close; Noto600 versus native font weight is not exactly certified. |
| Plus-circle painted box |21x21px | Matches native21.05x21.05. Its centerx362.33 is approximately1.63px right of the native360.70; retained as a small precision difference rather than a clipping/compactness defect. |
| Search field |38px,8px side insets | Corrected from36px; white field remains fluid at both safe settings. |
| Magnifier painted size |17x17px | Native16.92x17.33; prior11.67px painted symbol compression is resolved. |
| Search placeholder painted size |34.33x16.67px | Native33.02x16.51; small width residual is consistent with font-face differences. |
| Tab body / safe region |62.296875px body;96.296875px with bottom34px | Body grows by exactly the injected34px, not twice. Simulated-safe top747.703px is close to the annotated native interval748.64..752.76, with an additional1.206px normalized-image-height difference. |
| Chat painted icon |24x22px | Native24.35x21.87. |
| Contacts painted icon |26.33x21.67px | Native26.83x21.87. |
| Compass painted icon |24.33x24.33px | Native24.35x24.35. |
| Me painted icon |23x21.67px | Native23.11x21.87. |
| Simulated-safe icon vertical centers |Approximately773.33..773.83px | Native774.22: within approximately1px. |
| Simulated-safe label vertical centers |Approximately796.5..797.83px | Native797.13..797.33: within approximately1px. |
| Label painted heights |10..10.33px | Native9.08..9.90; approximately0.1-1.3px residual depending glyph/font. |
| Visible icon/label gap |Approximately6.3-9px depending glyph | Native also varies by glyph. The prior apparent gap was preserved rather than enlarged with the canvas sizes. No overlap. |
| Tab hit rectangles |Each97.5x45.296875px at390px | Full four-column targets remain separated; no tiny image-only tab target. Native invisible touch bounds remain unknown. |
| Me status entry |Separate pill below name/WeChat-ID, beside neither QR nor arrow | Visible in both safe variants, no overlap or clipping. Profile and status area move47px exactly with simulated top inset. There is no supplied nativeMe screenshot, so this is layout/entry verification, not exact nativeMe certification. |

The top/search/tab compaction items are corrected in these captures within the stated raster/font and safe-model limits. The contact alphabet rail stays in the list content band rather than over the fixed header/tab bar. Selected/unselected tab state and the newMe status entry are visually coherent across all eight captures. Functional status routing and cross-device interaction remain the separateQA checks.

## Conversation separator: real paint failure and minimal verified repair

A broader native-home check identified a genuine missed difference: native conversation separators are visible from the text left edge toward the right, while the initial new root captures are a continuous white list. Native samples atx500 near original row bounds yieldR244/R244 andR250/R242/R251 against254 white; current final1 samples at screenshotx600/y516..525 and732..741 are uniformly255.

The application selector existed and was not overridden. An isolated real `createApp` account, actual two-row root DOM and host-launched headlessChrome were used for diagnosis; the user browser and production data were untouched. Computed `::after` was alreadycontent empty/displayblock/positionabsolute/left76/right0/width314/height0.5/backgroundRGB229. DOMSnapshot actual bounds were[76,173.5,314,0.5] for row[0,102,390,72]. Thus it was a paint failure of the fractional-height box in this renderer, not missing CSS or an incorrect separator position. Changing default button appearance or moving the same0.5px box to the wrapper did not restore pixels.

The smallest successful probe retained the pseudo-element on the swipable row and used `height:1px; transform:scaleY(.5); transform-origin:bottom; background:#efefef; pointer-events:none`. After two animation frames plus80ms, actual screenshot pixels at the first row boundary wereR247/R239, with adjacent rows255. Their contrast integral is(8+16)/3 =8 CSS brightness units, close to the native samples' approximately7.8-8.3. Keeping the original darker#e5e5e5 producedR242/R229 and a visibly stronger line; no further fractional color adjustment is justified.

The first-row content crop before/after all style probes had identicalPNG SHA-256 `cb017c0a88827d122bba351d9ae08fb006b3cc166098e06c00767a3d03332117`; text and avatar painting were unchanged. The initial impression of blank probe content came from the multiple-image display, and was rejected by direct pixel/hash evidence. Temporary neutral probe captures are outside the product, under `%TEMP%/pipi-v042-separator-product` and `pipi-v042-separator-light`.

The source owner applied this minimal repair to the original rule, retainingleft76px and the row's swipe transform. Formal post-fix screenshots and swipe/pixel checks are closed in the following final3 evidence. The oldfinal1 white-list capture remains historical failure evidence. The full functional result is recorded separately from this visual judgment.

### Post-fix formal separator evidence

Independently opened `%TEMP%/pipi-ui-v042-final3/390-left-swipe.png` and sampled its pixels. On the unshifted first row, x227 remainswhite255 while x228(76 CSS px) and beyond haveR247/R239 at screenshoty520/521. On the swiped second row, screenshoty736/737 atx200/300/500 retainR247/R239; x550/600 instead show the exposed action backgroundRGB199,199,203. The white row and its separator share the same moving right edge. This closes the separator paint and swipe-attachment defect on the formal product capture; it is not merely a computed-style assertion. Final root zero/safe capture paths and frozen hashes are recorded in the following completed-run section.


## Final3 visual closure and frozen evidence

Completed formal evidence directory: `%TEMP%/pipi-ui-v042-final3`. The final `390-root-chats-simulated-safe.png` and `390-root-me-simulated-safe.png` were independently opened again. The formal zero-safe and simulated-safe chat images were independently pixel-sampled. The measured header/search/tab geometry above remains intact, theMe status pill stays below the identity text without colliding withQR/arrow, and the conversation list now contains the intended thin separators.

At zero-safe first-row screenshoty520/521 and simulated-safey661/662, x200 and227 arewhite255, while x228/600/1169 are247/239. This verifies the76px text inset, full rightward line and exact141px screenshot displacement for the47px synthetic top inset. Combined with the independently inspected swipe capture, the line both paints and moves with its row. This closes the last visible root-list defect identified in this audit.

Final `results.json` was read directly: date2026-11-14T17:40:41.725Z,42 checks, empty failures and errors arrays. Product hashes in that report are:

- `public/app.js`: `2fbcb6b2f5f9d8e364d8ab4a2180e812813048fb5978d4b1bf9c9c5a5a4ab919`
- `public/styles.css`: `0a76c946f011621806b62b49a80b6329fe49cf699262a72b597af159be7dcf07`
- `public/status.css`: `704a9a11b2b6625b5db4e9bdf079ba672ed466e1f5b2b504c755bc21b0ac3830`
- `public/features.css`: `10eca6db5ced3c53ed5498b0ae488c36ad9a353f2f44af1fbb5777b3b0abe3e9`

The visually supported outcome is that the root-header/search/tab compaction and the missing conversation separators are resolved for the reviewed states, with stable layout under zero and synthetic47/34px safe insets. The existingMe status entry now has a visible independent layout. This is not a claim that the gray synthetic reserved areas are native system chrome, that native inset values were proven by the annotated screenshot, or that all unreferenced pages are pixel-identical toWeChat8.0.80. Font-face/weight rasterization, the smallplus-center difference and the earlier concentrated unknowns remain explicit limits. No private screenshot/identity/message data or diagnostic captures were copied into product/release assets, and this reviewer changed only this audit document.
