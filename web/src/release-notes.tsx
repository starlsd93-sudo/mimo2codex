// Release notes shown in the "What's New" modal on admin first-load after a
// version bump. Maintained as a hand-rolled data file (TSX, not JSON, so we
// can drop in icons and the occasional ReactNode without losing TS safety).
//
// How to add an entry when you ship a new version:
//   1. Bump package.json `version` (via `npm run release:patch` etc.).
//   2. Update doc/tag-log{,.zh}.md as before (the WhatsNew modal complements
//      tag-log, it does not replace it).
//   3. Prepend a new `ReleaseNote` to RELEASE_NOTES below. Most recent first.
//      The modal auto-shows it to users whose lastSeenVersion is below it.
//
// Keep entries user-facing: highlight what changed from the user's seat, name
// the menu / button / page where the new thing lives, and (optionally) wire a
// CTA that navigates straight to it.

import type { ReactNode } from "react";
import { RobotOutlined, GlobalOutlined } from "@ant-design/icons";

export interface BilingualText {
  en: string;
  zh: string;
}

export interface ReleaseHighlight {
  icon?: ReactNode;
  /** Section badge: "new" | "improved" | "fixed" | "doc" */
  kind?: "new" | "improved" | "fixed" | "doc";
  title: BilingualText;
  description: BilingualText;
  /** Plain-text breadcrumb so users can find the new feature themselves. */
  location?: BilingualText;
  /** Optional CTA. ctaPath wins → react-router navigate; else ctaHref opens new tab. */
  ctaLabel?: BilingualText;
  ctaPath?: string;
  ctaHref?: string;
}

export interface ReleaseNote {
  version: string; // semver "0.4.2"
  date: string;    // "2026-05-21" ISO
  title: BilingualText;
  summary?: BilingualText;
  highlights: ReleaseHighlight[];
}

// ── Entries ──────────────────────────────────────────────────────────────
// Most recent first. Per the v0.4.3 release: we keep ONLY the latest version
// here so the in-app "What's new" modal stays tight — older release detail
// lives in doc/tag-log.{md,zh.md} for users who want the full history.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.4.5",
    date: "2026-05-22",
    title: {
      en: "Proxy support",
      zh: "代理的支持",
    },
    highlights: [
      {
        kind: "new",
        icon: <GlobalOutlined />,
        title: {
          en: "HTTP_PROXY / HTTPS_PROXY / NO_PROXY for outbound calls",
          zh: "HTTP_PROXY / HTTPS_PROXY / NO_PROXY 让 mimo2codex 走代理",
        },
        description: {
          en: "Set HTTP_PROXY / HTTPS_PROXY in your shell, .env, or docker-compose environment and mimo2codex's upstream fetches route through it — same behavior as curl. NO_PROXY excludes are honored too. The startup banner shows a `proxy:` line that echoes the active configuration so env-detection is verifiable at a glance, and upstream-failure logs include the underlying cause code (ECONNREFUSED / ENOTFOUND / ETIMEDOUT) for easier diagnosis. Opt-out via MIMO2CODEX_NO_PROXY_FROM_ENV=1 (useful when your shell keeps HTTPS_PROXY set for curl/git but the proxy can't reach the upstream).",
          zh: "在 shell / .env / docker-compose 的 environment 段设置 HTTP_PROXY / HTTPS_PROXY 即可，mimo2codex 向上游的请求会走该代理，行为与 curl 一致，NO_PROXY 排除列表也支持。启动 banner 多一行 `proxy:` 回显当前生效的代理，env 是否被识别一眼能看到；上游失败日志补上具体的错误码（ECONNREFUSED / ENOTFOUND / ETIMEDOUT），出问题不用再凭五个字猜。如果不想让 mimo2codex 跟着 shell 里的代理 env 走（典型场景：代理出口在境外、上游是国内域名），设 MIMO2CODEX_NO_PROXY_FROM_ENV=1 关掉。",
        },
        location: {
          en: "docker-compose.yml environment: / .env / shell export — startup banner shows the active proxy",
          zh: "docker-compose.yml environment: / .env / shell export —— 启动 banner 会回显当前代理",
        },
        ctaLabel: { en: "Proxy FAQ", zh: "代理 FAQ" },
        ctaHref: "https://github.com/7as0nch/mimo2codex/blob/main/doc/proxy-faq.zh.md",
      },
      {
        kind: "improved",
        icon: <RobotOutlined />,
        title: {
          en: "Clearer upstream-failure diagnostics",
          zh: "上游连接失败日志更易定位",
        },
        description: {
          en: "The WARN line on upstream connect failure now carries the underlying error code and cause message alongside the top-level 'fetch failed'. The 502 response body to your client also includes the code. ECONNREFUSED on the proxy port vs ENOTFOUND on the upstream domain are now distinguishable at a glance.",
          zh: "上游连接失败的 WARN 日志现在带上 underlying error code 和 cause message，不只是顶层的 'fetch failed'。返回给客户端的 502 错误信息里也包含这些细节。代理端口 ECONNREFUSED 还是上游域名 ENOTFOUND，一眼能区分。",
        },
      },
    ],
  },
];

// ── Semver compare ────────────────────────────────────────────────────────
export function compareVersion(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.replace(/^v/, "").split(".").map((n) => {
      const m = /^(\d+)/.exec(n);
      return m ? parseInt(m[1], 10) : 0;
    });
  const aa = parse(a);
  const bb = parse(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const ai = aa[i] ?? 0;
    const bi = bb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

// Releases the user has not yet acknowledged, capped at the running version
// (so a release-notes.tsx entry for a *future* version doesn't leak through).
export function unseenReleases(
  lastSeen: string | null,
  current: string,
): ReleaseNote[] {
  const baseline = lastSeen ?? "0.0.0";
  return RELEASE_NOTES.filter(
    (n) =>
      compareVersion(n.version, baseline) > 0 &&
      compareVersion(n.version, current) <= 0,
  );
}
