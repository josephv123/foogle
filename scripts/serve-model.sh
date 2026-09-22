#!/usr/bin/env bash
# Serve the local model with batching enabled.
#
# Why not just use Ollama? Ollama 0.31 hard-refuses to batch this architecture:
#   sched.go: "model architecture does not currently support parallel requests" arch=qwen35
# It silently starts llama-server with `-np 1`, so every Foogle request queues
# behind the last one. The limit is Ollama's scheduler, not the model — the same
# llama-server binary Ollama ships happily allocates 4 slots when we run it
# ourselves, which is worth ~2.4x aggregate throughput on this machine.
#
# Ollama.app can keep running; this listens on its own port and only reads
# Ollama's model blob off disk. Stop it with: scripts/serve-model.sh stop
set -euo pipefail

MODEL_NAME="${FOOGLE_LOCAL_MODEL:-qwen3.5:9b}"
PORT="${FOOGLE_LLAMA_PORT:-8899}"
# Total context, split evenly across slots (4 slots x 8192 here). Sections and
# result shards are small requests; 8k each is plenty.
CTX="${FOOGLE_LLAMA_CTX:-32768}"
# 4 is the measured sweet spot on M5/16GB: 1->21 tok/s, 2->38, 4->50, 6->44 (thrashes).
SLOTS="${FOOGLE_LLAMA_SLOTS:-4}"

RES="/Applications/Ollama.app/Contents/Resources"
BIN="${FOOGLE_LLAMA_BIN:-$RES/llama-server}"
OLLAMA="${FOOGLE_OLLAMA_BIN:-$RES/ollama}"

if [ "${1:-start}" = "stop" ]; then
  pkill -f "llama-server.*--port $PORT" && echo "stopped llama-server on :$PORT" || echo "nothing running on :$PORT"
  exit 0
fi

[ -x "$BIN" ] || { echo "llama-server not found at $BIN (set FOOGLE_LLAMA_BIN)" >&2; exit 1; }

# Resolve the GGUF blob Ollama already downloaded, so there's nothing new to fetch.
GGUF="$("$OLLAMA" show "$MODEL_NAME" --modelfile 2>/dev/null | awk '/^FROM \//{print $2; exit}')"
[ -n "${GGUF:-}" ] && [ -f "$GGUF" ] || {
  echo "could not resolve a GGUF for '$MODEL_NAME'. Is it pulled? (ollama list)" >&2; exit 1; }

if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "already serving on :$PORT"; exit 0
fi

# Free the VRAM Ollama is holding — two copies of a 6.6GB model do not fit in 16GB.
"$OLLAMA" stop "$MODEL_NAME" >/dev/null 2>&1 || true
"$OLLAMA" stop foogle-qwen  >/dev/null 2>&1 || true

LOG="${TMPDIR:-/tmp}/foogle-llama.log"
echo "starting llama-server: $MODEL_NAME  slots=$SLOTS ctx=$CTX port=$PORT"
nohup "$BIN" --model "$GGUF" --host 127.0.0.1 --port "$PORT" \
  -c "$CTX" -np "$SLOTS" -ngl 999 --flash-attn auto \
  -b 2048 -ub 512 --no-mmap --no-webui --jinja \
  > "$LOG" 2>&1 &

for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { echo "ready on :$PORT (log: $LOG)"; exit 0; }
  sleep 1
done
echo "timed out waiting for llama-server; see $LOG" >&2
tail -20 "$LOG" >&2
exit 1
