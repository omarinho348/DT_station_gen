# Progress

Source of truth for requirements: [Claude.md](Claude.md). One step at a time; each step waits for approval.

## Decisions so far

- Language: plain JavaScript (ES modules), zod for schemas.
- Reference repo (`3D-Digital-Twin-Visualization-Tool`): the owner sends the files when they're needed; I don't read the repo directly.
- Extra dependencies from §5 (`openai`, `lucide`, `fflate`) are installed in the phase that first needs them.
- `three` pinned to `^0.186.1` (stays in r186; 0.187 exists but the spec says ^0.186).

## Phase 0: Set-up

### Step 1: Project scaffold (done, awaiting approval)

**Changed**
- `package.json`: vite 7.3.8, three 0.186.1, vitest 3.2.7, zod 4.6.7; scripts `dev`, `build`, `preview`, `test`, `test:watch`.
- `vite.config.js`: port 5173 (strict), Vitest picks up `tests/**/*.test.js` in Node.
- `.gitignore`: node_modules, dist, `.env*` (except `.env.example`), `.agent-cache/`, `generated/_draft/`, `screenshots/`.
- `.env.example`: key placeholder, `LLM_MODE=mock`, model/price placeholders, budget caps 0.50 / 4.50.
- `index.html`, `app/main.js`, `app/style.css`: placeholder page.
- Folder skeleton from §6.1 with `.gitkeep` files, plus `scripts/`.
- `tests/smoke.test.js`: three r186 builds geometry headless; zod 4 defaults and `z.toJSONSchema` work.

**Results**
- `npm install`: OK (53 packages).
- `npm test`: 1 file, 2 tests passed.
- `npm run dev`: page and `/app/main.js` serve with HTTP 200; a headless Chrome screenshot shows the placeholder text.
- `npm audit`: 0 issues in runtime dependencies; 3 in dev dependencies (Vitest 3's `@vitest/mocker` and `tinypool`, which only run locally during tests). Fixing them needs Vitest 5, a major upgrade that breaks the §5 stack. Open question for the owner.

**Next:** Step 2, the empty viewer (renderer, camera, orbit controls, lights, environment, floor grid).
