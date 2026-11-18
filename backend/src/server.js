import http from 'node:http';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { HistoryService } from './engine/historyService.js';
import { SheetRegistry } from './engine/sheetRegistry.js';
import { createStore } from './persistence/createStore.js';
import { ensureSeedData } from './seed/inventorySheet.js';
import { AuthService } from './services/authService.js';
import { createApp } from './transport/http/app.js';
import { attachGateway } from './transport/ws/gateway.js';

async function main() {
  const store = createStore(config);
  await store.connect();
  await ensureSeedData({ store, config, logger });

  const registry = new SheetRegistry({ store, config, logger });
  const history = new HistoryService({ store, registry });
  const authService = new AuthService({ store, config });

  const app = createApp({ config, authService, registry, history, store, logger });
  const httpServer = http.createServer(app);
  const io = attachGateway({ httpServer, registry, authService, config, logger });

  await new Promise((resolve) => httpServer.listen(config.PORT, resolve));
  logger.info({ port: config.PORT, store: config.STORE_DRIVER }, 'SyncGrid API listening');

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down; flushing pending events');
    io.close();
    httpServer.close();
    await registry.closeAll();
    await store.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
