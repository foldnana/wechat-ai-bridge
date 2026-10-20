import type {
  BindingConfig,
  BotResponse,
  ChannelResponse,
  ChannelType,
  OpenClawConfig,
} from "@nexu/shared";

/** Prefix for all internal placeholder account IDs that must never be persisted to runtime state. */
export const NEXU_INTERNAL_ACCOUNT_PREFIX = "__nexu_internal_";

const INTERNAL_WECHAT_PREWARM_ACCOUNT_ID = `${NEXU_INTERNAL_ACCOUNT_PREFIX}wechat_prewarm__`;

export const MANAGED_CHANNEL_PLUGIN_IDS: Partial<Record<ChannelType, string>> =
  {
    dingtalk: "dingtalk-connector",
    wecom: "wecom",
    qqbot: "openclaw-qqbot",
    wechat: "openclaw-weixin",
  };

export const QQBOT_DEFAULT_ACCOUNT_ID = "default";

export function resolveOpenClawChannelKey(channelType: ChannelType): string {
  if (channelType === "wechat") {
    return "openclaw-weixin";
  }
  if (channelType === "dingtalk") {
    return "dingtalk-connector";
  }
  return channelType;
}

export function resolveOpenClawRuntimeAccountId(
  channelType: ChannelType,
  accountId: string,
): string {
  if (channelType === "qqbot") {
    return QQBOT_DEFAULT_ACCOUNT_ID;
  }
  if (channelType === "dingtalk" && accountId === "default") {
    return "__default__";
  }
  return accountId;
}

export function resolveManagedChannelPluginId(
  channelType: ChannelType,
): string | null {
  return MANAGED_CHANNEL_PLUGIN_IDS[channelType] ?? null;
}

export function compileChannelBindings(
  bots: BotResponse[],
  channels: ChannelResponse[],
): BindingConfig[] {
  const activeBots = new Set(
    bots.filter((bot) => bot.status === "active").map((bot) => bot.id),
  );

  return channels
    .filter(
      (channel) =>
        channel.channelType === "wechat" &&
        channel.status === "connected" &&
        activeBots.has(channel.botId),
    )
    .map((channel) => ({
      agentId: channel.botId,
      match: {
        channel: resolveOpenClawChannelKey(channel.channelType),
        accountId: resolveOpenClawRuntimeAccountId(
          channel.channelType,
          channel.accountId,
        ),
      },
    }));
}
export function compileChannelsConfig(params: {
  channels: ChannelResponse[];
  secrets: Record<string, string>;
  gatewayBaseUrl: string;
  gatewayToken?: string;
}): OpenClawConfig["channels"] {
  const accounts: Record<string, { enabled: boolean }> = {};
  for (const channel of params.channels) {
    if (channel.channelType === "wechat" && channel.status === "connected") {
      accounts[channel.accountId] = { enabled: true };
    }
  }
  if (Object.keys(accounts).length === 0) {
    accounts[INTERNAL_WECHAT_PREWARM_ACCOUNT_ID] = { enabled: false };
  }
  return { "openclaw-weixin": { enabled: true, accounts } };
}
