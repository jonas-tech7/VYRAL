# VYRAL launch trailer

45 s, 16:9, 3840×2160, 30 fps, 48 kHz stereo, no voiceover. Everything is
generated from this folder: the motion graphics are a deterministic HTML
timeline rendered frame by frame in Chromium, and the soundtrack (chill
half-time trap, 128 BPM, D# minor) is synthesised from scratch, so there are
no samples and no licensing questions. Every scene change sits on a bar of
the music.

| File | Role |
| --- | --- |
| `cues.json` | Shared timing sheet. Both the picture and the sound read it, so every hit lands on its visual event. |
| `timeline.html` / `timeline.js` | The scenes: logo, statements, fee flow, product walkthrough, Viral Score formula, leaderboard, payout, end card. `window.renderFrame(t)` poses the frame for time `t`. |
| `soundtrack.py` | Music and sound design (numpy only), mastered to −15 LUFS, true peak ≤ −1.5 dBTP. |
| `clips.py` | Cuts beat-aligned clips for X posts (each ends on the makevyral.com end card). |
| `capture.mjs` | Captures the real product screens used in scene 5 (`assets/ui/`). |
| `render.mjs` | Serves the timeline, renders frames with Playwright, encodes with ffmpeg. |

## Render

```bash
python3 video/soundtrack.py video/out/soundtrack.wav
node video/render.mjs            # frames + out/vyral-launch-4k.mp4 + out/vyral-launch-1080p.mp4
node video/render.mjs --prores   # additionally a ProRes 422 HQ master (.mov)
node video/render.mjs --stills 17.5,33.2   # review stills (1080p PNG)
python3 video/clips.py           # X post clips from the rendered frames → out/x/
```

Output is H.264 High, Rec.709 (tagged, broadcast range), AAC 320 kbps.

## Re-capturing the product screens

Only needed when the UI changes. Start the app with demo data and the
production domain so links read correctly, then:

```bash
APP_URL=https://makevyral.com npm run start   # in another terminal, after a build
node video/capture.mjs http://localhost:3000
```

The capture signs in with the E2E test wallet; nothing is launched or
submitted. Demo-environment notices are hidden in the captures, and the
trailer labels those scenes "Product UI · Illustrative data" instead. Leaderboard
numbers, the reward amount and the signature in scenes 6–7 are illustrative,
and the Viral Scores shown are computed with the real formula
(`src/lib/scoring/viral-score.ts`, default config).
