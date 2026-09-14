# Twigg chat

A streaming, multi-user chatbot for the terminal, built on the
[Twigg](https://twigg.ai) API. One file, in JavaScript or Python, with no SDK
and nothing to install.

The app stores nothing. Twigg keeps every chat and message. Each user's chats
live under the namespace `twigg-demo/<user>`, so listing them is one API call.

## Quick start

Download and run. It asks for your API key.

```bash
# JavaScript (Node 20.12+)
curl -O https://raw.githubusercontent.com/Twigg-AI-Ltd/twigg-examples/v1/chat/twigg-chat.mjs && node twigg-chat.mjs

# Python (3.8+)
curl -O https://raw.githubusercontent.com/Twigg-AI-Ltd/twigg-examples/v1/chat/twigg-chat.py && python3 twigg-chat.py
```

## Setup

To skip the prompt, put your key in a `.env` in the folder you run from (see
`.env.example`):

```
TWIGG_API_KEY=your-key-here
```

Or export it. Optional: `TWIGG_BASE_URL` (default `https://api.twigg.ai`) and
`TWIGG_MODEL` (default `gpt-5-6-luna`, see the
[model catalogue](https://api.twigg.ai/v1/catalogue/models.md)).

## Using it

Type a message to chat. The first message starts a chat. Commands:

- `/user <name>` switches user and starts a fresh chat
- `/new` starts a fresh chat
- `/list` lists this user's chats
- `/open <n>` reopens chat `n` from the last `/list` and shows its history

## Tests

`test/run.sh` runs every version through the same scripted session against a
fake Twigg (`test/fake-twigg.mjs`) and checks each one prints exactly
`test/expected.txt`. It needs Node, and skips versions whose toolchain is
missing. If you change the output on purpose, delete `test/expected.txt` and run
it again to regenerate it from the JavaScript version.
