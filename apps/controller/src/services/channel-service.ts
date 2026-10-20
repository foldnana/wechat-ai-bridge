import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelResponse } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { proxyFetch } from "../lib/proxy-fetch.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_WECHAT_BOT_TYPE = "3";
const WECHAT_LOGIN_TTL_MS = 5 * 60_000;
const WECHAT_QR_POLL_TIMEOUT_MS = 35_000;
const WECHAT_QR_FETCH_TIMEOUT_MS = 10_000;
const WECHAT_QR_POLL_BACKOFF_MS = 1_000;

type ActiveWechatLogin = {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
};

type WechatQrCodeResponse = {
  qrcode: string;
  qrcode_img_content: string;
};

type WechatQrStatusResponse = {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
};

type WechatStoredAccount = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  userId?: string;
};

const activeWechatLogins = new Map<string, ActiveWechatLogin>();

function normalizeAccountId(accountId: string): string {
  return accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function resolveWeChatPluginStateDir(env: ControllerEnv): string {
  const stateDir =
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    env.openclawStateDir ||
    path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "openclaw-weixin");
}

function resolveWeChatAccountsDir(env: ControllerEnv): string {
  return path.join(resolveWeChatPluginStateDir(env), "accounts");
}

function resolveWeChatAccountIndexPath(env: ControllerEnv): string {
  return path.join(resolveWeChatPluginStateDir(env), "accounts.json");
}

function writeWeChatAccount(
  env: ControllerEnv,
  accountId: string,
  data: WechatStoredAccount,
): void {
  const dir = resolveWeChatAccountsDir(env);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${accountId}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

function registerWeChatAccount(env: ControllerEnv, accountId: string): void {
  const stateDir = resolveWeChatPluginStateDir(env);
  mkdirSync(stateDir, { recursive: true });
  const indexPath = resolveWeChatAccountIndexPath(env);
  const existing = existsSync(indexPath)
    ? (() => {
        try {
          const parsed = JSON.parse(
            readFileSync(indexPath, "utf-8"),
          ) as unknown;
          return Array.isArray(parsed)
            ? parsed.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
        } catch {
          return [];
        }
      })()
    : [];

  if (existing.includes(accountId)) {
    return;
  }

  writeFileSync(
    indexPath,
    JSON.stringify([...existing, accountId], null, 2),
    "utf-8",
  );
}

function getWeChatAccountStateDiagnostics(
  env: ControllerEnv,
  accountId: string,
) {
  const stateDir = resolveWeChatPluginStateDir(env);
  return {
    stateDir,
    accountFileExists: existsSync(
      path.join(stateDir, "accounts", `${accountId}.json`),
    ),
    indexFileExists: existsSync(resolveWeChatAccountIndexPath(env)),
  };
}

function purgeExpiredWechatLogins(): void {
  const now = Date.now();
  for (const [sessionKey, login] of activeWechatLogins) {
    if (now - login.startedAt >= WECHAT_LOGIN_TTL_MS) {
      activeWechatLogins.delete(sessionKey);
    }
  }
}

async function fetchWechatQrCode(
  apiBaseUrl: string,
  botType: string,
): Promise<WechatQrCodeResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    base,
  );
  try {
    const response = await proxyFetch(url.toString(), {
      timeoutMs: WECHAT_QR_FETCH_TIMEOUT_MS,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch QR code: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as WechatQrCodeResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Timed out fetching WeChat QR code");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out fetching WeChat QR code");
    }
    throw error;
  }
}

async function pollWechatQrStatus(
  apiBaseUrl: string,
  qrcode: string,
): Promise<WechatQrStatusResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    base,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECHAT_QR_POLL_TIMEOUT_MS);
  try {
    const response = await proxyFetch(url.toString(), {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Failed to poll QR status: ${response.status} ${response.statusText}`,
      );
    }
    return JSON.parse(rawText) as WechatQrStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class ChannelService {
  constructor(
    private readonly env: ControllerEnv,
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  async listChannels() {
    return this.configStore.listChannels();
  }

  async getChannel(channelId: string): Promise<ChannelResponse | null> {
    return this.configStore.getChannel(channelId);
  }

  private getWorkspacePath(botId: string): string {
    return path.join(this.env.openclawStateDir, "agents", botId);
  }

  private logChannelConnectSuccess(channel: ChannelResponse): void {
    logger.info(
      {
        channelType: channel.channelType,
        channelId: channel.id,
        accountId: channel.accountId,
        botId: channel.botId,
        workspacePath: this.getWorkspacePath(channel.botId),
      },
      "channel_connect_workspace_binding",
    );
  }

  async connectWechat(accountId: string) {
    const channel = await this.configStore.connectWechat({ accountId });
    logger.info(
      {
        accountId,
        phase: "before",
        ...getWeChatAccountStateDiagnostics(this.env, accountId),
      },
      "wechat_connect_sync_all",
    );
    await this.syncService.syncAll();
    this.logChannelConnectSuccess(channel);
    logger.info(
      {
        accountId,
        phase: "after",
        ...getWeChatAccountStateDiagnostics(this.env, accountId),
      },
      "wechat_connect_sync_all",
    );
    // Don't block on readiness — the prewarm hot-reload + monitor startup
    // can take 15-30s depending on the previous long-poll cycle. Blocking
    // here keeps the connect modal open and risks a rollback that triggers
    // yet another config write + channel restart (making things worse).
    // The home page's live-status polling (every 3s) shows the real-time
    // "connecting → connected" transition instead.
    return channel;
  }

  async wechatQrStart() {
    const sessionKey = randomUUID();
    purgeExpiredWechatLogins();

    const qrResponse = await fetchWechatQrCode(
      DEFAULT_WECHAT_BASE_URL,
      DEFAULT_WECHAT_BOT_TYPE,
    );

    activeWechatLogins.set(sessionKey, {
      sessionKey,
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
    });

    return {
      qrDataUrl: qrResponse.qrcode_img_content,
      message: "使用微信扫描以下二维码，以完成连接。",
      sessionKey,
    };
  }

  async wechatQrWait(sessionKey: string) {
    const activeLogin = activeWechatLogins.get(sessionKey);
    if (!activeLogin) {
      return {
        connected: false,
        message: "当前没有进行中的登录，请先发起登录。",
      };
    }

    if (Date.now() - activeLogin.startedAt >= WECHAT_LOGIN_TTL_MS) {
      activeWechatLogins.delete(sessionKey);
      return {
        connected: false,
        message: "二维码已过期，请重新生成。",
      };
    }

    const deadline = Date.now() + 500_000;
    while (Date.now() < deadline) {
      const status = await pollWechatQrStatus(
        DEFAULT_WECHAT_BASE_URL,
        activeLogin.qrcode,
      );

      if (status.status === "wait" || status.status === "scaned") {
        await sleep(WECHAT_QR_POLL_BACKOFF_MS);
        continue;
      }

      if (status.status === "expired") {
        activeWechatLogins.delete(sessionKey);
        return {
          connected: false,
          message: "二维码已过期，请重新生成。",
        };
      }

      if (
        status.status === "confirmed" &&
        status.bot_token &&
        status.ilink_bot_id
      ) {
        const normalizedAccountId = normalizeAccountId(status.ilink_bot_id);
        writeWeChatAccount(this.env, normalizedAccountId, {
          token: status.bot_token,
          savedAt: new Date().toISOString(),
          baseUrl: status.baseurl || DEFAULT_WECHAT_BASE_URL,
          userId: status.ilink_user_id,
        });
        registerWeChatAccount(this.env, normalizedAccountId);
        logger.info(
          {
            accountId: normalizedAccountId,
            ...getWeChatAccountStateDiagnostics(this.env, normalizedAccountId),
          },
          "wechat_qr_confirmation_state_written",
        );
        activeWechatLogins.delete(sessionKey);
        return {
          connected: true,
          message: "微信连接成功。",
          accountId: normalizedAccountId,
        };
      }
    }

    activeWechatLogins.delete(sessionKey);
    return {
      connected: false,
      message: "等待扫码超时，请重新生成二维码。",
    };
  }

  async disconnectChannel(channelId: string) {
    // Align with OpenClaw's "remove" semantics: disconnect only unbinds the
    // channel from Nexu config and leaves the linked session intact. Explicit
    // logout remains a separate operation.
    const getChannel =
      "getChannel" in this.configStore &&
      typeof this.configStore.getChannel === "function"
        ? this.configStore.getChannel.bind(this.configStore)
        : null;
    const channel = getChannel ? await getChannel(channelId) : null;
    logger.info(
      { channelId, channelType: channel?.channelType ?? "unknown" },
      "channel_disconnect_start",
    );
    const removed = await this.configStore.disconnectChannel(channelId);
    if (removed) {
      // syncAll triggers the authoritative index writer which removes
      // account IDs no longer in config. Credential files are cleaned up
      // by the writer's orphan sweep — no destructive cleanup here so
      // disconnect stays a pure "unbind", not a "logout".
      await this.syncService.syncAll();
      logger.info(
        { channelId, channelType: channel?.channelType ?? "unknown" },
        "channel_disconnect_success",
      );
    } else {
      logger.warn({ channelId }, "channel_disconnect_not_found");
    }
    return removed;
  }
}
