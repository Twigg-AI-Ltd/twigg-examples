#!/usr/bin/env node
// A multi-user CLI chatbot on Twigg. One file, Node 20.12+, no dependencies.
//
//   node twigg-chat.mjs   (reads TWIGG_API_KEY from the environment, a .env, or asks)
//
// This app stores nothing. Twigg keeps every chat and message, and each user's
// chats live under the namespace twigg-demo/<user>, so listing a user's chats
// is one API call. Type a message to chat, or a command:
//
//   /user <name>   switch user (starts a fresh chat)
//   /new           start a fresh chat
//   /list          list this user's chats
//   /open <n>      reopen chat <n> from the last /list and show its history
//   /model [n]     list the models, or switch to model <n> from that list
import { createInterface } from "node:readline/promises";

try {
  process.loadEnvFile(); // ./.env, if there is one; variables already set win
} catch {}

const API = `${process.env.TWIGG_BASE_URL ?? "https://api.twigg.ai"}/api/v1`;
let model = process.env.TWIGG_MODEL ?? "gpt-5-6-luna"; // named on every message, so it can change mid-chat
const cli = createInterface({ input: process.stdin, output: process.stdout });
const key = process.env.TWIGG_API_KEY || (await cli.question("Twigg API key: "));

let user = "guest";
let chat = null; // the open chat's id: the only state this app holds
let listed = [];
let models = [];

async function twigg(path, body) {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Twigg ${res.status}: ${await res.text()}`);
  return res;
}

// Send only the new message. Twigg adds it to the chat, builds the context and streams the reply.
async function send(text) {
  const namespace = `twigg-demo/${user}`;
  chat ??= (await (await twigg("/chats", { namespace, title: [...text].slice(0, 50).join("") })).json()).id;
  const res = await twigg(`/chats/${chat}/responses`, { model, input: [{ type: "prompt", text }] });
  let buffer = "", event = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    const lines = (buffer + chunk).split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (!line.startsWith("data:")) continue;
      const data = JSON.parse(line.slice(5));
      if (event === "delta" && data.kind === "text") process.stdout.write(data.text);
      if (event === "error") throw new Error(data.message);
    }
  }
  console.log("\n");
}

const commands = {
  async user(name = "guest") {
    [user, chat, listed] = [name, null, []];
  },
  async new() {
    chat = null;
  },
  async list() {
    const namespace = encodeURIComponent(`twigg-demo/${user}`);
    listed = (await (await twigg(`/chats?namespace=${namespace}`)).json()).data;
    listed.forEach((c, i) => console.log(`${i + 1}. ${c.title ?? "Untitled"}  (${c.updated_at.slice(0, 16)})`));
  },
  async open(n) {
    if (!listed[n - 1]) return console.log("Run /list, then /open <n>");
    chat = listed[n - 1].id;
    const { data } = await (await twigg(`/chats/${chat}/history?limit=100`)).json();
    for (const { role, part } of data) {
      if (part.type === "prompt" || part.type === "message") console.log(`${role === "user" ? "you" : "bot"}: ${part.text}\n`);
    }
  },
  async model(n) {
    if (n === undefined) {
      models = await (await twigg("/models")).json();
      return models.forEach((m, i) => console.log(`${i + 1}. ${m.name}  ${m.provider_label}${m.name === model ? "  (current)" : ""}`));
    }
    if (!models[n - 1]) return console.log("Run /model, then /model <n>");
    model = models[n - 1].name;
    console.log(`Using ${model}`);
  },
};

cli.on("close", () => process.exit());
console.log("Type a message, or /user <name>, /new, /list, /open <n>, /model [n].");
while (true) {
  const line = (await cli.question(`${user}> `)).trim();
  if (!line) continue;
  try {
    const [command, arg] = line.split(/\s+/);
    if (!line.startsWith("/")) await send(line);
    else if (commands[command.slice(1)]) await commands[command.slice(1)](arg);
    else console.log("Commands: /user <name>, /new, /list, /open <n>, /model [n]");
  } catch (err) {
    console.error(err.message);
  }
}
