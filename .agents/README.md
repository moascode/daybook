# `.agents/` — project skills

Skills live here and are exposed to Claude Code through symlinks in
`.claude/skills/`. **A skill that is not symlinked does not load**, which is how
a copy of `feature-flow` sat tracked in this repo for months without ever
running — its frontmatter was identical to the plugin that was actually serving
the skill, so nothing looked wrong.

```
.agents/skills/<name>/SKILL.md      the skill itself
.claude/skills/<name> -> ../../.agents/skills/<name>
```

## What's here

| Skill | Purpose |
|---|---|
| [caveman](skills/caveman/SKILL.md) | Compressed communication mode |
| [caveman-commit](skills/caveman-commit/SKILL.md) | Conventional-commit message generator |
| [caveman-compress](skills/caveman-compress/SKILL.md) | Compress memory/context files |
| [caveman-help](skills/caveman-help/SKILL.md) | Reference card for the caveman modes |
| [caveman-review](skills/caveman-review/SKILL.md) | Compressed PR review comments |
| [smart-delegate](skills/smart-delegate/SKILL.md) | Model routing — which model for which task |

## Adding a skill

1. Write `.agents/skills/<name>/SKILL.md` with `name` and `description` frontmatter.
2. `ln -s ../../.agents/skills/<name> .claude/skills/<name>` — without this it never loads.
3. Commit both. `npm run check:doc-links` will catch any dead links you leave behind.

## Removed, and why

- **`cavecrew`** — dispatched to `cavecrew-investigator`/`-builder`/`-reviewer`
  subagents that were never defined anywhere. Every path through it failed at
  the first spawn.
- **`caveman-stats`** — required `hooks/caveman-stats.js` and
  `hooks/caveman-mode-tracker.js`. No `hooks/` directory has ever existed here.
- **`feature-flow`** — never symlinked, so never loaded; byte-identical in
  description to the `anthropic-skills` plugin that was doing the work.
