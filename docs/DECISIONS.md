# Decisions

Decisions taken while building v1.0.0, against the project plan (v1.0, 14 Oct 2026).

## Open decisions from the plan (section 13) — the plan's recommendations were taken

| Decision | Chosen | Note |
|---|---|---|
| Which provider first | **Both** OpenAI and Anthropic, plus Mock | The adapter interface made the second one cheap. Both are tested against a local fake server with the real SDKs, but **not** against the live APIs (no key was available). |
| URL fetching in v1 | **No** | URLs are stored as references with a "NOT READ" badge, and the prompt tells the model the URL was not read. |
| PDF export | **Printable HTML + Electron print-to-PDF** | The fonts are embedded as data URIs, so the HTML file is self-contained and Tamil shapes correctly. |
| Code-sign the installer | **No** | SmartScreen shows a warning ("More info → Run anyway"). Reconsider before sharing publicly. |
| Channel profiles | **Multiple, one default** | |
| Where to build the installer | On this Windows 11 PC | `npm run dist`. |

## Changes from the plan's technology choices

### SQLite: Node's built-in `node:sqlite` instead of `better-sqlite3`
The plan listed better-sqlite3 first, with "Node's built-in sqlite module" as the fallback.
I used the fallback from the start because:
- Electron 44's main process runs Node 24.21 and has `node:sqlite` built in (verified).
- It removes the native-module rebuild for the Electron ABI, which is the plan's "native SQLite module fails to package" risk.
- The same database code runs in Vitest under plain Node 26, so persistence tests use the real engine.
- The API is synchronous, like better-sqlite3. All data access is in `src/main/db/`, so switching back later would only touch that folder.

Status: `node:sqlite` is marked "release candidate" in Node 24. If a future Electron upgrade changes it, the fallback is better-sqlite3.

### Anthropic: structured outputs (`output_config.format`), not forced tool use
Forced tool use (`tool_choice: {type: "tool"}`) returns a 400 error on Claude Sonnet 5.5,
Opus 5.5 and Fable 5.1. The adapter therefore asks for JSON with structured outputs.
Schema keywords that structured outputs does not accept (`minItems`, `maxItems`,
`minLength`, `minimum`, …) are stripped before sending, and zod checks them again on
the response, with one repair retry. Streaming is used so long Tamil outputs don't hit
the SDK's non-streaming time limit.

For Fable 5.1, Opus 5.5, Opus 5 and Sonnet 5.5 the request also sets the server-side
refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). If
the model declines, the API retries on a suitable model within the same call.

Current models think before answering, and thinking tokens count toward `max_tokens`,
so the output budget is 12k + 3.5k per content type (max 64k). Only used tokens are billed.

### Model picker
AI Provider Settings lists recommended Claude models with prices (Haiku 5.5, Sonnet 5.5,
Opus 5.5, Fable 5.1), any models loaded from your key with *Load list*, and a "type
another model id" option. Changing the model saves immediately. The Generate screen
shows the active model with a *Change* link.

### OpenAI via Chat Completions with `response_format: json_schema` (strict: false)
Strict mode would require every optional field to become required-and-nullable, which
weakens the per-type contract. Non-strict guidance plus zod validation plus one repair
retry is simpler and still never guesses.

### Default models
- Anthropic: `claude-sonnet-5-5` (change it in AI Provider Settings; `claude-haiku-5-5` is about 20× cheaper).
- OpenAI: `gpt-5`. **Check this**: use *Load list* in AI Provider Settings and pick a current model your key can use.

Both are editable per provider.

## Design decisions

- **Guards run when packages are read, not only when they are generated.** Warnings therefore always reflect the current text, including your own edits. The plan asked for this on every regeneration; it now covers edits too.
- **`generated_json` is never overwritten by edits.** Field edits and accepted field regenerations go into `edited_json` with a `field_history` row. Package or platform regeneration replaces `generated_json` and stores the previous visible state in history (`field_path = '*'`), so Undo can restore it.
- **Field regeneration returns a proposal.** The user sees a diff and chooses Replace or Keep current. Nothing changes without acceptance.
- **Hard limits block "Copy full package"; editorial limits only warn.** Individual field Copy buttons always work.
- **The Mock provider uses only the user's headline/summary** and goes through the same schema, branding and accuracy checks as real providers. Every mock result shows a MOCK OUTPUT badge on the result, in exports, and in a persistent banner while Mock mode is active.
- **Import never overwrites.** It adds drafts with new ids, reuses profiles with the same name, and skips templates with the same name. The renderer only gets a preview plus a single-use token; the parsed backup stays in the main process for 10 minutes.
- **Name detection is English-only.** A Tamil script has no capital letters, so new Tamil names cannot be detected reliably. New numbers, dates, quotes, claims and hype phrases are detected in both languages. This is listed as a limitation.
- **Character counting is by Unicode code point.** A Tamil letter with a vowel sign counts as 2. This is the conservative choice, because platforms count at least this many.
