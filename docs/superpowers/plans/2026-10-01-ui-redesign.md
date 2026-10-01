# UI redesign implementation plan

> For agentic workers: use superpowers:executing-plans. The user requested implementation in this session; execute natively.

**Goal:** Replace padded copy and the dedicated cat widget with a direct game interface and an interactive roaming 3D cat.

**Architecture:** Preserve the server and game contracts. Simplify existing React screens. A Host overlay observes semantic DOM anchors and sends screen positions/depth to one Three.js renderer; only its HTML help target handles pointer input.

**Tech stack:** Existing React, TypeScript, Three.js/R3F, Vitest and Playwright. No new dependencies.

**Spec:** docs/superpowers/specs/2026-10-01-ui-redesign.md

## Constraints and review focus
- Names remain in ignored environment/runtime data.
- No always-visible private badge, promotional hero, footer slogan, decorative reveal headings or host panel.
- Do not cover inputs, game actions or the drawing canvas; check candidate landing positions against interactive bounds.
- Recompute positions on resize/scroll/keyboard changes; clamp on small viewports.
- Stop hidden-page animation and restore a static help control for reduced motion or failed WebGL.
- Cat events use public state only. Preserve secret answers and result accounting.

## Task 1: Direct copy and screens
Files: App.tsx, Lobby.tsx, GamePanel.tsx, Answers.tsx, Clue.tsx, Doodle.tsx, Scorecard.tsx, shared/games.ts, index.html, styles.css, server/app.ts.
- [x] Update acceptance tests to the plain names/actions and run the new roaming check to observe failure.
- [x] Remove redundant copy and restructure the home/game screens; use normal sentence-case instructions only when needed.
- [x] Verify updated all-games acceptance and inspect reveals.

## Task 2: Roaming host
Files: components/Host.tsx, components/CatScene.tsx, components/catLayout.ts, tests/cat-layout.test.ts, tests/e2e/v1.spec.ts.
Interfaces: CatPlacement {x,y,z,anchor}; resolvePerch(anchor, viewport, obstacles); Host consumes public mood/event key and help callback; CatScene consumes placement/mood/visibility and reports settled positions.
- [x] Test viewport clamping and interactive-obstacle avoidance before implementing placement.
- [x] Implement DOM anchoring, card interactions, short speech, page-wide perspective movement, articulated animation and static fallback.
- [x] Verify roaming/depth, help access, scrolling, blocked WebGL and reduced motion on phones.

## Task 3: Verification
Files: README.md, design/progress records, browser screenshots.
- [x] Run engine/server/layout tests, TypeScript and compiled-release browser acceptance.
- [x] Inspect home/game phone and laptop screenshots and resolve material visual issues.
- [x] Obtain independent review per the review skill, resolve findings and leave the local preview running.

No Git repository is present; do not create branches or commits. User authorization covers this reversible local redesign without additional approval handoffs.
