import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function patchBridgeModelRequest(runtimeDir) {
  const providerDir = path.join(
    runtimeDir,
    "node_modules/@mariozechner/pi-ai/dist/providers",
  );
  const target = path.join(providerDir, "openai-completions.js");
  const original = await readFile(target, "utf8");
  const before =
    "const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });";
  const legacy =
    "const openaiStream = await client.chat.completions.create(params, prepareBridgeModelRequest(model, params, options?.signal));";
  const after =
    "const bridgeRequestOptions = prepareBridgeModelRequest(model, params, options?.signal);\n            const openaiStream = await client.chat.completions.create(params, bridgeRequestOptions);";
  const finish =
    "finishCurrentBlock(currentBlock);\n            if (options?.signal?.aborted)";
  const guardedFinish =
    'finishCurrentBlock(currentBlock);\n            if (bridgeRequestOptions.signal?.aborted) throw new Error("Model request timed out or cancelled");\n            if (options?.signal?.aborted)';
  if (
    (!original.includes(before) &&
      !original.includes(legacy) &&
      !original.includes(after)) ||
    (!original.includes(finish) && !original.includes(guardedFinish))
  ) {
    throw new Error(
      "pi-ai OpenAI transport changed: Bridge request patch must be reviewed",
    );
  }
  let source = original
    .replace(before, after)
    .replace(legacy, after)
    .replace(finish, guardedFinish);
  if (!source.includes("import { prepareBridgeModelRequest }"))
    source = `import { prepareBridgeModelRequest } from "./bridge-model-request.mjs";\n${source}`;
  await copyFile(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "runtime-bridge/model-request.mjs",
    ),
    path.join(providerDir, "bridge-model-request.mjs"),
  );
  if (source !== original) await writeFile(target, source, "utf8");
}
