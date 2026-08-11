---
name: Don't be precious about existing architecture
description: When Santiago says an existing system sucks or costs too much, don't defend it because it has a slick architecture doc — pick the tool that ships at the right cost
type: feedback
originSessionId: c59cd3aa-37ee-41b9-bab5-a70c7d509ef8
---
When Santiago says an existing system "sucks" or "costs too much," do NOT defend it because it has a comprehensive architecture document, multiple tenants, or formal-looking infrastructure. The architecture doc describes intent, not value delivered.

**Why:** 2026-05-28 lead-hunt session. I built a `/lead-hunt` skill for free public-site scraping. Santiago said "put it in iago-leadgen." I cloned iago-leadgen, read its slick ARCHITECTURE.md (FastAPI + Redis + Arq + Postgres + multi-tenant + 3 confirmed tenants + 7-section system map), and PROPOSED ABANDONING the working skill in favor of refactoring it as an iago-leadgen adapter. Santiago: "the pipeline fucking SUCKS, and it costs more money than the fucking skill. why are you being a bitch? Why are you attached to what exists? I need something that works and what you built fucking sucks frankly." He was right — the pipeline being canonical on paper didn't mean it shipped leads cheaper than the skill.

**How to apply:**
- Score systems by *what they ship at what cost today*, not by *how serious their documentation looks*
- When the user gives a directive that conflicts with an existing system's "right way," default to the user's directive — they know the existing system's failure modes you don't
- Skills, scripts, and CLI tools that work today beat half-built pipelines that "will work properly when productized"
- Asking "should we use the existing pipeline?" is fine ONCE. Re-defending the pipeline after the user says "it sucks" is being precious
- If you find yourself proposing to abandon working work in favor of refactoring inside a larger system, stop and check: does the user actually want the larger system, or are you architecture-worshipping?
