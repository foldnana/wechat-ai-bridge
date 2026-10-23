import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Isolated mock provider; imports the exact transport shipped inside the EXE.
const runtime = path.resolve(
  process.argv[2] ?? "apps/desktop/.dist-runtime/openclaw",
);
if (process.argv.includes("--packaged")) {
  let patched = 0;
  for (const sub of ["dist", "dist/plugin-sdk"]) {
    const dir = path.join(runtime, "node_modules/openclaw", sub);
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".js")) continue;
      const source = await readFile(path.join(dir, file), "utf8");
      if (
        !source.includes(
          "const settingsManager = createEmbeddedPiSettingsManager(params);",
        )
      )
        continue;
      assert.ok(
        source.includes(
          "settingsManager.applyOverrides({ retry: { enabled: false } });",
        ),
        `Unbounded agent retry in ${file}`,
      );
      patched++;
    }
  }
  assert.ok(patched > 0, "No packaged retry guard found");
}
const { streamOpenAICompletions } = await import(
  pathToFileURL(
    path.join(
      runtime,
      "node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js",
    ),
  ).href
);
const root = await mkdtemp(path.join(os.tmpdir(), "bridge-transport-"));
const previousStateDir = process.env.OPENCLAW_STATE_DIR;
process.env.OPENCLAW_STATE_DIR = root;
let scenario = "transient";
let requests = 0;
const server = http.createServer(async (req, res) => {
  requests++;
  let body = "";
  for await (const chunk of req) body += chunk;
  assert.equal(JSON.parse(body).model, "synthetic-model");
  if (scenario === "auth") {
    res.writeHead(401).end('{"error":{"message":"invalid key"}}');
    return;
  }
  if (scenario === "always" || (scenario === "transient" && requests === 1)) {
    res.writeHead(503).end('{"error":{"message":"busy"}}');
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.flushHeaders();
  if (scenario === "stall") {
    res.write(": waiting\n\n");
    return;
  }
  res.write(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] })}\n\n`,
  );
  if (scenario === "partial") {
    setTimeout(() => res.destroy(), 30);
    return;
  }
  res.end(
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  );
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const model = {
    id: "synthetic-model",
    name: "Synthetic",
    api: "openai-completions",
    provider: "custom-openai__bridge",
    baseUrl,
    reasoning: false,
    input: ["text"],
    contextWindow: 32768,
    maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false },
  };
  const results = [];
  for (const [name, retries, expectedRequests] of [
    ["transient", 1, 2],
    ["always", 0, 1],
    ["always", 2, 3],
    ["auth", 2, 1],
    ["partial", 2, 1],
    ["stall", 1, 1],
  ]) {
    scenario = name;
    requests = 0;
    await writeFile(
      path.join(root, "nexu-runtime-model.json"),
      JSON.stringify({
        requestOptions: [
          {
            provider: model.provider,
            model: model.id,
            baseUrl,
            options: { thinking: "auto", timeoutSeconds: 30, retries },
          },
        ],
      }),
    );
    const started = Date.now();
    const result = await streamOpenAICompletions(
      model,
      {
        messages: [
          { role: "user", content: "synthetic test", timestamp: Date.now() },
        ],
      },
      { apiKey: "synthetic-not-a-real-key" },
    ).result();
    assert.equal(requests, expectedRequests, `${name}: unexpected retry count`);
    assert.equal(
      result.stopReason === "stop",
      name === "transient",
      `${name}: unexpected outcome`,
    );
    const elapsedMs = Date.now() - started;
    if (name === "stall")
      assert.ok(
        elapsedMs >= 29000 && elapsedMs < 35000,
        "body deadline did not hold",
      );
    results.push({
      scenario: name,
      retries,
      requests,
      elapsedMs,
      outcome: result.stopReason,
    });
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (previousStateDir === undefined)
    Reflect.deleteProperty(process.env, "OPENCLAW_STATE_DIR");
  else process.env.OPENCLAW_STATE_DIR = previousStateDir;
  assert.ok(
    !(
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("bridge-transport-")
    ),
    "Unsafe cleanup",
  );
  await rm(root, { recursive: true, force: true });
}
