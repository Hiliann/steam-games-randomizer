# Play Next - Steam Games Randomizer

[English](README.en.md) | [Русский](README.md)

**[Project website](https://hiliann.github.io/steam-games-randomizer/en/) · [Download for Windows](https://github.com/Hiliann/steam-games-randomizer/releases/latest) · [Report a problem](https://github.com/Hiliann/steam-games-randomizer/issues)**

Play Next is a local program that helps you pick a random game from your Steam library. It finds installed games automatically. An optional checkbox also includes uninstalled games from the active account's local license cache.

Spend less time browsing your library and more time playing. Exclude games you do not feel like playing, choose without repeats, and launch the selected game in Steam when you are ready.

The website includes a fictional demo, project information and downloads. It cannot read your Steam library or access the local program. **The program, website and project description are available in Russian and English.**

## Run on Windows

1. Download **PlayNext-1.9.0-win-x64.zip** from [Releases](https://github.com/Hiliann/steam-games-randomizer/releases/latest). Do not use **Code > Download ZIP**: that archive contains source code without the bundled runtime.
2. Extract the entire archive to a writable folder. Do not run the program from inside the ZIP.
3. Open **Play Next.exe**. The program opens in your browser, usually at `http://127.0.0.1:3210`. If the port is occupied, it chooses another one.
4. Press **Pick a game**, then **Play on Steam**. An uninstalled game instead offers **Install on Steam**. The local program passes the command to Steam without leaving a technical browser tab open.
5. Close the browser tab when you are done. Play Next stops automatically after the last tab closes; reloading the page does not stop it.

Requires **Windows 10/11 x64 (Intel/AMD), Steam and a modern browser**. Node.js 24.20.0 is included. No separate runtime installation, API key, Codex or administrator rights are required. Keep the `runtime` folder with the program. Desktop shortcut and Windows startup options are available in **«Настройки»** (Settings).

## Features

- Automatically detects Steam libraries across multiple drives; custom paths can be added manually.
- Chooses only eligible games, with optional no-repeat rounds and a history of recent picks.
- Adds saved categories directly from the picked game, plus a bulk editor for the whole library. A category can filter the visible library or become the active randomization mode.
- Includes modes for all participating games, installed or uninstalled games, never-played games, games dormant for 90 days and any saved category. Every eligible game keeps the same probability.
- Lets you exclude individual games. Exclusions survive closing the program, changing ports and clearing browser storage.
- Shows artwork from the local Steam cache, with a game-name fallback when artwork is unavailable.
- Shows a short Steam Store description for the picked game in the selected interface language, with plain-text validation and local caching.
- Includes search, keyboard controls, reduced-motion support and a responsive interface for narrow and wide windows.
- Optionally adds uninstalled games backed by local Steam licenses, without a public Steam profile or account sign-in through Play Next.
- Shows storage requirements for uninstalled games and lets you toggle size information and the installed-game badge.
- Can create a desktop shortcut and start in the background with Windows, without administrator rights.
- Chooses Russian or English from the system language on first launch, while always preserving a saved manual choice. It also offers three dark themes, preset accents and an editable random-palette preview.
- Shuffles the decorative draw sequence on every pick and avoids adjacent repeats while more than one candidate is available.
- Exports categories, history, exclusions, library paths and settings to one validated backup file and restores the previous data if an import write fails.
- Checks public GitHub releases for a newer version at startup or on demand. Verified updates can be installed manually or automatically at startup through an opt-in setting.

## Uninstalled games and storage information

The library is a **snapshot of local Steam data, not an online ownership check**. After buying a game or switching accounts, open Steam online and refresh the list in Play Next. Missing or incomplete cache data is reported without hiding installed games. DLC, tools, demos, borrowed/family and temporary licenses are not included in the uninstalled list.

**«Место» means disk space required according to the game's Steam Store system requirements, not an exact download or installation size.** Information is loaded for visible cards and the selected game, cached for seven days and retained for offline use. Steam requests are rate-limited.

**«≈» means an approximate fallback based on local Steam depot information.** DLC and optional components are excluded; updates, language choices and overlapping files may affect the result. If neither source provides a size, the program reports it as unknown rather than inventing a number.

Turn size information off in **«Настройки»** (Settings) to hide it and stop new size requests. A short description is requested only for the picked game. The installed-game badge is hidden by default and can be enabled separately.

## Saved settings and updates

Exclusions, categories, category assignments, pick history, the current round, the selected draw mode, display settings and cached online sizes are stored in the `data` folder next to the program. **Keep this folder when updating or moving your own copy.** Close the last Play Next tab before copying files.

The Windows section in **«Настройки»** (Settings) creates a shortcut for the current program folder and can enable background startup without opening the browser at sign-in. Play Next removes only shortcuts that belong to the current copy.

Update checks use the repository's public GitHub release API and are cached for six hours. **Update automatically at startup** is off by default. When enabled, a detected version is downloaded, verified and installed during startup; enabling the setting during a running session does not start an immediate installation. Otherwise a separate notice offers **Install update**, **Later** and **Do not show this notice again**. The notice can be enabled again in Settings, and manual installation remains available there.

The updater accepts only this repository's release archive, verifies its published SHA-256 and per-file manifest, and replaces program files only. The `data` folder is never included or modified. Update checks do not send your Steam library, settings or file paths. GitHub can see the connection's IP address.

The **Backup** section downloads one JSON file containing categories, assignments, history, the current round, exclusions, manual library paths and settings. The entire file is validated before restoration starts. If one write fails, Play Next attempts to restore the previous data. Keep personal backups separate from the clean ZIP shared with friends.

Only the uninstalled-games checkbox and manually added library paths remain in browser storage. They are specific to the browser and local address. Clearing browser data can reset these preferences, but does not remove categories, history or other settings saved in `data`.

Send friends the clean release ZIP, not a copy of a folder you have already used. Your used folder may contain personal settings and diagnostic logs.

## Privacy and limitations

The local server listens only on `127.0.0.1`. Steam files are read, not modified. Play Next does not require a Steam password or API key and does not upload account data, licenses, file paths or exclusions.

For uninstalled-game storage information and the selected game's short description, it makes HTTPS requests to `store.steampowered.com` using public game IDs. The description request also includes the interface language. Steam can see the connection's IP address. These requests do not include cookies or your account information. Size requests can be turned off; descriptions are requested only for the current result. Games and Steam may make their own network requests independently.

The downloadable ZIP excludes personal data, Steam files, game artwork and logs. It is not digitally signed. A `.zip.sha256` file is supplied to check that your download matches the published archive; a checksum is not a substitute for a security review.

Responsive layout does not make Play Next a phone app or expose it to your home network. Steam handles game ownership, updates, launchers and installation. Local installation files alone do not guarantee that the current account can launch a game.

## Development and packaging

The source uses HTML, CSS, JavaScript and Node.js built-ins, with no third-party npm packages. To run source code without the bundled runtime, install Node.js 22.2 or newer:

```text
node server.mjs
node --test
```

`npm start`, `npm test` and `npm run check` are also available. `npm install` is not needed.

To build a Windows release with an already verified runtime:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -RuntimeDirectory .\runtime
```

The script verifies pinned Node.js checksums and packages an explicit file allowlist. It refuses to overwrite existing releases. Use `-OutputDirectory` for another destination. See the [Russian documentation](README.md) for detailed cache formats, API boundaries and source references.

The static website lives in `docs/` with its English version in `docs/en/`. GitHub Pages publishes `/docs` from the main branch. Update both pages' release links, version, archive size and checksum when publishing a new release.

Play Next is an independent project, not affiliated with Valve. Steam and game artwork belong to their respective owners. The bundled Node.js license is included in `runtime/LICENSE`; see [third-party notices](THIRD_PARTY_NOTICES.md).
