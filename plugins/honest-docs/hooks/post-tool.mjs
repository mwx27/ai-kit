#!/usr/bin/env node
// PostToolUse (Edit|Write|NotebookEdit|Bash), PostToolUseFailure (Bash) → core/tool-hooks.mjs:
// attributes the call's paths to the session and runs the doc reminder on them.
import { postTool } from '../core/tool-hooks.mjs';
import { runHook } from './io.mjs';

runHook(postTool);
