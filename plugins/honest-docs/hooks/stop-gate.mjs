#!/usr/bin/env node
// Stop → core/gate.mjs: blocks a turn that leaves the tree failing the project's guard.
import { gate } from '../core/gate.mjs';
import { runHook } from './io.mjs';

runHook(gate);
