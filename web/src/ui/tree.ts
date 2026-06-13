// Shared passive-tree types, formatting, and render constants for both the
// read-only TreeMap viewer and the Portal build planner. The data comes from
// the server's /api/tree endpoint (see tree_to_json in idlin-server).

export interface Grant {
  stat: string;
  layer: string;
  value: number;
}

export interface TreeNode {
  id: string;
  num: number;
  name: string;
  kind: string;
  x: number;
  y: number;
  grants: Grant[];
}

export interface TreeData {
  nodes: TreeNode[];
  /** Index pairs into `nodes` (undirected adjacency). */
  edges: [number, number][];
}

export const STAT_NAMES: Record<string, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  intelligence: "Intelligence",
  life: "maximum life",
  damage_phys: "physical damage",
  damage_fire: "fire damage",
  damage_cold: "cold damage",
  damage_lightning: "lightning damage",
  damage_chaos: "chaos damage",
  attack_speed: "attack speed",
  move_speed: "movement speed",
  armour: "armour",
  evasion: "evasion",
  accuracy: "accuracy",
  resist_fire: "fire resistance",
  resist_cold: "cold resistance",
  resist_lightning: "lightning resistance",
  resist_chaos: "chaos resistance",
};

export const PERCENT_STATS = new Set([
  "resist_fire",
  "resist_cold",
  "resist_lightning",
  "resist_chaos",
]);

export function fmtGrant(g: Grant): string {
  const name = STAT_NAMES[g.stat] ?? g.stat;
  if (g.layer === "added") {
    return PERCENT_STATS.has(g.stat) ? `+${g.value / 100}% ${name}` : `+${g.value} to ${name}`;
  }
  const pct = Math.abs(g.value) / 100;
  if (g.layer === "increased") {
    return `${pct}% ${g.value < 0 ? "reduced" : "increased"} ${name}`;
  }
  return `${pct}% ${g.value < 0 ? "LESS" : "MORE"} ${name}`;
}

export const KIND_STYLE: Record<string, { r: number; fill: string; label: boolean }> = {
  travel: { r: 5, fill: "#8a8aa0", label: false },
  notable: { r: 10, fill: "#ffd75a", label: true },
  keystone: { r: 12, fill: "#ff6a6a", label: true },
  socket: { r: 9, fill: "#5adfdf", label: true },
};

export const SCALE = 16;
