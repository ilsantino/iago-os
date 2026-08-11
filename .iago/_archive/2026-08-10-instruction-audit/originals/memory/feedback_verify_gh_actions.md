---
name: Verify GitHub Actions inputs and permissions
description: Never apply review suggestions to GitHub Actions workflows without verifying validity against docs
type: feedback
---

Never blindly apply review findings to GitHub Actions workflow files. Verify every input name and permission value against the actual GitHub Actions docs before committing.

**Why:** On 2026-04-08, Claude's review suggested adding `workflows: write` to the permissions block. This is a PAT scope, NOT a valid GITHUB_TOKEN permission. Adding it caused GitHub to reject the entire workflow file — killing ALL triggers and breaking the review-fix loop completely. The user was furious.

**How to apply:** Before adding any permission to a `permissions:` block, confirm it's in the valid set: actions, checks, contents, deployments, id-token, issues, packages, pages, pull-requests, repository-projects, security-events, statuses. Before using any action input (like `prompt:` vs `custom_instructions:`), check the action's actual README or action.yml. Never trust review suggestions for CI files without verification.
