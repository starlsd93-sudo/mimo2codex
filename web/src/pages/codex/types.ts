import type { ProbeResult } from "../../api/client";

// Track which row is currently in flight for any of the mutating actions.
// `kind` discriminates the action; `key` is a stable rowKey-style id
// (provider::model) or, for backup actions, the backup timestamp as string.
// Only one Busy at a time across the page so the UI can disable peers.
export type Busy = null | {
  kind: "apply" | "override" | "restore" | "clear" | "delete-backup";
  key: string;
};

// Per-row probe state, indexed by `${providerId}::${modelId}`. `running`
// drives the button spinner; `result` drives the badge next to the row.
// Cleared on page reload — probes are point-in-time, not persisted.
export interface ProbeState {
  running?: boolean;
  result?: ProbeResult;
}
