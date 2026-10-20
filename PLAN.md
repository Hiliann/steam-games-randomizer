# Development roadmap

Quality, stability and privacy take priority over additional features. No hidden
telemetry, invented game metadata or weighted random draws.

## Critical foundation

- [x] Make the website and repository introduction English-first, with a Russian link.
- [x] Add the MIT license for original code and preserve third-party notices.
- [x] Exclude development notes, READMEs and logs from Windows packages.
- [x] Split application orchestration, settings, library rendering and update handling into tested modules.
- [x] Verify safe automatic updates, cancellation, recovery and existing user-data compatibility.

## Reliability and trust

- [x] Add synthetic regression fixtures for incomplete, corrupt and older Steam caches, without copying personal cache data.
- [x] Add a manual diagnostic export with an exact contents preview and no personal data or automatic upload.
- [x] Verify release integrity, the clean Windows build process and preserved personal stores during updates.
- Configure publisher signing when an appropriate signing identity is available.
- Prepare an installer, then verified winget and optional Scoop distribution.

## Game discovery

Start only after the critical foundation is verified.

- [x] Cache confirmed Store genres and single/multiplayer features, with an unknown state.
- [x] Add saved filter presets without inventing playtime or session-length data.
- [x] Offer continuing previously played games only when local data supports it.

## Localization

- [x] Separate dictionaries and test fallback behavior and long translations.
- [x] Add Ukrainian, Spanish, Brazilian Portuguese and German.

## Release gate

All critical tests pass. The clean package starts without system Node.js.
Existing categories, exclusions, history and settings survive an update.
Failures do not strand the UI. No personal files or technical logs enter the package.
Check every interface language, narrow windows, offline behavior and a clean Windows environment.
