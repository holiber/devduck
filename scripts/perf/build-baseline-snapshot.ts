#!/usr/bin/env node

import { main } from '../../src/perf/build-baseline-snapshot.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

