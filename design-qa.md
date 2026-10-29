# Three literary themes — implementation QA

final result: passed

Scope: the three author-approved theme directions applied to the existing desktop application. This is a functional theme implementation, not a claim of pixel-identical reproduction of every illustrative detail in the mockups.

## Visual evidence

- Sources: the approved Maple, Snow and Sword desktop concept images (1487 × 1058 pixels).
- Implementations: `preview-v010-maple.png`, `preview-v010-snow.png`, `preview-v010-sword.png`; captured in the in-app browser at a 1280 × 720 CSS viewport (1265 × 712 screenshot content after browser scrollbars).
- Combined comparisons: `data/qa-v010/compare-maple.png`, `compare-snow.png`, `compare-sword.png`. Each comparison places the source, normalized to the implementation width and top viewport crop, beside the corresponding implementation. The original full source was also inspected. These comparisons assess composition and theme fidelity, not pixel coordinates across unequal viewport heights.
- Focused checks: `preview-v010-reader.png`, `preview-v010-dialog.png`, `preview-v010-ai.png`, `preview-v010-relations.png`. The production home was checked separately using its existing long title and real chapter counts; that private screenshot is excluded from source control.

## Findings and fixes

- [P2, fixed] The initial Sword reader toolbar retained the old brown text, lowering contrast. Reader buttons now inherit the reader ink token. A fresh reader capture shows readable tools, page text and footer on the dark surface.
- [P2, fixed] Repeated theme changes stacked success messages over statistics. Theme selection now communicates through its pressed state; only storage failures show a message. Subsequent captures show no obstructing toast stack.
- [P2, fixed] The sidebar could scroll horizontally. Horizontal overflow is now clipped and status text wraps within its own grid. Export and settings also have entries in the compact navigation rather than disappearing with the desktop sidebar footer.
- [P2, fixed] Relationship labels inherited pale blue rectangle fills. Graph nodes, arrows, labels and label backgrounds now use theme tokens.
- [P3, accepted] Illustrative chapter paintings in the concepts are represented by local theme vignettes, rather than invented chapter-specific story illustrations. All generated art is decorative and absent from the manuscript reading surface.
- [P3, accepted] The existing fourth maintenance statistic, demo notice, full navigation and author data remain visible. Their additional height and content differ intentionally from the simplified concept images. The home hero was shortened after comparison, keeping the recent chapters closer to the first viewport.

## Required fidelity surfaces

- Typography: existing local Songti/SimSun-compatible serif stack for book titles and literary headings, system UI fallbacks for controls. No network font dependency. Navigation 15 px, ordinary helper text 13 px, chapter excerpts 14 px and adjustable reader text 16–30 px. Long production book titles wrap without covering the illustration.
- Layout rhythm: one navigation column, quiet utility bar with a shared theme selector, open hero, lightweight chapter separators, and a note column. Form density, navigation and retained statistics follow the existing product. No art overlays the text column or blocks pointer input.
- Colors: semantic tokens replace the old fixed blue/brown styling across forms, dialogs, AI workbench, maintenance and graph surfaces. Main text / muted text / primary-button contrast ratios: Maple 12.68 / 5.51 / 6.17; Snow 12.02 / 5.06 / 6.69; Sword 12.01 / 7.99 / 9.09. These are token-pair checks, not a full accessibility certification.
- Image quality: three real AI-generated raster illustrations with alpha edges, supplied locally as WebP; approximately 302 / 368 / 444 KB. No synthetic SVG/CSS approximation of the maple, snow or sword artwork. The existing application icon system is retained.
- Copy/content: existing source-backed author records and actions are unchanged. Theme selection is a browser appearance preference, not a novel setting. Data and reference indexes remain in the canonical project.

## Functional checks

- Switch all three themes without reloading the page.
- Preserve an unsaved note and in-progress model-name input while switching.
- Persist the selected theme across refresh; synchronize it across two same-origin tabs.
- Open the reader, change theme, return to the workbench; read and navigate chapters normally.
- Inspect dark relationship graphs and relation-editing dialog, without saving new author records.
- Static asset routes return WebP MIME types; unknown files remain unavailable.
- Syntax checks and the 64-test suite pass.

Limit: the browser exposed a fixed desktop viewport in this run. Compact CSS and navigation were reviewed, but a real mobile viewport and a full keyboard/screen-reader audit are not claimed as tested.

Implementation checklist: artwork placed; local theme persistence; form-preserving switching; reader support; dark dialogs/graphs; route allowlist; regression checks; production data integrity confirmed.
