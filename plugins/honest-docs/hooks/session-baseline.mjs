#!/usr/bin/env node
// SessionStart → core/baseline.mjs: records what was already dirty, once per session id.
import { baseline } from '../core/baseline.mjs';
import { runHook } from './io.mjs';

runHook(baseline);
