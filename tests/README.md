# Tests

Browser tests that drive the real app with Playwright. They run against a
local-mode dev server, so they never touch the shared Supabase workspace and
never spend anything on the Anthropic API — `/api/ai` is intercepted and
answered by a fake model.

## Running them

```bash
npm install
VITE_LOCAL_MODE=1 npx vite --port 5210 --strictPort   # in one terminal
node tests/sweep.mjs                                  # in another
```

`VITE_LOCAL_MODE=1` makes the app skip sign-in and keep data in this browser's
localStorage. Without it the tests would hit the login screen.

Run everything:

```bash
node tests/model.mjs                  # no browser needed
node tests/lists.mjs                  # no browser needed
node tests/sweep.mjs                  # needs the dev server
node tests/v2.mjs                     # needs the dev server
```

## What each one covers

**`model.mjs`** — the domain model and the v1 → v2 migration, with no browser.
Builds a document shaped like the real stored one and proves every mapping:
status split from mode (including that a blocked item still counts as waiting
on its named person), priorities onto P1–P5, the single country field onto
Operational Contexts, People harvested from owner and waiting-on names without
creating the signed-in user as their own colleague, completed work archived off
the board. Also checks the derived values — attention, portfolio health, due
badges, and that a goal's health comes from the clock rather than the
percentage. Crucially it runs the migration twice and proves the second pass
changes nothing: a migration that keeps finding work re-saves the whole
document on every single load.

**`lists.mjs`** — reads the constants straight out of `src/lib/model.js` and
proves no stored value is ever orphaned, nothing live is mapped to a closed
state, and nothing restricted becomes shareable. Also proves there is only
ONE classification list left: every retired workstream has a Function context
of the same name to land on, and no name appears twice.

**`v2.mjs`** — the v2 behaviour in the browser (22 checks). The rebuilt Capture
(that it groups a dump by kind, separates the user's actions from what others
owe, leaves spotted dates un-ticked, and writes records with the right modes
and a link back to the source), the mode/status split end to end, Portfolio,
Goals, the meeting workflow including that a meeting is only marked processed
after the records exist, and the confidentiality fence — it writes a
development note about a named person and then asserts that the text never
appears in an outgoing AI request while the person's name still does.

**`sweep.mjs`** — the full interaction sweep (74 checks). Every screen renders,
the work-item lifecycle (create, validate, type-specific fields, notes, edit,
delete), dialog and keyboard behaviour including Escape on stacked dialogs,
the AI cost controls (which model each job uses, that the workspace brief is
sent as one cacheable block and stays identical across tool rounds, that usage
reaches the spend meter, that the budget warning fires), capture, projects,
mobilisations, the COO/Board workspace including the board person-sweep,
search, persistence across a reload, export downloads, and the mobile layout
at 390px. Exits non-zero if anything fails.

**`measure-ai-cost.mjs`** — seeds a realistically sized workspace, captures the
brief the assistant actually sends, and prints what a multi-round reply costs
with and without caching. Use it to re-check the economics after changing the
system prompt or `serialiseForAI`.

## Notes for writing more

- There are no `data-testid` attributes; select by visible text or the stable
  class names (`.nitem`, `.kcard`, `.modal`, `.card`, `.tbl`, `.clip-fab`).
- Sidebar nav entries are `div.nitem`, not buttons, and their text includes a
  count badge when one is showing.
- Confirmations are in-DOM (`AskDialog`), never native — click `Yes, continue`,
  `OK` or `Save` rather than handling `page.on("dialog")`.
- A fresh workspace is genuinely empty, so a test must create whatever it
  needs before asserting on it.
- Saves are debounced 700ms; wait before asserting on localStorage.
- Select a sidebar entry by its `.lbl` span, not the `.nitem` row: the row's
  text picks up the count badge, so an anchored `^Waiting & Chasing$` stops
  matching the moment something is actually waiting. The click bubbles up.
- Playwright matches routes newest-first. A test that adds a second
  `page.route("**/api/ai", …)` to inspect one request must remove that handler
  by reference afterwards, or it silently swallows every later AI call.
