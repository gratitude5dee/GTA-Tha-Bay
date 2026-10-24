#!/usr/bin/env bash
# Recipe cut@1: the delivery ladder of a generated cutscene (spec/domains/05-assets-pipeline.md section 6 step 6;
# research/gap-cutscene-delivery-playback.md section 2.4). One input, one output directory.
#
#   ladder.sh <orig.mp4> <outdir>
#
# Writes into <outdir>:
#   v768.mp4    High L4.0, CRF 21, 5 Mbps cap, video-only CMAF fMP4, 1 s GOP, BT.709 tags     (codecs avc1.640028)
#   v540.mp4    High L3.1, CRF 23, 1.8 Mbps cap, 540 lines                                    (codecs avc1.64001f)
#   v1080.mp4   only when the source is 1080 lines or taller: High L4.1, CRF 21, 8 Mbps cap
#   poster.webp first frame; last.webp last frame
#   a.m4a       only with AUDIO=1 and a source audio track: AAC 128k, 48 kHz stereo, -16 LUFS / -1.5 dBTP
#
# The renditions carry no audio (cutscene audio plays through the game AudioContext). The container never publishes anything:
# the caller decides what leaves it. Exit status is that of the first failing ffmpeg call.
set -euo pipefail

orig="${1:?usage: ladder.sh <orig.mp4> <outdir>}"
out="${2:?usage: ladder.sh <orig.mp4> <outdir>}"
mkdir -p "$out"

FF=(ffmpeg -nostdin -hide_banner -loglevel error -y)
height="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$orig")"

common=(-c:v libx264 -profile:v high -preset slow -g 24 -keyint_min 24 -sc_threshold 0 -pix_fmt yuv420p
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -an
  -movflags +frag_keyframe+empty_moov+default_base_moof+cmaf)

"${FF[@]}" -i "$orig" "${common[@]}" -level 4.0 -crf 21 -maxrate 5M -bufsize 10M "$out/v768.mp4"
"${FF[@]}" -i "$orig" -vf scale=-2:540 "${common[@]}" -level 3.1 -crf 23 -maxrate 1.8M -bufsize 3.6M "$out/v540.mp4"
if [ "${height:-0}" -ge 1080 ]; then
  "${FF[@]}" -i "$orig" "${common[@]}" -level 4.1 -crf 21 -maxrate 8M -bufsize 16M "$out/v1080.mp4"
fi

"${FF[@]}" -ss 0 -i "$orig" -frames:v 1 -c:v libwebp -quality 80 "$out/poster.webp"
"${FF[@]}" -sseof -0.1 -i "$orig" -frames:v 1 -update 1 -c:v libwebp -quality 80 "$out/last.webp"

if [ "${AUDIO:-0}" = "1" ] && [ -n "$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$orig")" ]; then
  "${FF[@]}" -i "$orig" -vn -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 128k -ar 48000 -ac 2 "$out/a.m4a"
fi
