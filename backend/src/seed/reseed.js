import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createStore } from '../persistence/createStore.js';
import { ensureSeedData } from './inventorySheet.js';

async function run() {
  logger.info({ store: config.STORE_DRIVER }, 'Starting explicit database re-seed...');
  const store = createStore(config);
  await store.connect();
  await ensureSeedData({ store, config, logger, force: true });
  await store.disconnect();
  logger.info('Database re-seed finished successfully!');
  process.exit(0);
}

run().catch((err) => {
  logger.fatal({ err }, 'Re-seed script failed');
  process.exit(1);
});

