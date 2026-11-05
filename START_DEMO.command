#!/bin/zsh

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "FoodSafe Intelligence needs Node.js 18 or newer."
  echo "Install Node.js, then double-click this file again."
  read "?Press Return to close."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "FoodSafe Intelligence needs Python 3 for backend processing."
  echo "Install Python 3, then double-click this file again."
  read "?Press Return to close."
  exit 1
fi

echo "Starting FoodSafe Intelligence…"
echo "The application will open at http://127.0.0.1:4173"
echo "Keep this window open during the demo. Press Control-C to stop."
echo ""

node server.js &
server_pid=$!
trap 'kill $server_pid 2>/dev/null' INT TERM EXIT

for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:4173/api/health >/dev/null 2>&1; then
    open http://127.0.0.1:4173/#/overview
    wait $server_pid
    exit $?
  fi
  sleep 0.2
done

echo "The local server did not become ready. Run: node server.js"
kill $server_pid 2>/dev/null
read "?Press Return to close."
exit 1
