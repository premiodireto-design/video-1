# VideoTemplate Pro - Desktop App

Aplicativo desktop ultra-rápido para processamento de vídeos com templates.
Usa FFmpeg nativo com aceleração de GPU (NVIDIA NVENC, Intel QSV, AMD AMF).

## 🚀 Recursos

- **5-10x mais rápido** que a versão web
- **Aceleração GPU**: Usa sua placa de vídeo para encoding
- **Processamento paralelo**: Múltiplos vídeos simultâneos
- **Sem limite de tamanho**: Processa vídeos de qualquer duração
- **Suporte a todos os codecs**: H.264, H.265/HEVC, VP9, AV1, etc.

## 📦 Instalação

### Windows
1. Baixe o instalador: `VideoTemplatePro-Setup.exe`
2. Execute e siga as instruções
3. O FFmpeg será instalado automaticamente

### macOS
1. Baixe: `VideoTemplatePro.dmg`
2. Arraste para Applications
3. Na primeira execução, clique com botão direito > Abrir

### Linux
```bash
# Debian/Ubuntu
sudo dpkg -i videotemplate-pro_1.0.0_amd64.deb

# Ou use AppImage (sem instalação)
chmod +x VideoTemplatePro.AppImage
./VideoTemplatePro.AppImage
```

## 🎮 Aceleração de GPU

O app detecta automaticamente sua placa de vídeo:

| GPU | Encoder | Velocidade |
|-----|---------|------------|
| NVIDIA (GTX/RTX) | NVENC | 10-20x tempo real |
| Intel (integrada) | QSV | 5-10x tempo real |
| AMD (RX) | AMF | 5-10x tempo real |
| CPU (fallback) | libx264 | 2-3x tempo real |

## 🛠️ Desenvolvimento

### Pré-requisitos
- Node.js 18+
- FFmpeg instalado no sistema

### Setup
```bash
cd desktop-app
npm install
npm run dev
```

### Build
```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## 📁 Estrutura

```
desktop-app/
├── src/
│   ├── main/           # Processo principal (Electron)
│   │   ├── index.ts    # Entry point
│   │   ├── ffmpeg.ts   # FFmpeg wrapper com GPU
│   │   └── ipc.ts      # Comunicação com renderer
│   ├── renderer/       # UI (React)
│   │   └── ...
│   └── preload/        # Bridge seguro
├── package.json
└── electron-builder.yml
```

## ⚙️ Configuração FFmpeg

O app usa estas flags para máxima performance:

```bash
# NVIDIA NVENC (mais rápido)
-c:v h264_nvenc -preset p4 -tune hq -rc vbr -cq 23

# Intel QSV
-c:v h264_qsv -preset faster -global_quality 23

# AMD AMF
-c:v h264_amf -quality speed -rc cqp -qp 23

# CPU (fallback)
-c:v libx264 -preset veryfast -crf 23
```

## 📄 Licença

MIT - Use livremente!
