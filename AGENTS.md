# AGENTS.md — 8086 Learning Lab

Guidance for AI agents and new contributors working in this repository.
Everything below was verified against the CI-built WASM engine on 2026-11-14
(run `43619396640`); re-run the commands in [Verification](#verification)
after changing anything.

## What this repository is

A static, backend-free 8086 learning environment hosted on GitHub Pages:

- **Rust → WASM interpreter** (`src/`): a self-contained engine
  (lexer → parser → AST → semantic validation → executor). It has **no
  upstream interpreter dependency** — `Cargo.toml` only depends on
  `wasm-bindgen`, `serde`, `serde_json` (+ optional panic hook / `wee_alloc`).
- **React app** (`webapp/`): Create React App 4 + `react-app-rewired`,
  React Router 5, Material-UI v4, Ace editor. Landing page at `/`,
  compiler at `/compile`, instruction reference at `/instructions`.
- **`docs/`**: a *stale legacy build* kept only as an archive. It is **not**
  what GitHub Actions deploys — the pipeline deploys `webapp/build/`.

> **Interpreter, not assembler.** The engine interprets a structured
> instruction representation produced by the parser/sema pipeline. It does
> **not** encode x86 machine code: no opcode bytes are generated or verified.
> Never describe this project as a working assembler, and never claim
> byte-level encoding compatibility.

## Architecture

### Rust crate (`emulator-8086-web`)

| File | Role |
| --- | --- |
| `src/lib.rs` | wasm-bindgen entry: `mod driver; mod exec; mod frontend;` re-exports `WebDriver`. |
| `src/frontend/lexer.rs` | Tokenizer: comments, strings, identifiers, numbers (decimal, `0x…`, `0b…`, digit-initial `…h`/`…H`, and letter-initial `FFh`/`1010B` **in operand/expression context**). Identifiers/labels/strings/comments are never rewritten. |
| `src/frontend/parser.rs` | Recursive-descent parser → `Vec<Stmt>`: labels (colon and colon-less data form), `DB`/`DW` (+ arrays, strings, `DUP`), section/directive handling (whitelist below), instructions with structured operands, legacy `MACRO … -> … <-`, `print`, `SET`. |
| `src/frontend/ast.rs` | `Stmt`, `Instr`, `Op` (original-8086 subset), `Operand`, `MemOperand`, `Expr`. |
| `src/frontend/sema.rs` | Symbols, size/range checks, 8086 effective-address rules, jump-target resolution (second pass — forward jumps work), entry-point selection (`END`, `start:`, leading `JMP`, else first instruction), implicit `HLT`, `.STACK` → `Program.stack_size`, predefined `@DATA/@CODE/@STACK… = 0`. |
| `src/exec/mod.rs` | The executor: `Cpu` (16-bit regs, flags, 1 MB memory, IP), little-endian R/W, 20-bit physical wrap, DS/SS defaults + segment overrides, full flag logic (ADD/SUB/CF/OF/AF/ZF/SF/PF, INC/DEC keep CF, MUL/DIV ±overflow, shifts/rotates with CL), jumps/`LOOP`/`CALL`-`RET`, string ops + `REP`, `INT` dispatch (0, 3, 10h, 20h, 21h). |
| `src/driver/driver.rs` | `WebDriver` — the JS contract: `next()` → `{halt, int, ah}`, `get_state_snapshot()` → JSON `{instruction, registers, flags, changed_memory}`, `get_reg/get_flags/get_mem`, `int_10/get_int_21/set_int_21`, public `line`. `.STACK n` initialises `SP = n` (else `FFFEh`). Runtime errors rewind IP and record the failing step. |
| `src/driver/preprocess.rs` | `preprocess(source)`: lex → parse → analyze → `WebDriver`; diagnostics are `"Syntax Error|Error at line L:C : <src> : <msg>"`. |
| `src/driver/util.rs` | `JSReg`/`JSFlags` wasm objects for the live panels. |
| `.cargo/config` | Sets `-z stack-size=2000000` for `wasm32-unknown-unknown`. **Preserve it.** |

**JS API contract (do not break):** `preprocess(src)` → driver;
`driver.next()` → `{halt, int, ah}` where `int`/`ah` are **decimal service
numbers** (`10` = INT 10h, `21` = INT 21h); `get_state_snapshot()` returns
`{instruction, registers{AX…IP}, flags{CF…OF}, changed_memory[{address,
before, after}]}`; `get_mem(start, end)` is inclusive and returns a
`Uint8Array`; `int_10()`, `get_int_21()`, `set_int_21(str)`, `driver.line`.

**Memory history contract (important):** every executed instruction records
`changed_memory: [{address, before, after}]`, diffed against a snapshot of RAM
taken after the *previous* step (`prev_memory`). The frontend reconstructs any
historical RAM image by walking history backwards and re-applying `before`, so
repeated writes to the same address round-trip exactly. Never "simplify" this
back to a single `value` field.

### Supported MASM directives vs explicit diagnostics

Implemented (with semantics or documented no-op effect):

- `.DATA`, `.CODE`, `.CONST`, `.DATA?` — section markers.
- `.STACK n` — reserves the stack; `SP` starts at `n` (grows downwards).
- `.MODEL …` — accepted; the runtime is a single flat 1 MB segment
  (equivalent to TINY; larger models fall back to the same flat layout) and
  `@DATA`/`@CODE`/`@STACK` resolve to paragraph `0`.
- `.8086` — no-op (this *is* the target). `ASSUME …` — no-op (assembler-side
  bookkeeping; every assumption holds in the flat model, so no code exists).
- `name PROC [NEAR|FAR]`, `name ENDP`, `END [label]`, `SET n` (paragraph
  origin), `DB`/`DW`, `OFFSET`, `BYTE`/`WORD PTR`, legacy `MACRO`/`print`.

Rejected with an explicit message naming the directive (never silently
ignored): any other `.directive` (e.g. `.386` — "only the original 8086"),
`EQU`, `ORG`, `SEGMENT`/`ENDS`, unknown mnemonics, bad operand sizes,
invalid 8086 EA combinations, jumps to undefined labels.

### Frontend (`webapp/src`)

| Area | Files | Notes |
| --- | --- | --- |
| Routing/WASM boot | `components/router.js` | `basename` derived from `PUBLIC_URL`; loads `emulator_8086` and inits `${PUBLIC_URL}/emulator_8086_web_bg.wasm`; distinct loading/ready/error states — a failed load never renders a working editor. |
| Execution | `services/EmulatorAdapter.js`, `hooks/useExecutionController.js`, `context/EmulatorContext.js` | **Single execution mechanism.** Adapter wraps `preprocess()/next()/get_state_snapshot()`; the controller owns the run timer (one chain, `runId` guards against stale runs) and handles `int 10` (BIOS output), `int 21` AH=01/02/09/0Ah (input, char output, `$`-string output, buffered input); the context holds `{history, currentIndex, speed, status, radix, activeTab}`. Compile → baseline snapshot; each Step = one `next()` → one snapshot pushed. |
| Compiler page | `pages/compiler.js` | Editor + toolbar + memory table + register/flag panels + 5-tab inspector. Historical navigation only moves `currentIndex` — it never touches the live driver. `convertArray()` must accept `Uint8Array` (that is what `get_mem()` returns). |
| Panels | `components/simulator/*`, `components/ALUPanel.js`, `components/HistoryTimeline.js` | Registers/flags derive values from the selected snapshot; byte aliases (AH/AL/…) resolve through their 16-bit parent; ALU breakdown reports "unavailable" instead of inventing operand values. |
| Semantics text | `utils/instructionSemantics.js`, `utils/traceSelectors.js`, `utils/numberFormat.js` | All displayed values come from snapshots (`formatOperand`/`formatValue`), never from guesses. |

## WASM package & build dependencies

- `webapp/package.json` declares `"emulator_8086": "file:../pkg"` (npm
  symlink). **`pkg/` must exist before `npm ci`/`npm install`.**
- `pkg/` is produced by
  `wasm-pack build --release --target web --out-dir pkg`. It is gitignored
  **and untracked** — never commit it, and no workflow pushes it back to Git;
  CI publishes it only as the `pkg` workflow artifact.
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

## CI (`.github/workflows/ci.yml`)

Runs on every push/PR: `cargo test --lib` → `wasm-pack build` → uploads
`pkg/` as a **workflow artifact** (never to Git) → `npm ci` → Jest (real
engine, no mocks) → production build → `tests/engine.test.mjs`,
`tests/intel8086.test.mjs`, `tests/static.test.mjs`. Suite summaries are
emitted as job annotations (`::notice::`) so exact counts are readable via
the Actions API even when job logs are unavailable. Rust errors are surfaced
as `::error::` annotations.

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

Run from the repository root (suites need `pkg/`; CI produces it as an
artifact, or build locally with Rust + wasm-pack):

```bash
# 1. Build the engine (CI does this automatically)
wasm-pack build --release --target web --out-dir pkg

# 2. Install frontend deps once (file:../pkg must exist first)
cd webapp && npm ci --legacy-peer-deps && cd ..

# 3. Node suites against the real .wasm
node tests/engine.test.mjs        # 44 checks: ALU, flags, memory, stack, jumps, errors
node tests/intel8086.test.mjs     # 52 checks: acceptance A–E, directives, literals,
                                  # invalid inputs, legacy default, all shipped samples

# 4. Frontend tests (jsdom, real engine — no mocks)
cd webapp && CI=true npx react-app-rewired test   # 10 tests

# 5. Production build (zero warnings) + static hosting/deep-link suite
CI=true npm run build && cd .. && node tests/static.test.mjs   # 17 checks
```

### Test status (2026-11-14, CI run `43619396640`, freshly built `pkg/`)

| Suite | Result |
| --- | --- |
| `cargo test --lib` + `wasm-pack build` | **pass** |
| `tests/engine.test.mjs` (A arithmetic, B byte aliases, C memory history, D stack, E jumps/LOOP, F ALU, G errors) | **44/44 pass** |
| `tests/intel8086.test.mjs` (acceptance A–E: ADD→0008H, `[BX+SI+02H]` little-endian, `.DATA`/OFFSET, LOOP→0005H, INT 21h AH=02H → "A"; directives incl. `.STACK`/`.MODEL`; literal forms; 12 invalid-input diagnostics; legacy default; all 8 shipped samples + result checks) | **52/52 pass** |
| `webapp/src/learningLab.test.js` + `webapp/src/services/engineIntegration.test.js` (landing, compile+step UI, adapter contract, DOS/BIOS I/O incl. AH=09, entry-point JMP, error propagation) | **10/10 pass** |
| `tests/static.test.mjs` (base path, bundle URLs, `/compile` & `/instructions` deep-link 404 fallback, wasm MIME/magic/size, no external hosts) | **17/17 pass** |
| `CI=true npm run build` | **Compiled successfully, 0 warnings** |

## Engine limitations (verified — do not paper over them)

- **No machine-code encoding.** See the interpreter note above: the engine
  executes a structured IR; it is not an assembler and emits no opcodes.
- **Number literals:** `decimal`, `0x…`, `0b…`, digit-initial Intel hex
  (`0005h`, `0FFh`, `0BCh`), binary suffix (`1010B`), and letter-initial
  hex/binary **in operand/expression context** (`FFh`, `ABCh` — the parser
  recognises them where a value is expected). As *label/symbol names* those
  same tokens stay identifiers, so a symbol literally named `FFh` cannot also
  be used as a value (name collision is the user's responsibility).
  Identifiers, strings and comments are never rewritten.
- **Memory operands:** a bracket operand without any register needs a size
  qualifier (`MOV BYTE PTR [0500h], AL` / `MOV byte [0500h], AL`); register
  forms infer the size (`MOV WORD PTR [BX+SI+02H], 1234H`, `[BX]`, `[SI]`,
  `[BX+SI+04H]`, `DS:[SI]`/`DS[SI]` overrides). Original-8086 EA rules are
  enforced (no `BX+BP`, no `SI+DI`, no 8-bit regs, no `AX` in brackets).
- **Segments:** the runtime is one flat 1 MB address space (CS=DS=SS=ES=0
  unless changed); `.MODEL`/`@DATA` follow that model. There is no real
  segmented loader, no separate code/data segments, and `SEG` is rejected.
- **Interrupts:** DOS `INT 21h` AH=01 (char in), 02 (char out, AL mirrors),
  09 (`$`-string at DS:DX), 0Ah (buffered input); BIOS `INT 10h` AH=0Ah/13h;
  `INT 3`, `INT 0` (division error), `INT 20h` (terminate). Everything else
  raises "int 0xNN not supported". No real video/keyboard hardware.
- **`.STACK`/`.MODEL` are approximations** of MASM's segment machinery inside
  the flat model (documented above) — they work for standard student
  programs, not for code that relies on distinct segment bases.
- **Errors:** assembly/label errors are thrown by `preprocess()` with
  `line:col` text; division by zero throws from `next()` at step time.
- **`docs/` is stale** — do not copy assets or behaviour from it.

## Conventions & pitfalls

- Lint runs as part of `npm run build`; `react-hooks/exhaustive-deps` fires if
  you copy `state.history`/`state.currentIndex` into a local before listing
  them in deps — reference the member expressions directly instead.
- Do not introduce a second execution path (timers, parallel runners) outside
  `useExecutionController`.
- Do not commit `node_modules/`, Rust `target/`, or `pkg/` — and never add a
  workflow that pushes `pkg/` back to Git (use the CI artifact instead).
- Keep changes scoped: complete and connect existing components rather than
  redesigning them.
