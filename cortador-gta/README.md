# Cortador de lives de GTA → Shorts / Reels / TikTok

Pega uma live gravada (YouTube, Twitch ou Kick), acha os melhores momentos e entrega
de 5 a 10 clipes verticais (1080x1920, H.264/AAC), com legenda grande palavra por palavra.
É gratuito e roda 100% no seu computador. Não usa IA paga nem nuvem.

## Instalação (uma vez só)

**Windows:** dê dois cliques em `instalar.bat`. Ele instala, via winget, o que faltar:
ffmpeg, Deno (exigido pelo YouTube) e as bibliotecas Python. Precisa do Python 3.11+.

**macOS / Linux:** instale `ffmpeg` (e `deno`) e rode:
```bash
./instalar.sh
```

## Uso

```bash
cortar https://www.youtube.com/watch?v=XXXXXXXX
cortar https://www.twitch.tv/videos/123456789
cortar https://kick.com/canal/videos/abc...
cortar "C:\Videos\minha-live.mp4"        # também aceita arquivo local
```
No Windows, rode dentro da pasta do cortador (ou coloque a pasta no PATH).

O resultado fica em `cortes/<nome-da-live>/`:
- `01_titulo.mp4`, `02_...`: os clipes, numerados do melhor para o pior;
- `resumo.md`: para cada clipe, o minuto de origem na live (com link), o que acontece,
  a nota de 0 a 10 e sugestões de título e de legenda para postar;
- `.trabalho/`: vídeo baixado, transcrição e chat, guardados em cache. Rodar de novo
  o mesmo link é rápido. Pode apagar essa pasta depois.

### Opções úteis
| Opção | Para quê |
|---|---|
| `--clipes 5` | quantidade máxima de clipes |
| `--modelo medium` | transcrição mais precisa e mais lenta (`large-v3-turbo` é a melhor; com placa NVIDIA fica rápido) |
| `--facecam nao` | ignora a facecam |
| `--facecam 0.72,0.70,0.27,0.29` | posição manual da facecam: x, y, largura e altura em fração da tela |
| `--layout desfocado` | sem facecam: jogo inteiro no meio, com fundo desfocado, em vez do recorte |
| `--so-analisar` | só escolhe os momentos e escreve o `resumo.md`, sem renderizar |
| `--apagar-video` | apaga o vídeo baixado ao terminar (lives ocupam vários GB) |
| `--nome minha-live` | nome da pasta de saída |
| `--cookies chrome` | usa o login do seu navegador (chrome, firefox, edge) quando o YouTube pede "Sign in to confirm you're not a bot" |

## Como os momentos são escolhidos

Os critérios ficam em `presets/gta.toml`, e dá para editar à vontade. Cada meio segundo da
live recebe uma pontuação a partir de:
- **palavras ditas pelo streamer**, em 5 categorias: perseguição/fuga da polícia,
  batida/explosão, briga/tiroteio, reação (gritos, xingamentos) e risada;
- **volume** acima do normal daquela live (grito, reação);
- **impacto** no áudio: subida brusca de volume ou de graves (batida, explosão, tiro);
- **fala acelerada** em relação ao ritmo normal do streamer;
- **picos de chat**, quando o chat da live está disponível (YouTube e Twitch).

Depois ele pega os picos, monta clipes de 20 a 60 s que começam ~2,5 s antes da ação
subir e escreve um **gancho** em texto na tela nos 3 primeiros segundos. Se houver
facecam (rosto parado no mesmo canto da tela), o layout fica com a facecam em cima e o
jogo embaixo. Sem facecam, ele recorta 9:16 seguindo a região com mais movimento.

## Dicas e limites
- Tempo: a transcrição é a parte lenta. Numa CPU comum, conte ~10–30 min por hora de live
  com o modelo `small`. Com placa NVIDIA (CUDA), fica bem mais rápido.
- A nota é relativa à própria live. Revise os clipes antes de postar.
- Kick nem sempre deixa baixar, por causa da proteção do site. Nesse caso, baixe o vídeo
  de outro jeito e passe o arquivo.
- Se o YouTube der erro 403 ou "Sign in to confirm you're not a bot": rode com `--cookies chrome`
  (ou `firefox`/`edge`) e atualize o yt-dlp com `.venv/bin/pip install -U "yt-dlp[default]"`
  (no Windows: `.venv\Scripts\pip install -U "yt-dlp[default]"`).
- Só corte lives que você tem direito de usar (suas ou com permissão do streamer) e dê crédito.

Fonte das legendas: Anton (SIL Open Font License, em `fontes/OFL.txt`).
