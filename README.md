# Slovenia Command

A strategy game where you take command of the Republic of Slovenia — economy, military, diplomacy, research and events on a live satellite map. Play solo or **co-op with friends** over the internet.

## ▶ Download & play

**[⬇ Download the latest installer](https://github.com/wt2v3gb6/slovenia-command/releases/latest)**

1. Open the link above and download `SloveniaCommand-Setup-*.exe` from the latest release.
2. Run it. The game installs and launches automatically.
3. That's it — the game updates itself every time a new version is released. No re-downloading.

> Windows may show a "Windows protected your PC" SmartScreen notice because the app isn't code-signed. Click **More info → Run anyway**.

## Multiplayer (co-op)

Both players command the same Slovenia together.

- **Host:** Main menu → *Multiplayer* → *Host a game*. Forward **TCP port 8934** on your router to your PC, then share the room code shown (also visible in the pause menu, `Esc`).
- **Join:** Main menu → *Multiplayer* → *Join a game* → paste your friend's code.

---

## For developers

Run from source:

```bash
npm install
npm start
```

Build the installer locally:

```bash
npm run dist
```

### Releasing an update (auto-updates everyone)

Releases are built in the cloud by GitHub Actions (`.github/workflows/release.yml`) — you don't need any tokens locally:

```bash
# 1. bump "version" in package.json, then:
git commit -am "Release v1.0.1"
git tag v1.0.1
git push && git push --tags
```

Pushing the tag triggers the workflow, which builds `SloveniaCommand-Setup-<version>.exe` and publishes it to a GitHub Release. Every installed copy auto-updates from there on next launch.
