import { MemoryStore } from './memoryStore.js';
import { MongoStore } from './mongoStore.js';

export const createStore = (config) =>
  config.STORE_DRIVER === 'memory' ? new MemoryStore() : new MongoStore({ uri: config.MONGODB_URI });
