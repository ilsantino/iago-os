## Project Conventions

Add project-specific conventions here. These are injected into agent context before each dispatch (max 300 tokens).

Conventions not covered by CLAUDE.md but specific to this project:

- iaGO-OS is the configuration layer itself, not a client project
- Agent definitions use markdown frontmatter with YAML fields: name, description, model, tools, maxTurns
- Capability modules are 200-400 token prompt fragments — additive only, no prohibitions
- Profile files reference capabilities by filename (without .md extension)
