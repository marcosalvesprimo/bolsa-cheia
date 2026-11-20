#!/usr/bin/env bash
# Instalador para Linux e macOS. Uso: ./instalar.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
command -v python3 >/dev/null || { echo "Instale o Python 3.11+ primeiro."; exit 1; }
if ! command -v ffmpeg >/dev/null; then
  echo "ffmpeg não encontrado. Instale com:"
  echo "  macOS:  brew install ffmpeg"
  echo "  Ubuntu: sudo apt install ffmpeg"
  exit 1
fi
if ! command -v deno >/dev/null && ! command -v node >/dev/null; then
  echo "Aviso: o YouTube exige um runtime JavaScript para o yt-dlp. Instale o Deno:"
  echo "  curl -fsSL https://deno.land/install.sh | sh     (ou: brew install deno)"
fi
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt -q
mkdir -p "$HOME/.local/bin"
ln -sf "$DIR/cortar" "$HOME/.local/bin/cortar"
echo
echo "Pronto! Use:  cortar <link-da-live>"
echo "(se 'cortar' não for encontrado, adicione ~/.local/bin ao PATH ou rode $DIR/cortar)"
