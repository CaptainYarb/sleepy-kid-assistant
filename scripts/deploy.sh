#!/usr/bin/env bash
# Builds on this machine and ships to the Pi so nothing is compiled on the Pi.
# Usage: ./scripts/deploy.sh [user@host] [--setup]
set -euo pipefail

HOST="${SLEEPY_HOST:-pi@sleepy.local}"
SETUP=false
for arg in "$@"; do
	case "$arg" in
		--setup) SETUP=true ;;
		*) HOST="$arg" ;;
	esac
done
APP_DIR="sleepy"

cd "$(dirname "$0")/.."
npm run build

ssh "$HOST" "mkdir -p $APP_DIR/py"
# Named sources (no trailing slash) so --delete only prunes inside these folders, never data/ or the venv.
rsync -az --delete dist assets scripts deploy package.json package-lock.json "$HOST:$APP_DIR/"
rsync -az py/listen.py py/lcd.py py/fix_execstack.py py/requirements.txt "$HOST:$APP_DIR/py/"

if [ "$SETUP" = true ]; then
	ssh -t "$HOST" "cd $APP_DIR && ./scripts/setup-pi.sh"
else
	# -t gives sudo a terminal to ask for a password if the passwordless restart rule from setup-pi.sh is missing.
	# sync flushes the new files to the SD card, so a power cut right after a deploy cannot leave them half-written.
	ssh -t "$HOST" "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund --loglevel=error && sync && sudo systemctl restart sleepy"
fi
echo "Deployed to $HOST"
