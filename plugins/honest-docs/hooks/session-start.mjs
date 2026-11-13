#!/usr/bin/env node
// SessionStart → core/session-start.mjs: takes the docs problems there are before the session starts.
import { sessionStart } from '../core/session-start.mjs';
import { runHook } from './io.mjs';

runHook(sessionStart);
