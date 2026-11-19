"""
VYRAL launch trailer: music and sound design, synthesised from scratch
(no samples, no licensed material).

Chill half-time trap: 128 BPM (felt at 64), D# minor, sliding 808 bass,
soft kick / clap / hats, warm pads, a Rhodes-style electric piano and a
glassy bell motif. 24 bars = 45 s, 48 kHz stereo.

    python3 video/soundtrack.py video/out/soundtrack.wav

Event times come from video/cues.json, which the visual timeline uses too.
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48_000
CUES = json.loads((Path(__file__).parent / "cues.json").read_text())
DUR = float(CUES["duration"])
N = int(SR * DUR)
BEAT = 60 / CUES["bpm"]
BAR = 4 * BEAT
STEP = BEAT / 4  # 16th note
rng = np.random.default_rng(20261119)


def bar(k):
    """Start time of bar k (1-based)."""
    return (k - 1) * BAR


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def fft_filter(x, lo=None, hi=None, order=2):
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    H = np.ones_like(f)
    if hi:
        H *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        H *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-6)) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x, n) * H, n)


def stft_filter(x, fn, kind="band", win=2048, hop=512, order=2, q=2.0):
    """Time-varying filter: fn(time_seconds) -> cutoff / centre frequency in Hz."""
    n = len(x)
    w = np.hanning(win)
    pad = np.concatenate([np.zeros(win), x, np.zeros(win)])
    out = np.zeros_like(pad)
    norm = np.zeros_like(pad)
    f = np.fft.rfftfreq(win, 1 / SR)
    for start in range(0, len(pad) - win, hop):
        tc = (start + win / 2 - win) / SR
        fc = max(20.0, float(fn(tc)))
        if kind == "low":
            H = 1 / np.sqrt(1 + (f / fc) ** (2 * order))
        else:
            H = 1 / (1 + (q * (f / fc - fc / np.maximum(f, 1e-6))) ** 2)
        out[start : start + win] += np.fft.irfft(np.fft.rfft(pad[start : start + win] * w) * H, win) * w
        norm[start : start + win] += w * w
    return (out / np.maximum(norm, 1e-6))[win : win + n]


def saw(freq, t, harmonics=24):
    y = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        if freq * k > SR / 2.2:
            break
        y += np.sin(2 * np.pi * freq * k * t) / k
    return y * (2 / np.pi)


def pan_stereo(x, pan=0.0):
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


class Bus:
    def __init__(self):
        self.buf = np.zeros((N, 2))

    def add(self, sig, t0, gain=1.0, pan=0.0):
        s = pan_stereo(sig, pan) if sig.ndim == 1 else sig
        i0 = int(round(t0 * SR))
        if i0 >= N:
            return
        j0 = max(0, -i0)
        i0 = max(0, i0)
        m = min(N - i0, len(s) - j0)
        if m > 0:
            self.buf[i0 : i0 + m] += gain * s[j0 : j0 + m]


drums, bass, music, sfx, send = Bus(), Bus(), Bus(), Bus(), Bus()

# ----------------------------------------------------------------- pitches (D# minor / F# major)
NOTE = {
    "C#1": 34.65, "D#1": 38.89, "F1": 43.65, "F#1": 46.25, "G#1": 51.91, "A#1": 58.27, "B1": 61.74, "C#2": 69.30, "D#2": 77.78,
    "B2": 123.47, "C#3": 138.59, "D#3": 155.56, "F3": 174.61, "F#3": 185.00, "G#3": 207.65, "A#3": 233.08,
    "B3": 246.94, "C#4": 277.18, "D#4": 311.13, "F4": 349.23, "F#4": 369.99, "G#4": 415.30, "A#4": 466.16,
    "C#5": 554.37, "D#5": 622.25, "F5": 698.46, "F#5": 739.99, "G#5": 830.61, "A#5": 932.33, "C#6": 1108.73, "D#6": 1244.51,
}
CHORDS = {  # pad voicing, electric-piano voicing, 808 root, 808 fifth
    "D#m": (["D#3", "F#3", "A#3", "C#4", "F4"], ["A#3", "C#4", "F4", "F#4"], "D#1", "A#1"),
    "B": (["B2", "D#3", "F#3", "A#3", "C#4"], ["F#3", "A#3", "C#4", "D#4"], "B1", "F#1"),
    "F#": (["F#3", "A#3", "C#4", "G#4"], ["A#3", "C#4", "F4", "G#4"], "F#1", "C#2"),
    "C#": (["C#3", "F3", "G#3", "A#3", "D#4"], ["G#3", "A#3", "D#4", "F4"], "C#2", "G#1"),
}
BARS = ["D#m", "D#m", "B", "B", "F#", "F#", "C#", "C#", "D#m", "D#m", "B", "B", "F#", "F#", "C#", "C#", "D#m", "D#m", "B", "B", "C#", "C#", "F#", "F#"]
assert len(BARS) * BAR == DUR
hz = lambda names: [NOTE[n] for n in names]

# ----------------------------------------------------------------- instruments


def bass808(notes):
    """Monophonic 808: (t0, dur, freq, glide_from, velocity). A new note chokes the last one."""
    out = np.zeros(N)
    for t0, dur, f, f_prev, vel in sorted(notes):
        n = int((dur + 0.08) * SR)
        t = np.arange(n) / SR
        freq = f + (f_prev - f) * np.exp(-t / 0.05) if f_prev else f * (1 + 0.55 * np.exp(-t / 0.012))
        env = np.minimum(1, t / 0.004) * np.exp(-t / max(0.3, dur * 1.1)) * np.clip((dur + 0.08 - t) / 0.08, 0, 1)
        y = np.sin(2 * np.pi * np.cumsum(freq) / SR) * env
        y = np.tanh(2.4 * y) / np.tanh(2.4)
        i0 = int(round(t0 * SR))
        m = min(n, N - i0)
        if m > 0:
            out[i0 : i0 + m] = y[:m] * vel
            out[i0 + m : i0 + m + int(0.004 * SR)] *= 0
    return fft_filter(out, hi=1400)


def kick(gain=1.0):
    t = t_axis(0.45)
    f = 50 + 70 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = fft_filter(noise(0.45), lo=1800, hi=6000) * np.exp(-t / 0.003) * 0.18
    return np.tanh(1.4 * (body + click)) * 0.8 * gain


def clap(gain=1.0):
    dur = 0.5
    t = t_axis(dur)
    env = np.zeros_like(t)
    for d in (0.0, 0.009, 0.019, 0.028):
        env += np.where(t >= d, np.exp(-(t - d) / 0.006), 0)
    env += 0.5 * np.exp(-t / 0.14)
    snap = fft_filter(noise(dur), lo=1000, hi=5200) * env * 0.3
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.18
    return (snap + body) * gain * 2.4


def hat(vel=1.0, open_=False):
    dur = 0.3 if open_ else 0.07
    t = t_axis(dur)
    y = fft_filter(noise(dur), lo=5800, hi=14000) * np.exp(-t / (0.09 if open_ else 0.018))
    return y * 0.42 * vel


def pad(freqs, dur, attack=0.5, release=0.9, cutoff=1000):
    t = t_axis(dur + release)
    y = np.zeros_like(t)
    for f in freqs:
        for det, ph in ((-0.0045, 0.3), (0.0, 1.1), (0.005, 2.0)):
            y += saw(f * (1 + det), t + ph, 10)
    y = fft_filter(y, hi=cutoff)
    env = np.minimum(1, t / attack) * np.clip((dur + release - t) / release, 0, 1)
    breathe = 1 + 0.12 * np.sin(2 * np.pi * 0.27 * t)
    return y * env * breathe * 0.029


def ep_note(f, dur, vel=1.0):
    """Rhodes-style FM electric piano note with a soft tine."""
    t = t_axis(dur + 1.4)
    index = 1.6 * np.exp(-t / 0.4) + 0.2
    tine = 0.3 * np.exp(-t / 0.025) * np.sin(2 * np.pi * f * 14 * t)
    y = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t) + tine)
    env = np.minimum(1, t / 0.004) * np.exp(-t / 1.3) * np.clip((dur + 0.4 - t) / 0.4, 0, 1)
    return y * env * vel * 0.11


def ep_chord(freqs, dur, vel=1.0):
    out = None
    for i, f in enumerate(freqs):
        n = ep_note(f, dur, vel * (1 - 0.08 * i))
        out = n if out is None else out + n
    t = t_axis(len(out) / SR)
    trem = 1 + 0.18 * np.sin(2 * np.pi * 3.6 * t)
    pan = 0.35 * np.sin(2 * np.pi * 0.9 * t)
    a = (pan + 1) * np.pi / 4
    return np.stack([out * trem * np.cos(a), out * trem * np.sin(a)], axis=1)


def bell(f, dur=2.0, gain=1.0):
    t = t_axis(dur)
    index = 2.2 * np.exp(-t / 0.5)
    y = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * 3.5 * t))
    y += 0.25 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / 0.4)
    return y * np.minimum(1, t / 0.002) * np.exp(-t / 0.9) * 0.11 * gain


def bell_delay(f, t0, gain=1.0, pan=0.0):
    """Bell with dotted-eighth echoes bouncing across the stereo field."""
    b = bell(f, 2.0, gain)
    music.add(b, t0, 1.0, pan)
    send.add(b, t0, 0.55, pan)
    for k, g in enumerate((0.42, 0.22, 0.1), start=1):
        e = fft_filter(b, hi=4500 - 900 * k)
        music.add(e, t0 + k * 0.75 * BEAT, g, -pan if k % 2 else pan)
        send.add(e, t0 + k * 0.75 * BEAT, g * 0.6)


def whoosh(dur=0.45, lo=400, hi=5000, pan_from=-0.6, pan_to=0.6):
    t = t_axis(dur)
    y = stft_filter(noise(dur), lambda tt: lo * (hi / lo) ** np.clip(tt / dur, 0, 1), q=1.6, win=1024, hop=256)
    y *= np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2 * 0.4
    pans = np.linspace(pan_from, pan_to, len(t))
    a = (pans + 1) * np.pi / 4
    return np.stack([y * np.cos(a), y * np.sin(a)], axis=1)


def riser(dur, lo=300, hi=6000, gain=1.0):
    t = t_axis(dur)
    y = stft_filter(noise(dur) * 0.6, lambda tt: lo * (hi / lo) ** np.clip(tt / dur, 0, 1), q=3.0)
    return y * (t / dur) ** 2 * 0.4 * gain


def swell(dur=1.2, gain=1.0):
    """Reversed cymbal-like swell that lands on the next downbeat."""
    t = t_axis(dur)
    y = fft_filter(noise(dur), lo=2500) * np.exp(-t / 0.5)
    return np.stack([y[::-1], fft_filter(noise(dur), lo=2500)[::-1] * np.exp(-t / 0.5)[::-1]], axis=1) * 0.12 * gain


def cymbal(dur=3.0, gain=1.0):
    t = t_axis(dur)
    env = np.exp(-t / 0.9)
    return np.stack([fft_filter(noise(dur), lo=4000) * env, fft_filter(noise(dur), lo=4000) * env], axis=1) * 0.14 * gain


def sub_boom(dur=2.5, gain=1.0):
    t = t_axis(dur)
    f = 32 + 30 * np.exp(-t / 0.25)
    return np.tanh(1.2 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)) * gain


def click(gain=1.0):
    t = t_axis(0.03)
    y = fft_filter(noise(0.03), lo=1500, hi=9000) * np.exp(-t / 0.0013) * 0.3
    y += np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.004) * 0.12
    return y * gain


def blip(f, dur=0.12, gain=1.0):
    t = t_axis(dur)
    env = np.minimum(1, t / 0.003) * np.exp(-t / 0.05)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 2 * t)) * env * 0.12 * gain


def chime(freqs, step=0.07, dur=1.3, gain=1.0):
    total = step * len(freqs) + dur
    out = np.zeros(int(total * SR))
    for i, f in enumerate(freqs):
        b = bell(f, dur, 1.0)
        i0 = int(i * step * SR)
        out[i0 : i0 + len(b)] += b
    return out * gain


# ----------------------------------------------------------------- arrangement
C1, C2, C3, C5, CF, C6, C7, C8 = (CUES[k] for k in ("s1", "s2", "s3", "s5", "formula", "s6", "s7", "s8"))

# Air bed: soft, darkened noise for warmth under everything.
air = fft_filter(rng.standard_normal(N), lo=300, hi=5000)
air *= 0.007 * np.minimum(1, t_axis(DUR) / 0.4)
music.add(np.stack([air, np.roll(air, 3001)], axis=1), 0.0)

# Pads follow the chord of every 2-bar block.
for k in range(1, 25, 2):
    name = BARS[k - 1]
    first = k == 1
    p = pad(hz(CHORDS[name][0]), 2 * BAR, attack=0.12 if first else 0.45, release=0.9, cutoff=1100)
    music.add(p, bar(k) - (0 if first else 0.15), 1.0, -0.15)
    send.add(p, bar(k), 0.35)

# Electric piano: soft dotted stabs in the grooving sections.
def ep_bars(first, last, vel=1.0):
    for k in range(first, last + 1):
        voicing = hz(CHORDS[BARS[k - 1]][1])
        for st, v in ((0, 1.0), (6, 0.7), (10, 0.55)):
            c = ep_chord(voicing, STEP * (5 if st == 0 else 3), vel * v)
            music.add(c, bar(k) + st * STEP, 1.0)
            send.add(c, bar(k) + st * STEP, 0.4)

ep_bars(3, 4, 0.6)
ep_bars(5, 11, 0.85)
ep_bars(14, 20, 0.85)

# 808 bass lines: two alternating one-bar patterns with slides, plus fills.
def line808(first, last, fills=()):
    notes = []
    prev = None
    for k in range(first, last + 1):
        _, _, root_n, fifth_n = CHORDS[BARS[k - 1]]
        root, fifth = NOTE[root_n], NOTE[fifth_n]
        if k in fills:
            pattern = [(0, root, 6, 1.0), (8, root * 2, 1, 0.8), (9, root * 2, 1, 0.75), (10, fifth, 2, 0.85), (12, root * 2, 1, 0.8), (13, fifth, 1, 0.8), (14, root, 2, 0.9)]
        elif k % 2:
            pattern = [(0, root, 7, 1.0), (10, root, 2, 0.8), (12, root * 2, 4, 0.85)]
        else:
            pattern = [(0, root, 6, 1.0), (7, fifth, 3, 0.85), (11, root, 5, 0.9)]
        for st, f, length, vel in pattern:
            glide = prev if (prev and st > 0 and abs(np.log2(prev / f)) > 0.05) else None
            notes.append((bar(k) + st * STEP, length * STEP, f, glide, vel))
            prev = f
    return notes

notes808 = [(0.0, 1.6, NOTE["D#1"], None, 0.9)]  # the logo's first bloom
notes808 += [(C2["a"], 1.5, NOTE["B1"], None, 0.7), (C2["b"], 1.2, NOTE["F#1"], None, 0.75)]
notes808 += line808(5, 11, fills=(10,))
notes808 += [(bar(12), 1.8, NOTE["B1"], None, 0.7), (bar(13), 1.8, NOTE["F#1"], None, 0.7)]  # formula breakdown
notes808 += line808(14, 20, fills=(15, 20))
notes808 += [(C8["impact"], 2.6, NOTE["C#2"], None, 1.0), (bar(23), 3.4, NOTE["F#1"], NOTE["C#2"], 0.9)]
bass.add(bass808(notes808), 0.0, 0.4)

# Drums: half-time groove (kick on 1, clap on 3), hats in eighths with small rolls.
def groove(first, last, kick_gain=1.0, hats_only=False):
    for k in range(first, last + 1):
        b = bar(k)
        if not hats_only:
            drums.add(kick(kick_gain), b, 0.9)
            if k % 2 == 0:
                drums.add(kick(kick_gain * 0.7), b + 10 * STEP, 0.6)
            c = clap()
            drums.add(c, b + 8 * STEP, 0.8)
            send.add(c, b + 8 * STEP, 0.45)
        for i, v in enumerate((0.9, 0.45, 0.7, 0.45, 0.85, 0.45, 0.7, 0.55)):
            drums.add(hat(v * (0.75 if hats_only else 1.0)), b + i * 2 * STEP, 1.0, 0.18 if i % 2 else -0.12)
        if k % 4 == 0:
            for j in range(6):  # triplet roll into the next bar
                drums.add(hat(0.35 + 0.08 * j), b + 12 * STEP + j * (4 * STEP / 6), 1.0, 0.25)
        elif k % 2 == 0:
            drums.add(hat(0.4), b + 15 * STEP, 1.0, 0.2)

groove(3, 4, hats_only=True)
groove(5, 11)
groove(12, 13, hats_only=True)
groove(14, 20)
groove(21, 22, hats_only=True)

# Snare roll and riser into the drop, with a short breath before it.
for j in range(14):
    tj = C3["start"] - 0.95 + j * (0.82 / 14) ** 1.0 * (1 - j / 40)
    c = clap(0.25 + 0.04 * j)
    drums.add(c, tj, 0.55)
sfx.add(riser(1.9, 300, 7000, 0.7), C3["start"] - 1.95)
sfx.add(swell(1.0, 1.0), C3["start"] - 1.0)

# Intro (logo): first bloom, three bell notes as the units arrive, a shimmer on the light sweep.
sfx.add(sub_boom(2.2, 0.22), 0.0)
for f, tu, pan in zip(hz(["A#4", "D#5", "F#5"]), C1["units"], (-0.3, 0.0, 0.3)):
    bell_delay(f, tu, 0.9, pan)
for i, f in enumerate(hz(["D#6", "A#5", "F#5"])):
    sfx.add(bell(f * 2, 1.6, 0.35), C1["sweep"] + i * 0.045, 1.0, -0.4 + 0.4 * i)
    send.add(bell(f * 2, 1.6, 0.35), C1["sweep"] + i * 0.045, 0.8)
for i in range(5):
    sfx.add(click(0.35), C1["word"] + i * 0.06, 1.0, -0.3 + 0.15 * i)
sfx.add(swell(0.9, 0.7), C2["a"] - 0.9)

# Statements: a low thump and a soft air move on each.
for tc in (C2["a"], C2["b"]):
    sfx.add(sub_boom(1.2, 0.25), tc)
    sfx.add(whoosh(0.5, 300, 3000), tc - 0.12, 0.5)

# Drop and fee diagram.
sfx.add(cymbal(3.0, 0.8), C3["start"])
send.add(cymbal(3.0, 0.5), C3["start"])
for i, tl in enumerate(np.linspace(C3["light"], C3["light"] + 0.84, 7)):
    sfx.add(blip(hz(["D#5", "F#5", "G#5", "A#5", "C#6", "D#6", "F#5"])[i], 0.12, 0.6), tl, 1.0, -0.3 + 0.1 * i)
sfx.add(whoosh(0.7, 500, 6000), C3["move"], 0.7)

# Product walkthrough UI sounds (soft).
for key in ("clickHome", "clickLaunch", "clickToken", "clickSubmitLink", "clickCheck", "clickSubmit"):
    sfx.add(click(0.9), C5[key])
for key, (p0, p1) in (("toLaunch", (-0.5, 0.5)), ("toToken", (0.5, -0.5)), ("toCompetition", (-0.5, 0.5)), ("toSubmit", (0.5, -0.5))):
    sfx.add(whoosh(0.34, 700, 6000, p0, p1), C5[key] - 0.04, 0.55)
sfx.add(chime(hz(["D#5", "A#5"]), step=0.06, dur=0.9, gain=0.7), C5["toToken"] + 0.3)
sfx.add(click(0.6), C5["typeStart"] - 0.08)
for i, tc in enumerate(np.arange(C5["typeStart"], C5["typeEnd"], 0.045)):
    sfx.add(click(0.22 + 0.08 * (i % 3 == 0)), tc, 1.0, rng.uniform(-0.2, 0.2))
for i, tc in enumerate(C5["checks"]):
    sfx.add(blip(hz(["D#5", "F#5", "G#5", "A#5", "C#6", "D#6", "F#5", "A#5"])[i], 0.08, 0.5), tc, 1.0, -0.3 + 0.6 * i / 7)
sfx.add(chime(hz(["F#5", "C#6"]), step=0.05, dur=0.9, gain=0.8), C5["caHighlight"])
sfx.add(whoosh(0.45, 900, 9000), C5["zoom"], 0.7)

# Formula: bell sparkles as the terms appear.
for f, tc in zip(hz(["A#4", "C#5", "D#5", "F#5"]), CF["terms"]):
    bell_delay(f, tc, 0.55, 0.2)
for f, tc in zip(hz(["G#5", "A#5", "C#6"]), CF["log"]):
    bell_delay(f, tc, 0.45, -0.2)
sfx.add(swell(1.0, 0.8), C6["start"] - 1.0)

# Leaderboard: soft thumps on the metric words, light counting ticks, the first-place moment.
for tc in C6["words"]:
    sfx.add(sub_boom(0.9, 0.2), tc)
    sfx.add(blip(NOTE["D#5"], 0.1, 0.45), tc)
for i, tc in enumerate(np.arange(C6["words"][0], C6["passes"][-1], 0.234)):
    sfx.add(blip(2093.0 if i % 2 else 2349.3, 0.04, 0.18), tc, 1.0, 0.3 if i % 2 else -0.3)
for tc in C6["passes"][:-1]:
    sfx.add(blip(NOTE["A#5"], 0.1, 0.5), tc)
first = C6["passes"][-1]
sfx.add(chime(hz(["D#5", "F#5", "A#5", "D#6"]), step=0.07, dur=1.4, gain=1.0), first)
send.add(chime(hz(["D#5", "F#5", "A#5", "D#6"]), step=0.07, dur=1.4, gain=0.6), first)
sfx.add(cymbal(2.5, 0.5), first)
sfx.add(bell(NOTE["D#5"], 1.5, 0.6), C6["checkpoint"])
sfx.add(whoosh(0.45, 500, 5000), C6["expand"], 0.6)

# Rewards.
sfx.add(sub_boom(1.6, 0.3), C7["impact"])
tr0, tr1 = C7["transfer"]
sfx.add(blip(NOTE["F#5"], 0.12, 0.5), C7["pending"])
sfx.add(blip(NOTE["A#5"], 0.12, 0.5), C7["submitted"])
sfx.add(whoosh(tr1 - tr0 + 0.2, 300, 6000), tr0 - 0.1, 0.6)
for i in range(16):
    sfx.add(blip(1760.0 + 50 * i, 0.04, 0.22), tr0 + (tr1 - tr0) * (i / 16) ** 0.8, 1.0, -0.6 + 1.2 * i / 16)
sfx.add(chime(hz(["F#5", "A#5", "C#6", "F#5"]), step=0.06, dur=1.5, gain=1.0), C7["confirmed"])
send.add(chime(hz(["F#5", "A#5", "C#6"]), step=0.06, dur=1.5, gain=0.6), C7["confirmed"])
sfx.add(whoosh(0.6, 500, 6000, 0.6, -0.2), C7["out"] + 0.15, 0.6)
sfx.add(swell(1.0, 0.9), C8["impact"] - 1.0)

# End card: last downbeat, the domain, the logo pulses, a resolving F# chord.
sfx.add(sub_boom(3.0, 0.45), C8["impact"])
sfx.add(cymbal(3.5, 0.7), C8["impact"])
send.add(cymbal(3.5, 0.6), C8["impact"])
for i, f in enumerate(hz(["C#5", "F5", "G#5", "C#6"])):
    sfx.add(bell(f, 1.8, 0.4), C8["domain"] + i * 0.05, 1.0, -0.3 + 0.2 * i)
    send.add(bell(f, 1.8, 0.4), C8["domain"] + i * 0.05, 0.7)
for tp in C8["pulses"]:
    for f, d in zip(hz(["A#4", "D#5", "F#5"]), (0.0, 0.09, 0.18)):
        bell_delay(f, tp + d, 0.5, 0.0)
music.add(ep_chord(hz(["F#3", "A#3", "C#4", "F4", "G#4"]), 3.0, 0.9), bar(23))
send.add(ep_chord(hz(["F#3", "A#3", "C#4", "F4", "G#4"]), 3.0, 0.9), bar(23), 0.6)

# ----------------------------------------------------------------- mix & master


def reverb_ir(dur=2.8):
    t = t_axis(dur)
    env = np.exp(-t / 0.75)
    ir = np.stack([fft_filter(noise(dur), hi=6000) * env, fft_filter(noise(dur), hi=6000) * env], axis=1)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]
    return ir / np.max(np.abs(ir)) * 0.05


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    out = np.zeros((len(x), 2))
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size), size)[: len(x)]
    return out


# Gentle sidechain: music breathes with the kick and the 808 downbeats.
duck = np.ones(N)
env = np.exp(-t_axis(0.6) / 0.16)
for k in list(range(5, 12)) + list(range(14, 21)):
    for tk in (bar(k), bar(k) + 10 * STEP):
        i0 = int(tk * SR)
        seg = duck[i0 : i0 + len(env)]
        duck[i0 : i0 + len(env)] = np.minimum(seg, 1 - 0.3 * env[: len(seg)])
music.buf *= duck[:, None]

# The breath before the drop.
gap = np.ones(N)
g0, g1 = int((C3["start"] - 0.12) * SR), int(C3["start"] * SR)
gap[g0:g1] = 0.0
for b in (music, bass, drums):
    b.buf *= gap[:, None]

wet = convolve(send.buf, reverb_ir())
mix = drums.buf * 0.9 + bass.buf + music.buf + sfx.buf * 0.85 + wet
mix = np.tanh(mix * 0.9) / np.tanh(0.9)
fade_in = np.minimum(1, t_axis(DUR) / 0.005)
fade_out = np.clip((DUR - t_axis(DUR)) / 1.4, 0, 1)
mix *= (fade_in * fade_out)[:, None]


# Loudness mastering (ITU-R BS.1770): K-weighted, gated integrated loudness and 4x oversampled true peak.
def k_weighted(x):
    w = 2 * np.pi * np.fft.rfftfreq(len(x), 1 / SR) / SR
    z = np.exp(-1j * w)
    biquad = lambda b, a: (b[0] + b[1] * z + b[2] * z**2) / (a[0] + a[1] * z + a[2] * z**2)
    shelf = biquad([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
    high_pass = biquad([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
    return np.fft.irfft(np.fft.rfft(x, axis=0) * (shelf * high_pass)[:, None], len(x), axis=0)


def integrated_lufs(x):
    y = k_weighted(x) ** 2
    block, hop = int(0.4 * SR), int(0.1 * SR)
    power = np.array([y[i : i + block].mean(axis=0).sum() for i in range(0, len(y) - block + 1, hop)])
    loud = -0.691 + 10 * np.log10(power + 1e-12)
    power, loud = power[loud > -70], loud[loud > -70]
    relative = -0.691 + 10 * np.log10(power.mean()) - 10
    return -0.691 + 10 * np.log10(power[loud > relative].mean())


def true_peak(x, up=4):
    spec = np.fft.rfft(x, axis=0)
    padded = np.zeros((len(x) * up // 2 + 1, x.shape[1]), dtype=complex)
    padded[: spec.shape[0]] = spec
    return np.max(np.abs(np.fft.irfft(padded, len(x) * up, axis=0) * up))


TARGET_LUFS, MAX_TRUE_PEAK_DB = -15.0, -1.5
gain_db = TARGET_LUFS - integrated_lufs(mix)
gain_db = min(gain_db, MAX_TRUE_PEAK_DB - 20 * np.log10(true_peak(mix)))
mix *= 10 ** (gain_db / 20)
print(f"master: {integrated_lufs(mix):.1f} LUFS integrated, true peak {20 * np.log10(true_peak(mix)):.1f} dBTP")

out = sys.argv[1] if len(sys.argv) > 1 else "soundtrack.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())

for k in range(1, 25, 2):
    seg = mix[int(bar(k) * SR) : int(bar(k + 2) * SR)]
    rms = np.sqrt(np.mean(seg**2))
    print(f"bars {k:2d}-{k + 1:2d} ({bar(k):5.2f}s) {BARS[k - 1]:>3}  rms {20 * np.log10(max(rms, 1e-9)):6.1f} dBFS")
print("wrote", out)
