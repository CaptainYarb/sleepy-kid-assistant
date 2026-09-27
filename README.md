# Sleepy Kid Assistant

A small, offline-first bedroom audio box for a Raspberry Pi 2 Model B. It replaces a commercial smart speaker:

- **Voice commands** ("hey buddy, play stories", "what's the weather") recognized offline with Vosk and answered with espeak-ng + MBROLA
- **MP3 folders** played on command or on a schedule
- **Internet radio** for "play music"
- **Parent portal** (Vue + Tailwind) behind a PIN, exposed through a Cloudflare tunnel
- **1602A LCD** showing what it is doing, with the volume in the corner

No database and no cron. Everything is JSON files plus one Node process.

```
Browser ──> Cloudflare Tunnel ──> Node (Hono) :8080
                                   ├─ mpv            (MP3s + radio, JSON IPC)
                                   ├─ py/listen.py   (arecord → Vosk → JSON lines)
                                   ├─ py/lcd.py      (JSON lines → I2C LCD)
                                   └─ data/*.json    (config, schedules, state)
```

## Hardware

| Part | Notes |
| --- | --- |
| Raspberry Pi 2 Model B | Pi OS Lite 32-bit (Bookworm) |
| USB Wi-Fi dongle | The Pi 2 has no built-in Wi-Fi |
| USB DAC or USB speaker | The onboard 3.5mm jack is noisy. Speakers that take only power over USB, with sound on a 3.5mm cable, go into the Pi's jack or a USB DAC |
| USB microphone | Any class-compliant mic |
| USB Bluetooth dongle | Only for the future Bluetooth speaker mode |
| 1602A LCD + HW-061 I2C backpack | Optional status screen |

These four USB devices use every port, and together they may draw more power than the Pi can supply. A powered USB hub avoids brownouts.

### LCD wiring

| HW-061 | Pi header |
| --- | --- |
| GND | pin 6 (GND) |
| VCC | pin 2 (5V) |
| SDA | pin 3 (GPIO2) |
| SCL | pin 5 (GPIO3) |

Check it with `i2cdetect -y 1`. It usually shows `27`, sometimes `3f`. Set the address in Settings if it differs. The backpack pulls the data lines up to 5V. The Pi normally tolerates this, but removing the backpack's two pull-up resistors, or adding a level shifter, is the safe option. Turn the blue potentiometer on the backpack if the text is invisible.

## Local development (macOS)

```sh
brew install mpv sox espeak-ng
npm install
npm run dev          # server on :8080, portal on http://localhost:5173
```

The dev server uses `dev-data/` (PIN `123456`) and ships with a few test tones. On a Mac the LCD only appears as the preview on the Now Playing page.

To try real voice recognition locally:

```sh
python3 -m venv py/.venv && py/.venv/bin/pip install -r py/requirements.txt
curl -LO https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip && mv vosk-model-small-en-us-0.15 py/model
```

Use `VOICE=off npm run dev` to skip the microphone, and use **Voice → Try a phrase** instead.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (tsx watch) + Vite |
| `npm run build` | Portal to `dist/web`, server to `dist/server` |
| `npm test` | Unit tests (vitest) |
| `npm run lint` | ESLint with autofix |
| `npm run typecheck` | Server + Vue type checks |

## Deploying to the Pi

1. Flash **Raspberry Pi OS Lite (32-bit)** with Raspberry Pi Imager. In the imager, set the hostname to `sleepy`, enable SSH, and add your Wi-Fi.
2. From this repo, do the first deploy, which also provisions the Pi:

   ```sh
   ./scripts/deploy.sh pi@sleepy.local --setup
   ```

   This installs mpv, Node 22, the Vosk model, ALSA mixing, the `sleepy` systemd service, and cloudflared. Find the first-boot PIN with `journalctl -u sleepy | grep PIN`.
3. Later deploys: `./scripts/deploy.sh pi@sleepy.local` (or set `SLEEPY_HOST`).

Copy audio into `~/media/<folder name>/` on the Pi, for example with `scp -r "Bedtime Stories" pi@sleepy.local:media/`. The library rescans every minute.

### Managing the service

The app runs as the `sleepy` systemd service. Every deploy restarts it automatically. Run these on the Pi:

```sh
systemctl status sleepy         # running or crashed, plus the last few log lines
sudo systemctl restart sleepy   # restart, e.g. after editing config.json by hand
sudo systemctl stop sleepy      # stop until the next start or reboot
sudo systemctl start sleepy
```

### Logs

```sh
journalctl -u sleepy -f                    # follow live, Ctrl+C to stop
journalctl -u sleepy -n 100                # last 100 lines
journalctl -u sleepy -b                    # everything since the last boot
journalctl -u sleepy --since "10 min ago"
journalctl -u sleepy -b --no-pager -o cat  # full-width lines, nothing cut off
journalctl -u sleepy | grep PIN            # the first-boot PIN
```

To follow the logs from your Mac without logging in: `ssh pi@sleepy.local 'journalctl -u sleepy -f'`.

Each line starts with a tag, so you can filter by area, for example `journalctl -u sleepy -f | grep -E '\[(voice|mic|vosk)\]'`:

| Tag | Area |
| --- | --- |
| `[server]`, `[config]` | Startup and the first-boot PIN |
| `[player]`, `[mpv]` | Playback, speech and audio devices |
| `[voice]`, `[mic]`, `[vosk]` | Wake phrase, what was heard, microphone and recognizer |
| `[scheduler]` | Schedules as they fire |
| `[weather]` | Weather lookups |
| `[lcd]` | LCD screen |

### Cloudflare tunnel

1. Go to Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel (cloudflared) and copy the token.
2. On the Pi, run `CLOUDFLARE_TUNNEL_TOKEN=<token> ~/sleepy/scripts/setup-pi.sh`, or run `sudo cloudflared service install <token>`.
3. Add a public hostname (for example `sleepy.example.com`) pointing to `http://localhost:8080`.

The portal PIN locks for 15 minutes after 5 wrong tries. Use at least 6 digits because the portal is on the public internet. Adding a Cloudflare Access policy in front of the hostname is a good extra layer.

## Data files

Everything lives in `DATA_DIR` (`~/sleepy/data` on the Pi):

- `config.json`: PIN, wake phrase, volume limits, folder voice names, radio stations, LCD settings, Bluetooth on/off, weather city and units
- `schedules.json`: `{ time, days, action: "play" | "stop", folder | stationId }`
- `state.json`: last volume, when each schedule last fired, and what was playing (so playback resumes after a power cut, crash or deploy; see **Settings → Resume after a power cut**)
- `secret`: session cookie signing key

You can edit these files by hand. Restart with `sudo systemctl restart sleepy`.

## Voice tips

- Grammar is closed. Only the words in the wake phrase, the fixed commands, folder spoken names and story titles are recognized, which is what makes it reliable on a Pi 2.
- Privacy: audio is processed in memory on the Pi and never saved or sent anywhere. The recognizer only knows the command words, and anything said without the wake phrase is discarded without being logged or shown.
- The Library page warns when a spoken name uses a word the model does not know. Spell numbers out ("book two", not "book 2").
- Say the wake phrase alone, wait for the chime, then say a command within 6 seconds. You can also say it in one go: "hey buddy, play stories".
- Commands: `play <folder>`, `play <story> [in <folder>]`, `play music`, `stop`, `pause`, `resume`, `next`, `louder`, `quieter`, `volume to max`, `what time is it`, `what day is it`, `what day is it tomorrow`, `what's the weather`.
- Stories are found by their filename minus the leading number (`01 the sleepy unicorn.mp3` is "the sleepy unicorn"). Any distinctive word works ("play unicorns in the sleep stories"), and playback continues through the folder afterwards.
- Answers are spoken with espeak-ng using the MBROLA `us3` voice, which setup-pi.sh builds and installs (plain espeak is used if it is missing). For weather, pick a city in **Settings → Weather** (forecasts come from Open-Meteo, no account needed). The time uses the Pi's timezone, so set it with `sudo raspi-config` → Localisation if it is off.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No sound | `aplay -l`, `speaker-test -D default -c 2`, `cat /etc/asound.conf` |
| Voice never triggers | `arecord -D default -f S16_LE -r 16000 -d 5 test.wav && aplay test.wav`, Voice page status |
| Wrong USB card picked | Re-run setup with `AUDIO_CARD=<name> MIC_CARD=<name>` (names from `aplay -l` / `arecord -l`) |
| LCD blank | `i2cdetect -y 1`, contrast potentiometer, address in Settings |
| Restart loop after a power cut (`ERR_INVALID_PACKAGE_CONFIG` or similar in the log) | A file written just before the power cut was corrupted. Run `rm -rf ~/sleepy/node_modules ~/sleepy/dist` on the Pi, then deploy again. If it keeps happening without a recent deploy, the SD card may be failing |
| Logs | `journalctl -u sleepy -f` |

## Roadmap

- Bluetooth speaker mode (bluez-alsa). The `bluetooth.enabled` setting already exists and is off by default: while it is off the server powers the adapter radio off to save power. For zero draw, unplug the dongle.
