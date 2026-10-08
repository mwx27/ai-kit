// Instructions log (InstructionsLoaded + PostToolUse + UserPromptExpansion): one log per session,
// holding the instruction files that entered context, the skill invocations and the files the
// session wrote, in the order they happened. Off unless the config sets `instructionsLog: true`.
//
// Exists to answer two questions by measurement rather than assumption. First: does a path-scoped
// rule reach a session BEFORE it writes? The rule loads on the read of a matching file, so a
// session that creates a new file may get it late or not at all — and only a single time-ordered
// log of both events can tell the two apart. Second: did a skill enter the session at all, and by
// which route — the Skill tool, a typed slash command or a Read of its file?
//
// Line format (two spaces between columns), second column says which kind of line it is:
//   <ISO ts>  <load_reason>  <instruction file>[ trigger=<file whose access loaded it>]
//   <ISO ts>  write:<Edit|Write>  <written file>
//   <ISO ts>  skill:Skill  <skill name>
//   <ISO ts>  skill:slash  <command name> source=<command_source>
//   <ISO ts>  skill:Read  <file under .claude/skills/>
// The loading format is a measurement contract compared against earlier sessions — do not touch
// it. The colon in `write:` and `skill:` is what keeps those lines apart from any future load_reason.
//
// A skill line is an invocation, not a load: a Skill call on a skill already in context gets
// "already loaded" back and still logs `skill:Skill`, and a `/name` the user types logs only
// `skill:slash`. Any Read outside .claude/skills/ logs nothing. Invisible to the log: `cat` on a
// SKILL.md, the skill descriptions every session starts with (skill_listing), and a skill attached
// again after compaction.
//
// Raw and append-only: no deduplication, no aggregation. Unique files are counted when reporting,
// which is the same reason load_reason is kept per line rather than collapsed.
//
// The events discard systemMessage, so the log is the only output. Reading it is a manual step —
// <logDir>/instructions-*.log, one file per session.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, loadConfig, skippedRoots } from './config.mjs';
import { logEvent } from './log.mjs';

const SKILLS_DIR = '.claude/skills/';

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

function lineBody(input, root, ignoredRoots) {
  /** Repo-relative POSIX path, or null for anything outside the repo or under an ignored root. */
  function repoRelative(filePath) {
    const rel = path.relative(root, path.resolve(root, filePath));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    if (ignoredRoots.includes(rel.split(path.sep)[0])) return null;
    return rel.split(path.sep).join('/');
  }

  /** `write:…` for Edit|Write, `skill:…` for Skill and a Read under .claude/skills/, else null. */
  function toolLine() {
    if (input.tool_name === 'Skill') {
      const skill = input.tool_input?.skill;
      return isNonEmptyString(skill) ? `skill:Skill  ${skill}` : null;
    }
    const filePath = input.tool_input?.file_path;
    if (!isNonEmptyString(filePath)) return null;
    const rel = repoRelative(filePath);
    if (!rel) return null;
    if (input.tool_name === 'Read') return rel.startsWith(SKILLS_DIR) ? `skill:Read  ${rel}` : null;
    return `write:${input.tool_name ?? '?'}  ${rel}`;
  }

  function expansionLine() {
    if (input.expansion_type !== 'slash_command' || !isNonEmptyString(input.command_name)) return null;
    return `skill:slash  ${input.command_name} source=${input.command_source ?? '?'}`;
  }

  function loadLine() {
    const file = input.file_path;
    if (!isNonEmptyString(file)) return null;
    const trigger = input.trigger_file_path ? ` trigger=${path.relative(root, input.trigger_file_path)}` : '';
    return `${input.load_reason ?? '?'}  ${path.relative(root, file)}${trigger}`;
  }

  if (input.hook_event_name === 'PostToolUse') return toolLine();
  if (input.hook_event_name === 'UserPromptExpansion') return expansionLine();
  return loadLine();
}

/** Hook input → { exitCode }. Always exit 0. */
export function instructionsLog(input) {
  if (!input) return { exitCode: 0 };
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    // Silent: the Stop gate reports a broken config, once per turn.
    logEvent(root, 'instructions-log', { reason: 'config-error' });
    return { exitCode: 0 };
  }
  if (config.instructionsLog !== true) return { exitCode: 0 };

  const body = lineBody(input, root, skippedRoots(config));
  if (body) {
    const session = String(input.session_id ?? 'unknown').slice(0, 8);
    const logDir = path.join(root, config.logDir);
    mkdirSync(logDir, { recursive: true });
    appendFileSync(path.join(logDir, `instructions-${session}.log`), `${new Date().toISOString()}  ${body}\n`);
  }
  return { exitCode: 0 };
}
