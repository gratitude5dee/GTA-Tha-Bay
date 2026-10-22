---
id: story.beat
version: 1
hook: story.beat
recipe: K
style: bay-cel@1
keyframePin: openai/gpt-image-2.5/sunburst/edit@unpinned
shots: [{ durationS: 7, camera: push-in }, { durationS: 7, camera: static }]
aspect: '16:9'
resolution: 768P
audio: engine
slots: [style_tokens, subject_brief_1, subject_brief_2, subject_brief_3, place_desc, time_of_day, weather, mood, action_1, action_2, camera_1, camera_2]
---
{style_tokens}. {place_desc}, {time_of_day}, {weather}. Mood: {mood}.
Characters in frame: {subject_brief_1}. {subject_brief_2}. {subject_brief_3}.
Shot one: {action_1}. Camera: {camera_1}.
Shot two: {action_2}. Camera: {camera_2}.
No text, no letters, no logos, no numbers on clothing or signs.
