# AGENTS.md — 8086 Learning Lab

Guidance for AI agents and new contributors working in this repository.
Everything below was verified against the real WASM build on 2026-11-14;
re-run the commands in [Verification](#verification) after changing anything.

## What this repository is

A static, backend-free 8086 learning environment hosted on GitHub Pages:

- **Rust → WASM interpreter** (`src/`): thin wasm-bindgen wrapper around the
  upstream interpreter (git dependency `lib8086` = `YJDoc2/8086-Emulator`).
- **React app** (`webapp/`): Create React App 4 + `react-app-rewired`,
  React Router 5, Material-UI v4, Ace editor. Landing page at `/`,
  compiler at `/compile`, instruction reference at `/instructions`.
- **`docs/`**: a *stale legacy build* kept only as an archive. It is **not**
  what GitHub Actions deploys — the pipeline deploys `webapp/build/`.

## Architecture

### Rust crate (`emulator-8086-web`)

| File | Role |
| --- | --- |
| `src/lib.rs` | wasm-bindgen entry: `preprocess(source) -> WebDriver` (throws `JsValue` errors with line/col text). |
| `src/driver/driver.rs` | `WebDriver`: `next()` executes one instruction; `get_state_snapshot()` returns JSON `{instruction, registers, flags, changed_memory}`; `get_reg/get_flags/get_mem` for the live panels. |
| `src/driver/preprocess.rs` | Comment stripping → `normalize_hex_literals()` → upstream preprocessor; error positions come from `error_helper::get_err_pos`. |
| `src/driver/util.rs`, `error_helper.rs` | Flag/register JS objects; line/column mapping for diagnostics. |
| `.cargo/config` | Sets `-z stack-size=2000000` for `wasm32-unknown-unknown`. **Preserve it.** |

**Memory history contract (important):** every executed instruction records
`changed_memory: [{address, before, after}]`, diffed against a snapshot of RAM
taken after the *previous* step (`prev_memory`). The frontend reconstructs any
historical RAM image by walking history backwards and re-applying `before`, so
repeated writes to the same address round-trip exactly. Never "simplify" this
back to a single `value` field.

### Frontend (`webapp/src`)

| Area | Files | Notes |
| --- | --- | --- |
| Routing/WASM boot | `components/router.js` | `basename` derived from `PUBLIC_URL`; loads `emulator_8086` and inits `${PUBLIC_URL}/emulator_8086_web_bg.wasm`; distinct loading/ready/error states — a failed load never renders a working editor. |
| Execution | `services/EmulatorAdapter.js`, `hooks/useExecutionController.js`, `context/EmulatorContext.js` | **Single execution mechanism.** Adapter wraps `preprocess()/next()/get_state_snapshot()`; the controller owns the run timer (one chain, `runId` guards against stale runs); the context holds `{history, currentIndex, speed, status, radix, activeTab}`. Compile → baseline snapshot; each Step = one `next()` → one snapshot pushed. |
| Compiler page | `pages/compiler.js` | Editor + toolbar + memory table + register/flag panels + 5-tab inspector. Historical navigation only moves `currentIndex` — it never touches the live driver. `convertArray()` must accept `Uint8Array` (that is what `get_mem()` returns). |
| Panels | `components/simulator/*`, `components/ALUPanel.js`, `components/HistoryTimeline.js` | Registers/flags derive values from the selected snapshot; byte aliases (AH/AL/…) resolve through their 16-bit parent; ALU breakdown reports "unavailable" instead of inventing operand values. |
| Semantics text | `utils/instructionSemantics.js`, `utils/traceSelectors.js`, `utils/numberFormat.js` | All displayed values come from snapshots (`formatOperand`/`formatValue`), never from guesses. |

## WASM package & build dependencies

- `webapp/package.json` declares `"emulator_8086": "file:../pkg"` (npm
  symlink). **`pkg/` must exist before `npm ci`/`npm install`.**
- `pkg/` is produced by
  `wasm-pack build --release --target web --out-dir pkg` (it is gitignored —
  never commit it).
- The deployed binary must be copied to `webapp/public/emulator_8086_web_bg.wasm`
  (the frontend fetches `${PUBLIC_URL}/emulator_8086_web_bg.wasm`).
- `npm ci` requires `--legacy-peer-deps` (transitive `react-speech-kit` peer
  demands React 16, the app uses React 17). `webapp/.npmrc` already sets
  `legacy-peer-deps=true`.
- webpack 4 cannot parse `import.meta`, which the current wasm-bindgen glue
  uses: `webapp/scripts/import-meta-loader.js` (production build) and
  `webapp/scripts/jest-pkg-transform.js` (tests) rewrite it. Both are wired in
  `webapp/config-overrides.js` — do not delete them when upgrading
  wasm-pack/Rust.

## Build & deploy (`.github/workflows/deploy.yml`)

Triggers: `push` to `master`/`main` + `workflow_dispatch`. Permissions:
`contents: read`, `pages: write`, `id-token: write` (required by Pages
artifact deployment).

Pipeline (order matters):

1. checkout → `configure-pages` → Rust toolchain with `wasm32-unknown-unknown`
   → install `wasm-pack` → **build `pkg/` first**
2. copy `pkg/emulator_8086_web_bg.wasm` → `webapp/public/`
3. Node 20 → `npm ci --legacy-peer-deps` → `npm run build`
4. generate `webapp/build/404.html` **from `index.html`** (GitHub Pages serves
   404.html for unknown paths — this is what keeps deep links such as
   `/8086-Online-Smart-Compiler/compile` working on refresh) + `.nojekyll`
5. `upload-pages-artifact` → `deploy-pages` (job environment `github-pages`)

`webapp/package.json` `homepage` must stay
`https://revanthboina.github.io/8086-Online-Smart-Compiler/` (public asset
paths, `basename`, and the WASM URL all derive from it).

### Repository settings the workflow needs (admin UI)

These cannot be changed through the current API token; if deploys fail, check:

1. **Settings → Pages → Source = "GitHub Actions"** (site must have
   `build_type: workflow`; a legacy/branch site rejects `deploy-pages`).
2. **Settings → Environments → `github-pages`** deployment branch policy must
   allow the branch that runs the workflow (a policy of `main` only rejects
   deploys triggered from `master`).

## Verification

Run from the repository root:

```bash
# 1. Build the engine (needs Rust + wasm-pack; CI does this automatically)
wasm-pack build --release --target web --out-dir pkg
cp -f pkg/emulator_8086_web_bg.wasm webapp/public/emulator_8086_web_bg.wasm

# 2. Engine tests A–G against the real .wasm (preprocess, stepping, snapshots)
node tests/engine.test.mjs          # 44 checks

# 3. Frontend tests (jsdom, real engine — no mocks): landing + compile/step flow
cd webapp && CI=true npx react-app-rewired test --watchAll=false   # 2 tests

# 4. Production build (zero warnings) and test H (static hosting/deep links)
npx react-app-rewired build
cd .. && node tests/static.test.mjs  # 17 checks
```

### Test status (2026-11-14, CI-built `pkg/`)

| Suite | Result |
| --- | --- |
| `tests/engine.test.mjs` (A arithmetic, B byte aliases, C memory history, D stack, E jumps/LOOP, F ALU, G errors) | **44/44 pass** |
| `webapp/src/learningLab.test.js` (landing links; compile+step of the default program rendering AX=`0006h`, BX=`0003h`, 5 history steps, all 5 tabs) | **2/2 pass** |
| `tests/static.test.mjs` (base path, bundle URLs, `/compile` & `/instructions` deep-link fallback, local wasm MIME/magic, no external hosts) | **17/17 pass** |
| `npx react-app-rewired build` | **Compiled successfully, 0 warnings** |

## Engine limitations (verified — do not paper over them)

- **Number literals:** `decimal`, `0x…`, `0b…`. Additionally
  `preprocess.rs::normalize_hex_literals()` rewrites digit-initial Intel-style
  hex (`0005h`, `0FFh`, `0BCh` → `0x…`) because the shipped default program
  and lesson material use that form. Literals that start with a letter
  (`FFh`) are **not** rewritten (they are indistinguishable from identifiers)
  — use `0xFF`. Binary-suffix form (`1010b`) is unsupported — use `0b1010`.
  Identifiers are never touched: only digit-initial runs followed by `h` at a
  non-alphanumeric boundary are rewritten, and `0x`/`0b` tokens are copied
  verbatim.
- **Memory operands:** the bracket form needs a size qualifier
  (`MOV byte [0500h], AL`); bare `MOV [0500h], AL` is a syntax error. Labels
  work as operands (`MOV byte VAL, AL`). Absolute addresses are resolved
  through the data segment like the upstream engine does.
- **Interrupts:** only the subset implemented upstream (INT 10h with
  AH=0Ah/0x13, INT 21h with AH=01/02/0Ah, INT 3, INT 0 = division error).
  There is no real video/keyboard hardware.
- **Errors:** assembly/label errors are thrown by `preprocess()` with
  `line:col` text; division by zero throws from `next()` at step time.
- **`docs/` is stale** — do not copy assets or behaviour from it.

## Conventions & pitfalls

- Lint runs as part of `npm run build`; `react-hooks/exhaustive-deps` fires if
  you copy `state.history`/`state.currentIndex` into a local before listing
  them in deps — reference the member expressions directly instead.
- Do not introduce a second execution path (timers, parallel runners) outside
  `useExecutionController`.
- Do not commit `node_modules/`, Rust `target/`, or `pkg/`.
- Keep changes scoped: complete and connect existing components rather than
  redesigning them.
