import { ControlPlaneHealthService } from "../runtime/control-plane-health.js";
import { GatewayClient } from "../runtime/gateway-client.js";
import { startHealthLoop } from "../runtime/loops.js";
import { OpenClawAuthProfilesStore } from "../runtime/openclaw-auth-profiles-store.js";
import { OpenClawAuthProfilesWriter } from "../runtime/openclaw-auth-profiles-writer.js";
import { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import { OpenClawWsClient } from "../runtime/openclaw-ws-client.js";
import { SessionsRuntime } from "../runtime/sessions-runtime.js";
import { OpenClawRuntimeModelWriter } from "../runtime/slimclaw-runtime-model-writer.js";
import { OpenClawRuntimePluginWriter } from "../runtime/slimclaw-runtime-plugin-writer.js";
import {
  type ControllerRuntimeState,
  createRuntimeState,
} from "../runtime/state.js";
import { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import { AgentService } from "../services/agent-service.js";
import { ChannelService } from "../services/channel-service.js";
import { DesktopLocalService } from "../services/desktop-local-service.js";
import { LocalUserService } from "../services/local-user-service.js";
import { ModelProviderService } from "../services/model-provider-service.js";
import { OpenClawAuthService } from "../services/openclaw-auth-service.js";
import { OpenClawGatewayService } from "../services/openclaw-gateway-service.js";
import { OpenClawSyncService } from "../services/openclaw-sync-service.js";
import { RuntimeConfigService } from "../services/runtime-config-service.js";
import { RuntimeModelStateService } from "../services/runtime-model-state-service.js";
import { SessionService } from "../services/session-service.js";
import { TemplateService } from "../services/template-service.js";
import { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import { NexuConfigStore } from "../store/nexu-config-store.js";
import { type ControllerEnv, env } from "./env.js";

export interface ControllerContainer {
  env: ControllerEnv;
  configStore: NexuConfigStore;
  gatewayClient: GatewayClient;
  controlPlaneHealth: ControlPlaneHealthService;
  openclawProcess: OpenClawProcessManager;
  agentService: AgentService;
  channelService: ChannelService;
  sessionService: SessionService;
  runtimeConfigService: RuntimeConfigService;
  runtimeModelStateService: RuntimeModelStateService;
  modelProviderService: ModelProviderService;
  localUserService: LocalUserService;
  desktopLocalService: DesktopLocalService;
  templateService: TemplateService;
  openclawSyncService: OpenClawSyncService;
  openclawAuthService: OpenClawAuthService;
  wsClient: OpenClawWsClient;
  gatewayService: OpenClawGatewayService;
  runtimeState: ControllerRuntimeState;
  startBackgroundLoops: () => () => void;
}

export async function createContainer(): Promise<ControllerContainer> {
  const configStore = new NexuConfigStore(env);
  await configStore.syncManagedRuntimeGateway({
    port: env.openclawGatewayPort,
    authMode: env.openclawGatewayToken ? "token" : "none",
  });
  const compiledStore = new CompiledOpenClawStore(env);
  const configWriter = new OpenClawConfigWriter(env);
  const authProfilesStore = new OpenClawAuthProfilesStore(env);
  const authProfilesWriter = new OpenClawAuthProfilesWriter(authProfilesStore);
  const runtimePluginWriter = new OpenClawRuntimePluginWriter(env);
  const runtimeModelWriter = new OpenClawRuntimeModelWriter(env);
  const templateWriter = new WorkspaceTemplateWriter(env);
  const gatewayClient = new GatewayClient(env);
  const sessionsRuntime = new SessionsRuntime(env);
  const runtimeState = createRuntimeState();
  // Construct openclawProcess before watchTrigger so the watch trigger can
  // delegate gateway restarts to OpenClawProcessManager.restart() instead of
  // re-implementing the dev-vs-launchd branching inline.
  const openclawProcess = new OpenClawProcessManager(env);
  const watchTrigger = new OpenClawWatchTrigger(env, openclawProcess);
  const wsClient = new OpenClawWsClient(env);
  const gatewayService = new OpenClawGatewayService(wsClient);
  const controlPlaneHealth = new ControlPlaneHealthService(
    gatewayService,
    wsClient,
    runtimeState,
    openclawProcess,
  );
  const openclawSyncService = new OpenClawSyncService(
    env,
    configStore,
    compiledStore,
    configWriter,
    authProfilesWriter,
    authProfilesStore,
    runtimePluginWriter,
    runtimeModelWriter,
    templateWriter,
    watchTrigger,
    gatewayService,
  );
  const openclawAuthService = new OpenClawAuthService(env, authProfilesStore);
  const modelProviderService = new ModelProviderService(
    configStore,
    env,
    openclawSyncService,
    openclawProcess,
  );
  modelProviderService.setAuthService(openclawAuthService);
  const runtimeModelStateService = new RuntimeModelStateService(env);

  return {
    env,
    gatewayClient,
    controlPlaneHealth,
    openclawProcess,
    agentService: new AgentService(configStore, openclawSyncService),
    channelService: new ChannelService(env, configStore, openclawSyncService),
    sessionService: new SessionService(sessionsRuntime),
    runtimeConfigService: new RuntimeConfigService(
      configStore,
      openclawSyncService,
    ),
    runtimeModelStateService,
    modelProviderService,
    localUserService: new LocalUserService(configStore),
    desktopLocalService: new DesktopLocalService(configStore, openclawProcess),
    templateService: new TemplateService(configStore, openclawSyncService),
    openclawSyncService,
    openclawAuthService,
    wsClient,
    gatewayService,
    configStore,
    runtimeState,
    startBackgroundLoops: () => {
      const stopHealthLoop = startHealthLoop({
        env,
        state: runtimeState,
        controlPlaneHealth,
        processManager: openclawProcess,
        wsClient,
      });

      return () => {
        stopHealthLoop();
        openclawAuthService.dispose();
        wsClient.stop();
      };
    },
  };
}
