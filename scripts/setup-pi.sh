#!/usr/bin/env bash
# One-time Raspberry Pi provisioning, run on the Pi from the app folder. Safe to re-run.
# Optional env: MEDIA_DIR, AUDIO_CARD, MIC_CARD, CLOUDFLARE_TUNNEL_TOKEN
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MEDIA_DIR="${MEDIA_DIR:-$HOME/media}"
VOSK_MODEL="vosk-model-small-en-us-0.15"

step() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }

step "Installing system packages"
sudo apt-get update
sudo apt-get install -y mpv alsa-utils python3-venv python3-pip i2c-tools bluez libatomic1 espeak-ng unzip curl

step "Enabling I2C for the LCD and Bluetooth control"
sudo raspi-config nonint do_i2c 0
sudo usermod -aG i2c,audio,bluetooth "$USER"

step "Installing Node.js 22 (armv7l)"
NODE_TARBALL="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-armv7l\.tar\.xz$/ {print $2}')"
NODE_DIR="/opt/${NODE_TARBALL%.tar.xz}"
if [ ! -d "$NODE_DIR" ]; then
	curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE_TARBALL" | sudo tar -xJ -C /opt
fi
sudo ln -sfn "$NODE_DIR" /opt/node
for bin in node npm npx; do
	sudo ln -sf "/opt/node/bin/$bin" "/usr/local/bin/$bin"
done
node --version

step "Installing app dependencies"
mkdir -p "$APP_DIR/data" "$MEDIA_DIR"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)

step "Setting up Python sidecars (Vosk + LCD)"
python3 -m venv "$APP_DIR/py/.venv"
"$APP_DIR/py/.venv/bin/pip" install --quiet -r "$APP_DIR/py/requirements.txt"
for lib in "$APP_DIR"/py/.venv/lib/python3*/site-packages/vosk/libvosk.so; do
	"$APP_DIR/py/.venv/bin/python" "$APP_DIR/py/fix_execstack.py" "$lib"
done
if [ ! -d "$APP_DIR/py/model" ]; then
	tmp="$(mktemp -d)"
	curl -fsSL -o "$tmp/model.zip" "https://alphacephei.com/vosk/models/$VOSK_MODEL.zip"
	unzip -q "$tmp/model.zip" -d "$tmp"
	mv "$tmp/$VOSK_MODEL" "$APP_DIR/py/model"
	rm -rf "$tmp"
fi

step "Installing the MBROLA speech voice"
# Raspbian does not package the mbrola engine, so it is built from source; the us3 voice is what the app speaks with.
if ! command -v mbrola > /dev/null; then
	sudo apt-get install -y build-essential
	tmp="$(mktemp -d)"
	curl -fsSL https://github.com/numediart/MBROLA/archive/refs/heads/master.tar.gz | tar -xz -C "$tmp"
	make -C "$tmp/MBROLA-master"
	sudo install -m 755 "$tmp/MBROLA-master/Bin/mbrola" /usr/local/bin/mbrola
	rm -rf "$tmp"
fi
if [ ! -f /usr/share/mbrola/us3/us3 ]; then
	sudo mkdir -p /usr/share/mbrola/us3
	sudo curl -fsSL -o /usr/share/mbrola/us3/us3 https://raw.githubusercontent.com/numediart/MBROLA-voices/master/data/us3/us3
fi

step "Configuring ALSA"
# Skip the Pi's onboard jack and HDMI outputs so the USB DAC and USB mic are picked by default.
AUDIO_CARD="${AUDIO_CARD:-$(aplay -l | awk -F'[: ]+' '/^card/ && !/Headphones|HDMI|hdmi/ {print $3; exit}')}"
MIC_CARD="${MIC_CARD:-$(arecord -l | awk -F'[: ]+' '/^card/ {print $3; exit}')}"
# Many USB speakers only draw power over USB and carry sound on a 3.5mm cable into the onboard jack.
if [ -z "$AUDIO_CARD" ] && aplay -l | grep -q '^card .*: Headphones '; then
	AUDIO_CARD="Headphones"
	echo "No USB speaker found, using the Pi's 3.5mm headphone jack."
fi
if [ -z "$AUDIO_CARD" ] || [ -z "$MIC_CARD" ]; then
	echo "Could not find a USB speaker ($AUDIO_CARD) or mic ($MIC_CARD). Plug them in, then re-run with AUDIO_CARD=<name> MIC_CARD=<name>."
	aplay -l || true
	arecord -l || true
	exit 1
fi
echo "Speaker: $AUDIO_CARD  Mic: $MIC_CARD"
# Chimes and speech must play over music. The onboard jack has 8 hardware subdevices that mix on their own
# (and it rejects dmix), while a USB DAC has one, so only USB cards get the dmix software mixer.
if [ "$AUDIO_CARD" = "Headphones" ]; then
	PLAYBACK_PCM="hw:$AUDIO_CARD,0"
	DMIX_BLOCK=""
else
	PLAYBACK_PCM="dmixer"
	DMIX_BLOCK="pcm.dmixer {
	type dmix
	ipc_key 1024
	ipc_perm 0666
	slave { pcm \"hw:$AUDIO_CARD,0\"; rate 48000; }
}"
fi
sudo tee /etc/asound.conf > /dev/null <<ASOUND
$DMIX_BLOCK
pcm.!default {
	type asym
	playback.pcm { type plug; slave.pcm "$PLAYBACK_PCM"; }
	capture.pcm { type plug; slave.pcm "hw:$MIC_CARD,0"; }
}
ctl.!default { type hw; card $AUDIO_CARD; }
ASOUND

step "Installing the systemd service"
sed -e "s|__USER__|$USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__MEDIA_DIR__|$MEDIA_DIR|g" \
	"$APP_DIR/deploy/sleepy.service" | sudo tee /etc/systemd/system/sleepy.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable sleepy
sudo systemctl restart sleepy
# Lets deploy.sh restart the app over SSH without a password prompt; this one command is all the rule allows.
# Validated before installing, because a broken file in sudoers.d would lock sudo out entirely.
rule_file="$(mktemp)"
echo "$USER ALL=(root) NOPASSWD: $(command -v systemctl) restart sleepy" > "$rule_file"
if sudo visudo -cf "$rule_file" > /dev/null; then
	sudo install -m 440 -o root -g root "$rule_file" /etc/sudoers.d/sleepy-restart
fi
rm -f "$rule_file"

step "Installing cloudflared"
if ! command -v cloudflared > /dev/null; then
	tmp="$(mktemp -d)"
	curl -fsSL -o "$tmp/cloudflared.deb" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-armhf.deb
	sudo dpkg -i "$tmp/cloudflared.deb"
	rm -rf "$tmp"
fi
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ] && ! systemctl is-enabled cloudflared > /dev/null 2>&1; then
	sudo cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN"
elif ! systemctl is-enabled cloudflared > /dev/null 2>&1; then
	echo "Tunnel not configured yet. Re-run with CLOUDFLARE_TUNNEL_TOKEN=<token> (see README)."
fi

# Setup writes hundreds of files; flush them to the SD card so a power cut straight afterwards cannot corrupt them.
sync

step "Done"
echo "Portal: http://$(hostname).local:8080"
echo "The first-boot PIN is printed in: journalctl -u sleepy | grep PIN"
echo "Log out and back in (or reboot) so the i2c/audio/bluetooth group changes apply."
