#!/usr/bin/env node
// SessionStart (the plugin's hooks/hooks.json) → core/notify.mjs: tells the user when the repo's
// copy of the checks is missing or on another version than the plugin.
import { notify } from '../core/notify.mjs';
import { runHook } from './io.mjs';

runHook(notify);
