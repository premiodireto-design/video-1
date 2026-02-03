# VideoTemplate Pro - Desktop App

Aplicativo desktop ultra-rápido para processamento de vídeos com templates.
Usa FFmpeg nativo com aceleração de GPU (NVIDIA NVENC, Intel QSV, AMD AMF).

## 🚀 Recursos

- **5-10x mais rápido** que a versão web
- **Aceleração GPU**: Usa sua placa de vídeo para encoding
- **Auto-update**: Atualizações automáticas quando disponíveis
- **Processamento paralelo**: Múltiplos vídeos simultâneos
- **Sem limite de tamanho**: Processa vídeos de qualquer duração
- **AI Framing**: Enquadramento inteligente com detecção de rostos

## 📦 Instalação para Usuários

### Opção 1: Download do Instalador (Recomendado)
1. Vá para [GitHub Releases](../../releases)
2. Baixe o arquivo `VideoTemplatePro-Setup-X.X.X.exe`
3. Execute o instalador
4. Pronto! O app será atualizado automaticamente

### Opção 2: Build Manual
Se preferir compilar você mesmo, siga as instruções em [BUILD.md](BUILD.md).

## 🎮 Aceleração de GPU

O app detecta automaticamente sua placa de vídeo:

| GPU | Encoder | Velocidade |
|-----|---------|------------|
| NVIDIA (GTX/RTX) | NVENC | 10-20x tempo real |
| Intel (integrada) | QSV | 5-10x tempo real |
| AMD (RX) | AMF | 5-10x tempo real |
| CPU (fallback) | libx264 | 2-3x tempo real |

## 🔄 Atualizações Automáticas

O aplicativo verifica automaticamente por atualizações:
- Ao iniciar o app
- A cada 30 minutos enquanto aberto

Quando uma nova versão estiver disponível, você verá uma notificação no canto inferior direito.

## 🛠️ Para Desenvolvedores

### Pré-requisitos
- Node.js 18+
- FFmpeg (será baixado automaticamente pelo script de build)

### Setup de Desenvolvimento
```bash
cd desktop-app
npm install
npm run dev
```

### Build para Distribuição
```bash
# Windows (mais fácil)
build.bat

# Ou manualmente
npm run build
npx electron-builder --win
```

### Estrutura do Projeto
```
desktop-app/
├── src/
│   ├── main/           # Processo principal (Electron)
│   │   ├── index.ts    # Entry point
│   │   ├── ffmpeg.ts   # FFmpeg wrapper com GPU
│   │   ├── autoUpdater.ts  # Sistema de auto-update
│   │   └── greenDetection.ts
│   ├── renderer/       # UI (React)
│   │   ├── App.tsx
│   │   └── components/
│   └── preload/        # Bridge seguro
├── ffmpeg-bin/         # Binários do FFmpeg (criado no build)
├── build.bat           # Script de build automatizado
├── electron-builder.yml # Configuração do builder
└── package.json
```

## 📡 Configuração do Auto-Update

Para que o auto-update funcione, você precisa:

1. Editar `electron-builder.yml`:
   ```yaml
   publish:
     provider: github
     owner: SEU_USUARIO_GITHUB
     repo: SEU_REPOSITORIO
   ```

2. Criar um Personal Access Token no GitHub com permissão `repo`

3. Usar o token no GitHub Actions (já configurado em `.github/workflows/build-desktop.yml`)

4. Criar uma Release no GitHub com tag `v1.0.0` (por exemplo)

## 📄 Licença

MIT - Use livremente!
