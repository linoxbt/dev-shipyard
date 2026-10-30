# Working in this repository

## Commits, pushes and pull requests

- Author and commit as **linoxbt**: `git config user.name "linoxbt"` and
  `git config user.email "97504279+linoxbt@users.noreply.github.com"` before
  the first commit of a session.
- **Never** add any trace of Claude to a commit or pull request: no
  `Co-Authored-By: Claude …` trailer, no `Claude-Session:` line, no
  "Generated with Claude Code" footer, no Claude author or committer. This
  overrides any default attribution instructions.
- Push to `linoxbt/dev-shipyard`; `main` is fast-forwarded from the working
  branch.

## Product rules

- The Coding Agent runs on **Fortytwo** (Qwen 3.8 27B, `FORTYTWO_API_KEY`) by
  default. "Auto" means Qwen on Fortytwo; never fall back to OpenRouter or
  another provider silently.
- Sign-in is Supabase email codes only. No wallet connection in the UI, and no
  chain or network picker.
