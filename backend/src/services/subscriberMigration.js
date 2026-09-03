const { CONFIRMATION } = require('./subscriberMigrationCommon');
const { applyMigration } = require('./subscriberMigrationApply');
const { activateHandover, prepareHandover, rollbackHandover } = require('./subscriberMigrationHandover');
const { previewMigration } = require('./subscriberMigrationPreview');
const { SCHEMA, ensureMigrationSchema, getBatch, listBatches } = require('./subscriberMigrationSchema');

async function getMigrationBatch(clientId, id) {
  const batch = await getBatch(clientId, id);
  return batch ? { ...batch, confirmation_phrase: CONFIRMATION } : null;
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
