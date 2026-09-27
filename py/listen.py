"""Offline speech recognizer sidecar.

Reads 16 kHz mono S16_LE PCM from stdin and prints one JSON object per line:
  {"type": "oov", "words": [...]}  grammar words the model does not know
  {"type": "ready"}
  {"type": "text", "text": "..."}   each final recognition
Usage: listen.py <model_dir> <grammar_json>
"""
import json
import sys

from vosk import KaldiRecognizer, Model, SetLogLevel

SAMPLE_RATE = 16000
CHUNK_BYTES = 4000  # 125 ms of audio


def emit(message):
    print(json.dumps(message), flush=True)


def main():
    model_dir, grammar_json = sys.argv[1], sys.argv[2]
    SetLogLevel(-1)
    model = Model(model_dir)

    words = {word for phrase in json.loads(grammar_json) if phrase != "[unk]" for word in phrase.split()}
    unknown = sorted(word for word in words if model.vosk_model_find_word(word) == -1)
    emit({"type": "oov", "words": unknown})

    recognizer = KaldiRecognizer(model, SAMPLE_RATE, grammar_json)
    emit({"type": "ready"})

    while True:
        data = sys.stdin.buffer.read(CHUNK_BYTES)
        if not data:
            break
        if recognizer.AcceptWaveform(data):
            text = json.loads(recognizer.Result()).get("text", "")
            if text:
                emit({"type": "text", "text": text})


if __name__ == "__main__":
    main()
