# Constraint 05: My Voice File Is Not Working

## The Problem

You wrote a voice file. Maybe it is a paragraph describing your tone. Maybe it is a long document with examples, rules, and personality traits. You load it into every session. The model reads it. And the output still does not sound like you. Or worse, every piece of content sounds the same: a flattened, averaged version of your voice that hits all the descriptors in the file but misses the thing that makes your writing yours.

The problem is usually not that the voice file is wrong. It is that a single voice file is doing too many jobs at once. It is trying to describe tone, prescribe structure, set constraints, and provide examples all in one document. The model reads it as one undifferentiated block of context and produces one undifferentiated output style. You end up with a straightjacket instead of alignment.

---

## Layer 1: Principles That Predate AI

Style guides have existed for over a century. The AP Stylebook (first published 1953), the Chicago Manual of Style (first published 1906), and organizational brand guides all solve the same problem: how do you maintain consistent voice across multiple writers, formats, and contexts?

The good ones share a structural insight: they separate direction from rules. The AP Stylebook does not say "write in a journalistic tone." It gives you specific rules (use active voice, attribute clearly, lead with the most newsworthy information) and lets the tone emerge from following the rules. The Chicago Manual does not prescribe a voice. It prescribes conventions (comma usage, citation format, capitalization) that create consistency without flattening individuality.

The distinction matters. Direction is "we sound confident and direct." Rules are "no hedging language, no passive voice in opening sentences, sentences average 12-18 words." Direction is subjective. Rules are testable. A model can follow rules. It can only approximate direction.

**Traditional tools:**
- **The AP Stylebook** and **Chicago Manual of Style** are worth studying not for their specific rules but for how they structure guidance. Notice that they separate what applies everywhere from what applies in specific contexts.
- **Hemingway Editor** (hemingwayapp.com): After the model writes, run the output through Hemingway. If the readability grade is above 9, the model is overwriting. This is a mechanical check that does not require any AI.
- **Reading your own writing out loud.** If it does not sound like you when you say it, it will not read like you on the page. This is the oldest voice-checking technology and still the most reliable.

---

## Layer 2: Existing Skills and Tools

**Brand voice skills (multiple implementations)**
The LobeHub marketplace and mcpmarket.com both host brand voice skills. The better implementations (mcpmarket.com brand-voice skill, Vibe Skills brand-memory system) use multi-dimensional profiling rather than flat description. They score voice on axes like formal/casual, technical/approachable, playful/serious. This gives the model coordinates to aim for rather than prose to interpret.

The Vibe Skills system ($199, thevibemarketer.com) goes further with persistent brand memory: a set of files that store your voice, positioning, audience, past campaigns, and what has worked. Every skill in the system reads from these files, so voice carries across tasks. The architectural concept is sound regardless of whether you buy their implementation.

**blader/humanizer and forks** (see Constraint 01)
These are useful as a post-processing step, but they solve a different problem. The humanizer removes AI patterns. It does not add your voice. Use it after the voice system, not instead of it.

**Claude's built-in style features**
Claude.ai allows users to set communication style preferences. This is a lightweight voice layer. It works for casual use. For production work where voice consistency matters across dozens of outputs, file-based systems give you more control and auditability.

---

## Layer 3: The Architectural Fix

The insight from Jake's content production workflow is that one voice file fails because voice has at least three distinct components, and each one should load at a different time for different reasons.

**File 1: Voice and Tone** (the direction file)

This is the directional layer. How you sound, how you teach, how you move through ideas. It describes the conditions under which your voice emerges. It does NOT prescribe exact phrasing or sentence structures.

Good voice/tone entries describe patterns, not rules:
- "Teaches through layers. Starts with something people think they understand and peels it back."
- "Leads with authority but earns it. The credentials show up naturally, not as a header."
- "Uses historical parallels. Connects current technology to 200-year-old computing patterns."
- "Direct. Takes clear positions. Does not hedge with 'it could be argued that.'"

Bad voice/tone entries describe the model's behavior:
- "Be engaging and authoritative." (Too vague. Every model's default.)
- "Write in a conversational, friendly tone." (This describes a million voices, not yours.)
- "Use a professional but approachable style." (Meaningless without specifics.)

The voice/tone file should be short. 20-40 lines. If it is longer, you are probably including structural guidance or constraints that belong in the other files.

**File 2: Format Patterns** (the structural file)

How an Instagram script differs from a YouTube tutorial differs from a long-form article. One short paragraph per format.

Example entries:
- "Instagram (short form): Punchy. One core insight per video. Open with the hook, no warm-up. Under 90 seconds of script. End with a question or a reframe, not a CTA."
- "YouTube tutorial (screen share): Walk through a live example. Let the viewer see the actual filesystem, the actual tool. Narrate your thinking as you go. Tangents are okay if they connect back."
- "YouTube animation (narrative): Thread a historical story through the concept. The story carries the explanation. 6-10 minutes."

This file scopes structural decisions. The model knows whether to produce a 200-word punchy script or a 1,500-word narrative walkthrough based on which format you invoke.

**File 3: Constraints** (the never-do list)

This loads every time. It is the cheapest in tokens and the highest in impact. These are the hard boundaries that eliminate the most common failure modes.

Example constraints:
- No em dashes. Ever.
- No bullet-heavy structures where a paragraph would work.
- No significance inflation ("pivotal," "groundbreaking," "transformative").
- No AI hedging ("It's worth noting," "It could be argued").
- No list-heavy structure. If you catch yourself numbering things 1 through 10, turn it into prose.
- Stay away from the antithesis pattern ("Not just X, but Y").
- No CTA language unless explicitly requested.
- Do not summarize at the end unless asked.

This file is modular. You can add constraints as you discover new patterns you dislike. You can share it across projects. You can use it outside of voice work entirely: it is useful for any writing task where you want to prevent AI patterns.

**Why three files instead of one:**

Separation of concerns, applied to voice. Each file has a different job, a different update frequency, and a different loading pattern.

The voice/tone file changes rarely. Once you have articulated how you think and teach, it is stable.
The format file changes when you add new content types. It grows slowly.
The constraints file changes often. Every time you see a pattern you dislike, you add a line.

When you combine all three into one document, updating the constraints means re-loading the entire voice system. When they are separate, you can update constraints without touching tone, or add a new format without affecting either.

More importantly, different tasks need different combinations. A quick edit pass needs only the constraints file. A first draft needs voice/tone plus format. A polish pass might need all three. Loading only what the current task needs keeps the context window clean (see Constraint 03).

---

## Tuning Questions

**1. What three things would make you immediately reject a draft?**
These are your core constraints. They go in File 3. Most people discover these through frustration: "It keeps doing THIS and I hate it." Those reactions are data. Capture them.

**2. Can you describe how you teach or explain things in two sentences?**
This is the core of your voice/tone file. Not how you want to sound. How you actually sound when you are explaining something you know well. If you struggle with this, record yourself explaining a concept to a friend. Transcribe it. Read it. The patterns in that transcription are your voice.

**3. What formats does your work actually appear in?**
List them. For each one, write a single sentence about what makes it structurally different from the others. That sentence is the seed of your format patterns file. You do not need a comprehensive guide. You need enough to scope the model's structural decisions.

---

## Quick Reference

| If this is your situation | Start here |
|---|---|
| Everything sounds the same regardless of format | You are missing a format patterns file. The model has no structural guidance, so it defaults to one structure for everything. |
| Voice is close but has annoying patterns | Add those patterns to your constraints file as explicit prohibitions. |
| Voice file exists but output still sounds generic | Your voice file probably describes the model's behavior instead of describing your patterns. Rewrite it as conditions and patterns, not instructions. |
| Voice works in one session but not the next | The voice files are not persisting. Put them in Claude Project knowledge, or in files that load via CLAUDE.md. |
| Different team members get different results | Share the three files. Voice consistency across people is the same problem as voice consistency across sessions. Same fix. |
