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

## What each one covers

**`sweep.mjs`** — the full interaction sweep (73 checks). Every screen renders,
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
