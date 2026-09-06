#!/usr/bin/env node

const fs = require('fs');
const dotenv = require('dotenv');

const envFile = process.env.BACKEND_ENV_FILE || '/etc/nexa-platform/backend.env';
if (fs.existsSync(envFile)) dotenv.config({ path: envFile });
dotenv.config();

const { registerC2bUrls } = require('../src/services/darajaC2b');

(async () => {
  try {
    const result = await registerC2bUrls();
    console.log('===== DARAJA C2B REGISTRATION =====');
    console.log('Environment :', result.environment);
    console.log('Shortcode   :', result.shortcode);
    console.log('Validation  :', result.urls.validation);
    console.log('Confirmation:', result.urls.confirmation);
    console.log('Response    :', JSON.stringify(result.response));
    if (!result.success) process.exitCode = 2;
  } catch (error) {
    console.error('Daraja C2B registration failed:', error.response?.data || error.message);
    process.exitCode = 1;
  }
})();
