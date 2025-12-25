// A simple long-lived process that writes to stdout and stderr.

// eslint-disable-next-line no-console
console.log('LOGGY_START stdout');
// eslint-disable-next-line no-console
console.error('LOGGY_START stderr');

let i = 0;
setInterval(() => {
  i += 1;
  // eslint-disable-next-line no-console
  console.log(`LOGGY_TICK stdout ${i}`);
  if (i % 2 === 0) {
    // eslint-disable-next-line no-console
    console.error(`LOGGY_TICK stderr ${i}`);
  }
}, 100).unref();

