#!/usr/bin/env python3
# A multi-user CLI chatbot on Twigg. One file, Python 3.8+, standard library only.
#
#   python3 twigg-chat.py   (reads TWIGG_API_KEY from the environment, a .env, or asks)
#
# This app stores nothing. Twigg keeps every chat and message, and each user's
# chats live under the namespace twigg-demo/<user>, so listing a user's chats
# is one API call. Type a message to chat, or a command:
#
#   /user <name>   switch user (starts a fresh chat)
#   /new           start a fresh chat
#   /list          list this user's chats
#   /open <n>      reopen chat <n> from the last /list and show its history
import json, os, sys, urllib.error, urllib.parse, urllib.request

# ./.env, if there is one; variables already set win
if os.path.exists(".env"):
    for line in open(".env"):
        name, sep, value = line.strip().partition("=")
        if sep and not name.startswith("#"):
            os.environ.setdefault(name.strip(), value.strip().strip("\"'"))

API = os.environ.get("TWIGG_BASE_URL", "https://api.twigg.ai") + "/api/v1"
MODEL = os.environ.get("TWIGG_MODEL", "gpt-5-6-luna")
KEY = os.environ.get("TWIGG_API_KEY") or input("Twigg API key: ")

user = "guest"
chat = None  # the open chat's id: the only state this app holds
listed = []


def twigg(path, body=None):
    request = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    try:
        return urllib.request.urlopen(request)
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"Twigg {err.code}: {err.read().decode()}") from None


# Send only the new message. Twigg adds it to the chat, builds the context and streams the reply.
def send(text):
    global chat
    if chat is None:
        chat = json.load(twigg("/chats", {"namespace": f"twigg-demo/{user}", "title": text[:50]}))["id"]
    event = ""
    for line in twigg(f"/chats/{chat}/responses", {"model": MODEL, "input": [{"type": "prompt", "text": text}]}):
        line = line.decode().strip()
        if line.startswith("event:"):
            event = line[6:].strip()
        if not line.startswith("data:"):
            continue
        data = json.loads(line[5:])
        if event == "delta" and data.get("kind") == "text":
            print(data["text"], end="", flush=True)
        if event == "error":
            raise RuntimeError(data["message"])
    print("\n")


print("Type a message, or /user <name>, /new, /list, /open <n>.")
while True:
    try:
        line = input(f"{user}> ").strip()
    except (EOFError, KeyboardInterrupt):
        break
    if not line:
        continue
    command, arg = (line.split() + [""])[:2]
    try:
        if not line.startswith("/"):
            send(line)
        elif command == "/user":
            user, chat, listed = arg or "guest", None, []
        elif command == "/new":
            chat = None
        elif command == "/list":
            namespace = urllib.parse.quote(f"twigg-demo/{user}", safe="")
            listed = json.load(twigg(f"/chats?namespace={namespace}"))["data"]
            for i, c in enumerate(listed, 1):
                print(f"{i}. {c['title'] or 'Untitled'}  ({c['updated_at'][:16]})")
        elif command == "/open":
            if not (arg.isdigit() and 0 < int(arg) <= len(listed)):
                print("Run /list, then /open <n>")
                continue
            chat = listed[int(arg) - 1]["id"]
            for p in json.load(twigg(f"/chats/{chat}/history?limit=100"))["data"]:
                if p["part"]["type"] in ("prompt", "message"):
                    print(f"{'you' if p['role'] == 'user' else 'bot'}: {p['part']['text']}\n")
        else:
            print("Commands: /user <name>, /new, /list, /open <n>")
    except Exception as err:
        print(err, file=sys.stderr)
