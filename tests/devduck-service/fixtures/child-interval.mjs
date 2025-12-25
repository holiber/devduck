// A child process that should be killed when its parent process group is killed.

// eslint-disable-next-line no-console
console.log(`CHILD_STARTED pid=${process.pid}`);

setInterval(() => {
  // keep alive
}, 1000);

