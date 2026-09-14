# Twigg chat

A streaming, multi-user chatbot for the terminal, built on the
[Twigg](https://twigg.ai) API. One file, in JavaScript or Python, with no SDK
and nothing to install.

The app itself stores nothing. Twigg keeps every chat and message, so you can
quit, come back later, or run it on another machine with the same key, and
your chats are still there.

## Quick start

You need a Twigg API key (see [Getting a key](../README.md#getting-a-key)).
Download a file and run it. It asks for your key.

```bash
# JavaScript (Node 20.12 or newer)
curl -O https://raw.githubusercontent.com/Twigg-AI-Ltd/twigg-examples/v2/chat/twigg-chat.mjs && node twigg-chat.mjs

# Python (3.8 or newer)
curl -O https://raw.githubusercontent.com/Twigg-AI-Ltd/twigg-examples/v2/chat/twigg-chat.py && python3 twigg-chat.py
```

Or clone the repo and run it from this folder:

```bash
git clone https://github.com/Twigg-AI-Ltd/twigg-examples.git
cd twigg-examples/chat
node twigg-chat.mjs        # or: python3 twigg-chat.py
```

## Using it

Type a message and press Enter to chat. The reply streams in as it is written.
Your first message starts a new chat, and later messages continue it.

| Command        | What it does                                                   |
| -------------- | -------------------------------------------------------------- |
| `/user <name>` | Switch to another user, and start a fresh chat as them.        |
| `/new`         | Start a fresh chat as the current user.                        |
| `/list`        | List the current user's chats, newest first.                   |
| `/open <n>`    | Reopen chat `n` from the last `/list` and print its history.   |
| `/model`       | List the models you can use, marking the current one.          |
| `/model <n>`   | Switch to model `n` from that list, from your next message on. |

Quit with Ctrl+D or Ctrl+C.

A session looks like this (replies shortened):

```
Type a message, or /user <name>, /new, /list, /open <n>, /model [n].
guest> What's a good name for a cat?
How about Miso? Short, friendly, and easy to call across a room.

guest> /model
1. claude-fable-5-1  Anthropic
2. claude-opus-5  Anthropic
3. claude-sonnet-5  Anthropic
4. gpt-5-6-luna  OpenAI  (current)
...
guest> /model 3
Using claude-sonnet-5
guest> Any more ideas?
Pepper, Biscuit or Tofu, if you like the food theme Miso started.

guest> /user alice
alice> Plan a weekend in Lisbon
Day one: start in Alfama...

alice> /list
1. Plan a weekend in Lisbon  (2026-09-14T10:02)
alice> /user guest
guest> /list
1. What's a good name for a cat?  (2026-09-14T10:00)
guest> /open 1
you: What's a good name for a cat?

bot: How about Miso? Short, friendly, and easy to call across a room.

guest> And one for a dog?
...
```

User names become part of a namespace, so use lowercase letters, digits, `-`
and `_` only. Anything else is rejected by the API.

## How it works

The app keeps one piece of state: the id of the chat that is open. Everything
else is a call to Twigg.

| When                  | Call                                     | What happens                                                                 |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| Your first message    | `POST /api/v1/chats`                     | Creates a chat under `twigg-demo/<user>`, titled with your message.          |
| Every message         | `POST /api/v1/chats/{chat_id}/responses` | Sends only the new text and the model. The reply streams back.               |
| `/list`               | `GET /api/v1/chats?namespace=...`        | Lists every chat under that user's namespace.                                |
| `/open <n>`           | `GET /api/v1/chats/{chat_id}/history`    | Reads the conversation back.                                                 |
| `/model`              | `GET /api/v1/models`                     | Lists every model in the catalogue you can name on a message.               |

**Users are namespaces.** Each user's chats are created under
`twigg-demo/<user>`, so there is no users table. A user exists as soon as they
have a chat, and listing their chats is one call filtered by namespace. In a
real app you would use something like `your-app/users/<user-id>`.

**The transcript is never sent.** Each turn sends only the new message. Twigg
adds it to the chat, assembles the context for the model (summarising older
turns if the chat outgrows the model's window), calls the model, and records
the reply. That is why the same code works whether a chat has two messages or
two thousand.

**Streaming is plain server-sent events.** The response is a `text/event-stream`
of `event:` and `data:` lines. The app prints the text of each `delta` event
whose `kind` is `text` and skips the rest, such as reasoning. The stream ends
with a `done` event carrying usage and cost.

**The model is a per-request choice.** Every message names a model, and the
chat doesn't belong to any one of them. Use `/model` to switch mid-chat: the
next message goes to the new model, with the whole conversation so far, even if
it comes from a different provider.

**A namespace is not a security boundary.** `/user` lets anyone at the keyboard
read any user's chats, which is fine for a demo. Your API key gives access to
every chat in your organisation, so a real app must check who is signed in
before choosing their namespace.

## Configuration

Settings come from the environment, or from a `.env` file in the folder you run
from (see `.env.example`). Variables already set in your shell win over `.env`.

| Variable         | Default                 | Meaning                                                                             |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `TWIGG_API_KEY`  | asks when you start     | Your API key.                                                                       |
| `TWIGG_MODEL`    | `gpt-5-6-luna`          | The model to start on. Any `name` from the [model catalogue](https://api.twigg.ai/v1/catalogue/models.md). |
| `TWIGG_BASE_URL` | `https://api.twigg.ai`  | Only change this if you were given a different API address.                         |

Each message is billed from your prepaid credit at the model's rates. The
default model is the cheapest in the catalogue.

## Troubleshooting

Errors are printed as `Twigg <status>: <details>` and the app keeps running.

| You see      | Meaning                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `Twigg 401`  | The API key is missing or wrong.                                                                        |
| `Twigg 402`  | Your credit can't cover the message. Add funds under Billing.                                           |
| `Twigg 404`  | Usually a model name that isn't in the catalogue.                                                       |
| `Twigg 422`  | Something failed validation. With `/user`, the name probably has uppercase letters or other characters. |

## Files

| File                  | What it is                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| `twigg-chat.mjs`      | The app in JavaScript.                                                     |
| `twigg-chat.py`       | The same app in Python.                                                    |
| `.env.example`        | A template for your `.env`.                                                |
| `test/run.sh`         | Runs each version through a scripted session against a fake Twigg.         |
| `test/fake-twigg.mjs` | The fake Twigg the tests use. No key or network needed.                    |
| `test/expected.txt`   | The exact output every version must print.                                 |

To change the output on purpose, delete `test/expected.txt` and run
`test/run.sh` again to regenerate it from the JavaScript version.
