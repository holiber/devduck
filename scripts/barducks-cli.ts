#!/usr/bin/env node

import { main } from '../src/barducks-cli.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).catch((e: unknown) => {
    const err = e as { message?: string; stack?: string };
    // eslint-disable-next-line no-console
    console.error(err && err.stack ? err.stack : err.message || String(e));
    process.exitCode = 1;
  });
}

