#!/usr/bin/env python3
"""
cortar.py — corta uma live gravada em clipes verticais (9:16) com legenda.

Uso:
    cortar <link-ou-arquivo> [opções]

Pipeline:
    1. baixa o vídeo (yt-dlp)            -> cortes/<nome>/.trabalho/video.mp4
    2. extrai o áudio e mede volume/impactos
    3. transcreve em português (faster-whisper, com tempo por palavra)
    4. baixa o chat, se houver (chat-downloader)
    5. pontua cada trecho com o preset (presets/gta.toml) e escolhe 5-10 momentos
    6. renderiza cada clipe em 1080x1920 (H.264/AAC) com legenda palavra por palavra
    7. escreve cortes/<nome>/resumo.md
Tudo que é caro (download, transcrição, chat) fica em cache em .trabalho/.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tomllib
import unicodedata
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
for _fluxo in (sys.stdout, sys.stderr):  # console do Windows não é UTF-8 por padrão
    try:
        _fluxo.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
PASSO = 0.5  # resolução da linha do tempo de pontuação (s)
W, H = 1080, 1920


# ---------------------------------------------------------------- utilidades
def info(msg: str) -> None:
    print(f"» {msg}", flush=True)


def aviso(msg: str) -> None:
    print(f"  ! {msg}", flush=True)


def normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", " ", t).strip()


def slug(texto: str, limite: int = 60) -> str:
    s = normalizar(texto).replace(" ", "-")
    s = re.sub(r"-+", "-", s).strip("-")
    return (s[:limite].rstrip("-")) or "live"


def hms(seg: float) -> str:
    seg = int(round(seg))
    return f"{seg // 3600:02d}:{seg % 3600 // 60:02d}:{seg % 60:02d}"


def rodar(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


def ffprobe(caminho: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(caminho)],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def suavizar(x: np.ndarray, segundos: float) -> np.ndarray:
    n = max(1, int(round(segundos / PASSO)))
    if n <= 1 or len(x) == 0:
        return x
    k = np.ones(n) / n
    return np.convolve(x, k, mode="same")


def z_robusto(x: np.ndarray, mascara: np.ndarray | None = None) -> np.ndarray:
    base = x[mascara] if mascara is not None and mascara.any() else x
    if len(base) == 0:
        return np.zeros_like(x)
    med = np.median(base)
    mad = np.median(np.abs(base - med)) * 1.4826
    if mad < 1e-6:
        mad = np.std(base) or 1.0
    return (x - med) / mad


# ---------------------------------------------------------------- download
def runtimes_js() -> list[str]:
    # yt-dlp precisa de um runtime JavaScript para o YouTube (deno é o padrão)
    return [r for r in ("deno", "node", "bun") if shutil.which(r)]


COOKIES_NAVEGADOR = ""  # preenchido por --cookies (chrome, firefox, edge, brave...)


def ytdlp_base() -> list[str]:
    cmd = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings"]
    rts = runtimes_js()
    if rts:
        cmd += ["--js-runtimes", ",".join(rts)]
    if COOKIES_NAVEGADOR:
        cmd += ["--cookies-from-browser", COOKIES_NAVEGADOR]
    return cmd


def obter_info(link: str) -> dict:
    r = subprocess.run(ytdlp_base() + ["--dump-single-json", "--skip-download", link],
                       capture_output=True, text=True)
    if r.returncode != 0:
        erro = (r.stderr.strip().splitlines() or ["erro desconhecido"])[-1]
        dica = ""
        if "Sign in" in erro or "bot" in erro or "403" in erro:
            dica = ("\n  Dica: rode de novo com --cookies chrome (ou firefox/edge) para usar o login do "
                    "seu navegador,\n  e atualize o yt-dlp (veja o README).")
        raise SystemExit(f"não consegui abrir o link:\n  {erro}{dica}")
    return json.loads(r.stdout)


def baixar(link: str, trabalho: Path, altura_max: int) -> Path:
    destino = trabalho / "video.mp4"
    if destino.exists():
        info("vídeo já baixado (cache)")
        return destino
    info("baixando o vídeo (pode demorar em lives longas)...")
    fmt = f"bv*[height<={altura_max}]+ba/b[height<={altura_max}]/bv*+ba/b"
    rodar(ytdlp_base() + ["-f", fmt, "--merge-output-format", "mp4",
                          "-o", str(trabalho / "video.%(ext)s"), link])
    if not destino.exists():
        candidatos = sorted(trabalho.glob("video.*"))
        candidatos = [c for c in candidatos if c.suffix not in (".part", ".json", ".ytdl")]
        if not candidatos:
            raise SystemExit("download falhou: nenhum arquivo de vídeo encontrado")
        rodar(["ffmpeg", "-v", "error", "-y", "-i", str(candidatos[0]), "-c", "copy", str(destino)])
        candidatos[0].unlink()
    return destino


def baixar_chat(link: str, trabalho: Path) -> list[tuple[float, str]]:
    cache = trabalho / "chat.json"
    if cache.exists():
        return [tuple(m) for m in json.loads(cache.read_text(encoding="utf-8"))]
    msgs: list[tuple[float, str]] = []
    try:
        from chat_downloader import ChatDownloader  # type: ignore
        info("baixando o chat da live (se existir)...")
        for i, m in enumerate(ChatDownloader().get_chat(link, message_groups=["messages"])):
            t = m.get("time_in_seconds")
            if t is not None and t >= 0:
                msgs.append((float(t), m.get("message") or ""))
            if i and i % 5000 == 0:
                print(f"    {i} mensagens...", flush=True)
    except Exception as e:  # chat é opcional: Kick e alguns VODs não têm
        aviso(f"chat indisponível ({type(e).__name__}); seguindo só com áudio e fala")
        msgs = []
    cache.write_text(json.dumps(msgs, ensure_ascii=False), encoding="utf-8")
    if msgs:
        info(f"{len(msgs)} mensagens de chat")
    return msgs


# ---------------------------------------------------------------- áudio
def extrair_audio(video: Path, trabalho: Path) -> Path:
    wav = trabalho / "audio16k.wav"
    if not wav.exists():
        info("extraindo áudio...")
        rodar(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
               "-c:a", "pcm_s16le", str(wav)])
    return wav


def medir_audio(wav: Path, trabalho: Path) -> tuple[np.ndarray, np.ndarray]:
    """Retorna (volume em dB, energia de graves em dB) a cada PASSO segundos."""
    cache = trabalho / "audio_medidas.npz"
    if cache.exists():
        d = np.load(cache)
        return d["db"], d["grave"]
    info("medindo volume e impactos do áudio...")
    db, grave = [], []
    with wave.open(str(wav), "rb") as w:
        sr = w.getframerate()
        janela = int(sr * PASSO)
        freqs = np.fft.rfftfreq(janela, 1 / sr)
        faixa_grave = (freqs >= 30) & (freqs <= 250)
        while True:
            bruto = w.readframes(janela * 200)
            if not bruto:
                break
            x = np.frombuffer(bruto, dtype=np.int16).astype(np.float32) / 32768.0
            n = len(x) // janela
            if n == 0:
                break
            blocos = x[: n * janela].reshape(n, janela)
            rms = np.sqrt(np.mean(blocos ** 2, axis=1) + 1e-12)
            db.append(20 * np.log10(rms))
            esp = np.abs(np.fft.rfft(blocos * np.hanning(janela), axis=1)) ** 2
            grave.append(10 * np.log10(esp[:, faixa_grave].sum(axis=1) + 1e-12))
    db_a = np.concatenate(db) if db else np.zeros(0)
    gr_a = np.concatenate(grave) if grave else np.zeros(0)
    np.savez(cache, db=db_a, grave=gr_a)
    return db_a, gr_a


# ---------------------------------------------------------------- transcrição
def transcrever(wav: Path, trabalho: Path, cfg: dict, duracao: float) -> list[dict]:
    cache = trabalho / f"transcricao_{cfg['modelo']}.json"
    if cache.exists():
        info("transcrição já feita (cache)")
        return json.loads(cache.read_text(encoding="utf-8"))
    from faster_whisper import WhisperModel

    disp = cfg.get("dispositivo", "auto")
    if disp == "auto":
        try:
            import ctranslate2
            disp = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            disp = "cpu"
    tipo = "float16" if disp == "cuda" else "int8"
    info(f"transcrevendo em português (modelo {cfg['modelo']}, {disp}) — a parte mais lenta...")
    try:
        modelo = WhisperModel(cfg["modelo"], device=disp, compute_type=tipo)
    except Exception as e:
        aviso(f"GPU indisponível ({e}); usando CPU")
        modelo = WhisperModel(cfg["modelo"], device="cpu", compute_type="int8")
    segs, _ = modelo.transcribe(
        str(wav), language=cfg.get("idioma", "pt"), word_timestamps=True,
        vad_filter=True, beam_size=int(cfg.get("feixe", 1)),
        condition_on_previous_text=False,
    )
    saida, ultimo = [], -1
    for s in segs:
        palavras = [{"w": p.word.strip(), "s": round(p.start, 2), "e": round(p.end, 2)}
                    for p in (s.words or []) if p.word.strip()]
        saida.append({"s": round(s.start, 2), "e": round(s.end, 2), "t": s.text.strip(), "p": palavras})
        pct = int(100 * s.end / max(duracao, 1))
        if pct // 5 != ultimo:
            ultimo = pct // 5
            print(f"    {pct}%  ({hms(s.end)} de {hms(duracao)})", flush=True)
    cache.write_text(json.dumps(saida, ensure_ascii=False), encoding="utf-8")
    return saida


# ---------------------------------------------------------------- palavras-chave
@dataclass
class Padrao:
    categoria: str
    tokens: list[str]
    peso: float

    def casa(self, seq: list[str], i: int) -> bool:
        if i + len(self.tokens) > len(seq):
            return False
        for j, tk in enumerate(self.tokens):
            alvo = seq[i + j]
            if tk.endswith("*"):
                if not alvo.startswith(tk[:-1]):
                    return False
            elif alvo != tk:
                return False
        return True


def compilar_padroes(categorias: dict) -> list[Padrao]:
    out = []
    for nome, c in categorias.items():
        for p in c.get("palavras", []):
            toks = [t for t in re.split(r"\s+", p.lower().strip()) if t]
            toks = [normalizar(t.rstrip("*")) + ("*" if t.endswith("*") else "") for t in toks]
            if toks:
                out.append(Padrao(nome, toks, float(c.get("peso", 1.0))))
    return out


def tokens_com_tempo(transcricao: list[dict]) -> list[tuple[str, float, float]]:
    toks = []
    for seg in transcricao:
        for p in seg["p"]:
            for t in normalizar(p["w"]).split():
                toks.append((t, p["s"], p["e"]))
    return toks


def achar_palavras(toks, padroes: list[Padrao]):
    """Lista de (tempo, categoria, peso, trecho) para cada palavra-chave encontrada."""
    seq = [t[0] for t in toks]
    achados = []
    i = 0
    while i < len(seq):
        melhor = None
        for p in padroes:
            if p.casa(seq, i) and (melhor is None or len(p.tokens) > len(melhor.tokens)):
                melhor = p
        if melhor:
            n = len(melhor.tokens)
            achados.append((toks[i][1], melhor.categoria, melhor.peso, " ".join(seq[i:i + n])))
            i += n
        else:
            i += 1
    return achados


# ---------------------------------------------------------------- pontuação
@dataclass
class Sinais:
    total: np.ndarray
    volume: np.ndarray
    impacto: np.ndarray
    fala: np.ndarray
    palavras: np.ndarray
    chat: np.ndarray


def pontuar(db, grave, toks, achados, chat, pesos: dict, chat_cfg: dict, n: int) -> Sinais:
    def ajustar(x):
        x = np.asarray(x, dtype=float)
        return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)), constant_values=x.min() if len(x) else 0)

    db, grave = ajustar(db), ajustar(grave)
    # piso: silêncio digital (-120 dB) não pode distorcer médias nem virar "impacto"
    db = np.maximum(db, max(-60.0, float(np.percentile(db, 5))))
    grave = np.maximum(grave, float(np.percentile(grave, 10)))

    # 1) volume: quanto acima do nível típico desta live (gritos, reação)
    dbs = suavizar(db, 1.5)
    p50, p90 = np.percentile(dbs, 50), np.percentile(dbs, 90)
    volume = np.clip((dbs - p50) / max(p90 - p50, 1.0) * 1.5, 0, 4)

    # 2) impacto: subida brusca de volume/graves vs. os 3 s anteriores, que chega a um nível alto
    def subida(x):
        ant = np.array([np.median(x[max(0, i - 6):i]) if i > 0 else x[0] for i in range(len(x))])
        return np.maximum(x - ant, 0)
    alto = (db > np.percentile(db, 90)) | (grave > np.percentile(grave, 92))
    imp = np.maximum(subida(db), subida(grave)) * alto
    impacto = np.clip(suavizar(np.clip(imp / 8.0, 0, 4), 1.5) * 1.5, 0, 4)

    # 3) fala acelerada: palavras por segundo numa janela de 4 s
    cont = np.zeros(n)
    for _, s, _e in toks:
        k = int(s / PASSO)
        if 0 <= k < n:
            cont[k] += 1
    taxa = suavizar(cont, 4.0) / PASSO
    falando = taxa > 0.5
    fala = np.clip(z_robusto(taxa, falando), 0, 3) * falando

    # 4) palavras-chave (perseguição, batida, tiro, reação...), espalhadas por ~6 s
    kw = np.zeros(n)
    for t, _cat, peso, _txt in achados:
        k = int(t / PASSO)
        if 0 <= k < n:
            kw[k] += peso
    palavras = np.clip(suavizar(kw, 6.0) * (6.0 / PASSO) / 4.0, 0, 5)

    # 5) chat: mensagens por segundo (com atraso compensado), palavras de hype contam dobrado
    chat_s = np.zeros(n)
    if chat:
        hype = compilar_padroes({"chat": {"palavras": chat_cfg.get("palavras", []), "peso": 1}})
        atraso = float(pesos.get("chat_atraso", 6.0))
        for t, msg in chat:
            k = int((t - atraso) / PASSO)
            if 0 <= k < n:
                seq = normalizar(msg).split()
                bonus = 1.0 + any(p.casa(seq, i) for p in hype for i in range(len(seq)))
                chat_s[k] += bonus
        taxa_chat = suavizar(chat_s, 8.0)
        chat_s = np.clip(z_robusto(taxa_chat, taxa_chat > 0), 0, 4)

    total = (pesos.get("volume", 1) * volume + pesos.get("impacto", 1) * impacto
             + pesos.get("velocidade_fala", 0.5) * fala + pesos.get("palavras", 1) * palavras
             + pesos.get("chat", 1) * chat_s)
    total = suavizar(total, 3.0)
    return Sinais(total, volume, impacto, fala, palavras, chat_s)


# ---------------------------------------------------------------- escolha dos momentos
@dataclass
class Clipe:
    inicio: float
    fim: float
    pico: float
    forca: float
    nota: float = 0.0
    categorias: list[str] = field(default_factory=list)
    palavras: list[str] = field(default_factory=list)
    frase: str = ""
    sinais: dict = field(default_factory=dict)
    titulo: str = ""
    gancho: str = ""
    legenda_post: str = ""
    descricao: str = ""
    arquivo: str = ""

    @property
    def duracao(self):
        return self.fim - self.inicio


def ajustar_bordas(ini: float, fim: float, toks, transcricao, dur_total: float, dmin: float, dmax: float):
    # não começar no meio de uma palavra: recua para o início dela
    for _t, s, e in toks:
        if s < ini < e:
            ini = s - 0.1
            break
    # terminar no fim de uma frase, se der (até +4 s)
    for seg in transcricao:
        if seg["s"] < fim < seg["e"] and seg["e"] - fim <= 4 and seg["e"] - ini <= dmax:
            fim = seg["e"] + 0.3
            break
    for _t, s, e in toks:
        if s < fim < e:
            fim = e + 0.2
            break
    ini, fim = max(0.0, ini), min(dur_total, fim)
    if fim - ini < dmin:  # completa pelo fim (o gancho fica no começo)
        fim = min(dur_total, ini + dmin)
        ini = max(0.0, fim - dmin)
    if fim - ini > dmax:
        fim = ini + dmax
    return ini, fim


def escolher(sinais: Sinais, geral: dict, toks, transcricao, dur_total: float) -> list[Clipe]:
    s = sinais.total.copy()
    n = len(s)
    dmin, dmax = float(geral["duracao_min"]), float(geral["duracao_max"])
    antes, depois = float(geral["antes_da_acao"]), float(geral["depois_da_acao"])
    gap = float(geral["intervalo_minimo"])
    livre = np.ones(n, dtype=bool)
    base = float(np.median(s))
    clipes: list[Clipe] = []

    while len(clipes) < int(geral["max_clipes"]):
        cand = np.where(livre, s, -np.inf)
        k = int(np.argmax(cand))
        if not np.isfinite(cand[k]):
            break
        pico = cand[k]
        corte = base + 0.45 * (pico - base)
        # região da ação: enquanto a pontuação estiver alta perto do pico
        # (tolera quedas curtas, de até 4 s, entre dois picos do mesmo lance)
        def expandir(passo: int, limite: float) -> int:
            ultimo, i, fora = k, k, 0
            while 0 <= i + passo < n and livre[i + passo] and abs(i + passo - k) * PASSO < limite:
                i += passo
                if s[i] > corte:
                    ultimo, fora = i, 0
                else:
                    fora += 1
                    if fora * PASSO > 4.0:
                        break
            return ultimo
        a = expandir(-1, dmax * 0.6)
        b = expandir(+1, dmax)
        ini = a * PASSO - antes
        fim = b * PASSO + depois
        if fim - ini > dmax:  # ação longa: garante o pico dentro, começando antes dele
            ini = max(ini, k * PASSO - dmax * 0.45)
            fim = ini + dmax
        ini, fim = ajustar_bordas(ini, fim, toks, transcricao, dur_total, dmin, dmax)
        i0, i1 = int(ini / PASSO), max(int(ini / PASSO) + 1, int(fim / PASSO))
        trecho = s[i0:i1]
        forca = float(0.6 * pico + 0.4 * np.mean(np.sort(trecho)[-max(1, len(trecho) // 3):]) - base)

        if len(clipes) >= int(geral["min_clipes"]) and clipes and forca < float(geral["limiar_relativo"]) * clipes[0].forca:
            break
        # bloqueia a região (com folga) para não repetir o mesmo momento
        livre[max(0, int((ini - gap) / PASSO)):min(n, int((fim + gap) / PASSO))] = False
        if fim - ini < min(dmin, dur_total) - 0.5:
            continue
        clipes.append(Clipe(ini, fim, k * PASSO, forca))
        clipes.sort(key=lambda c: -c.forca)
    return sorted(clipes, key=lambda c: -c.forca)


# ---------------------------------------------------------------- textos (resumo, título, legenda)
def descrever(c: Clipe, sinais: Sinais, achados, transcricao, categorias: dict, geral: dict, idx: int, canal: str):
    i0, i1 = int(c.inicio / PASSO), int(c.fim / PASSO)
    fatia = lambda x: float(np.percentile(x[i0:i1], 90)) if i1 > i0 else 0.0
    c.sinais = {"volume": fatia(sinais.volume), "impacto": fatia(sinais.impacto),
                "fala": fatia(sinais.fala), "chat": fatia(sinais.chat)}
    c.nota = round(10 * (1 - math.exp(-max(c.forca, 0) / float(geral.get("escala_nota", 6)))), 1)

    soma: dict[str, float] = {}
    ditas = []
    for t, cat, peso, txt in achados:
        if c.inicio <= t <= c.fim:
            soma[cat] = soma.get(cat, 0) + peso
            if txt not in ditas:
                ditas.append(txt)
    c.categorias = [k for k, _ in sorted(soma.items(), key=lambda kv: -kv[1])]
    c.palavras = ditas[:8]

    # frase mais forte do trecho (a fala no momento de maior pontuação)
    melhor, melhor_v = "", -1.0
    for seg in transcricao:
        if seg["e"] >= c.inicio and seg["s"] <= c.fim and seg["t"]:
            a, b = int(seg["s"] / PASSO), max(int(seg["s"] / PASSO) + 1, int(seg["e"] / PASSO))
            v = float(np.mean(sinais.total[a:b])) if b <= len(sinais.total) else 0
            if v > melhor_v:
                melhor, melhor_v = seg["t"], v
    c.frase = (melhor[:110] + "…") if len(melhor) > 110 else melhor

    pistas = []
    if c.sinais["volume"] >= 1.5:
        pistas.append("pico de volume (grito/reação)")
    if c.sinais["impacto"] >= 1.5:
        pistas.append("impacto forte no áudio (batida, explosão ou tiro)")
    if c.sinais["fala"] >= 1.0:
        pistas.append("fala acelerada")
    if c.sinais["chat"] >= 1.5:
        pistas.append("chat explodiu")
    rotulos = [categorias[k]["rotulo"] for k in c.categorias[:2]]
    partes = []
    if rotulos:
        partes.append(" + ".join(rotulos) + ".")
    else:
        partes.append("Momento de ação detectado pelo áudio.")
    if pistas:
        texto = ", ".join(pistas)
        partes.append(texto[0].upper() + texto[1:] + ".")
    if c.frase:
        partes.append(f"Fala: “{c.frase}”")
    c.descricao = " ".join(partes)

    cat = c.categorias[0] if c.categorias else ("batida" if c.sinais["impacto"] >= 2.5 else "reacao")
    cat = cat if cat in categorias else next(iter(categorias))
    titulos = categorias[cat].get("titulos") or ["Momento insano no GTA 6 🔥"]
    ganchos = categorias[cat].get("ganchos") or ["ESPERA O FINAL"]
    c.titulo = titulos[idx % len(titulos)]
    c.gancho = ganchos[idx % len(ganchos)]
    tags = {"perseguicao": "#policia #perseguicao", "batida": "#batida #explosao",
            "tiroteio": "#tiroteio #acao", "reacao": "#reacao #react", "risada": "#humor #engracado"}
    credito = f" | 🎥 live de {canal}" if canal else ""
    palavras_frase = normalizar(c.frase).split()
    frase_boa = 3 <= len(palavras_frase) and len(set(palavras_frase)) >= 0.6 * len(palavras_frase) and len(c.frase) <= 90
    curto = f"“{c.frase}”" if frase_boa else re.sub(r"\s*#\w+", "", c.titulo).strip()
    c.legenda_post = (f"{curto}{credito}\n#GTA6 #GTAVI #GTA #gta6brasil {tags.get(cat, '')} #gameplay #shorts #fyp").strip()


# ---------------------------------------------------------------- vídeo
def detectar_facecam(video: Path, dur: float, vw: int, vh: int):
    """Procura um rosto que fica parado no mesmo lugar ao longo da live (= facecam) e
    acha a moldura dela pelas bordas que não mudam entre os quadros."""
    try:
        import cv2
    except ImportError:
        return None
    if not hasattr(cv2, "CascadeClassifier"):
        aviso("OpenCV sem detector de rostos; use --facecam x,y,l,a")
        return None
    cascata = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"))
    amostras, aw = 24, 640
    caixas, quadros = [], []
    for i in range(amostras):
        t = dur * (0.05 + 0.9 * i / (amostras - 1))
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
                            "-vf", f"scale={aw}:-2,format=gray", "-f", "rawvideo", "-"], capture_output=True)
        if not r.stdout:
            continue
        ah = len(r.stdout) // aw
        img = np.frombuffer(r.stdout[: aw * ah], dtype=np.uint8).reshape(ah, aw)
        quadros.append(img)
        for (x, y, w, h) in cascata.detectMultiScale(img, 1.1, 6, minSize=(20, 20)):
            caixas.append((i, x / aw, y / ah, w / aw, h / ah))
    if not caixas or not quadros:
        return None
    # agrupa rostos no mesmo lugar; facecam = grupo presente em >= 35% das amostras
    melhor = None
    for _, x0, y0, w0, h0 in caixas:
        cx, cy = x0 + w0 / 2, y0 + h0 / 2
        grupo = [b for b in caixas if abs(b[1] + b[3] / 2 - cx) < 0.05 and abs(b[2] + b[4] / 2 - cy) < 0.07]
        n_quadros = len({b[0] for b in grupo})
        if melhor is None or n_quadros > melhor[0]:
            melhor = (n_quadros, grupo)
    if melhor[0] < amostras * 0.35:
        return None
    fx, fy, fw, fh = np.median(np.array([b[1:] for b in melhor[1]]), axis=0)
    ah = quadros[0].shape[0]

    # bordas persistentes: pixel que é borda em >= 60% dos quadros
    fixas = np.mean([cv2.Canny(q, 60, 160) > 0 for q in quadros], axis=0) >= 0.6
    X0, X1 = int(fx * aw), int((fx + fw) * aw)
    Y0, Y1 = int(fy * ah), int((fy + fh) * ah)

    def procurar(eixo: str, inicio: int, passo: int, limite: int) -> int:
        i = inicio
        while 0 < i < limite - 1:
            i += passo
            j0, j1 = max(0, i - 1), i + 2  # faixa de ±1 px (o redimensionamento "treme" a borda)
            linha = fixas[Y0:Y1 + 1, j0:j1].any(axis=1) if eixo == "x" else fixas[j0:j1, X0:X1 + 1].any(axis=0)
            if linha.size and linha.mean() >= 0.5:
                return i
        return 0 if passo < 0 else limite

    esq = procurar("x", X0 - 2, -1, aw)
    dir_ = procurar("x", X1 + 2, +1, aw)
    topo = procurar("y", Y0 - 2, -1, ah)
    base = procurar("y", Y1 + 2, +1, ah)
    x, y, lw, la = esq / aw, topo / ah, (dir_ - esq) / aw, (base - topo) / ah
    plausivel = 1.1 * fw <= lw <= 0.6 and 1.05 * fh <= la <= 0.7
    if not plausivel:
        # sem moldura clara: estima ~3x o rosto, encostando na borda mais próxima
        lw, la = min(0.45, fw * 3.0), min(0.6, fh * 3.0)
        cx, cy = fx + fw / 2, fy + fh / 2
        x, y = cx - lw / 2, cy - la * 0.45
        if x < 0.12: x = 0.0
        if x + lw > 0.88: x = 1 - lw
        if y < 0.12: y = 0.0
        if y + la > 0.88: y = 1 - la
    x, y = min(max(x, 0.0), 1 - lw), min(max(y, 0.0), 1 - la)
    return tuple(float(round(v, 3)) for v in (x, y, lw, la))


def centro_da_acao(video: Path, ini: float, dur: float, vw: int, vh: int, facecam, peso_centro: float, larg_frac: float) -> float:
    """Posição horizontal (0-1, centro do recorte) onde há mais movimento no trecho."""
    aw, ah = 192, 108
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{ini:.2f}", "-t", f"{dur:.2f}", "-i", str(video),
                        "-vf", f"fps=4,scale={aw}:{ah},format=gray", "-f", "rawvideo", "-"], capture_output=True)
    q = len(r.stdout) // (aw * ah)
    if q < 3:
        return 0.5
    f = np.frombuffer(r.stdout[: q * aw * ah], dtype=np.uint8).reshape(q, ah, aw).astype(np.float32)
    mov = np.abs(np.diff(f, axis=0)).mean(axis=0)
    mov[int(ah * 0.72):, : int(aw * 0.25)] = 0  # ignora o minimapa do GTA (canto inferior esquerdo)
    if facecam:
        x, y, lw, la = facecam
        mov[int(y * ah):int((y + la) * ah) + 1, int(x * aw):int((x + lw) * aw) + 1] = 0
    col = mov.sum(axis=0)
    jan = max(1, int(aw * larg_frac))
    soma = np.convolve(col, np.ones(jan), mode="valid")
    if soma.max() <= 0:
        return 0.5
    melhor = (int(np.argmax(soma)) + jan / 2) / aw
    return float(peso_centro * 0.5 + (1 - peso_centro) * melhor)


def par(v: float) -> int:
    return max(2, int(v) // 2 * 2)


def montar_filtro(vw, vh, facecam, cfgv: dict, centro: float) -> str:
    if facecam:
        fx, fy, fl, fa = facecam
        cam_h = par(cfgv.get("altura_facecam", 640))
        jogo_h = H - cam_h
        cam = (f"[0:v]crop={par(fl * vw)}:{par(fa * vh)}:{par(fx * vw)}:{par(fy * vh)},"
               f"scale={W}:{cam_h}:force_original_aspect_ratio=increase,crop={W}:{cam_h}[cam]")
        gw, gh = par(vh * W / jogo_h), vh
        if gw > vw:
            gw, gh = vw, par(vw * jogo_h / W)
        gx = par(min(max(centro * vw - gw / 2, 0), vw - gw))
        gy = par((vh - gh) / 2)
        jogo = f"[0:v]crop={gw}:{gh}:{gx}:{gy},scale={W}:{jogo_h}[jogo]"
        return f"{cam};{jogo};[cam][jogo]vstack=inputs=2,setsar=1[base]"
    if cfgv.get("layout_sem_facecam") == "desfocado":
        return (f"[0:v]split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                f"boxblur=25:5,eq=brightness=-0.08[fundo];[b]scale={W}:-2[frente];"
                f"[fundo][frente]overlay=0:(H-h)/2,setsar=1[base]")
    cw = par(vh * 9 / 16)
    if cw > vw:
        cw = par(vw)
    cx = par(min(max(centro * vw - cw / 2, 0), vw - cw))
    return f"[0:v]crop={cw}:{vh}:{cx}:0,scale={W}:{H},setsar=1[base]"


def cor_ass(rrggbb: str) -> str:
    rrggbb = rrggbb.lstrip("#")
    return f"&H00{rrggbb[4:6]}{rrggbb[2:4]}{rrggbb[0:2]}".upper()


def quebrar(texto: str, largura: int = 22) -> str:
    linhas, atual = [], ""
    for p in texto.split():
        if atual and len(atual) + 1 + len(p) > largura:
            linhas.append(atual)
            atual = p
        else:
            atual = f"{atual} {p}".strip()
    if atual:
        linhas.append(atual)
    return r"\N".join(linhas)


def ass_tempo(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def gerar_ass(c: Clipe, palavras_orig, achados, sinais: Sinais, leg: dict, tem_facecam: bool, cfgv: dict) -> str:
    tam = int(leg.get("tamanho", 125))
    y = int(H * float(leg.get("altura", 0.62)))
    cor, dest = cor_ass(leg.get("cor", "FFFFFF")), cor_ass(leg.get("cor_destaque", "FFE500"))
    fonte = leg.get("fonte", "Anton")
    cont = int(leg.get("contorno", 9))
    topo_gancho = (int(cfgv.get("altura_facecam", 640)) + 40) if tem_facecam else 170
    linhas = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 2",
        "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
        "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Palavra,{fonte},{tam},{cor},{cor},&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,{cont},4,5,40,40,0,1",
        f"Style: Gancho,{fonte},{int(leg.get('gancho_tamanho', 78))},&H00000000,&H00000000,{dest},&H64000000,"
        f"0,0,0,0,100,100,1,0,3,18,0,8,60,60,{topo_gancho},1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    if leg.get("gancho", True) and c.gancho:
        linhas.append(f"Dialogue: 1,{ass_tempo(0)},{ass_tempo(3.0)},Gancho,,0,0,0,,"
                      f"{{\\fad(120,200)}}{quebrar(c.gancho.upper())}")

    chave_t = {round(t, 2) for t, *_ in achados if c.inicio <= t <= c.fim}
    palavras = [(w, s, e) for (w, s, e) in palavras_orig if c.inicio <= s < c.fim]
    for i, (w, s, e) in enumerate(palavras):
        txt = re.sub(r"[^\w!?'\-ÁÉÍÓÚÂÊÔÃÕÇáéíóúâêôãõçÀà]+", "", w)
        if not txt:
            continue
        if leg.get("maiusculas", True):
            txt = txt.upper()
        prox = palavras[i + 1][1] if i + 1 < len(palavras) else e + 0.5
        fim = min(max(e + 0.15, s + 0.25), prox, c.fim)
        k = int(s / PASSO)
        alto = k < len(sinais.volume) and sinais.volume[k] >= 2.0
        estilo_cor = f"\\c{dest}" if (round(s, 2) in chave_t or alto) else ""
        escala = min(100, int(100 * 9 / max(9, len(txt))))
        anim = f"\\fscx{int(escala * 1.18)}\\fscy{int(escala * 1.18)}\\t(0,90,\\fscx{escala}\\fscy{escala})"
        linhas.append(f"Dialogue: 0,{ass_tempo(s - c.inicio)},{ass_tempo(fim - c.inicio)},Palavra,,0,0,0,,"
                      f"{{\\an5\\pos({W // 2},{y}){anim}{estilo_cor}}}{txt}")
    return "\n".join(linhas) + "\n"


def renderizar(video: Path, c: Clipe, saida: Path, trabalho: Path, filtro: str, ass: str, cfgv: dict, fps: float):
    pasta = trabalho / "render"
    pasta.mkdir(exist_ok=True)
    fontes = pasta / "fontes"
    if not fontes.exists():
        shutil.copytree(AQUI / "fontes", fontes)
    (pasta / "legenda.ass").write_text(ass, encoding="utf-8")
    # caminhos relativos (cwd = pasta) evitam problemas de escape no Windows
    vf = f"{filtro};[base]ass=legenda.ass:fontsdir=fontes[v]"
    cmd = ["ffmpeg", "-v", "error", "-stats", "-y", "-ss", f"{c.inicio:.3f}", "-t", f"{c.duracao:.3f}",
           "-i", str(video.resolve()), "-filter_complex", vf, "-map", "[v]", "-map", "0:a:0?",
           "-af", f"loudnorm=I={cfgv.get('volume_alvo', -14)}:TP=-1.5:LRA=11",
           "-c:v", "libx264", "-preset", str(cfgv.get("preset_x264", "medium")), "-crf", str(cfgv.get("crf", 20)),
           "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", f"{min(fps, 60):.3f}",
           "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(saida.resolve())]
    rodar(cmd, cwd=pasta)


# ---------------------------------------------------------------- resumo
def link_tempo(link: str, t: float) -> str:
    if not link or not link.startswith("http"):
        return ""
    s = int(t)
    if "twitch.tv" in link:
        return f"{link.split('?')[0]}?t={s // 3600}h{s % 3600 // 60}m{s % 60}s"
    if "youtube.com" in link or "youtu.be" in link:
        return f"{link}{'&' if '?' in link else '?'}t={s}s"
    return ""


def escrever_resumo(pasta: Path, clipes: list[Clipe], meta: dict, categorias: dict):
    L = [f"# Cortes — {meta['titulo']}", ""]
    if meta.get("link"):
        L.append(f"- **Live:** {meta['link']}")
    if meta.get("canal"):
        L.append(f"- **Canal:** {meta['canal']}")
    L += [f"- **Duração da live:** {hms(meta['duracao'])}",
          f"- **Gerado em:** {dt.datetime.now().strftime('%d/%m/%Y %H:%M')} · modelo de transcrição `{meta['modelo']}`"
          f" · chat: {'sim' if meta['chat'] else 'não'} · facecam: {meta['facecam']}", "",
          "| # | Arquivo | Minuto na live | Duração | Nota | Tipo |", "|---|---|---|---|---|---|"]
    for i, c in enumerate(clipes, 1):
        tipo = ", ".join(categorias[k]["rotulo"].split(" /")[0] for k in c.categorias[:2]) or "ação (áudio)"
        L.append(f"| {i} | `{c.arquivo}` | {hms(c.inicio)} → {hms(c.fim)} | {c.duracao:.0f}s | **{c.nota:.1f}** | {tipo} |")
    L.append("")
    for i, c in enumerate(clipes, 1):
        lk = link_tempo(meta.get("link", ""), c.inicio)
        origem = f"[{hms(c.inicio)} → {hms(c.fim)}]({lk})" if lk else f"{hms(c.inicio)} → {hms(c.fim)}"
        L += [f"## {i:02d}. {c.titulo}", "",
              f"- **Arquivo:** `{c.arquivo}`",
              f"- **Minuto de origem:** {origem} (pico da ação em {hms(c.pico)})",
              f"- **O que acontece:** {c.descricao}",
              f"- **Nota:** {c.nota:.1f}/10 — volume {c.sinais['volume']:.1f} · impacto {c.sinais['impacto']:.1f}"
              f" · fala {c.sinais['fala']:.1f} · chat {c.sinais['chat']:.1f}"
              + (f" · palavras: {', '.join(c.palavras)}" if c.palavras else ""),
              *(["- ⚠️ **Momento fraco**: entrou só para completar o mínimo de clipes; avalie antes de postar."]
                if c.nota < 3 else []),
              f"- **Gancho na tela (0–3 s):** {c.gancho}",
              f"- **Título sugerido:** {c.titulo}",
              "- **Legenda para postar:**", "", "  ```", *[f"  {l}" for l in c.legenda_post.splitlines()], "  ```", ""]
    L += ["---", "_Notas são relativas a esta live (heurística de áudio + fala + chat). "
          "Confira os clipes antes de postar e dê crédito ao streamer._", ""]
    (pasta / "resumo.md").write_text("\n".join(L), encoding="utf-8")


# ---------------------------------------------------------------- principal
def carregar_preset(caminho: str) -> dict:
    p = Path(caminho)
    if not p.exists():
        p = AQUI / "presets" / (caminho if caminho.endswith(".toml") else caminho + ".toml")
    with open(p, "rb") as f:
        return tomllib.load(f)


def parse_facecam(valor: str):
    if valor in ("auto", "nao", "não", "no", ""):
        return valor
    partes = [float(x) for x in valor.split(",")]
    if len(partes) != 4:
        raise SystemExit("--facecam deve ser auto, nao ou x,y,largura,altura (frações de 0 a 1)")
    return tuple(partes)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="cortar", description="Corta uma live em clipes verticais com legenda.")
    ap.add_argument("fonte", help="link da live (YouTube, Twitch, Kick) ou caminho de um vídeo local")
    ap.add_argument("--nome", help="nome da pasta em cortes/ (padrão: título da live)")
    ap.add_argument("--preset", default="gta", help="preset de critérios (padrão: gta)")
    ap.add_argument("--clipes", type=int, help="número máximo de clipes (padrão do preset: 10)")
    ap.add_argument("--modelo", help="modelo Whisper: tiny, base, small, medium, large-v3-turbo")
    ap.add_argument("--facecam", help="auto | nao | x,y,largura,altura em frações (ex: 0.72,0.7,0.27,0.29)")
    ap.add_argument("--layout", choices=["corte", "desfocado"], help="layout quando não há facecam")
    ap.add_argument("--sem-chat", action="store_true", help="não baixar o chat")
    ap.add_argument("--cookies", metavar="NAVEGADOR", help="usa o login do navegador no download (chrome, firefox, edge)")
    ap.add_argument("--qualidade", type=int, default=1080, help="altura máxima do download (padrão 1080)")
    ap.add_argument("--saida", default=str(AQUI / "cortes"), help="pasta base de saída (padrão: cortes/)")
    ap.add_argument("--apagar-video", action="store_true", help="apaga o vídeo baixado ao terminar")
    ap.add_argument("--so-analisar", action="store_true", help="só escolhe os momentos e escreve o resumo")
    a = ap.parse_args(argv)

    for prog in ("ffmpeg", "ffprobe"):
        if not shutil.which(prog):
            raise SystemExit(f"{prog} não encontrado. Rode o instalador (veja o README).")

    global COOKIES_NAVEGADOR
    COOKIES_NAVEGADOR = a.cookies or ""
    cfg = carregar_preset(a.preset)
    geral, pesos, cfgv, leg = cfg["geral"], cfg["pesos"], cfg["video"], cfg["legenda"]
    cfgt, categorias = dict(cfg["transcricao"]), cfg["categorias"]
    if a.clipes:
        geral["max_clipes"] = a.clipes
        geral["min_clipes"] = min(geral["min_clipes"], a.clipes)
    if a.modelo:
        cfgt["modelo"] = a.modelo
    if a.layout:
        cfgv["layout_sem_facecam"] = a.layout
    facecam_opt = parse_facecam(a.facecam if a.facecam is not None else str(cfgv.get("facecam", "auto")))

    local = Path(a.fonte).expanduser()
    meta = {"link": "", "canal": "", "titulo": local.stem}
    if local.exists():
        nome = a.nome or slug(local.stem)
    else:
        meta["link"] = a.fonte
        info("lendo informações da live...")
        inf = obter_info(a.fonte)
        meta["titulo"] = inf.get("title") or "live"
        meta["canal"] = inf.get("uploader") or inf.get("channel") or ""
        nome = a.nome or slug(meta["titulo"])
    pasta = Path(a.saida) / nome
    trabalho = pasta / ".trabalho"
    trabalho.mkdir(parents=True, exist_ok=True)
    info(f"pasta de saída: {pasta}")

    if local.exists():
        video = local.resolve()
    else:
        video = baixar(a.fonte, trabalho, a.qualidade)

    pr = ffprobe(video)
    vs = next(s for s in pr["streams"] if s["codec_type"] == "video")
    vw, vh = int(vs["width"]), int(vs["height"])
    num, den = (vs.get("avg_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    dur = float(pr["format"]["duration"])
    meta["duracao"] = dur
    info(f"vídeo: {vw}x{vh} @ {fps:.0f} fps, {hms(dur)}")

    wav = extrair_audio(video, trabalho)
    db, grave = medir_audio(wav, trabalho)
    transcricao = transcrever(wav, trabalho, cfgt, dur)
    chat = [] if (a.sem_chat or not cfg.get("chat", {}).get("ativado", True) or not meta["link"]) \
        else baixar_chat(meta["link"], trabalho)

    toks = tokens_com_tempo(transcricao)
    palavras_orig = [(p["w"], p["s"], p["e"]) for seg in transcricao for p in seg["p"]]
    achados = achar_palavras(toks, compilar_padroes(categorias))
    info(f"{len(achados)} palavras-chave encontradas na fala")

    n = int(math.ceil(dur / PASSO))
    sinais = pontuar(db, grave, toks, achados, chat, pesos, cfg.get("chat", {}), n)
    clipes = escolher(sinais, geral, toks, transcricao, dur)
    if not clipes:
        raise SystemExit("nenhum momento encontrado (vídeo curto demais?)")
    info(f"{len(clipes)} momentos escolhidos")

    if facecam_opt == "auto":
        info("procurando facecam...")
        facecam = detectar_facecam(video, dur, vw, vh)
    elif isinstance(facecam_opt, tuple):
        facecam = facecam_opt
    else:
        facecam = None
    meta["facecam"] = ("sim (" + ", ".join(f"{v:.2f}" for v in facecam) + ")") if facecam else "não"
    info(f"facecam: {meta['facecam']}")
    meta["modelo"], meta["chat"] = cfgt["modelo"], bool(chat)

    canal = meta["canal"]
    for i, c in enumerate(clipes):
        descrever(c, sinais, achados, transcricao, categorias, geral, i, canal)
        c.arquivo = f"{i + 1:02d}_{slug(c.titulo, 40)}.mp4"

    if not a.so_analisar:
        for antigo in pasta.glob("[0-9][0-9]_*.mp4"):
            antigo.unlink()
        larg = (vh * W / (H - int(cfgv.get("altura_facecam", 640)))) / vw if facecam else (vh * 9 / 16) / vw
        for i, c in enumerate(clipes, 1):
            info(f"[{i}/{len(clipes)}] {hms(c.inicio)} → {hms(c.fim)} ({c.duracao:.0f}s) nota {c.nota} — {c.titulo}")
            centro = 0.5
            if facecam or cfgv.get("layout_sem_facecam", "corte") == "corte":
                centro = centro_da_acao(video, c.inicio, c.duracao, vw, vh, facecam,
                                        float(cfgv.get("peso_centro", 0.5)), min(1.0, larg))
            filtro = montar_filtro(vw, vh, facecam, cfgv, centro)
            ass = gerar_ass(c, palavras_orig, achados, sinais, leg, bool(facecam), cfgv)
            renderizar(video, c, pasta / c.arquivo, trabalho, filtro, ass, cfgv, fps)

    escrever_resumo(pasta, clipes, meta, categorias)
    if a.apagar_video and not local.exists():
        (trabalho / "video.mp4").unlink(missing_ok=True)
        (trabalho / "audio16k.wav").unlink(missing_ok=True)
    info(f"pronto! {len(clipes)} clipes + resumo.md em {pasta}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        raise SystemExit(f"erro ao rodar: {' '.join(map(str, e.cmd[:3]))}... (código {e.returncode})")
    except KeyboardInterrupt:
        raise SystemExit("\ninterrompido.")
