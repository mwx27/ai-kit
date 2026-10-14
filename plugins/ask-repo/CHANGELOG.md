# Changelog

All notable changes to the `ask-repo` plugin are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). It stays in the `0.x` range until the interface settles.

---

## [0.1.0] — 2026-10-15

### Added

- **`ask-repo`, a command that asks another repository on your machine a question.** A separate Claude session runs inside that repository and answers; follow-up questions continue the same session.
- **The session can only read.** It gets the file-reading tools alone, none of your MCP servers, and none of the permissions your own settings grant. `--git` also lets it read git history.
- **Repositories are registered by name** with `ask-repo --add <name> <path>`, in `~/.config/ask-repo/registry.json`, outside every repository.
- **Answers are kept in the project you ask from**, in `artifacts/ask-repo/`, which git ignores without any change to your `.gitignore`. A session unused for 7 days is deleted.
- **`/ask-repo:ask`**, which the agent also uses on its own when a task needs another registered repository.
- Works on macOS, Linux and Windows.

### Known limitations

- With `--git`, a git option that writes a file, such as `git diff --output`, is not blocked; only the session's instructions forbid it.
- Each question runs a full Claude session.
