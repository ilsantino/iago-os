# Technical Standards

<!--
TEACHING NOTE: A reference doc that gets loaded by spec and build agents.
Replace with your actual standards. This shows the structure.
-->

## Code Quality

- All code must have error handling for external calls (APIs, file I/O)
- No hardcoded secrets or API keys — use environment variables
- Include a README with setup instructions for any demo project
- Prefer standard library solutions over third-party packages when equivalent

## Testing

- Every demo must have at least one "happy path" verification
- Interactive demos: test the primary user flow end-to-end
- API demos: test with real (or mocked) responses

## Deployment

- All web demos must work on modern browsers (Chrome, Firefox, Safari latest)
- Mobile-responsive unless explicitly scoped as desktop-only
- Static deployable preferred (Vercel, Netlify, GitHub Pages)
