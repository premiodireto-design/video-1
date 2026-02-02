import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Monitor, 
  Download, 
  Github, 
  Terminal, 
  Package, 
  Rocket,
  CheckCircle2,
  Copy,
  ExternalLink,
  Zap,
  HardDrive,
  Cpu
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export default function DesktopAppTutorial() {
  const { toast } = useToast();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copiado!',
      description: `${label} copiado para a área de transferência`,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container py-8 max-w-4xl">
        {/* Hero Section */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full mb-4">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-medium text-primary">10x mais rápido que a versão web</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            App Desktop - VideoTemplate Pro
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Guia completo para compilar e distribuir o aplicativo desktop com aceleração GPU
          </p>
        </div>

        {/* Benefits */}
        <div className="grid md:grid-cols-3 gap-4 mb-10">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <Cpu className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">Aceleração GPU</h3>
              <p className="text-sm text-muted-foreground">
                NVIDIA NVENC, Intel QSV, AMD AMF
              </p>
            </CardContent>
          </Card>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <HardDrive className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">Sem Limites</h3>
              <p className="text-sm text-muted-foreground">
                Processe vídeos de qualquer tamanho
              </p>
            </CardContent>
          </Card>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <Zap className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">Ultra Rápido</h3>
              <p className="text-sm text-muted-foreground">
                5-20x mais rápido que navegador
              </p>
            </CardContent>
          </Card>
        </div>

        <Separator className="my-8" />

        {/* Step by Step Guide */}
        <div className="space-y-8">
          {/* Step 1: Prerequisites */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                  1
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Pré-requisitos
                  </CardTitle>
                  <CardDescription>Instale as ferramentas necessárias</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Node.js 18+</p>
                    <p className="text-sm text-muted-foreground mb-2">Runtime JavaScript para compilar o app</p>
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer" className="gap-2">
                        <Download className="h-4 w-4" />
                        Baixar Node.js
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">Git</p>
                    <p className="text-sm text-muted-foreground mb-2">Controle de versão para clonar o projeto</p>
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://git-scm.com/downloads" target="_blank" rel="noopener noreferrer" className="gap-2">
                        <Download className="h-4 w-4" />
                        Baixar Git
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">FFmpeg</p>
                    <p className="text-sm text-muted-foreground mb-2">Engine de processamento de vídeo</p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" target="_blank" rel="noopener noreferrer" className="gap-2">
                          <Download className="h-4 w-4" />
                          Windows
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href="https://evermeet.cx/ffmpeg/" target="_blank" rel="noopener noreferrer" className="gap-2">
                          <Download className="h-4 w-4" />
                          macOS
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href="https://ffmpeg.org/download.html#build-linux" target="_blank" rel="noopener noreferrer" className="gap-2">
                          <Download className="h-4 w-4" />
                          Linux
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                  ⚠️ Importante para Windows: Após baixar o FFmpeg, extraia e adicione a pasta <code className="bg-muted px-1 rounded">bin</code> ao PATH do sistema.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Step 2: GitHub Setup */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                  2
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Github className="h-5 w-5" />
                    Criar Conta no GitHub
                  </CardTitle>
                  <CardDescription>Configure seu repositório</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">2.1</Badge>
                  <div>
                    <p className="font-medium">Crie uma conta no GitHub</p>
                    <p className="text-sm text-muted-foreground">Acesse github.com e clique em "Sign up"</p>
                    <Button variant="link" className="h-auto p-0 text-primary" asChild>
                      <a href="https://github.com/signup" target="_blank" rel="noopener noreferrer">
                        github.com/signup <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">2.2</Badge>
                  <div>
                    <p className="font-medium">Crie um novo repositório</p>
                    <p className="text-sm text-muted-foreground">Clique no "+" no canto superior direito → "New repository"</p>
                    <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                      <li>• Nome: <code className="bg-muted px-1 rounded">videotemplate-pro-desktop</code></li>
                      <li>• Visibilidade: Public (para downloads) ou Private</li>
                      <li>• NÃO marque "Add a README file"</li>
                    </ul>
                  </div>
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* Step 3: Clone and Build */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                  3
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5" />
                    Clonar e Compilar
                  </CardTitle>
                  <CardDescription>Execute os comandos no terminal</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">3.1 Clone o projeto do Lovable para seu computador:</p>
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
                    <code className="flex-1 overflow-x-auto">git clone https://github.com/SEU-USUARIO/SEU-PROJETO.git</code>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={() => copyToClipboard('git clone https://github.com/SEU-USUARIO/SEU-PROJETO.git', 'Comando')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    💡 Substitua SEU-USUARIO e SEU-PROJETO pelo seu usuário e nome do repositório
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">3.2 Entre na pasta do app desktop:</p>
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
                    <code className="flex-1">cd SEU-PROJETO/desktop-app</code>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={() => copyToClipboard('cd SEU-PROJETO/desktop-app', 'Comando')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">3.3 Instale as dependências:</p>
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
                    <code className="flex-1">npm install</code>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8 flex-shrink-0"
                      onClick={() => copyToClipboard('npm install', 'Comando')}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">3.4 Compile para seu sistema operacional:</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
                      <Badge className="flex-shrink-0">Windows</Badge>
                      <code className="flex-1">npm run build:win</code>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={() => copyToClipboard('npm run build:win', 'Comando Windows')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
                      <Badge className="flex-shrink-0">macOS</Badge>
                      <code className="flex-1">npm run build:mac</code>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={() => copyToClipboard('npm run build:mac', 'Comando macOS')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
                      <Badge className="flex-shrink-0">Linux</Badge>
                      <code className="flex-1">npm run build:linux</code>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        onClick={() => copyToClipboard('npm run build:linux', 'Comando Linux')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  ✅ Os arquivos compilados estarão na pasta <code className="bg-muted px-1 rounded">desktop-app/dist</code>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Step 4: Create Release */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                  4
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Rocket className="h-5 w-5" />
                    Publicar no GitHub Releases
                  </CardTitle>
                  <CardDescription>Disponibilize para download</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="space-y-3">
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">4.1</Badge>
                  <div>
                    <p className="font-medium">Acesse seu repositório no GitHub</p>
                    <p className="text-sm text-muted-foreground">github.com/SEU-USUARIO/videotemplate-pro-desktop</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">4.2</Badge>
                  <div>
                    <p className="font-medium">Clique em "Releases" (lado direito)</p>
                    <p className="text-sm text-muted-foreground">Ou vá direto para: github.com/SEU-USUARIO/REPO/releases/new</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">4.3</Badge>
                  <div>
                    <p className="font-medium">Clique em "Draft a new release"</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">4.4</Badge>
                  <div>
                    <p className="font-medium">Preencha os campos:</p>
                    <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                      <li>• Tag: <code className="bg-muted px-1 rounded">v1.0.0</code></li>
                      <li>• Title: <code className="bg-muted px-1 rounded">VideoTemplate Pro Desktop v1.0.0</code></li>
                      <li>• Description: Descrição das funcionalidades</li>
                    </ul>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">4.5</Badge>
                  <div>
                    <p className="font-medium">Arraste os arquivos compilados:</p>
                    <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                      <li>• <code className="bg-muted px-1 rounded">VideoTemplatePro-Setup.exe</code> (Windows)</li>
                      <li>• <code className="bg-muted px-1 rounded">VideoTemplatePro.dmg</code> (macOS)</li>
                      <li>• <code className="bg-muted px-1 rounded">VideoTemplatePro.AppImage</code> (Linux)</li>
                    </ul>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5">4.6</Badge>
                  <div>
                    <p className="font-medium">Clique em "Publish release"</p>
                    <p className="text-sm text-muted-foreground">Pronto! Seus downloads estarão disponíveis</p>
                  </div>
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* Step 5: Update Links */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                  5
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5" />
                    Atualizar Links de Download
                  </CardTitle>
                  <CardDescription>Configure os links no seu app web</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Após publicar o release, seus links de download serão:
              </p>
              
              <div className="space-y-2">
                <div className="p-3 bg-muted rounded-lg font-mono text-xs overflow-x-auto">
                  <code>https://github.com/SEU-USUARIO/REPO/releases/latest/download/VideoTemplatePro-Setup.exe</code>
                </div>
                <div className="p-3 bg-muted rounded-lg font-mono text-xs overflow-x-auto">
                  <code>https://github.com/SEU-USUARIO/REPO/releases/latest/download/VideoTemplatePro.dmg</code>
                </div>
                <div className="p-3 bg-muted rounded-lg font-mono text-xs overflow-x-auto">
                  <code>https://github.com/SEU-USUARIO/REPO/releases/latest/download/VideoTemplatePro.AppImage</code>
                </div>
              </div>

              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  💡 <strong>Dica:</strong> Me diga o nome do seu usuário e repositório no GitHub e eu atualizo os links automaticamente no app!
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Using the App */}
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Usando o App Desktop
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-primary">1.</span>
                  <span>Abra o app e selecione seu template (imagem com área verde)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-primary">2.</span>
                  <span>Escolha a pasta de saída onde os vídeos serão salvos</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-primary">3.</span>
                  <span>Adicione os vídeos que deseja processar</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-primary">4.</span>
                  <span>Configure qualidade (Rápido/Balanceado/Qualidade)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-primary">5.</span>
                  <span>Clique em "Processar" e aguarde!</span>
                </li>
              </ol>

              <div className="grid grid-cols-3 gap-4 pt-4">
                <div className="text-center p-3 bg-green-500/10 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">NVENC</p>
                  <p className="text-xs text-muted-foreground">NVIDIA 10-20x</p>
                </div>
                <div className="text-center p-3 bg-blue-500/10 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600">QSV</p>
                  <p className="text-xs text-muted-foreground">Intel 5-10x</p>
                </div>
                <div className="text-center p-3 bg-red-500/10 rounded-lg">
                  <p className="text-2xl font-bold text-red-600">AMF</p>
                  <p className="text-xs text-muted-foreground">AMD 5-10x</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
