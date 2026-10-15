# Test report — v1.0.0 (14 October 2026)

Machine: Windows 11 Home 10.0.26200, Node 26.8.2, npm 11.19.1, Electron 44.7.2 (Node 24.21 inside).

## Results

| Suite | Command | Result |
|---|---|---|
| Type-check (main, preload, shared, tests, renderer) | `npm run typecheck` | ✅ no errors |
| Unit + integration (Vitest) | `npm test` | ✅ **80 / 80 passed** (5 files) |
| E2E on dev build (Playwright → real Electron window) | `npm run test:e2e` | ✅ passed |
| E2E on **packaged** app (`dist/win-unpacked/KishoreSocialStudio.exe`) | `KSS_E2E_EXE=… npx playwright test` | ✅ passed |
| Installer build | `npm run dist` | ✅ `dist/Kishore-Social-Studio-Setup-1.0.0.exe` (109 MB, NSIS, x64, per-user) |

## Acceptance checklist (plan section 11)

| # | Criterion | Verified by | Status |
|---|---|---|---|
| 1 | Windows app opens | E2E launch of the dev build and the packaged exe on Windows 11 | ✅ |
| 2 | Headline generates all selected types | E2E: 14 tabs after "Generate 14 packages" (Mock); unit: headline-only → 14 types | ✅ |
| 3 | Real provider works with valid key | Both adapters tested with the **real SDKs against a local fake HTTP server** (request shape, JSON-schema / forced tool use, streaming, usage, 401/429 mapping) | ⚠️ **Not tested against live OpenAI/Anthropic** — no API key was available. Do this first: AI Provider Settings → Test connection, then one generation. |
| 4 | Mock mode clearly labelled | E2E: banner + MOCK OUTPUT badges; exports carry "MOCK OUTPUT" | ✅ |
| 5 | Results editable and copyable | E2E: edit field, regenerate with diff, accept, undo, copy full package (read back from the OS clipboard) | ✅ |
| 6 | Drafts persist after restart | E2E: closes and relaunches the app, the draft and the edit are still there; unit: DB file close/reopen | ✅ |
| 7 | Export works | Unit: TXT/JSON/HTML/PDF*/CSV files written and contain the draft; backup → import round-trip | ✅ (*PDF path tested with a stub in unit tests; real `printToPDF` runs only in the app — open one exported PDF manually once) |
| 8 | No invented facts from missing context | 21 accuracy tests incl. the four spec examples (allegation, missing exam date, question, headline-only) | ✅ for the deterministic checks — see limitations |
| 9 | Channel names applied correctly | Unit: per-platform mandatory hashtag, Settings change propagates, second profile used | ✅ |
| 10 | Credentials never in logs/exports | Unit: keys absent from DB tables, log file, TXT/JSON/HTML/CSV exports and backup, even when a key is pasted into source text | ✅ |

## Other things the tests cover

- IPC rejects malformed payloads, unknown channels, path-like field names and non-allowlisted URLs.
- Schema: Instagram + keywords rejected, Story + titles/hashtags rejected, exactly 3 title options, missing/duplicate/unrequested packages reported.
- One automatic repair retry, then a clear "schema" error with nothing saved.
- Cancel during generation; timeout, offline, rate-limit (with retry-after), quota, invalid-key, server-error mapping.
- Regenerating one field never changes other edited fields; undo order; platform regenerate + undo; reset + undo.
- CSV formula injection neutralised; prompt delimiter spoofing neutralised; skill loader refuses `../` and absolute paths.
- Window security in E2E: no `require`/`process` in the page; `window.api` exposes only `invoke`.
- Tamil font: `document.fonts.check('16px "Noto Sans Tamil"', 'தமிழ்')` is true in the real window. Screenshots in `docs/screenshots/` show correct shaping of mixed Tamil + English.

## Not verified / known limitations

1. **Live AI calls** (see #3). Quality of real Tamil output depends on the model. Review the first results carefully and adjust `SKILL.md` / `examples.json` if wording feels unnatural.
2. **Installer was built but not installed** on this PC by the build process. Run it once yourself and check: the Start-menu shortcut, first launch, and uninstall. The packaged app itself (`win-unpacked`) passed the full E2E test.
3. **Unsigned**: SmartScreen warns on first run.
4. **Tamil name detection is not possible** with the capital-letter heuristic. New Tamil names will not be flagged; English names will (as "info"). Numbers, dates, quotes, claim words and hype phrases are checked in both languages.
5. Instagram caption / hashtag limits and the Facebook text limit could not be confirmed on official help pages (see `PLATFORM-LIMITS.md`).
6. The accuracy checks are deterministic heuristics. They reduce risk but do not replace an editor reading the text before posting.
