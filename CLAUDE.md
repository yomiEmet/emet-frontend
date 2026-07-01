# Emet Frontend — Collaboration Rules

- **Autonomous-execution authorization**: As long as a change is clearly reversible (standalone commit + a clear revert path), just go ahead and do it — don't itemize a checklist for Jingyi to tick through anymore. Only stop to ask for authorization on "important things" — important = involves money (subscriptions / subscription ToS gray areas), involves data loss, involves external exposure / privacy, or takes a long time with no visible result along the way.
- Legacy-code migration must be copied over verbatim — do only the DOM→React conversions that are strictly necessary; rewriting "after understanding it" is forbidden. Literal, explicit instructions like "port it / replicate / follow the original" = copy-paste directly, do NOT "take it as a reference for ideas."
- worker.js is fully authorized for direct editing and deployment — just keep a revert path ready (the old rule is retired).
- After finishing each independent step, git commit first, then move on to the next step. Every commit must be independently revertable.
- Deployment: Cloudflare Pages — pushing to master auto-deploys. Build: npm run build, Output: dist.
- Backend address: emet-memoty-v66.aandxiaobao.workers.dev (the spelling really is "memoty" — not a typo).
- Never hardcode any secret/key into the code or commit it into the repo.
