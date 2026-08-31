# Play Next - Steam Games Randomizer

[Русский](README.md) | [English](README.en.md)

**[Project website](https://hiliann.github.io/steam-games-randomizer/en/) · [Download for Windows](https://github.com/Hiliann/steam-games-randomizer/releases/latest) · [Report a problem](https://github.com/Hiliann/steam-games-randomizer/issues)**

Play Next is a local program that helps you pick a random game from your Steam library. It finds installed games automatically. An optional checkbox also includes uninstalled games from the active account's local license cache.

Spend less time browsing your library and more time playing. Exclude games you do not feel like playing, choose without repeats, and launch the selected game in Steam when you are ready.

The website includes a fictional demo, project information and downloads. It cannot read your Steam library or access the local program. **The program's interface is currently in Russian; the website and this project description are available in Russian and English.**

## Run on Windows

1. Download **PlayNext-1.4.1-win-x64.zip** from [Releases](https://github.com/Hiliann/steam-games-randomizer/releases/latest). Do not use **Code > Download ZIP**: that archive contains source code without the bundled runtime.
2. Extract the entire archive to a writable folder. Do not run the program from inside the ZIP.
3. Open **Start.cmd**. The program opens in your browser, usually at `http://127.0.0.1:3210`. If the port is occupied, it chooses another one.
4. Press **«Выбрать игру»** (Choose a game), then **«Играть в Steam»** (Play in Steam). An uninstalled game instead offers **«Установить в Steam»** (Install in Steam). Nothing launches or downloads automatically.
5. Open **Stop.cmd** to stop the program completely. Closing the browser tab alone does not stop the background process.

Requires **Windows 10/11 x64 (Intel/AMD), Steam and a modern browser**. Node.js 24.20.0 is included. No separate runtime installation, API key, Codex or administrator rights are required. Keep the `runtime` folder with the program. Play Next does not add itself to Windows startup.

## Features

- Automatically detects Steam libraries across multiple drives; custom paths can be added manually.
- Chooses only eligible games, with optional no-repeat rounds and a history of recent picks.
- Lets you exclude individual games. Exclusions survive closing the program, changing ports and clearing browser storage.
- Shows artwork from the local Steam cache, with a game-name fallback when artwork is unavailable.
- Includes search, keyboard controls, reduced-motion support and a responsive interface for narrow and wide windows.
- Optionally adds uninstalled games backed by local Steam licenses, without a public Steam profile or account sign-in through Play Next.
- Shows storage requirements for uninstalled games and lets you toggle size information and the installed-game badge.

## Uninstalled games and storage information

The library is a **snapshot of local Steam data, not an online ownership check**. After buying a game or switching accounts, open Steam online and refresh the list in Play Next. Missing or incomplete cache data is reported without hiding installed games. DLC, tools, demos, borrowed/family and temporary licenses are not included in the uninstalled list.

**«Место» means disk space required according to the game's Steam Store system requirements, not an exact download or installation size.** Information is loaded for visible cards and the selected game, cached for seven days and retained for offline use. Steam requests are rate-limited.

**«≈» means an approximate fallback based on local Steam depot information.** DLC and optional components are excluded; updates, language choices and overlapping files may affect the result. If neither source provides a size, the program reports it as unknown rather than inventing a number.

Turn size information off in **«Настройки»** (Settings) to hide it and stop new Steam Store requests. The installed-game badge is hidden by default and can be enabled separately.

## Saved settings and updates

Exclusions, display settings and cached online sizes are stored in the `data` folder next to the program. **Keep this folder when updating or moving your own copy.** Stop the program with Stop.cmd before copying files.

History, the current randomization round, the uninstalled-games checkbox and manually added library paths remain in browser storage. They are specific to the browser and local address. Clearing browser data can reset these preferences, but does not remove the settings saved in `data`.

Send friends the clean release ZIP, not a copy of a folder you have already used. Your used folder may contain personal settings and diagnostic logs.

## Privacy and limitations

The local server listens only on `127.0.0.1`. Steam files are read, not modified. Play Next does not require a Steam password or API key and does not upload account data, licenses, file paths or exclusions.

For uninstalled-game storage information, it makes HTTPS requests to `store.steampowered.com` using public game IDs. Steam can see the connection's IP address. These requests do not include cookies or your account information. You can turn this feature off. Games and Steam may make their own network requests independently.

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
