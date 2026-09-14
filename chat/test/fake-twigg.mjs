// A fake Twigg with just enough of the API for test/run.sh. Chats live in memory.
// It checks what the real API checks (the key, title length, namespace format)
// and sends streams a few bytes at a time, so clients must handle events, lines
// and UTF-8 characters split across reads.
import { createServer } from "node:http";

const KEY = "test-key";
const NAMESPACE = /^[a-z0-9_-]{1,64}(\/[a-z0-9_-]{1,64})*$/;
const chats = [];

createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const { pathname, searchParams } = new URL(req.url, "http://localhost");
  const json = (status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const fail = (status, message) => json(status, { error: { code: String(status), message } });
  if (req.headers.authorization !== `Bearer ${KEY}`) return fail(401, "bad key");

  if (req.method === "POST" && pathname === "/api/v1/chats") {
    const { namespace, title } = JSON.parse(body);
    if (!NAMESPACE.test(namespace)) return fail(422, `bad namespace ${namespace}`);
    if ([...title].length > 50) return fail(422, "title over 50 characters");
    const chat = { id: crypto.randomUUID(), namespace, title, updated_at: "2026-09-14T10:00:00Z", parts: [] };
    chats.unshift(chat);
    return json(201, chat);
  }
  if (req.method === "GET" && pathname === "/api/v1/chats") {
    const ns = searchParams.get("namespace");
    return json(200, { data: chats.filter((c) => c.namespace === ns || c.namespace.startsWith(`${ns}/`)) });
  }

  const chat = chats.find((c) => c.id === pathname.split("/")[4]);
  if (!chat) return fail(404, "no such chat");

  if (req.method === "POST" && pathname.endsWith("/responses")) {
    const { model, input } = JSON.parse(body);
    if (!model || input?.[0]?.type !== "prompt") return fail(422, "bad response request");
    const reply = `Heard (${chat.parts.length / 2 + 1}): ${input[0].text} ✓`;
    chat.parts.push({ role: "user", part: { type: "prompt", text: input[0].text } });
    chat.parts.push({ role: "assistant", part: { type: "message", text: reply } });
    const event = (name, data, eol = "\n") => `event: ${name}${eol}data: ${JSON.stringify(data)}${eol}${eol}`;
    const stream = Buffer.from(
      event("run", { run_id: crypto.randomUUID(), chat_id: chat.id, closed_tool_calls: [] }) +
        event("block_start", { kind: "thinking" }) +
        event("delta", { kind: "thinking", text: "this must not be printed" }) +
        event("block_start", { kind: "text" }, "\r\n") +
        reply.split(/(?<= )/).map((text) => event("delta", { kind: "text", text })).join("") +
        event("block_stop", {}) +
        event("done", { stop_reason: "end_turn", pending_tool_calls: [] }),
    );
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (let i = 0; i < stream.length; i += 5) {
      res.write(stream.subarray(i, i + 5));
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    return res.end();
  }
  if (req.method === "GET" && pathname.endsWith("/history")) return json(200, { data: chat.parts });
  fail(404, "no such route");
}).listen(Number(process.env.PORT ?? 4999));
