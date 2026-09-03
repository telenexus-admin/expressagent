const db = require('../db');
const { CONFIRMATION } = require('./subscriberMigrationCommon');
const genericApply = require('./subscriberMigrationApply');
const genericHandover = require('./subscriberMigrationHandover');
const genericPreview = require('./subscriberMigrationPreview');
const wispman = require('./subscriberMigrationWispman');
const { startWispmanLocalApiController } = require('./subscriberLocalApiController');
const { SCHEMA, ensureMigrationSchema, getBatch, listBatches } = require('./subscriberMigrationSchema');

async function getMigrationBatch(clientId, id) {
  const batch = await getBatch(clientId, id);
  return batch ? { ...batch, confirmation_phrase: CONFIRMATION } : null;
}

async function usesWispmanPath(clientId, batchId) {
  const result = await db.query(
    `SELECT source_system
     FROM billing_subscriber_migration_batches
     WHERE client_id=$1 AND id=$2
     LIMIT 1`,
    [clientId, batchId]
  );
  return String(result.rows[0]?.source_system || '').toLowerCase() === 'wispman';
}

async function previewMigration(input) {
  if (String(input.sourceSystem || '').toLowerCase() === 'wispman') {
    return wispman.previewWispmanMigration(input);
  }
  return genericPreview.previewMigration(input);
}

async function applyMigration(input) {
  return (await usesWispmanPath(input.clientId, input.batchId))
    ? wispman.applyWispmanMigration(input)
    : genericApply.applyMigration(input);
}

async function prepareHandover(input) {
  return (await usesWispmanPath(input.clientId, input.batchId))
    ? wispman.prepareWispmanHandover(input)
    : genericHandover.prepareHandover(input);
}

async function activateHandover(input) {
  return (await usesWispmanPath(input.clientId, input.batchId))
    ? wispman.activateWispmanHandover(input)
    : genericHandover.activateHandover(input);
}

async function rollbackHandover(input) {
  return (await usesWispmanPath(input.clientId, input.batchId))
    ? wispman.rollbackWispmanHandover(input)
    : genericHandover.rollbackHandover(input);
}

if (process.env.CI !== 'true' && process.env.NODE_ENV !== 'test') {
  const timer = setTimeout(() => {
    ensureMigrationSchema()
      .then(() => startWispmanLocalApiController())
      .catch((error) => console.error('Wispman migration controller startup:', error.message));
  }, 5000);
  timer.unref?.();
}

module.exports = {
  CONFIRMATION,
  SCHEMA,
  activateHandover,
  applyMigration,
  ensureMigrationSchema,
  getBatch: getMigrationBatch,
  listBatches,
  prepareHandover,
  previewMigration,
  rollbackHandover,
};
