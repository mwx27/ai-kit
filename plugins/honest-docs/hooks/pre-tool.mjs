#!/usr/bin/env node
// PreToolUse (Bash) → core/tool-hooks.mjs: stores the tree before the call.
import { preTool } from '../core/tool-hooks.mjs';
import { runHook } from './io.mjs';

runHook(preTool);
