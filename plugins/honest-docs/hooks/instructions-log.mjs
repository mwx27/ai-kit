#!/usr/bin/env node
// InstructionsLoaded, UserPromptExpansion, PostToolUse (Edit|Write|Skill|Read) →
// core/instructions-log.mjs: the measurement log, when the config turns it on.
import { instructionsLog } from '../core/instructions-log.mjs';
import { runHook } from './io.mjs';

runHook(instructionsLog);
