# Guia de Build - VideoTemplate Pro Desktop

Este guia explica como compilar o aplicativo desktop para distribuição.

## 🚀 Build Rápido (Windows)

A forma mais fácil é usar o script automatizado:

```bash
cd desktop-app
build.bat
```

O script irá:
1. ✅ Verificar/instalar dependências
2. ✅ Baixar FFmpeg automaticamente
3. ✅ Compilar o aplicativo
4. ✅ Gerar o instalador

O resultado estará em `desktop-app/release/`.

---

## 🔧 Build Manual

### Pré-requisitos

1. **Node.js 18+** 
   - Download: https://nodejs.org/

2. **FFmpeg binários**
   - Download: https://github.com/BtbN/FFmpeg-Builds/releases
   - Extraia `ffmpeg.exe` e `ffprobe.exe` para `desktop-app/ffmpeg-bin/`

### Passos

```bash
# 1. Navegue para a pasta
cd desktop-app

# 2. Instale dependências
npm install

# 3. Compile o código
npm run build

# 4. Gere o instalador
npm run build:win   # Para Windows
npm run build:mac   # Para macOS
npm run build:linux # Para Linux
```

### Estrutura após o build

```
desktop-app/
├── dist/           # Código compilado
├── release/        # Instaladores gerados
│   ├── VideoTemplatePro-Setup-1.0.0.exe
│   └── ...
└── ffmpeg-bin/     # Binários do FFmpeg
    ├── ffmpeg.exe
    └── ffprobe.exe
```

---

## 🔄 Configurando Auto-Update

Para que as atualizações cheguem automaticamente nos usuários:

### 1. Configure o electron-builder.yml

Edite o arquivo `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: SEU_USUARIO_GITHUB    # ← Seu usuário do GitHub
  repo: NOME_DO_REPOSITORIO    # ← Nome do repositório
  releaseType: release
```

### 2. Crie um Token de Acesso no GitHub

1. Vá para https://github.com/settings/tokens
2. Clique em "Generate new token (classic)"
3. Selecione o escopo `repo` (acesso completo)
4. Copie o token gerado

### 3. Configure o GitHub Actions

O token `GITHUB_TOKEN` já é fornecido automaticamente pelo GitHub Actions.
Se precisar de um token personalizado, adicione-o nos Secrets do repositório.

### 4. Publique uma Release

#### Opção A: Manual
1. Faça o build localmente
2. Vá para GitHub → Releases → Create Release
3. Crie uma tag como `v1.0.0`
4. Anexe o instalador `.exe`

#### Opção B: Automático (recomendado)
1. Crie uma tag no Git:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. O GitHub Actions irá:
   - Compilar o app
   - Baixar FFmpeg
   - Gerar o instalador
   - Publicar no GitHub Releases

---

## 🧪 Testando o Auto-Update

1. Compile uma versão `1.0.0`
2. Instale no seu computador
3. Compile uma nova versão `1.1.0` e publique
4. Abra o app instalado (1.0.0)
5. Ele deve mostrar a notificação de atualização

---

## ❓ Problemas Comuns

### "FFmpeg não encontrado"
- Verifique se `ffmpeg.exe` está em `desktop-app/ffmpeg-bin/`
- Ou se está em `C:\ffmpeg\bin\`

### "Erro de symlink" no Windows
- Execute o build como Administrador
- Ou ative o Modo de Desenvolvedor do Windows

### Build muito lento
- A primeira compilação é mais demorada
- Builds subsequentes são mais rápidos

### Auto-update não funciona
- Verifique se o `electron-builder.yml` está configurado
- Verifique se a Release está publicada no GitHub
- O auto-update só funciona no app instalado (não no dev mode)
