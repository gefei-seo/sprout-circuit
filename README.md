# Sprout Circuit

A standalone export of Ludazo’s original garden clicker. Harvest seeds, buy gloves to improve each tap, and unlock sprinklers and helper bots for automatic production. Milestones track lifetime seeds; offline production is capped at two hours.

- Play the original: https://ludazo.com/games/sprout-circuit/
- More clicker games: https://ludazo.com/clicker-games-unblocked/

## Run locally

From this directory, run:

```sh
python3 -m http.server 8091 --bind 127.0.0.1
```

Open http://127.0.0.1:8091 in a modern browser. Use HTTP rather than opening `index.html` directly because the game uses JavaScript modules. All scripts, styling and game artwork are local; no remote scripts or third-party game assets are included. The garden artwork is inline SVG in `index.html`.

Optional shortcuts (no npm dependencies or install needed):

```sh
npm test
npm run preview
```

Tests require Node.js with the built-in test runner; preview requires Python 3.

## Saves

Progress automatically saves in browser localStorage when available. Saves are isolated by browser profile and origin (scheme, host and port), so the live Ludazo game and this standalone copy do not share progress automatically. Use **Export save** to download JSON, then **Import save** on the destination origin; keep a backup before clearing browser data. Reset removes only this game’s storage key. If browser storage is blocked, play continues but persistence is unavailable.

## License

No license has been selected for this export. Public repository visibility does not grant an open-source license. Do not assume MIT or other reuse permission.
