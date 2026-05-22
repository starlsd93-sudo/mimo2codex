// 出站代理识别：Node 原生 fetch（undici）不读 HTTP_PROXY/HTTPS_PROXY/NO_PROXY，
// 这里在启动早期安装 undici 的 EnvHttpProxyAgent 作为全局 dispatcher，
// 让 mimo2codex 的上游 fetch 行为与 curl 一致。
import { EnvHttpProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici";

export interface ProxyStatus {
  enabled: boolean;
  /** 解释 enabled=false：用户 opt-out 还是 env 本来就没设 */
  reason?: "no-env" | "opted-out";
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

export interface InstallOptions {
  /** 测试注入：默认走真正的 undici.setGlobalDispatcher */
  setDispatcher?: (d: Dispatcher) => void;
}

export function installProxyDispatcherFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: InstallOptions = {}
): ProxyStatus {
  // opt-out：shell 里为 curl/git 常驻 HTTPS_PROXY 但不想让 mimo2codex 跟着走。
  // 任意非空值生效，与 MIMO2CODEX_VERBOSE 等保持一致。
  if (env.MIMO2CODEX_NO_PROXY_FROM_ENV) {
    return { enabled: false, reason: "opted-out" };
  }

  const httpProxy = env.HTTP_PROXY ?? env.http_proxy;
  const httpsProxy = env.HTTPS_PROXY ?? env.https_proxy;
  const noProxy = env.NO_PROXY ?? env.no_proxy;
  if (!httpProxy && !httpsProxy) {
    return { enabled: false, reason: "no-env" };
  }

  const dispatcher = new EnvHttpProxyAgent();
  (opts.setDispatcher ?? setGlobalDispatcher)(dispatcher);
  return { enabled: true, httpProxy, httpsProxy, noProxy };
}

/** 抹掉代理 URL 里的密码，banner / 日志安全可见。 */
export function redactProxyUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}
