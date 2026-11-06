#!/usr/bin/env node
if (process.argv[2] === '--wait') setInterval(() => {}, 1000)
else if (process.argv[2] === '--version') process.stdout.write('fixture 1.0.0\n')
else if (process.argv[2] === '--env') process.stdout.write(process.env.DSH_TEST_NOT_FOR_CHILD ?? 'clean')
else process.stdout.write(JSON.stringify({ args: process.argv.slice(2), pid: process.pid }))
