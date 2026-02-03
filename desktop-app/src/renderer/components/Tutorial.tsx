import React, { useState } from 'react';

type TabId = 'requisitos' | 'instalacao' | 'uso' | 'problemas';

interface TabContent {
  id: TabId;
  title: string;
  icon: string;
}

const tabs: TabContent[] = [
  { id: 'requisitos', title: 'Requisitos', icon: '📋' },
  { id: 'instalacao', title: 'Instalação', icon: '⚙️' },
  { id: 'uso', title: 'Como Usar', icon: '🎬' },
  { id: 'problemas', title: 'Problemas', icon: '🔧' },
];

interface TutorialProps {
  onClose: () => void;
}

export function Tutorial({ onClose }: TutorialProps) {
  const [activeTab, setActiveTab] = useState<TabId>('requisitos');

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-primary/10 p-6 border-b flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-primary">📚 Tutorial Completo</h2>
            <p className="text-muted-foreground">Passo a passo para instalar e usar o app</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-2xl p-2"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-muted/30">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-background text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:bg-background/50'
              }`}
            >
              {tab.icon} {tab.title}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'requisitos' && <RequisitosTab />}
          {activeTab === 'instalacao' && <InstalacaoTab />}
          {activeTab === 'uso' && <UsoTab />}
          {activeTab === 'problemas' && <ProblemasTab />}
        </div>
      </div>
    </div>
  );
}

function RequisitosTab() {
  return (
    <div className="space-y-6">
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <h3 className="text-lg font-bold mb-2">⚠️ Antes de começar</h3>
        <p className="text-muted-foreground">
          Você precisa instalar 2 programas no seu computador para o app funcionar.
          Siga as instruções abaixo cuidadosamente.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Node.js */}
        <div className="border rounded-xl p-5">
          <div className="text-3xl mb-3">📦</div>
          <h4 className="font-bold text-lg mb-2">Node.js (LTS)</h4>
          <p className="text-sm text-muted-foreground mb-4">
            Motor JavaScript necessário para rodar o app.
          </p>
          <div className="bg-muted rounded-lg p-3 text-sm mb-3">
            <span className="text-primary font-mono">nodejs.org</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Baixe a versão <strong>LTS</strong> (recomendada).
          </p>
        </div>

        {/* FFmpeg */}
        <div className="border rounded-xl p-5">
          <div className="text-3xl mb-3">🎬</div>
          <h4 className="font-bold text-lg mb-2">FFmpeg</h4>
          <p className="text-sm text-muted-foreground mb-4">
            Processador de vídeo profissional.
          </p>
          <div className="bg-muted rounded-lg p-3 text-sm mb-3">
            <span className="text-primary font-mono">ffmpeg.org/download.html</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Baixe a versão "full" ou "essentials".
          </p>
        </div>
      </div>

      <div className="border rounded-xl p-5">
        <h4 className="font-bold mb-3">💻 Requisitos do Sistema</h4>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span className="text-primary">✓</span>
            Windows 10/11, macOS, ou Linux
          </li>
          <li className="flex items-center gap-2">
            <span className="text-primary">✓</span>
            4GB de RAM (8GB recomendado)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-primary">✓</span>
            GPU (opcional): NVIDIA, Intel ou AMD aceleram 10x
          </li>
        </ul>
      </div>
    </div>
  );
}

function InstalacaoTab() {
  return (
    <div className="space-y-6">
      {/* Step 1 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">1</span>
          <h4 className="font-bold">Baixar o Código</h4>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Acesse o repositório do projeto e baixe o código:
          </p>
          <div className="bg-muted rounded-lg p-3 font-mono text-sm">
            <p className="text-muted-foreground mb-1"># Opção 1: Git (recomendado)</p>
            <p className="text-primary">git clone [URL_DO_REPOSITORIO]</p>
            <p className="text-muted-foreground mt-3 mb-1"># Opção 2: Download ZIP</p>
            <p>Clique em "Code" → "Download ZIP"</p>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">2</span>
          <h4 className="font-bold">Instalar Node.js</h4>
        </div>
        <div className="p-4 space-y-3">
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Acesse <strong className="text-primary">nodejs.org</strong></li>
            <li>Clique no botão verde <strong>"LTS"</strong></li>
            <li>Execute o instalador baixado</li>
            <li>Clique <strong>Next → Next → Install</strong></li>
            <li>Aguarde e clique <strong>Finish</strong></li>
          </ol>
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
            ✅ Para verificar: Abra o Prompt de Comando e digite <code className="bg-muted px-1 rounded">node --version</code>
          </div>
        </div>
      </div>

      {/* Step 3 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">3</span>
          <h4 className="font-bold">Instalar FFmpeg (Windows)</h4>
        </div>
        <div className="p-4 space-y-3">
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Acesse <strong className="text-primary">ffmpeg.org/download.html</strong></li>
            <li>Clique em <strong>Windows builds from gyan.dev</strong></li>
            <li>Baixe <strong>ffmpeg-release-essentials.zip</strong></li>
            <li>Extraia para <code className="bg-muted px-1 rounded">C:\ffmpeg</code></li>
            <li>Adicione ao PATH:
              <ul className="list-disc list-inside ml-4 mt-2 space-y-1 text-muted-foreground">
                <li>Pesquise "Variáveis de ambiente"</li>
                <li>Clique em "Variáveis de Ambiente..."</li>
                <li>Em "Path", clique "Editar" → "Novo"</li>
                <li>Adicione <code className="bg-muted px-1 rounded">C:\ffmpeg\bin</code></li>
                <li>Clique OK em tudo</li>
              </ul>
            </li>
          </ol>
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
            ✅ Para verificar: Abra um <strong>novo</strong> Prompt e digite <code className="bg-muted px-1 rounded">ffmpeg -version</code>
          </div>
        </div>
      </div>

      {/* Step 4 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">4</span>
          <h4 className="font-bold">Rodar o App</h4>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Navegue até a pasta <code className="bg-muted px-1 rounded">desktop-app</code> do projeto:
          </p>
          <div className="bg-muted rounded-lg p-3 font-mono text-sm space-y-1">
            <p className="text-muted-foreground"># Entre na pasta</p>
            <p className="text-primary">cd desktop-app</p>
            <p className="text-muted-foreground mt-2"># OU simplesmente dê dois cliques em:</p>
            <p className="text-primary">start-app.bat</p>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-sm">
            💡 O script <strong>start-app.bat</strong> instala as dependências automaticamente na primeira vez.
          </div>
        </div>
      </div>
    </div>
  );
}

function UsoTab() {
  return (
    <div className="space-y-6">
      {/* Step 1 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">1</span>
          <h4 className="font-bold">Selecionar Template</h4>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground mb-3">
            Clique em <strong>"📁 Selecionar Template"</strong> e escolha uma imagem PNG ou JPG.
          </p>
          <div className="bg-muted rounded-lg p-3 text-sm">
            <p className="font-medium mb-2">⚠️ Importante:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>O template deve ter uma <strong>área verde pura</strong> (#00FF00)</li>
              <li>É onde o vídeo será inserido</li>
              <li>O app detecta automaticamente a área</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">2</span>
          <h4 className="font-bold">Escolher Pasta de Saída</h4>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground">
            Clique em <strong>"📂 Pasta de Saída"</strong> e selecione onde deseja salvar os vídeos processados.
          </p>
        </div>
      </div>

      {/* Step 3 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">3</span>
          <h4 className="font-bold">Adicionar Vídeos</h4>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground mb-3">
            Clique em <strong>"🎬 Adicionar Vídeos"</strong> e selecione um ou mais vídeos.
          </p>
          <p className="text-xs text-muted-foreground">
            Formatos suportados: MP4, MOV, AVI, MKV, WebM, HEVC, M4V
          </p>
        </div>
      </div>

      {/* Step 4 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">4</span>
          <h4 className="font-bold">Configurar Opções</h4>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-muted rounded-lg p-3">
              <p className="font-medium text-sm mb-1">🧠 IA Framing</p>
              <p className="text-xs text-muted-foreground">
                Detecta rostos e centraliza automaticamente no vídeo.
              </p>
            </div>
            <div className="bg-muted rounded-lg p-3">
              <p className="font-medium text-sm mb-1">⚡ Usar GPU</p>
              <p className="text-xs text-muted-foreground">
                Acelera o processamento em até 10x (NVIDIA/Intel/AMD).
              </p>
            </div>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="font-medium text-sm mb-2">Qualidade:</p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li><strong>⚡ Rápido:</strong> Menor qualidade, máxima velocidade</li>
              <li><strong>⚖️ Balanceado:</strong> Equilíbrio entre qualidade e velocidade</li>
              <li><strong>✨ Qualidade:</strong> Máxima qualidade, mais lento</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Step 5 */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-primary/10 p-4 flex items-center gap-3">
          <span className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold">5</span>
          <h4 className="font-bold">Processar!</h4>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground">
            Clique no botão <strong>"🚀 Processar"</strong> e aguarde. Você verá o progresso de cada vídeo em tempo real.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProblemasTab() {
  return (
    <div className="space-y-6">
      {/* FFmpeg not found */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-destructive/10 p-4">
          <h4 className="font-bold text-destructive">❌ "FFmpeg não encontrado"</h4>
        </div>
        <div className="p-4 space-y-2 text-sm">
          <p className="text-muted-foreground">Soluções:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Verifique se o FFmpeg está em <code className="bg-muted px-1 rounded">C:\ffmpeg\bin</code></li>
            <li>Verifique se adicionou ao PATH corretamente</li>
            <li>Reinicie o computador após alterar o PATH</li>
            <li>Teste com: <code className="bg-muted px-1 rounded">ffmpeg -version</code></li>
          </ol>
        </div>
      </div>

      {/* Node not found */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-destructive/10 p-4">
          <h4 className="font-bold text-destructive">❌ "node não é reconhecido"</h4>
        </div>
        <div className="p-4 space-y-2 text-sm">
          <p className="text-muted-foreground">Soluções:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Reinstale o Node.js de <strong className="text-primary">nodejs.org</strong></li>
            <li>Durante a instalação, marque "Add to PATH"</li>
            <li>Reinicie o computador</li>
          </ol>
        </div>
      </div>

      {/* Green area not detected */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-yellow-500/10 p-4">
          <h4 className="font-bold text-yellow-600">⚠️ "Área verde não detectada"</h4>
        </div>
        <div className="p-4 space-y-2 text-sm">
          <p className="text-muted-foreground">Verifique:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>A área verde deve ser <strong>#00FF00 puro</strong> (RGB: 0, 255, 0)</li>
            <li>Não pode ter degradê ou transparência</li>
            <li>Área mínima: 50x50 pixels</li>
            <li>Salve como PNG sem compressão</li>
          </ul>
        </div>
      </div>

      {/* GPU not detected */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-yellow-500/10 p-4">
          <h4 className="font-bold text-yellow-600">⚠️ "GPU não detectada"</h4>
        </div>
        <div className="p-4 space-y-2 text-sm">
          <p className="text-muted-foreground">Isso é normal! O app funciona sem GPU, apenas mais devagar.</p>
          <p className="text-muted-foreground">Para usar GPU:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>NVIDIA:</strong> Instale os drivers mais recentes</li>
            <li><strong>Intel:</strong> Use CPU Intel de 6ª geração ou superior</li>
            <li><strong>AMD:</strong> Instale os drivers AMD Adrenalin</li>
          </ul>
        </div>
      </div>

      {/* Video with black bars */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-yellow-500/10 p-4">
          <h4 className="font-bold text-yellow-600">⚠️ Vídeo com barras pretas</h4>
        </div>
        <div className="p-4 space-y-2 text-sm">
          <p className="text-muted-foreground">
            O app detecta e remove automaticamente bordas pretas/brancas dos vídeos.
            Se ainda aparecerem barras:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Ative <strong>🧠 IA Framing</strong> para melhor enquadramento</li>
            <li>Verifique se a proporção do template é compatível com seus vídeos</li>
          </ul>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <h4 className="font-bold mb-2">🆘 Ainda precisa de ajuda?</h4>
        <p className="text-sm text-muted-foreground">
          Entre em contato ou abra uma issue no repositório do projeto.
        </p>
      </div>
    </div>
  );
}
