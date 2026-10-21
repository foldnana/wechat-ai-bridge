import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(
  pluginDir,
  "..",
  "..",
  "nexu-runtime-model.json",
);

let cachedRaw = null;
let cachedState = null;

function loadState() {
  try {
    const raw = readFileSync(statePath, "utf8");
    if (cachedState && cachedRaw === raw) {
      return cachedState;
    }
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.selectedModelRef !== "string" ||
      typeof parsed.promptNotice !== "string"
    ) {
      return null;
    }
    cachedRaw = raw;
    cachedState = parsed;
    return parsed;
  } catch {
    return cachedState;
  }
}

const plugin = {
  id: "nexu-runtime-model",
  name: "Nexu Runtime Model",
  description:
    "Injects Nexu runtime model selection into model routing and prompt context.",
  register(api) {
    api.on("before_model_resolve", async () => {
      const state = loadState();
      if (!state) {
        return;
      }
      if (state.selectedModelRef.trim().length === 0) {
        return;
      }
      const slashIndex = state.selectedModelRef.indexOf("/");
      const providerOverride = state.selectedModelRef.slice(0, slashIndex);
      const modelOverride =
        slashIndex > 0
          ? state.selectedModelRef.slice(slashIndex + 1)
          : state.selectedModelRef;
      return {
        ...(slashIndex > 0 ? { providerOverride } : {}),
        modelOverride,
      };
    });

    api.on("before_prompt_build", async (_event, ctx) => {
      const state = loadState();
      if (
        !state ||
        state.selectedModelRef.trim().length === 0 ||
        state.promptNotice.trim().length === 0
      ) {
        return;
      }
      const preset = state.userPresets?.[ctx?.agentId];
      let behaviorPrompt = "";
      let persona = "auto";
      try {
        const behavior = JSON.parse(
          readFileSync(
            path.join(path.dirname(statePath), "bridge-behavior.json"),
            "utf8",
          ),
        );
        if (typeof behavior.promptContext === "string")
          behaviorPrompt = behavior.promptContext.slice(0, 16000);
        persona = ["auto", "whale", "none"].includes(behavior.persona)
          ? behavior.persona
          : "auto";
      } catch (error) {
        if (error?.code !== "ENOENT") persona = "none";
        /* Missing or unreadable behavior settings do not change the base preset. */
      }
      const customPreset = typeof preset === "string" ? preset.trim() : "";
      const defaultPersona =
        persona === "whale" || (persona === "auto" && state.deepseek === true)
          ? state.whalePersona
          : "";
      return {
        prependSystemContext: [
          state.promptNotice,
          customPreset ||
            (typeof defaultPersona === "string" ? defaultPersona : ""),
          behaviorPrompt,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    });
  },
};

export default plugin;
