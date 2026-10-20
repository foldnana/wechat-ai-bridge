import { logger } from "../lib/logger.js";
import type { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

export class DesktopLocalService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly openclawProcess: OpenClawProcessManager,
  ) {}

  async setDefaultModel(modelId: string) {
    await this.configStore.setDefaultModel(modelId);
    return { ok: true, modelId };
  }

  async restartRuntime(): Promise<void> {
    if (!this.openclawProcess.managesProcess()) {
      logger.info(
        {},
        "desktop_local_runtime_restart_skipped_external_openclaw",
      );
      return;
    }

    await this.openclawProcess.stop();
    this.openclawProcess.enableAutoRestart();
    this.openclawProcess.start();
  }
}
