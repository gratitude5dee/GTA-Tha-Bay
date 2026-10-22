---
id: story.establish
version: 1
hook: story.establish
recipe: K
style: bay-cel@1
keyframePin: openai/gpt-image-2.5/sunburst/edit@unpinned
shots: [{ durationS: 8, camera: push-in }]
aspect: '16:9'
resolution: 768P
audio: generated-ambient
slots: [style_tokens, place_desc, time_of_day, weather, mood, camera_1]
---
{style_tokens}. An establishing view of {place_desc}, {time_of_day}, {weather}. Mood: {mood}.
Small figures go about their day in the background, softly out of focus.
Camera: {camera_1}.
No text, no letters, no logos, no numbers on clothing or signs.
