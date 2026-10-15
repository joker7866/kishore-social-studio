# Troubleshooting

### "Windows protected your PC" when installing
The installer is not code-signed. Click **More info → Run anyway**. Only do this for an
installer you built yourself or got from a trusted source.

### Generate button is disabled
- **No API key saved**: open *AI Provider Settings*, paste the key, Save, then *Use this provider*.
  Or switch to **Mock** to try the app.
- **Offline**: real providers need the internet. Drafts, editing, copy and export still work offline.
- **No headline or no content type selected.**

### Error messages from the AI provider
| Message | What to do |
|---|---|
| "rejected the API key" | Key is wrong or revoked. Paste a new one. |
| "out of credit / over its quota" / "billing problem" | Add credit on the provider's billing page. |
| "rate limit reached — try again in N seconds" | Wait, then retry. |
| "could not find that model" | Use *Load list* and pick a model your key can use. |
| "did not answer in time" | Raise the timeout (AI Provider Settings), or select fewer content types. |
| "answer was cut off because it was too long" | Select fewer content types per generation. |
| "did not match the required format, even after one automatic repair" | Try again. If it repeats, try another model. Nothing was saved. |

### Tamil text shows boxes
The app ships with Noto Sans Tamil, so this should not happen inside the app. In
exported **TXT/CSV** files, the program that opens them must support Tamil. Excel and
Notepad on Windows 11 do (CSV and TXT are saved as UTF-8 with BOM). Printable HTML and
PDF embed the font.

### Running from VS Code: `Cannot read properties of undefined (reading 'setPath')`
Some tools (for example VS Code extensions) set `ELECTRON_RUN_AS_NODE=1`, which starts
Electron as plain Node. Unset it before `npm run dev`:
```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npm run dev
```
The Playwright E2E test removes it automatically.

### `npm install` finished but `npm run dev` says Electron is missing
The `postinstall` script downloads Electron. If it was skipped, run `npx install-electron`.

### Where are the logs?
`%APPDATA%\Kishore Social Studio\logs\app.log` (rotates at 5 MB). API keys and
Authorization headers are redacted before anything is written.

### Start completely fresh
Close the app and delete `%APPDATA%\Kishore Social Studio`. This removes drafts, settings
and saved API keys. Make a backup first if you want to keep drafts.

### Restore a backup
*Export & Backup → Choose backup file…* shows what the file contains before importing.
Importing only adds data. Files from a newer, unknown backup version are rejected.
