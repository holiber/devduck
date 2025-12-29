#!/usr/bin/env node

import { main } from '../../src/barducks-service/src/service.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  });
}

