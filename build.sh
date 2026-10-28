#!/usr/bin/env bash
set -e

pip install -r requirements.txt

# Vosk model
if [ ! -d "vosk-model/vosk-model-en-in-0.5" ]; then
  mkdir -p vosk-model
  curl -L -o vosk-model.zip https://alphacephei.com/vosk/models/vosk-model-en-in-0.5.zip
  unzip -q vosk-model.zip -d vosk-model
  rm vosk-model.zip
fi

# Piper voice files
curl -L -o en_US-amy-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -L -o en_US-amy-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json