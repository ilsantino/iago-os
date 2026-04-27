# Animation Spec Template
## Long-Form Video (5+ Minutes)

Use this template to create a specification file for any long-form animated video. Fill in the sections, edit the beats to match your script, and hand it to Claude with your script. Claude builds the animation from this spec.

**What this is:** A contract between the voiceover and the animation. It makes sure timing, visuals, and emphasis align beat by beat.

**What this is NOT:** Code. Frame numbers. Pixel positions. Component props. Keep it in plain English. Claude handles the technical translation. Giving Claude creative room within clear boundaries produces better results than controlling every detail.

---

## Project

```
Title: [Video title]
Duration: [Estimated total length]
Style: [Describe the visual feel — minimal, bold, technical, playful, dark/moody, etc.]
Audience: [Who is watching this and what do they already know]
```

---

## Visual Philosophy

Describe the overall visual language for this video. Claude references this section when making design decisions for every scene.

```
Color palette: [Primary, secondary, accent colors. Or reference a style guide file.]
Typography: [Clean sans-serif / monospace for code / etc.]
Animation style: [Smooth transitions / sharp cuts / build-up reveals / etc.]
Motion principles: [What should feel fast? What should feel slow? What should pause?]
Background: [Dark with subtle texture / clean white / gradient / etc.]
Text on screen: [Minimal — keywords only / full sentences / code blocks / etc.]
```

---

## Beat Map

Each beat is a moment in the video tied to the script. Timestamps align to the voiceover. Claude builds one scene (or sequence of scenes) per beat.

```
## Beat 1: [Title]
Timestamp: 0:00 - 0:15
Script: "[The exact words being spoken during this beat]"
Visual: [What the viewer sees. Describe the animation, graphic, or on-screen element.]
Emphasis: [What should stand out? A word? A number? A visual element?]
Mood: [Energy level — building, calm, intense, reflective]
Transition: [How does this beat end and the next one begin?]

## Beat 2: [Title]
Timestamp: 0:15 - 0:35
Script: "[Exact words]"
Visual: [Description]
Emphasis: [What stands out]
Mood: [Energy]
Transition: [Into next beat]

## Beat 3: [Title]
...
```

**Tips for writing beats:**
- One beat per distinct idea or visual moment. If the visual changes, that is a new beat.
- Keep the script field to the exact words being spoken. This is what Claude uses for timing.
- Visual descriptions should say what appears, not how to code it. "A stack of seven layers building from bottom to top" not "render a flexbox column with seven divs."
- Emphasis tells Claude what the viewer's eye should be drawn to at this moment.
- Mood helps Claude choose animation speed, easing, and intensity.

---

## Key Moments

List the 3-5 moments in the video that absolutely must land. These are the beats where the visual and the words need to hit together perfectly. Claude will prioritize getting these right.

```
1. [Timestamp] — [Description of what must land and why]
2. [Timestamp] — [Description]
3. [Timestamp] — [Description]
```

---

## Audio Sync Points

Specific words or phrases where an animation must trigger at the exact moment the word is spoken.

```
- At "[specific word]" (timestamp): [what should appear or change]
- At "[specific phrase]" (timestamp): [what should appear or change]
- At "[specific word]" (timestamp): [what should appear or change]
```

---

## Technical Notes (Optional)

Only include this section if you have specific technical constraints. Otherwise, let Claude make these decisions based on the visual philosophy.

```
Frame rate: [30fps default]
Resolution: [1920x1080 default]
Component reuse: [List any existing components to use: text-reveal, scene-container, etc.]
Libraries: [Any specific libraries beyond Remotion defaults]
```

---
---

# Animation Spec Template
## Short-Form Video (Under 60 Seconds)

Shorter format. Fewer beats. Faster pacing. Same principles.

---

## Project

```
Title: [Video title]
Duration: [Target length — 15s / 30s / 45s / 60s]
Platform: [Instagram Reel / TikTok / YouTube Short / etc.]
Hook: [First 2-3 seconds — what grabs attention]
Style: [Visual feel]
```

---

## Visual Philosophy

```
Color palette: [Colors]
Motion: [Fast cuts / smooth builds / punchy / etc.]
Text: [Big bold keywords / minimal / etc.]
Aspect ratio: [9:16 for vertical / 16:9 for horizontal]
```

---

## Beat Map

Short-form videos typically have 3-6 beats. Every second counts.

```
## Beat 1: Hook
Timestamp: 0:00 - 0:03
Script: "[Opening words]"
Visual: [What grabs attention immediately]
Emphasis: [The one thing the viewer must read/see]

## Beat 2: Setup
Timestamp: 0:03 - 0:12
Script: "[Words]"
Visual: [Description]
Emphasis: [Key element]

## Beat 3: Payoff
Timestamp: 0:12 - 0:25
Script: "[Words]"
Visual: [Description]
Emphasis: [Key element]

## Beat 4: Close
Timestamp: 0:25 - 0:30
Script: "[Closing words or CTA]"
Visual: [Final frame — logo, CTA, subscribe, etc.]
```

---

## Key Moment

One moment that must land. In short-form, there is usually only one.

```
[Timestamp] — [What must hit and why]
```

---

## Audio Sync

```
- At "[word]" (timestamp): [trigger]
```

---
---

# Spec Generation Prompt

If you want Claude to generate the first draft of a spec from a script, use this prompt. Edit the output before building.

```
I have a script for a [long-form / short-form] video. I want you to generate 
an animation spec from it.

Here is the script:
[paste your script]

Use this structure for the spec:
- Project section (title, duration, style, audience)
- Visual philosophy (color, typography, motion, text approach)
- Beat map (one beat per distinct visual moment, with timestamp, 
  script excerpt, visual description, emphasis, mood, transition)
- Key moments (3-5 beats that must land perfectly)
- Audio sync points (specific words where animations must trigger)

Keep all descriptions in plain English. No code, no frame numbers, 
no pixel values. Describe what the viewer sees, not how to build it.

My visual style is: [describe your style or reference a style guide file]
```
