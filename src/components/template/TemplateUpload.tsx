import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, ImageIcon, Check, AlertCircle, Loader2 } from 'lucide-react';
import { detectGreenArea, type GreenArea } from '@/lib/greenDetection';
import { cn } from '@/lib/utils';

interface TemplateUploadProps {
  onTemplateDetected: (file: File, greenArea: GreenArea) => void;
  templateFile: File | null;
  greenArea: GreenArea | null;
}

export function TemplateUpload({ onTemplateDetected, templateFile, greenArea }: TemplateUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const processTemplate = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Por favor, envie uma imagem (PNG ou JPG)');
      setIsProcessing(false);
      return;
    }

    // Create preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // Detect green area
    const result = await detectGreenArea(file);

    if (!result.success || !result.area) {
      setError(result.error || 'Erro ao detectar área verde');
      toast({
        variant: 'destructive',
        title: 'Erro na detecção',
        description: result.error,
      });
      setIsProcessing(false);
      return;
    }

    onTemplateDetected(file, result.area);
    toast({
      title: 'Template detectado!',
      description: `Área verde: ${result.area.width}x${result.area.height} pixels`,
    });
    setIsProcessing(false);
  }, [onTemplateDetected, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      processTemplate(file);
    }
  }, [processTemplate]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processTemplate(file);
    }
  }, [processTemplate]);

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          Enviar Template (Canva)
        </CardTitle>
        <CardDescription>
          Envie sua imagem de template 1080x1920 com a área verde (#00FF00) para a janela do vídeo
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'relative border-2 border-dashed rounded-lg transition-all duration-200',
            isDragging ? 'border-primary bg-primary/5' : 'border-border',
            error ? 'border-destructive' : '',
            greenArea ? 'border-green-500' : ''
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {previewUrl ? (
            <div className="relative">
              <div className="relative w-full" style={{ paddingBottom: '177.78%' }}>
                <img
                  src={previewUrl}
                  alt="Template preview"
                  className="absolute inset-0 w-full h-full object-contain rounded-lg"
                />
                {/* Green area overlay */}
                {greenArea && (
                  <div
                    className="absolute border-2 border-green-500 bg-green-500/20 pointer-events-none"
                    style={{
                      left: `${(greenArea.x / 1080) * 100}%`,
                      top: `${(greenArea.y / 1920) * 100}%`,
                      width: `${(greenArea.width / 1080) * 100}%`,
                      height: `${(greenArea.height / 1920) * 100}%`,
                    }}
                  >
                    <div className="absolute -top-6 left-0 text-xs bg-green-500 text-white px-1 rounded">
                      {greenArea.width}x{greenArea.height}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Status overlay */}
              <div className="absolute bottom-4 left-4 right-4">
                {isProcessing ? (
                  <div className="flex items-center gap-2 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm">Detectando área verde...</span>
                  </div>
                ) : greenArea ? (
                  <div className="flex items-center gap-2 bg-green-500/90 text-white backdrop-blur-sm rounded-lg px-3 py-2">
                    <Check className="h-4 w-4" />
                    <span className="text-sm">Área detectada: {greenArea.width}x{greenArea.height}</span>
                  </div>
                ) : error ? (
                  <div className="flex items-center gap-2 bg-destructive/90 text-destructive-foreground backdrop-blur-sm rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">{error}</span>
                  </div>
                ) : null}
              </div>

              {/* Change template button */}
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                Trocar
              </Button>
            </div>
          ) : (
            <div 
              className="flex flex-col items-center justify-center py-12 px-4 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="p-4 bg-muted rounded-full mb-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium mb-1">
                Arraste e solte ou clique para enviar
              </p>
              <p className="text-xs text-muted-foreground">
                PNG ou JPG • 1080x1920 recomendado
              </p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          className="hidden"
          onChange={handleFileSelect}
        />

        {!previewUrl && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <h4 className="text-sm font-medium mb-1">💡 Dica</h4>
            <p className="text-xs text-muted-foreground">
              No Canva, adicione um retângulo preenchido com verde sólido (#00FF00) onde deseja que o vídeo apareça.
              Exporte como PNG para manter a qualidade.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
