"""Clear the executable-stack flag on a shared library, in place.

glibc 2.41+ (Pi OS Trixie) refuses to dlopen libraries that request an executable stack,
and the prebuilt libvosk.so does even though it never needs one.
Usage: fix_execstack.py <library.so>
"""
import struct
import sys

PT_GNU_STACK = 0x6474E551
PF_X = 0x1


def main():
    path = sys.argv[1]
    with open(path, "r+b") as f:
        header = f.read(64)
        if header[:4] != b"\x7fELF":
            sys.exit(f"{path} is not an ELF file")
        is_64 = header[4] == 2
        endian = "<" if header[5] == 1 else ">"
        if is_64:
            phoff, = struct.unpack_from(endian + "Q", header, 32)
            phentsize, phnum = struct.unpack_from(endian + "HH", header, 54)
            flags_offset = 4
        else:
            phoff, = struct.unpack_from(endian + "I", header, 28)
            phentsize, phnum = struct.unpack_from(endian + "HH", header, 42)
            flags_offset = 24

        for index in range(phnum):
            entry = phoff + index * phentsize
            f.seek(entry)
            p_type, = struct.unpack(endian + "I", f.read(4))
            if p_type != PT_GNU_STACK:
                continue
            f.seek(entry + flags_offset)
            flags, = struct.unpack(endian + "I", f.read(4))
            if flags & PF_X:
                f.seek(entry + flags_offset)
                f.write(struct.pack(endian + "I", flags & ~PF_X))
                print(f"Cleared executable stack flag on {path}")
            return


if __name__ == "__main__":
    main()
