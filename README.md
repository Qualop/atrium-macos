<p align="center">
  <img src="docs/images/banner.png" alt="Atrium" width="560">
</p>

<p align="center">
  <b>Your AI coding sessions, together on one canvas.</b><br>
  A macOS desktop workspace for Claude Code, Codex, Gemini CLI and terminals.
</p>

<p align="center">
  <b>English</b> · <a href="README.ko.md">한국어</a> · <a href="LICENSE">MIT</a>
</p>

Atrium lets you run several coding sessions, see which ones need your attention, and send instructions without switching between terminal windows. It manages the workspace; Claude Code, Codex, Gemini CLI and your shell do the actual work.

![Atrium on macOS: Korean UI with a session name and automatically discovered Codex model selector](docs/images/model-picker-macos.png)

*Actual macOS UI in an isolated test project. The displayed model catalog depends on your installed Codex and provider configuration.*

## Start on macOS

You need **Node.js 24**, **Git**, and whichever agent CLI you want to use. Install and sign in to your chosen CLI separately; Google account users should use Antigravity CLI (see below). Plain terminals do not require an AI account.

```sh
git clone https://github.com/Qualop/atrium-macos.git
cd atrium-macos/app
npm run setup:mac
npm run mac
```

`setup:mac` downloads **herdr TUI 0.9.5** for Apple Silicon or Intel, verifies its SHA-256, and installs the app and backend dependencies. Herdr stays inside the checkout under `.tools/`; the setup script does not install it globally or edit your shell configuration.

After setup, launch again with `npm run mac` from `app/`. To use another compatible herdr executable, set `ATRIUM_HERDR` to its path. This integration expects herdr **0.9.5 / protocol 22**.

## Your first session

1. Click **+** at the top left and choose a project folder.
2. Click **New session…** at the bottom, or **Shift-click** an agent icon on the left.
3. Enter an optional **session name**, such as `reviewer`. This is a nickname for the window, not a model name. Names accept ASCII letters, digits, `-` and `_`.
4. Choose **Codex**, then select a model from the dropdown. Use **Refresh**, **Use Codex default settings**, or **Enter a model ID…** as needed. Extra CLI arguments are under **Advanced settings**.
5. Start the session and complete any sign-in, folder trust or approval prompts in its terminal.
6. Send an instruction from the bottom input:

   ```text
   @reviewer Explain this project's structure. Do not change any files.
   ```

The model picker reads the installed Codex catalog using `model/list`; it does not start an inference turn. Being listed does **not** guarantee access to a model. The selected model takes precedence over model options in the additional arguments.

`Enter` sends and `Shift+Enter` adds a line. `⌘K` focuses the input and `⌘F` searches. `@all` targets agent sessions across the **entire board**, not just the current project. Shell commands must be entered directly in a terminal.

For the Korean interface, choose **Settings → Language → 한국어**.

### Collaborating with Gemini

For a **personal Google account**, install [Antigravity CLI](https://antigravity.google/docs/getting-started), run `agy`, and sign in. Choose **Gemini (Antigravity)** in Atrium. The older Gemini CLI can reject personal Google sign-in even after OAuth succeeds; retrying the same login does not fix that service rejection.

For a **Gemini API key or supported enterprise authentication**, install `npm install -g @google/gemini-cli` and choose **Gemini CLI**. The sidebar has one Gemini icon for Google accounts. Shift-click it to choose the folder, session name and model; select Gemini CLI in the agent-type dropdown when using API or enterprise authentication. Gemini CLI models are read from installed metadata; Antigravity queries `agy models`. Catalog failures leave default and manual model entry available. A displayed model is not a guarantee of access.

For example, connect a Claude session to a Gemini session with the **reviewer** role. Ask the working session to have its reviewer inspect the change, then address the findings. The role notice provides the delegation commands. Gemini can also delegate to Claude or Codex. Naming a session `reviewer` alone does not assign a role.

Gemini prompt submissions, completed answers and shell tool calls feed the board's collaboration records. Managed children inherit their parent's agent kind; use `--kind claude`, `--kind codex` or `--kind gemini` / `--kind agy` to change it. Answer login, trust and approval prompts in the terminal. Gemini CLI gets a separate settings profile referencing its existing login/history. Antigravity requires a named `atrium-board` entry in `~/.gemini/config/hooks.json`; existing hooks are preserved, and that entry only reports from Atrium-managed sessions. Antigravity hook payloads omit final response text, so Atrium reads completed responses from that session’s native transcript, with terminal snapshots as a fallback. If your settings disable hooks, detailed collaboration tracking is unavailable. Claude history auto-indexing and sleep controls do not apply to Gemini.

## What is included

| Feature | What it does |
|---|---|
| Infinite canvas | Keeps projects, sessions and worktree areas together. Zoom in for a live terminal or out for a summary. |
| Agent sessions | Runs Claude Code, Codex, Gemini CLI and shells. DeepSeek uses Claude Code through a separately configured opencodex gateway. |
| Codex model picker | Discovers models, supports refresh and manual entry, and distinguishes the model from the session name. |
| Attention and results | Shows requests waiting for your response and results you have not reviewed. Claude Code has richer status and approval integration. |
| Split layouts | Arranges several session windows in one group with adjustable dividers. |
| Agent relationships | Assigns roles between sessions and displays delegation in a relationship map. |
| Notes and task boards | Places Markdown notes and kanban cards beside your work. |
| Repeat tasks | Resends an instruction on an interval, when idle, or when a configured text condition matches. These requests can consume model tokens. |
| History and recovery | Lists past Claude conversations and reconnects to sessions after window or backend restarts. |
| Memory controls | Puts eligible idle Claude Code sessions into sleep mode and resumes their conversations when needed. |
| Korean interface | Reworked labels, settings, errors and confirmations, including localized permission choices and Mac shortcut hints. |

Recent reliability fixes cover interrupted message delivery, partial conversation files, concurrent session creation and kanban updates, connection timeouts, and terminal selection when the connection budget is full.

## Build an application for Finder

After setup, run from the **repository root**:

```sh
node app/scripts/package-macos.mjs
```

This creates `out/Atrium.app`. Move it into **Applications** with Finder, then open Atrium normally. The bundle includes Electron, Node 24, herdr and the required runtime dependencies. Agent CLIs and their accounts remain separate.

- Build on the Mac where you intend to use it: the package records detected local CLI paths for Finder launches.
- The package uses a **local ad-hoc signature**. It is not an Apple-notarized distribution or a downloadable DMG release.
- Before rebuilding, move the existing `out/Atrium.app` aside. Packaging uses a temporary staging directory and publishes the bundle only after signing and verification succeed.
- An installed app is a separate copy. Source edits require another build and installation to appear in that copy.

## Closing the window does not stop the work

Herdr owns the terminal processes, so sessions can continue after the window or app exits. The menu-bar icon provides separate controls for the app, backend and execution engine.

To stop the sessions too, choose the menu item that stops **herdr and all sessions**. In Korean, this is **모든 작업과 실행 엔진 종료…**. The app-only and backend-only exit options leave sessions running.

## Data and permissions

- The app's control API binds to `127.0.0.1` and requires a token. This does not make the AI agents offline: their prompts and code may be sent to the configured model provider or gateway.
- Atrium reads Claude conversation metadata and history under `~/.claude/projects`. It can automatically discover projects from previous CLI conversations. This behavior is configurable.
- Session settings are generated separately; Atrium does not modify `~/.claude/settings.json`.
- The default Claude permission mode is `manual`, but some session-control commands are allowlisted. Review permission and automatic-approval settings before running unattended work.
- Archiving keeps conversation files. Supported conversation-deletion actions move the relevant files to Trash after confirmation.

| macOS data | Default location |
|---|---|
| Board database, logs and session settings | `~/Library/Application Support/atrium` |
| Window preferences | `~/Library/Application Support/atrium-app-real` |
| Herdr session | `~/.config/herdr/sessions/atrium` |
| Development data | `backend/.dev/data` |

`ATRIUM_DATA_DIR`, `ATRIUM_APP_USERDATA`, `ATRIUM_HERDR_SESSION` and `ATRIUM_PORT` override the corresponding defaults. Herdr also follows `XDG_CONFIG_HOME`.

## Verification and platform status

As of **2026-11-04**, local verification passed **458 backend tests and 94 UI tests**, plus the renderer build. The macOS integration checks include nine concurrent sessions, model selection, Korean copy at 900×600, multiline paste, synthetic Korean IME events, WebGL context loss, backend crash recovery, and engine stop/start. Test groups were run separately; these are not a claim that every combination or platform has been tested.

| Environment | Status |
|---|---|
| Apple Silicon macOS | Source and installed-app workflows exercised locally. |
| Intel herdr through Rosetta | Integration checks passed with ARM64 Node/Electron. This is not an Intel Mac hardware test. |
| Intel Mac hardware | Not verified. |
| Windows | Existing implementation retained and CI configured; native regression testing has not been performed locally. |

Google model listing was also verified from the installed app. The actual Gemini CLI completed a turn and exact-ID resume against a local fake model server. A live Google worker/reviewer pair completed review → correction → re-review through board deliveries. Mixed-provider collaboration is covered separately by backend contract tests.

Physical reboot recovery, real IME candidate windows and language switching, OS notification clicks, and authenticated model work across every provider still require manual validation. A passing test suite is not a security certification.

The [full functional audit](docs/log/full-functional-audit.md) covers lifecycle, delegation, queues, loops, history, search, memos, kanban, layout, terminals and packaging. Another **19 browser interaction tests** passed, including a board with 100 synthetic sessions.

## Development

Run these commands from the repository root:

```sh
npm --prefix backend test
npm --prefix app test
npm --prefix app run build
npm --prefix app run test:mac
npm --prefix app run test:mac:stress
```

To include the installed Gemini CLI and Codex catalogs, Google provider UI, and Korean UI checks:

```sh
ATRIUM_TEST_GEMINI=1 ATRIUM_TEST_MODELS=1 ATRIUM_TEST_COPY=1 npm --prefix app run test:mac
```

Start the development profile with `cd app && npm run mac -- --dev`. Integration tests create separate temporary profiles, folders and herdr sessions; they do not use the normal board's data.

Architecture: **Electron / React / React Flow / xterm.js → local Node 24 backend → herdr → agent CLIs**, with board state stored in SQLite.

- [Testing guide](docs/testing.md)
- [Architecture](docs/ARCH.md)
- [Reliability validation](docs/log/resilience-validation.md)
- [Model picker](docs/log/codex-model-picker.md)
- [Korean UI revision](docs/log/korean-ui-rewrite.md)

## License and third-party software

[MIT](LICENSE). Dependency licenses and font notices are listed in [THIRD_PARTY_NOTICES](app/THIRD_PARTY_NOTICES.txt). Agent names and logos identify the corresponding tools; they do not imply affiliation or endorsement.
