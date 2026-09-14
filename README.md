# Twigg examples

Small, runnable apps built on the [Twigg](https://twigg.ai) API. Each one is a
single file with no SDK: plain HTTP calls to `https://api.twigg.ai`.

| Example         | What it is                                                                 |
| --------------- | -------------------------------------------------------------------------- |
| [chat](chat/)   | A streaming, multi-user chatbot for the terminal, in JavaScript and Python. |

## What Twigg is

Twigg is a stateful API for LLM conversations: a context store, context
assembler and model router in one.

Calling a model directly means your app keeps the whole conversation, sends all
of it back every turn, trims or summarises it when it outgrows the model's
context window, translates it for each provider, and works out what each
request cost. With Twigg, your app keeps a chat id and sends only what just
happened. Twigg does the rest:

- **Stores the conversation.** Every message, tool call and result is kept in
  the chat, so there is no messages table for you to design.
- **Fits it to the window.** When history grows past the model's budget, older
  turns are compacted into a summary in the background.
- **Routes to any model.** `model` is chosen per request, so one chat can start
  on one provider and continue on another. The
  [catalogue](https://api.twigg.ai/v1/catalogue/models.md) lists models and prices.
- **Streams the answer and prices it.** Replies arrive as server-sent events,
  and every run reports its token usage and cost.

Your app keeps the parts that are really yours: the agent loop, your tools
(Twigg never runs one, it tells you one was called), and how your users map to
chats.

## How it works

1. **Create a chat**, once per conversation, optionally under a namespace you
   choose, such as `acme/users/alice`.
   ```
   POST /api/v1/chats                   {"namespace": "acme/users/alice"}
   ```
2. **Send the next message** and the model to answer it. Never the transcript.
   ```
   POST /api/v1/chats/{chat_id}/responses
   {"model": "gpt-5-6-luna", "input": [{"type": "prompt", "text": "Hello"}]}
   ```
3. **Read the stream.** Text arrives as `delta` events, and `done` closes the
   turn with usage and cost.

Repeat steps 2 and 3 for the life of the chat. To read things back,
`GET /api/v1/chats?namespace=...` lists chats under a namespace and
`GET /api/v1/chats/{chat_id}/history` returns a conversation.

## Getting a key

Sign up at [twigg.ai](https://twigg.ai), add credit under Billing (Twigg is
prepaid), and create a key under
[API keys](https://twigg.ai/dashboard/api-keys). Keys look like `tw_live_…`.

## Learn more

- [Docs overview](https://twigg.ai/docs)
- [Quickstart, as markdown](https://twigg.ai/docs/quickstart.md)
- [API reference](https://twigg.ai/docs/api)
- [Model catalogue and prices](https://api.twigg.ai/v1/catalogue/models.md)

## License

MIT. Copy anything here into your own project.
