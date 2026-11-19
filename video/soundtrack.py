"""
VYRAL launch trailer: soundtrack and sound design, synthesised from scratch
(no samples, no licensed material). 45 s, 120 BPM, A minor, 48 kHz stereo.

    python3 video/soundtrack.py video/out/soundtrack.wav

Event times come from video/cues.json, which the visual timeline uses too.
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48_000
DUR = 45.0
N = int(SR * DUR)
BEAT = 0.5  # 120 BPM
rng = np.random.default_rng(20261119)
CUES = json.loads((Path(__file__).parent / "cues.json").read_text())


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def fft_filter(x, lo=None, hi=None, order=2):
    """Zero-phase high/low-pass via FFT (fine for one-shots and stems)."""
    n = len(x)
    X = np.fft.rfft(x, n)
    f = np.fft.rfftfreq(n, 1 / SR)
    H = np.ones_like(f)
    if hi:
        H *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        H *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-6)) ** (2 * order))
    return np.fft.irfft(X * H, n)


def stft_filter(x, fn, t0=0.0, kind="low", win=2048, hop=512, order=2, q=2.0):
    """Time-varying filter: fn(time_seconds) -> cutoff/centre frequency in Hz."""
    n = len(x)
    w = np.hanning(win)
    pad = np.concatenate([np.zeros(win), x, np.zeros(win)])
    out = np.zeros_like(pad)
    norm = np.zeros_like(pad)
    f = np.fft.rfftfreq(win, 1 / SR)
    for start in range(0, len(pad) - win, hop):
        seg = pad[start : start + win] * w
        tc = t0 + (start + win / 2 - win) / SR
        fc = max(20.0, float(fn(tc)))
        if kind == "low":
            H = 1 / np.sqrt(1 + (f / fc) ** (2 * order))
        else:  # band-pass around fc
            H = 1 / (1 + (q * (f / fc - fc / np.maximum(f, 1e-6))) ** 2)
        out[start : start + win] += np.fft.irfft(np.fft.rfft(seg) * H, win) * w
        norm[start : start + win] += w * w
    return (out / np.maximum(norm, 1e-6))[win : win + n]


def saw(freq, t, harmonics=24):
    """Band-limited sawtooth by additive synthesis."""
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


music, sfx, send = Bus(), Bus(), Bus()  # send = reverb send


# ----------------------------------------------------------------- instruments

def kick(dur=0.5):
    t = t_axis(dur)
    f = 44 + 115 * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * (np.exp(-t / 0.17) + 0.25 * np.exp(-t / 0.4))
    click = fft_filter(noise(dur), lo=2500) * np.exp(-t / 0.0025) * 0.25
    return np.tanh(1.6 * (body + click)) * 0.9


def sub_boom(dur=3.2, depth=1.0):
    t = t_axis(dur)
    f = 30 + 42 * np.exp(-t / 0.28)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (1.0 * depth))
    body = fft_filter(noise(dur), hi=700) * np.exp(-t / 0.35) * 0.55
    return np.tanh(1.3 * (sub + body))


def crash(dur=2.6, decay=0.75):
    t = t_axis(dur)
    env = np.exp(-t / decay)
    l = fft_filter(noise(dur), lo=3500) * env
    r = fft_filter(noise(dur), lo=3500) * env
    return np.stack([l, r], axis=1) * 0.35


def metallic(base=220.0, dur=1.6, gain=1.0):
    t = t_axis(dur)
    y = np.zeros_like(t)
    for ratio, decay, amp in [(1.0, 0.9, 1.0), (2.76, 0.6, 0.6), (5.40, 0.4, 0.45), (8.93, 0.25, 0.3), (13.3, 0.15, 0.2)]:
        y += amp * np.sin(2 * np.pi * base * ratio * t) * np.exp(-t / decay)
    y += fft_filter(noise(dur), lo=1800) * np.exp(-t / 0.01) * 0.6
    return y * 0.32 * gain


def hat(open_=False):
    dur = 0.35 if open_ else 0.08
    t = t_axis(dur)
    y = fft_filter(noise(dur), lo=7000) * np.exp(-t / (0.12 if open_ else 0.022))
    return y * 0.22


def clap():
    dur = 0.4
    t = t_axis(dur)
    env = np.zeros_like(t)
    for d in (0.0, 0.011, 0.022):
        env += np.where(t >= d, np.exp(-(t - d) / 0.006), 0)
    env += 0.45 * np.exp(-t / 0.11)
    y = fft_filter(noise(dur), lo=900, hi=3800) * env
    return y * 0.32


def bass_note(freq, dur):
    t = t_axis(dur)
    env = np.minimum(1, t / 0.006) * np.exp(-t / 0.22)
    y = 0.55 * saw(freq, t, 16) + 0.8 * np.sin(2 * np.pi * freq * t)
    return y * env


def stab(freqs, dur=0.45):
    t = t_axis(dur)
    y = np.zeros_like(t)
    for f in freqs:
        for det in (-0.006, 0.0, 0.006):
            y += saw(f * (1 + det), t, 18)
    y = fft_filter(y, hi=2600) * np.minimum(1, t / 0.004) * np.exp(-t / 0.14)
    return y * 0.09


def pad(freqs, dur, attack=0.8, release=1.2, cutoff=1100):
    t = t_axis(dur)
    y = np.zeros_like(t)
    for f in freqs:
        for det in (-0.004, 0.0, 0.005):
            y += saw(f * (1 + det), t, 12)
    y = fft_filter(y, hi=cutoff)
    env = np.minimum(1, t / attack) * np.minimum(1, np.maximum(0, (dur - t) / release))
    return y * env * 0.03


def riser(dur, lo=250, hi=7000, gain=1.0):
    t = t_axis(dur)
    x = noise(dur) * 0.6 + saw(1, t, 1) * 0
    centre = lambda tt: lo * (hi / lo) ** np.clip(tt / dur, 0, 1)
    y = stft_filter(x, centre, kind="band", q=3.0)
    pitch = 110 * 8 ** (t / dur)
    tone = np.sin(2 * np.pi * np.cumsum(pitch) / SR) * 0.25
    return (y + tone) * (t / dur) ** 2 * 0.5 * gain


def whoosh(dur=0.45, lo=400, hi=5000, pan_from=-0.6, pan_to=0.6):
    t = t_axis(dur)
    centre = lambda tt: lo * (hi / lo) ** np.clip(tt / dur, 0, 1)
    y = stft_filter(noise(dur), centre, kind="band", q=1.6, win=1024, hop=256)
    y *= np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2 * 0.55
    pans = np.linspace(pan_from, pan_to, len(t))
    a = (pans + 1) * np.pi / 4
    return np.stack([y * np.cos(a), y * np.sin(a)], axis=1)


def click():
    t = t_axis(0.03)
    y = fft_filter(noise(0.03), lo=2000) * np.exp(-t / 0.0015) * 0.5
    y += np.sin(2 * np.pi * 2900 * t) * np.exp(-t / 0.004) * 0.25
    return y


def blip(freq, dur=0.11, gain=1.0):
    t = t_axis(dur)
    env = np.minimum(1, t / 0.003) * np.exp(-t / 0.045)
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2 * t)) * env * 0.22 * gain


def chime(freqs, step=0.075, dur=1.2, gain=1.0):
    total = step * len(freqs) + dur
    out = np.zeros(int(total * SR))
    for i, f in enumerate(freqs):
        t = t_axis(dur)
        tone = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.005 * t)) * np.minimum(1, t / 0.002) * np.exp(-t / 0.42)
        i0 = int(i * step * SR)
        out[i0 : i0 + len(tone)] += tone
    return out * 0.16 * gain


def bell(base=440.0, dur=3.0, gain=1.0):
    t = t_axis(dur)
    y = np.zeros_like(t)
    for ratio, decay, amp in [(1, 2.2, 1), (2, 1.5, 0.5), (3, 1.0, 0.3), (4.2, 0.7, 0.25), (5.4, 0.5, 0.15)]:
        y += amp * np.sin(2 * np.pi * base * ratio * t) * np.exp(-t / decay)
    return y * np.minimum(1, t / 0.003) * 0.08 * gain


def glitch(dur=0.06):
    x = noise(dur)
    x = np.round(x * 3) / 3  # crushed
    x = np.repeat(x[::6], 6)[: len(x)]
    t = t_axis(dur)
    return fft_filter(x, lo=600) * np.exp(-t / 0.03) * 0.12


def sweep(f0, f1, dur, gain=1.0):
    t = t_axis(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    env = np.sin(np.pi * t / dur) ** 1.5
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env * 0.12 * gain


def tape_stop(dur=0.32):
    t = t_axis(dur)
    f = 220 * (1 - t / dur) ** 2 + 30
    y = saw(1, t, 1)
    tone = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.5 + np.sin(2 * np.pi * np.cumsum(f / 2) / SR)
    return fft_filter(tone, hi=900) * (1 - t / dur) * 0.22


# ----------------------------------------------------------------- notes
A1, C2, D2, E2, F1, G1 = 55.0, 65.41, 73.42, 82.41, 43.65, 49.0
A3, C4, E4, A4, F3, G3, B3, D4 = 220.0, 261.63, 329.63, 440.0, 174.61, 196.0, 246.94, 293.66
CHORDS = {"A": ([A3, C4, E4], A1), "F": ([F3, A3, C4], F1 * 2), "G": ([G3, B3, D4], G1 * 2), "E": ([E2 * 4 / 2, G3 * 1.26, B3], E2)}
PROGRESSION = ["A", "A", "F", "G"]  # one chord per bar (2 s)


def chord_at(t):
    bar = int(max(0, t - 16.0) // 2)
    return CHORDS[PROGRESSION[bar % 4]]


# ----------------------------------------------------------------- arrangement

# 00–05 · Hook: dark drone, bass pulse, metallic hits, rising tension.
drone_t = t_axis(11.0)
drone = (np.sin(2 * np.pi * A1 * drone_t) + 0.6 * np.sin(2 * np.pi * E2 * drone_t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.25 * drone_t))
drone += fft_filter(noise(11.0), hi=380) * 0.5
drone *= np.minimum(1, drone_t / 2.5) * 0.11
drone[int(10.6 * SR) :] = 0
music.add(drone, 0.0)
sfx.add(sub_boom(3.4), 0.15, 0.95)
C1 = CUES["s1"]
sfx.add(metallic(220, gain=0.9), C1["line1"])
send.add(metallic(220, gain=0.5), C1["line1"])
sfx.add(metallic(196, gain=1.2), C1["line2"])
send.add(metallic(196, gain=0.6), C1["line2"])
sfx.add(riser(2.55, 200, 6500, 0.9), 2.0)
for tg in C1["glitches"]:
    sfx.add(glitch(), tg, 1.0, pan=rng.uniform(-0.5, 0.5))
sfx.add(whoosh(0.45, 600, 9000), C1["exit"], 0.9)
sfx.add(crash(1.6, 0.5), C1["flash"] + 0.03, 0.6)

# 05–10.6 · Crypto world: percussion builds, bass filter opens, notification textures.
build_bass = np.zeros(int(5.6 * SR))
for i in range(int(5.6 / (BEAT / 2))):
    note = bass_note(A1 if (i // 8) % 2 == 0 else A1 * 1.0, BEAT / 2)
    i0 = int(i * BEAT / 2 * SR)
    build_bass[i0 : i0 + len(note)] += note[: len(build_bass) - i0]
build_bass = stft_filter(build_bass, lambda tt: 180 * (1900 / 180) ** np.clip(tt / 5.6, 0, 1), t0=0.0)
music.add(build_bass * 0.5, 5.0)
t = 5.0
while t < 10.55:
    music.add(kick(), t, 0.85)
    t += BEAT
t = 5.25
while t < 10.55:
    music.add(hat(), t, 0.9, pan=0.15)
    t += BEAT
t = 8.0
while t < 10.55:
    music.add(hat(), t, 0.55, pan=-0.2)
    t += BEAT / 4
for tc in (8.5, 9.5):
    music.add(clap(), tc, 0.9)
    send.add(clap(), tc, 0.4)
C2 = CUES["s2"]
NOTIFY_SHOTS = {5, 9}  # cut indices that show notification toasts (see timeline.js)
for i, tc in enumerate(C2["cuts"][1:], start=1):
    sfx.add(click(), tc, 0.9, pan=rng.uniform(-0.6, 0.6))
    if i in NOTIFY_SHOTS:
        for k in range(3):
            sfx.add(blip(1318.5 if k % 2 == 0 else 1760.0, gain=0.7), tc + 0.03 + k * 0.085, pan=rng.uniform(-0.4, 0.4))
for k, tc in enumerate(C2["words"]):
    sfx.add(metallic(262 if k < 3 else 196, 0.7, 0.55 if k < 3 else 0.9), tc)
    send.add(metallic(262 if k < 3 else 196, 0.7, 0.3), tc)
sfx.add(riser(2.2, 300, 8000, 1.0), C2["freeze"] - 2.2)
sfx.add(tape_stop(), C2["freeze"], 1.0)

# 11.4–15.55 · Opportunity: digital arpeggio rising, line sweep, swell, short silence.
arp_notes = [A3, C4, E4, A4, E4, C4, A3 * 2, E4]
arp = np.zeros(int(4.15 * SR))
for i in range(int(4.15 / 0.125)):
    f = arp_notes[i % len(arp_notes)]
    tt = t_axis(0.125)
    note = np.sign(np.sin(2 * np.pi * f * tt)) * np.exp(-tt / 0.09) * np.minimum(1, tt / 0.003)
    i0 = int(i * 0.125 * SR)
    arp[i0 : i0 + len(note)] += note[: len(arp) - i0]
arp = stft_filter(arp, lambda tt: 350 * (5200 / 350) ** np.clip(tt / 4.15, 0, 1), t0=0.0)
arp *= np.linspace(0.25, 1.0, len(arp)) * 0.075
music.add(arp, 11.4, pan=0.0)
send.add(arp * 0.6, 11.4)
sfx.add(sweep(180, 2400, 1.0, 1.0), 11.4)
sfx.add(sub_boom(1.6, 0.5), 12.2, 0.45)
swell = crash(1.0, 0.45)[::-1] * np.linspace(0, 1, int(1.0 * SR))[:, None] ** 2
sfx.add(swell, 14.55, 1.2)
sfx.add(riser(1.0, 400, 9000, 0.7), 14.55)

# 16–36 · Drop and main groove.
sfx.add(sub_boom(3.6, 1.2), 16.0, 1.0)
sfx.add(crash(2.8, 0.9), 16.0, 0.8)
send.add(crash(2.8, 0.9), 16.0, 0.4)
t = 16.0
while t < 36.0 - 1e-6:
    music.add(kick(), t, 0.95)
    t += BEAT
t = 16.25
while t < 36.0:
    chord, root = chord_at(t)
    music.add(bass_note(root, 0.22), t, 0.75)
    t += BEAT
t = 16.0
while t < 36.0:
    music.add(hat(), t + 0.125, 0.45, pan=-0.25)
    music.add(hat(), t + 0.375, 0.45, pan=0.25)
    music.add(hat(open_=True), t + 0.25, 0.35, pan=0.1)
    t += BEAT
t = 16.5
while t < 36.0:
    music.add(clap(), t, 0.85)
    send.add(clap(), t, 0.3)
    t += 2 * BEAT
for bar_t in np.arange(16.0, 36.0, 4.0):
    chord, root = chord_at(bar_t)
    music.add(stab(chord), bar_t, 1.0, pan=-0.2)
    send.add(stab(chord), bar_t, 0.6)
    music.add(pad(chord, 4.0), bar_t, 1.0, pan=0.2)
sfx.add(bell(440, 3.0, 1.0), 16.7)
send.add(bell(440, 3.0, 0.8), 16.7)
sfx.add(bell(659.25, 2.4, 0.6), 17.2, pan=0.2)
sfx.add(whoosh(0.7, 500, 6000), CUES["s4"]["move"], 0.9)
sfx.add(sub_boom(1.2, 0.4), 21.0, 0.35)

# Product walkthrough UI sounds.
C5 = CUES["s5"]
for key in ("clickHome", "clickLaunch", "clickToken", "clickSubmitLink", "clickCheck", "clickSubmit"):
    sfx.add(click(), C5[key], 1.1)
for key, (p0, p1) in (("toLaunch", (-0.5, 0.5)), ("toToken", (0.5, -0.5)), ("toCompetition", (-0.5, 0.5)), ("toSubmit", (0.5, -0.5))):
    sfx.add(whoosh(0.34, 700, 7000, p0, p1), C5[key] - 0.04, 0.85)
sfx.add(chime([1046.5, 1568.0], step=0.06, dur=0.6, gain=0.8), C5["toToken"] + 0.3)
sfx.add(click(), C5["typeStart"] - 0.08, 0.7)
for i, tc in enumerate(np.arange(C5["typeStart"], C5["typeEnd"], 0.045)):
    sfx.add(click(), tc, 0.3 + 0.12 * (i % 3 == 0), pan=rng.uniform(-0.2, 0.2))
for i, tc in enumerate(C5["checks"]):
    sfx.add(blip(1568.0 * 2 ** (i / 24), 0.06, 0.55), tc, pan=-0.3 + 0.6 * i / 7)
sfx.add(chime([1318.5, 1760.0], step=0.05, dur=0.5, gain=0.8), C5["caHighlight"])
sfx.add(whoosh(0.4, 900, 10000), C5["zoom"], 1.0)
sfx.add(riser(0.35, 800, 9000, 0.6), C5["zoom"])

# 29–36 · Viral Score: hits, counting ticks, first-place moment.
C6 = CUES["s6"]
first = C6["passes"][-1]
for tc, base in zip(C6["words"] + [C6["score"]], [247, 277, 330, 196]):
    sfx.add(metallic(base, 0.8, 0.8), tc)
    send.add(metallic(base, 0.8, 0.4), tc)
for i, tc in enumerate(np.arange(C6["words"][0], first, 0.125)):
    sfx.add(blip(2093.0 if i % 2 else 2637.0, 0.05, 0.35), tc, pan=0.3 if i % 2 else -0.3)
for tc in C6["passes"][:-1]:
    sfx.add(blip(1568.0, 0.09, 0.7), tc)
sfx.add(riser(first - 31.2, 300, 7000, 0.6), 31.2)
sfx.add(sub_boom(2.0, 0.6), first, 0.6)
sfx.add(chime([1046.5, 1318.5, 1568.0, 2093.0], step=0.07, dur=1.0, gain=1.0), first)
send.add(chime([1046.5, 1318.5, 1568.0, 2093.0], step=0.07, dur=1.0, gain=0.7), first)
sfx.add(blip(1046.5, 0.2, 0.8), C6["checkpoint"])
sfx.add(whoosh(0.45, 500, 6000), C6["expand"], 0.9)

# 36–41 · Rewards: deep impact, lighter groove, transfer, confirmation chime.
C7 = CUES["s7"]
sfx.add(sub_boom(3.0, 1.0), C7["impact"], 0.95)
t = 36.0
while t < 41.0 - 1e-6:
    music.add(kick(), t, 0.6)
    music.add(hat(), t + 0.25, 0.4)
    t += BEAT
music.add(pad(CHORDS["F"][0], 2.5), 36.0, 1.2)
music.add(pad(CHORDS["G"][0], 2.5), 38.5, 1.2)
tr0, tr1 = C7["transfer"]
sfx.add(blip(1318.5, 0.12, 0.6), C7["pending"])
sfx.add(blip(1568.0, 0.12, 0.6), C7["submitted"])
sfx.add(whoosh(tr1 - tr0 + 0.2, 300, 8000), tr0 - 0.1, 0.9)
for i in range(22):
    tc = tr0 + (tr1 - tr0) * (i / 22) ** 0.8
    sfx.add(blip(1760.0 + 40 * i, 0.04, 0.4), tc, pan=-0.6 + 1.2 * i / 22)
sfx.add(chime([1568.0, 2093.0, 2637.0], step=0.06, dur=1.3, gain=1.1), C7["confirmed"])
send.add(chime([1568.0, 2093.0, 2637.0], step=0.06, dur=1.3, gain=0.8), C7["confirmed"])
sfx.add(whoosh(0.6, 500, 7000, 0.6, -0.2), C7["out"] + 0.15, 0.9)

# 41–45 · End card: final cinematic impact, resolve, pulse shimmers, fade.
sfx.add(sub_boom(4.0, 1.5), 41.0, 1.0)
sfx.add(crash(3.5, 1.2), 41.0, 0.7)
send.add(crash(3.5, 1.2), 41.0, 0.5)
sfx.add(bell(220, 4.0, 1.2), 41.0)
send.add(bell(220, 4.0, 1.0), 41.0)
music.add(pad([A3, C4, E4, 493.88], 4.0, attack=0.4, release=2.0, cutoff=1500), 41.0, 1.4)
for tg in CUES["s8"]["pulses"]:
    sfx.add(chime([2637.0, 3136.0], step=0.05, dur=0.9, gain=0.45), tg)
    send.add(chime([2637.0, 3136.0], step=0.05, dur=0.9, gain=0.45), tg)

# ----------------------------------------------------------------- mix & master

def reverb_ir(dur=2.4):
    t = t_axis(dur)
    env = np.exp(-t / 0.55)
    l = fft_filter(noise(dur), hi=5000) * env
    r = fft_filter(noise(dur), hi=5000) * env
    ir = np.stack([l, r], axis=1)
    return ir / np.max(np.abs(ir)) * 0.06


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    out = np.zeros((len(x), 2))
    for c in range(2):
        y = np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size), size)[: len(x)]
        out[:, c] = y
    return out


# Sidechain-style ducking of the music under the drop's kick pattern.
duck = np.ones(N)
kick_env = np.exp(-t_axis(0.5) / 0.09)
for tk in np.arange(16.0, 36.0, BEAT):
    i0 = int(tk * SR)
    seg = duck[i0 : i0 + len(kick_env)]
    duck[i0 : i0 + len(kick_env)] = np.minimum(seg, 1 - 0.45 * kick_env[: len(seg)])
music.buf *= duck[:, None]

# Audio drop: freeze at 10.6 s, silence until 11.4 s and before the reveal at 16 s.
gate = np.ones(N)
gate[int(10.62 * SR) : int(11.4 * SR)] = 0.0
gate[int(15.55 * SR) : int(16.0 * SR)] = 0.0
music.buf *= gate[:, None]
sfx_gate = np.ones(N)
sfx_gate[int(15.56 * SR) : int(16.0 * SR)] = 0.0
sfx.buf *= sfx_gate[:, None]

wet = convolve(send.buf, reverb_ir())
mix = music.buf + sfx.buf + wet * 1.0
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
fade_in = np.minimum(1, t_axis(DUR) / 0.01)
fade_out = np.clip((DUR - t_axis(DUR)) / 1.6, 0, 1)
mix *= (fade_in * fade_out)[:, None]


# Loudness mastering (ITU-R BS.1770): K-weighted, gated integrated loudness and 4× oversampled true peak.
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


TARGET_LUFS, MAX_TRUE_PEAK_DB = -13.0, -1.5
gain_db = TARGET_LUFS - integrated_lufs(mix)
gain_db = min(gain_db, MAX_TRUE_PEAK_DB - 20 * np.log10(true_peak(mix)))
mix *= 10 ** (gain_db / 20)
print(f"master: {integrated_lufs(mix):.1f} LUFS integrated, true peak {20 * np.log10(true_peak(mix)):.1f} dBTP")

out = sys.argv[1] if len(sys.argv) > 1 else "soundtrack.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())

sections = [(0, 5), (5, 10.6), (10.6, 11.4), (11.4, 15.55), (15.55, 16), (16, 21), (21, 29), (29, 36), (36, 41), (41, 45)]
for a, b in sections:
    seg = mix[int(a * SR) : int(b * SR)]
    rms = np.sqrt(np.mean(seg**2)) if len(seg) else 0
    print(f"{a:5.2f}-{b:5.2f}s  rms {20 * np.log10(max(rms, 1e-9)):6.1f} dBFS  peak {20 * np.log10(max(np.max(np.abs(seg)), 1e-9)):6.1f} dBFS")
print("wrote", out)
