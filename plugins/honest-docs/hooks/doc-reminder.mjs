#!/usr/bin/env node
// PostToolUse (Edit|Write|Bash) → core/reminder.mjs: names a doc whose `covers:` code changed.
import { reminder } from '../core/reminder.mjs';
import { runHook } from './io.mjs';

runHook(reminder);
