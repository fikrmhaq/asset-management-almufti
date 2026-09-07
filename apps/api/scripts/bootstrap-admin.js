'use strict';

/**
 * One-time bootstrap command — `05-infrastructure.md` §10.3.
 *
 * Creates the first user and assigns the seeded System Admin role. Run once,
 * manually, after deploy:
 *
 *   npm run bootstrap
 *
 * The password is prompted for, never taken from an argument or an environment
 * variable: both end up in shell history, process listings and CI logs.
 *
 * The rules live in `src/auth/bootstrapService.js`; this file only handles the
 * terminal interaction.
 */

const readline = require('node:readline');

const { loadDotEnvFiles, loadConfig } = require('../src/config');
const {
  bootstrapAdmin,
  BootstrapError,
  MIN_PASSWORD_LENGTH,
} = require('../src/auth/bootstrapService');
const { closeSequelize, assertDatabaseConnection } = require('../src/db/sequelize');

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

/**
 * Prompts without echoing. `readline` has no built-in hidden input, so the
 * output stream's write is intercepted for the duration of the prompt.
 */
function askHidden(rl, question) {
  return new Promise((resolve) => {
    const originalWrite = rl.output.write.bind(rl.output);
    let muted = false;

    rl.output.write = (chunk, ...rest) => {
      if (muted) return true;
      return originalWrite(chunk, ...rest);
    };

    originalWrite(question);
    muted = true;

    rl.question('', (answer) => {
      muted = false;
      rl.output.write = originalWrite;
      originalWrite('\n');
      resolve(answer);
    });
  });
}

async function main() {
  loadDotEnvFiles();

  try {
    loadConfig();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      'bootstrap must be run from an interactive terminal so the password can be ' +
        'entered without being echoed or recorded.'
    );
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    await assertDatabaseConnection();

    console.log('Creating the first administrator account.\n');

    const username = await ask(rl, 'Username: ');
    const password = await askHidden(rl, `Password (min ${MIN_PASSWORD_LENGTH} chars): `);
    const confirmation = await askHidden(rl, 'Confirm password: ');

    if (password !== confirmation) {
      console.error('\nThe passwords do not match. Nothing was created.');
      process.exitCode = 1;
      return;
    }

    const firstName = (await ask(rl, 'First name [System]: ')) || 'System';
    const lastName = (await ask(rl, 'Last name [Administrator]: ')) || 'Administrator';

    const user = await bootstrapAdmin({ username, password, firstName, lastName });

    console.log(`\nCreated user "${user.username}" with the "${user.role}" role.`);
    console.log('Sign in at POST /api/v1/auth/login to continue.');
  } catch (error) {
    console.error(
      `\n${error instanceof BootstrapError ? error.message : `Bootstrap failed: ${error.message}`}`
    );
    process.exitCode = 1;
  } finally {
    rl.close();
    await closeSequelize();
  }
}

main();
