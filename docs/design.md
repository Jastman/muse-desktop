# Design system

Muse Desktop uses a persistent sidebar, one primary conversation pane, and an optional project inspector. Native traffic lights sit in a draggable titlebar. Messages and the titlebar sit directly on the background without shadow panels or a header divider. The composer stays visible while conversation content scrolls; the view follows incoming messages only while the reader is near the bottom.

## Themes

- **Muse:** the supplied electric-blue layout direction, translucent surfaces, a large exact Muse M watermark, and the waving mascot in the sidebar. The empty canvas leaves room for the brand and a focused composer.
- **Daylight:** warm ivory, stone, soft natural light, and the mascot in a quiet studio.
- **Moonlight:** navy and slate with restrained moonlit artwork.
- **Grove:** sage, limestone, and a miniature garden.
- **Plush:** a close-up of the cream mascot against cobalt blue, with reduced artwork presence while reading.

All five themes share the same interaction structure; Daylight, Moonlight, and Grove also show welcome prompts. Semantic CSS variables in `tokens.css` control color, contrast, reading size, and surfaces. Background intensity, system appearance, and reduced motion are user settings. The M is the supplied PNG, never a text glyph or a traced approximation. All artwork is local.

## Typography

Functional text uses the macOS system font throughout. Shared tokens define 12 px captions and keyboard hints, 13 px supporting text, 14 px controls, and 15 px default conversation text. Section and page headings use a consistent weight hierarchy; code uses SF Mono/Menlo at readable sizes. Compact conversation text is 14 px; Large is 17 px. Layouts adapt through wrapping and spacing instead of shrinking small labels. Supporting text has stronger contrast in every theme. The welcome wordmark alone retains its expressive serif treatment.

## Copy conventions

Use sentence case and concise action labels. **Project** means a local folder; **conversation** means a Muse session. **Muse Code** names the installed CLI and its settings. **Settings** is used consistently across the sidebar, native menu, command menu, and dialog.

Suggested prompts describe concrete tasks: Plan a feature, Explore the project, Review the code. Keyboard hints are `↵ Send` and `⇧ ↵ New line`. Status text reports facts: Local project, Connected to Muse Code, Permissions: Muse Code settings, Theme: Daylight. Only the welcome headline and mascot greeting carry expressive copy. Avoid duplicate slogans around functional controls.

## Accessibility

All icon buttons have accessible names and tooltips. Dialogs use native HTML modal behavior and restore focus. Dropdowns use theme-matched popovers with arrow keys, Home/End, type-ahead, Escape, outside-click dismissal, and a visible selected state. Controls support keyboard navigation; the command menu supports arrow keys and Return. The composer handles Shift–Return and IME composition. Text size and motion settings complement macOS preferences. Statuses include text, not color alone. Remote Markdown remains inert HTML-free content with explicit external-link handling.

Artwork prompts and reference provenance are recorded in `image-prompts.json`, `plush-image-prompt.json`, and `../NOTICE.md`.
