export const BRIDGE_THEMES = [
  {
    id: "forest",
    name: "松林绿",
    description: "自然、柔和",
    ink: "#245c43",
    paper: "#edf2e6",
  },
  {
    id: "ocean",
    name: "海盐蓝",
    description: "清爽、专注",
    ink: "#285b94",
    paper: "#edf2f9",
  },
  {
    id: "iris",
    name: "鸢尾紫",
    description: "安静、有个性",
    ink: "#665195",
    paper: "#f2eef8",
  },
  {
    id: "sand",
    name: "暖砂色",
    description: "温暖、轻松",
    ink: "#835934",
    paper: "#f7f0e7",
  },
] as const;

export type BridgeTheme = (typeof BRIDGE_THEMES)[number]["id"];

export function readBridgeTheme(): BridgeTheme {
  try {
    const saved = localStorage.getItem("bridge-theme");
    return BRIDGE_THEMES.find((theme) => theme.id === saved)?.id ?? "forest";
  } catch {
    return "forest";
  }
}
