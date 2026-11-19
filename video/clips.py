"""
Cuts short, self-contained clips for X posts from the rendered trailer.

    python3 video/clips.py        # needs video/out/frames + video/out/soundtrack.wav (node video/render.mjs)

Every cut sits on the 128 BPM beat grid, so the music keeps its groove across
the dissolve into the end tag (the makevyral.com end card).
Output: video/out/x/*.mp4, 1920x1080 H.264 + AAC, Rec.709.
"""
import json
import subprocess
from pathlib import Path

DIR = Path(__file__).parent
OUT = DIR / "out"
FRAMES = OUT / "frames"
AUDIO = OUT / "soundtrack.wav"
cues = json.loads((DIR / "cues.json").read_text())
FPS = cues["fps"]
BEAT = 60 / cues["bpm"]
BAR = 4 * BEAT
TAG_BAR = 22  # the end card is fully built from bar 22 on
TAG_BEATS = 6
XFADE = 0.25


def bar(k, beats=0.0):
    return (k - 1) * BAR + beats * BEAT


CLIPS = [
    # name, start, end (None = to the end of the trailer), add end tag
    ("vyral-x-2-memes-are-attention", bar(1), bar(6, 2), True),
    ("vyral-x-3-how-it-works", bar(7), bar(11, 3.5), True),
    ("vyral-x-4-one-viral-score", bar(12), bar(17, 3), True),
    ("vyral-x-5-top-video-gets-paid", bar(18), None, False),
]

F = "accurate_rnd+full_chroma_int+full_chroma_inp"
TO_709 = f"scale=in_range=full:in_color_matrix=bt601:flags={F},format=gbrp,scale=1920:1080:flags=lanczos+{F},scale=out_color_matrix=bt709:out_range=tv:flags={F},format=yuv420p"
TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"]


def frames_input(t0, t1):
    first = round(t0 * FPS)
    count = round(t1 * FPS) - first
    return ["-framerate", str(FPS), "-start_number", str(first), "-i", str(FRAMES / "f%05d.jpg")], count


(OUT / "x").mkdir(parents=True, exist_ok=True)
for name, t0, t1, tag in CLIPS:
    t1 = t1 if t1 is not None else cues["duration"]
    a_in, a_frames = frames_input(t0, t1)
    dur_a = a_frames / FPS
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *a_in]
    if tag:
        # The tag starts at the same position in the bar as the cut, so the beat carries on.
        phase = ((t1 - t0) / BEAT) % 4
        tag0 = bar(TAG_BAR, phase)
        # Tag pictures start XFADE early so they stay in sync with the tag audio through the dissolve.
        b_in, b_frames = frames_input(tag0 - XFADE, tag0 + TAG_BEATS * BEAT)
        dur_b = b_frames / FPS
        total = dur_a + dur_b - XFADE
        args += [*b_in, "-i", str(AUDIO)]
        graph = (
            f"[0:v]trim=end_frame={a_frames},setpts=PTS-STARTPTS[a];"
            f"[1:v]trim=end_frame={b_frames},setpts=PTS-STARTPTS[b];"
            f"[a][b]xfade=transition=fade:duration={XFADE}:offset={dur_a - XFADE:.4f},{TO_709},"
            f"fade=t=in:st=0:d=0.2,fade=t=out:st={total - 0.5:.4f}:d=0.5[v];"
            f"[2:a]atrim={t0:.5f}:{t1:.5f},asetpts=PTS-STARTPTS[x];"
            f"[2:a]atrim={tag0 - XFADE:.5f}:{tag0 + TAG_BEATS * BEAT:.5f},asetpts=PTS-STARTPTS[y];"
            f"[x][y]acrossfade=d={XFADE}:c1=tri:c2=tri,afade=t=in:st=0:d=0.05,afade=t=out:st={total - 0.8:.4f}:d=0.8[au]"
        )
    else:
        total = dur_a
        args += ["-i", str(AUDIO)]
        graph = (
            f"[0:v]trim=end_frame={a_frames},setpts=PTS-STARTPTS,{TO_709},fade=t=in:st=0:d=0.2[v];"
            f"[1:a]atrim={t0:.5f}:{t1:.5f},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.05[au]"
        )
    args += [
        "-filter_complex", graph, "-map", "[v]", "-map", "[au]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-tune", "film", *TAGS,
        "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-t", f"{total:.4f}",
        str(OUT / "x" / f"{name}.mp4"),
    ]
    subprocess.run(args, check=True)
    print(f"{name}.mp4  {total:5.2f} s")
