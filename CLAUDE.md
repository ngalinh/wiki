# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. PR & Deploy Workflow (project-specific)

**Every fix goes through a PR and auto-deploys to the server.**

- Develop on the designated feature branch (`claude/gifted-newton-s0aceb` or whatever the session assigns).
- Before creating a PR, always `git fetch origin main && git rebase origin/main` to avoid squash-merge divergence.
- Create the PR as **ready-for-review** (not draft) so it can be merged immediately — this repo has no required CI checks.
- **Merge immediately** after creating the PR (squash merge). Do not wait.
- Pushing to `main` triggers the GitHub Actions deploy workflow (`.github/workflows/deploy.yml`) which SSH-deploys to the server (`git reset --hard origin/main`) and restarts the wiki process.
- Never push directly to `main`; always use a PR.

### Server details (for context)
- SSH: `vmadmin@103.140.249.232` (passwordless sudo)
- Deploy path: `/opt/dashboard-bot/data/bots/e9778bedc4f9f670`
- Process wiki chạy TRONG container Docker của dashboard-bot: cmdline là `node index.js`, cwd `/app/data/bots/e9778bedc4f9f670/server` (mount từ deploy path trên host). KHÔNG dùng PM2. `pkill -f "server/index.js"` KHÔNG trúng wiki (và suýt trúng app khác `image-server`). Restart đúng: tìm pid theo cwd chứa id bot (`readlink /proc/<pid>/cwd`) rồi `kill` — manager tự respawn; xem lệnh trong deploy.yml. Port của wiki nằm trong network namespace của container, không thấy bằng `ss` trên host. (Đã xác minh 2026-06-11 qua log deploy #36–#38.)
- Wiki runs on port `4105`, proxied by nginx at `/b/e9778bedc4f9f670/`
- Admin email env var: `ADMIN_EMAILS` in the bot's `.env` file
