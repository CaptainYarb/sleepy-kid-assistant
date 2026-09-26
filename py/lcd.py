"""1602A LCD sidecar for a PCF8574 (HW-061) I2C backpack.

Reads JSON lines from stdin: {"l1": "...", "l2": "...", "backlight": true}
Usage: lcd.py <i2c_address, e.g. 0x27>
"""
import json
import sys
import time

from smbus2 import SMBus

COLS = 16
ROW_ADDRESS = (0x80, 0xC0)
# PCF8574 pin mapping on the HW-061: P0=RS, P1=RW, P2=E, P3=backlight, P4-P7=D4-D7
RS = 0x01
ENABLE = 0x04
BACKLIGHT = 0x08


class Lcd:
    def __init__(self, bus, address):
        self.bus = bus
        self.address = address
        self.backlight_bit = BACKLIGHT
        self.rows = [None, None]
        time.sleep(0.05)
        # HD44780 reset sequence to force 4-bit mode regardless of its current state.
        for nibble in (0x30, 0x30, 0x30, 0x20):
            self.write_nibble(nibble, 0)
            time.sleep(0.005)
        for command in (0x28, 0x0C, 0x06, 0x01):
            self.send(command, 0)
        time.sleep(0.002)

    def write_nibble(self, nibble, mode):
        value = (nibble & 0xF0) | mode | self.backlight_bit
        self.bus.write_byte(self.address, value | ENABLE)
        self.bus.write_byte(self.address, value & ~ENABLE)

    def send(self, value, mode):
        self.write_nibble(value & 0xF0, mode)
        self.write_nibble((value << 4) & 0xF0, mode)

    def set_row(self, row, text):
        text = text.ljust(COLS)[:COLS]
        if self.rows[row] == text:
            return
        self.rows[row] = text
        self.send(ROW_ADDRESS[row], 0)
        for char in text:
            self.send(ord(char) if ord(char) < 128 else ord("?"), RS)

    def set_backlight(self, on):
        self.backlight_bit = BACKLIGHT if on else 0
        self.bus.write_byte(self.address, self.backlight_bit)


def main():
    address = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x27
    with SMBus(1) as bus:
        lcd = Lcd(bus, address)
        for line in sys.stdin:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            lcd.set_backlight(bool(message.get("backlight")))
            lcd.set_row(0, message.get("l1", ""))
            lcd.set_row(1, message.get("l2", ""))
        lcd.set_backlight(False)


if __name__ == "__main__":
    main()
