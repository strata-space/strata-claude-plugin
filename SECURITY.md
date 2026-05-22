# Security policy

## Reporting a vulnerability

Email **security@strata.space** with a description of the issue, reproduction
steps, and the impact you observed. Please do not open a public GitHub issue
for security reports. We aim to acknowledge within 3 business days.

## Scope

This repository ships Claude Code skills, some of which run privileged
operations on the user's machine (package installs, system-extension toggles,
force unmounts, group membership changes) and some of which write to the
user's Strata content over the MCP server. Reports we are particularly
interested in:

- A path by which the skill executes a privileged command **without** the
  documented explicit per-command consent prompt.
- A path that bypasses the SHA-256 verification of the Linux CLI install
  artifact.
- A path that mounts over a destructive target the skill is supposed to
  refuse (`/`, `/usr`, `/var`, `/tmp`, `/etc`, `/bin`, `/sbin`, `/dev`,
  `/sys`, `/proc`, `$HOME`, `.`, or any directory containing existing
  `*.md` content).
- A path that writes user data into a git work tree without first updating
  `.gitignore` or `.git/info/exclude`.
- A path by which `strata-publish` or `strata-review` writes to the user's
  Strata content without the documented in-conversation consent.

## Out of scope

- Vulnerabilities in the `strata` CLI itself — report those at the
  CLI repository.
- Vulnerabilities in third-party MCP bridges such as `mcp-remote`.
- Vulnerabilities in Claude Code itself — report those to Anthropic.
