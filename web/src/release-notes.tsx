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
    version: "0.4.6",
    date: "2026-05-23",
    title: {
      en: "Proxy support",
      zh: "部分体验的优化",
    },
    highlights: [
      {
        kind: "fixed",
        title: {
          en: "DeepSeek 400 \"Invalid assistant message\" with Chrome plugin",
          zh: "Chrome 插件触发 DeepSeek 400 \"Invalid assistant message\" 已修复",
        },
        description: {
          en: "When an assistant turn was assembled from a reasoning item plus function_call without any visible text part (Codex Chrome plugin pattern), the translated wire shape carried an explicit content: null alongside tool_calls. DeepSeek V4's strict validator treats that as \"neither field present\" and 400s. The OpenAI spec says content is optional when tool_calls is set, so we now omit the field instead of sending null. Reasoning-only turns get content: \"\" to stay spec-valid. Fixes issue #29.",
          zh: "当 assistant 回合由 reasoning + function_call 拼成、没有可见 text 时（Codex Chrome 插件场景），翻译产物里会带显式 content: null 和 tool_calls。DeepSeek V4 的严格校验把这种形状当成\"两个字段都没\"于是 400。OpenAI 规范规定 tool_calls 存在时 content 是可选的，现在直接省略该字段而不是发 null。reasoning-only 回合回落到 content: \"\" 保持合规。修复 issue #29。",
        },
        location: {
          en: "Codex onboarding → DeepSeek (any model)",
          zh: "Codex 接入 → DeepSeek（任意模型）",
        },
      },
      {
        kind: "fixed",
        title: {
          en: "Windows + pnpm-global + Node 22 startup no longer crashes",
          zh: "Windows + pnpm 全局安装 + Node 22 启动不再崩溃",
        },
        description: {
          en: "On Windows with pnpm global install and Node 22, better-sqlite3 sometimes can't load its native binding (no prebuilt for node-v127-win32-x64), and mimo2codex would exit on startup with \"Could not locate the bindings file\". The proxy now logs a clear, multi-line warning (with the underlying error and a Windows/pnpm-specific remediation hint) and starts with the admin DB DISABLED. Core Codex ↔ Chat-Completions translation never needed the DB, so the proxy is fully usable out-of-the-box on the install setups that hit this binding gap. Fixes issue #30.",
          zh: "Windows + pnpm 全局安装 + Node 22 时，better-sqlite3 有时拿不到对应 ABI (node-v127-win32-x64) 的 prebuilt native binding，mimo2codex 之前会直接退出报 \"Could not locate the bindings file\"。现在改成打印一段多行告警（包含原始错误信息和针对 Windows / pnpm 的修复建议）然后以 admin 关闭模式继续启动。核心 Codex ↔ Chat-Completions 翻译本来就不依赖 DB —— 让命中 binding 缺失的安装方式也能开箱可用。修复 issue #30。",
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
