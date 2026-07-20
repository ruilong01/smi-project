---
name: deploy-lightsail
description: Prepare and verify deployment configuration for AWS Lightsail Ubuntu (4GB/2vCPU). Use for Phase 4, goal tracker item 10. Preparation only - no live deployment without explicit approval.
---

# Deploy to Lightsail

## Trigger
- Phase 4 work: goal tracker item 10
- Changes to server config, process manager, or env handling

## Constraints
- Target: Ubuntu Linux, 4GB RAM, 2 vCPU, 80GB SSD Lightsail instance
- Budget: ~SGD 87/month estimate, SGD 100/month cap, SGD 300 pilot cap
- Server runs Linux even though development is Windows: scripts written
  for the server must use bash/sh, not cmd/PowerShell.
- Secrets via server environment variables only. Never commit them.
  Provide .env.example with placeholder values only.

## Workflow
1. Produce/update: build steps, static file serving (nginx or node),
   backend process manager config (pm2 or systemd), ingestion cron
   schedule (APIs ~6h, webpages 12-24h), log rotation.
2. Document firewall/ports and HTTPS approach.
3. Dry-run everything locally that can be dry-run (build, server start).
4. Write a rollback note for each deployment change.

## Completion criteria
- Deployment documents/scripts exist and local dry-runs pass
- No credentials anywhere in the repo
- Explicit user approval obtained before any live server action

## Required report
1. Artifacts created/changed
2. Dry-run results
3. Estimated monthly cost impact vs SGD 100 cap
4. Exact manual steps the developer must perform on the server
