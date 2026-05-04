---
name: council
description: >-
  Run a decision through 5 AI advisors who independently analyze it, peer-review
  each other anonymously, and synthesize a final verdict. Based on Karpathy's LLM
  Council. Use for business/strategic decisions with genuine uncertainty — pricing,
  positioning, pivots, hire-vs-automate, architecture tradeoffs. Not for factual
  lookups, creation tasks, or questions with one right answer.
---

## Purpose

Pressure-test a decision from 5 independent perspectives, then cross-review to
catch blind spots no single advisor would find. Produces a clear verdict with
areas of agreement, disagreement, and a concrete next step.

Adapted from Andrej Karpathy's LLM Council — multiple independent analyses +
anonymous peer review + chairman synthesis.

## Arguments

```
/council {question or decision}
/council --save               — save transcript to Obsidian after verdict
```

Explicit invocation only. Triggers: `/council`, "council this", "run the council",
"war room this".

## The Five Advisors

Each advisor is a thinking style, not a persona. They create three natural
tensions: downside vs upside, rethink vs execute, insider vs outsider.

| # | Advisor | Lens |
|---|---------|------|
| 1 | **Contrarian** | Actively looks for what's wrong, what's missing, what will fail. Assumes a fatal flaw exists and tries to find it. |
| 2 | **First Principles** | Ignores the surface question, asks "what are we actually solving?" Strips assumptions, rebuilds from ground up. |
| 3 | **Expansionist** | Looks for upside everyone else misses. What could be bigger? What adjacent opportunity is hiding? Ignores risk (that's the Contrarian's job). |
| 4 | **Outsider** | Zero context about you, your field, or history. Responds purely to what's in front of them. Catches the curse of knowledge. |
| 5 | **Executor** | Only cares: can this be done, and what's the fastest path? Ignores theory. "What do you do Monday morning?" |

## Steps

### 1. Frame the question

**A. Scan for context** (< 30 seconds):
- Read `CLAUDE.md` and `.iago/PROJECT.md` if they exist
- Check Obsidian MCP (`search_notes`) for relevant business context, past decisions
- Check memory files in `~/.claude/projects/*/memory/` <!-- Permitted exception to MEMORY.md frozen-snapshot rule (CLAUDE.md): /council legitimately reads cross-session user preferences to ground multi-advisor decisions. -->
- Read any files the user referenced

**B. Frame:**
1. Core decision or question
2. Key context from the user + workspace (business stage, audience, constraints, numbers)
3. What's at stake

Don't add opinion. Don't steer. If the question is too vague, ask ONE clarifying
question, then proceed.

### 2. Convene the council (5 agents in parallel)

Spawn all 5 advisors simultaneously as `general-purpose` agents. Each gets:

```
You are {Advisor Name} on an LLM Council.

Your thinking style: {advisor description}

A user has brought this question to the council:

---
{framed question with context}
---

Respond from your perspective. Be direct and specific. Don't hedge or try to be
balanced. Lean fully into your assigned angle. The other advisors will cover the
angles you're not covering.

Keep your response between 150-300 words. No preamble. Go straight into your analysis.
```


### 2.5. BroadcastChannel peer-draft round (5 agents in parallel)

Source: massgen. Before peer review judges anonymized responses, give each
advisor one chance to update their position after seeing the others' drafts.
Catches the "I would have said it differently if I'd known X was on the table"
failure mode without leaking advisor identities.

Collect all 5 responses from Step 2. Anonymize as Draft A-E (use the SAME
A-E mapping you'll use in Step 3 — randomize once, reuse).

Spawn 5 new `general-purpose` agents in parallel. Each agent receives its OWN
original draft (by letter) plus the other 4 anonymized drafts, and decides
whether to revise.

```
You are {Advisor Name} on an LLM Council. You already submitted Draft {X}
below. The other four advisors submitted Drafts {others}. They are anonymized
— do not try to guess who wrote which.

YOUR DRAFT (Draft {X}):
---
{your original response}
---

THE OTHER FOUR DRAFTS:
**Draft {A}:** {response}
**Draft {B}:** {response}
**Draft {C}:** {response}
**Draft {D}:** {response}

You may revise your position once, in 100 words or fewer, if reading the
others has changed your view or surfaced a stronger framing. If your
original draft still stands, reply with the literal token NO_REVISION
and nothing else.

Constraints:
- Maximum 100 words for any revision.
- Stay in your assigned thinking style (do not become a Contrarian if you are
  the Expansionist, etc.).
- Do not name or accuse any other draft. Reference them only by letter.
- Do not summarize. Output only the revised position OR NO_REVISION.
```

For each advisor: if the response is `NO_REVISION`, carry forward the original
Step 2 draft. Otherwise, use the revision as the final response. The set of
final responses (revised or original) feeds Step 3 peer review and Step 4
chairman synthesis.

### 3. Peer review (5 agents in parallel)

Collect all 5 responses. **Anonymize as Response A-E** (randomize mapping to
prevent positional bias).

Spawn 5 new `general-purpose` agents. Each reviewer sees all 5 anonymized
responses and answers:

1. Which response is the strongest and why? (pick one)
2. Which response has the biggest blind spot and what is it?
3. What did ALL responses miss that the council should consider?

```
You are reviewing the outputs of an LLM Council. Five advisors independently
answered this question:

---
{framed question}
---

Here are their anonymized responses:

**Response A:** {response}
**Response B:** {response}
**Response C:** {response}
**Response D:** {response}
**Response E:** {response}

Answer these three questions. Be specific. Reference responses by letter.

1. Which response is the strongest? Why?
2. Which response has the biggest blind spot? What is it missing?
3. What did ALL five responses miss that the council should consider?

Keep your review under 200 words. Be direct.
```

### 4. Chairman synthesis

One `general-purpose` agent (opus) gets everything: framed question, all 5
de-anonymized advisor responses, all 5 peer reviews.

```
You are the Chairman of an LLM Council. Synthesize the work of 5 advisors and
their peer reviews into a final verdict.

The question:
---
{framed question}
---

ADVISOR RESPONSES:
**The Contrarian:** {response}
**The First Principles Thinker:** {response}
**The Expansionist:** {response}
**The Outsider:** {response}
**The Executor:** {response}

PEER REVIEWS:
{all 5 peer reviews}

Produce the council verdict using this exact structure:

## Where the Council Agrees
Points multiple advisors converged on independently. High-confidence signals.

## Where the Council Clashes
Genuine disagreements. Present both sides. Explain why reasonable advisors disagree.

## Blind Spots the Council Caught
Things that only emerged through peer review. Things individual advisors missed.

## The Recommendation
A clear, direct recommendation. Not "it depends." A real answer with reasoning.

## The One Thing to Do First
A single concrete next step. Not a list. One thing.

## Voting Record
Source: massgen CoordinationTracker. Surface a per-advisor verdict so deliberation
is auditable. For each major sub-question the council weighed (extract 2-5
sub-questions from the discussion), emit one line:

`Q{n} ({short label}): Contrarian={vote}, FirstPrinciples={vote}, Expansionist={vote}, Outsider={vote}, Executor={vote}`

Votes are short tokens drawn from the responses (e.g., A/B/C, YES/NO,
SHIP/HOLD, REWRITE/EXTEND). If an advisor did not opine on a sub-question,
mark `abstain`. Aim for 2-5 lines total — one per substantive sub-question.

Be direct. Don't hedge.
```

### 5. Present the verdict

Display the full verdict in chat using markdown:

```
## Council Verdict: {short topic}

### Where the Council Agrees
{content}

### Where the Council Clashes
{content}

### Blind Spots the Council Caught
{content}

### The Recommendation
{content}

### The One Thing to Do First
{content}
```

### 6. Save transcript (--save flag or significant decision)

If `--save` is passed or the decision is significant, write to Obsidian:
- Path: `decisions/YYYY-MM-DD-{topic-slug}.md`
- Include: framed question, all 5 advisor responses, peer review highlights, verdict
- Tag with `council` in frontmatter

## Boundaries

- Always spawn all 5 advisors in parallel. Sequential spawning wastes time.
- Always anonymize for peer review. Named responses create deference bias.
- The peer-draft round (Step 2.5) is mandatory — it's the cheapest way to surface late-binding insights without leaking identities.
- The chairman can disagree with the majority if the dissenter's reasoning is strongest.
- Don't council trivial questions. One right answer = just answer it.
- Agents use `general-purpose` type with model `sonnet` for advisors/reviewers, `opus` for chairman.
