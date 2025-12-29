#!/usr/bin/env node

import { main } from '../../src/perf/node-test-parse.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

