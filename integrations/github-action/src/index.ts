import { run } from './main.js';

const outcome = await run({
  env: process.env,
  write: (text) => {
    process.stdout.write(text);
  },
});
process.exitCode = outcome.exitCode;
