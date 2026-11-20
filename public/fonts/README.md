# Local UI fonts

The application is hosted on a server and used in mobile browsers, with a possible connected app later. Every platform, including iPhone and app WebViews, prefers the same self-hosted Inter for Latin text and Noto Sans SC for Chinese. System fonts are fallback fonts during loading or when a glyph is unavailable. Apple font files are not bundled. Both bundled fonts use SIL OFL 1.1 and support variable weights, avoiding separate files for every weight.

- Noto Sans SC 2.004: copyright 2014–2021 Adobe, with Reserved Font Name “Source”. Original `Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf` from https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c . Converted to WOFF2 with FontTools, without changing glyphs, names or weights. See `NotoSansSC-OFL.txt`.
- Inter: copyright 2016 The Inter Project Authors, https://github.com/rsms/inter . Unmodified `docs/font-files/InterVariable.woff2`, Git blob `5a8d3e72ad7ffb62af3b146e1b1f54ab5813a212`; SHA-256 `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`. See `Inter-OFL.txt`.

Fonts are served locally. No Google Fonts CDN, tracker, font runtime library or font build dependency is required to run the app.

## Choice and deployment

Apple documents San Francisco as its system family for Latin and other supported scripts, and recommends language-aware system font selection. Chinese UI fonts can vary with the OS version and language; this project does not assume every iPhone uses the same PingFang file. Sources: [Apple font overview](https://developer.apple.com/documentation/technologyoverviews/fonts), [Apple fonts](https://developer.apple.com/fonts/), and [Apple engineer's Chinese UI font explanation](https://developer.apple.com/forums/thread/758189).

Inter and Noto Sans SC are a visual approximation using neutral sans-serif letterforms; they are not identical Apple fonts. OFL 1.1 permits commercial use and embedding subject to its terms, including preserving the license and not selling the font by itself. The two complete license files above accompany distribution.

The files total about 8.1 MB before HTTP transfer overhead. Browsers can retain the downloaded font files and revalidate them with ETag/304 responses; authenticated API responses remain `no-store`. The first visit still downloads the fonts. An app that displays this webpage can reuse these resources; a future native UI must configure its own font assets separately.
