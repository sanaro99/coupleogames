# UI and cat redesign

The user wants direct, natural copy, fewer headings, and a cat that inhabits the interface. They explicitly requested brainstorming followed by implementation in this session. Existing games, scoring, privacy and persistence stay intact.

The home screen starts with the partners' names and four game cards. Remove the promotional hero, slogan footer, decorative eyebrows, private-table badge, host panel and redundant explanations. Use plain controls and outcomes: Play, Answer, Correct, Same answer, Draw, Play again. Keep game titles, real questions and useful scorecard sections. Connection notices appear only when action is needed.

Replace the fixed host card with one viewport overlay. A perspective Three.js camera renders a better articulated original black cat that walks, jumps onto card edges, reaches toward selected elements and reacts to results. The cat travels in X/Y and Z, with depth changing apparent scale. DOM anchors give it actual landing positions. Interactive controls are obstacles; the overlay passes pointer events through except its small help target. The speech bubble appears briefly for instructions or direct interaction.

Movement is brief and demand-rendered. Stop the canvas when the page is hidden; respect reduced motion and the existing animation switch. A static SVG help button replaces 3D when it is disabled or unavailable. Adapt to resize, scroll, small screens, modal opening and on-screen keyboards. Never expose private answers through cat reactions.

Verify all four games after rewriting copy, persistent records and reconnect behavior. Add browser coverage for roaming between cards, interaction, depth, controls remaining usable and fallback behavior. Check phone and laptop screenshots of the home screen and game reveals.
