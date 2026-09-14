#!/usr/bin/env bash
# Runs every version through the same scripted session against test/fake-twigg.mjs
# and checks each one prints exactly test/expected.txt. The key and URL come from a
# .env in a scratch directory, so .env loading is tested too. Versions whose
# toolchain is missing are skipped.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
port="${PORT:-4999}"
printf 'TWIGG_API_KEY=test-key\nTWIGG_BASE_URL=http://localhost:%s\n' "$port" > "$work/.env"

session=(
  "hello there"
  "/new"
  "tell me something long enough that the title has to be cut short 🌿🌿"
  "/list"
  "/user bob"
  "/open 1"
  "hi from bob"
  "/list"
  "/user guest"
  "/list"
  "/open 2"
  "and a follow-up"
  "/open 2"
  "/bogus"
)
feed() {
  for line in "${session[@]}"; do sleep 0.4; printf '%s\n' "$line"; done
  sleep 1
}

command -v go > /dev/null && go build -o "$work/twigg-chat-go" "$root/twigg-chat.go"
command -v cargo > /dev/null && cargo build -q --release --manifest-path "$root/rust/Cargo.toml"

failed=0
check() { # name, command...
  local name=$1
  shift
  if ! command -v "$1" > /dev/null; then echo "skip  $name"; return; fi
  PORT=$port node "$root/test/fake-twigg.mjs" &
  local fake=$!
  sleep 0.5
  (cd "$work" && feed | env -u TWIGG_API_KEY -u TWIGG_BASE_URL -u TWIGG_MODEL "$@" > "$work/$name.txt" 2>&1)
  kill $fake
  wait $fake 2> /dev/null
  # No expected.txt yet (or deleted to regenerate): the first version's output becomes it.
  [[ -f "$root/test/expected.txt" ]] || { cp "$work/$name.txt" "$root/test/expected.txt"; echo "wrote test/expected.txt from $name"; }
  if diff -u "$root/test/expected.txt" "$work/$name.txt"; then echo "pass  $name"; else echo "FAIL  $name"; failed=1; fi
}

check javascript node "$root/twigg-chat.mjs"
check python python3 "$root/twigg-chat.py"
check go "$work/twigg-chat-go"
check rust "$root/rust/target/release/twigg-chat"
exit $failed
