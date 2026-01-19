import { loadConfig, Config } from "./config.js";
import { loadRegistry, Registry } from "./registry.js";
import { SqliteIndex } from "./sqlite_index.js";
import { IndexStore } from "./indexer.js";
import { startServer } from "./server.js";
import { buildIndex } from "./index_builder.js";
import { syncRepos } from "./sync.js";
import { logger } from "./logger.js";

async function main() {
  logger.info("BTW MCP Server starting...");
  const config = loadConfig();
  logger.info("Config loaded");
  const registry = await loadRegistry(config);
  logger.info(`Registry loaded with ${registry.repos.length} repos`);
  const index = new SqliteIndex(config.indexPath);
  logger.info("Index initialized");
  const initialBuild = await buildIndex(config, registry, index);
  if (initialBuild.errors.length > 0) {
    logger.warn(`index build warnings: ${initialBuild.errors.join("; ")}`);
  }
  logger.info("Index built successfully");
  startAutoSync(config, registry, index);
  logger.info("Starting MCP server...");
  await startServer(config, registry, index);
  logger.info("MCP server started and listening");
}

function startAutoSync(
  config: Config,
  registry: Registry,
  index: IndexStore
) {
  if (config.syncIntervalSec <= 0) {
    return;
  }
  let syncing = false;
  setInterval(async () => {
    if (syncing) {
      return;
    }
    syncing = true;
    try {
      const sync = await syncRepos(config, registry);
      if (sync.errors.length > 0) {
        logger.warn(`auto-sync warnings: ${sync.errors.join("; ")}`);
      }
      const rebuild = await buildIndex(config, registry, index);
      if (rebuild.errors.length > 0) {
        logger.warn(`auto-index warnings: ${rebuild.errors.join("; ")}`);
      }
    } catch (err) {
      logger.error(`auto-sync failed: ${String(err)}`);
    } finally {
      syncing = false;
    }
  }, config.syncIntervalSec * 1000);
}

main().catch((err) => {
  logger.error(String(err));
  process.exit(1);
});
