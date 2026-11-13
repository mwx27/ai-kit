#!/usr/bin/env node
// Stop → core/gate.mjs: blocks a turn whose own changes made the docs worse or fail the guard.
import { gate } from '../core/gate.mjs';
import { runHook } from './io.mjs';

runHook(gate);
