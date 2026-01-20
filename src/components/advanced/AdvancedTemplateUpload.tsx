import { useCallback, useState, useRef } from 'react';
import { Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { detectGreenArea, type GreenArea } from '@/lib/greenDetection';

interface AdvancedTemplateUploadProps {
  onTemplateDetected: (file: File, greenArea: GreenArea) => void;
  templateFile: File | null;
  greenArea: GreenArea | null;
}

export function AdvancedTemplateUpload({ onTemplateDetected, templateFile, greenArea }: AdvancedTemplateUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateDimensions, setTemplateDimensions] = useState<{ width: number; height: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const processTemplate = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Por favor, selecione uma imagem');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);

      // Get image dimensions
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = rej;
        img.src = url;
      });
      setTemplateDimensions({ width: img.width, height: img.height });

      const result = await detectGreenArea(file);
      
      if (!result.success || !result.area) {
        setError(result.error || 'Não foi possível detectar a área verde no template');
        toast({
          variant: 'destructive',
          title: 'Área verde não encontrada',
          description: result.error || 'Certifique-se de que o template possui uma área verde (#00FF00) bem definida.',
        });
        return;
      }

      onTemplateDetected(file, result.area);
      toast({
        title: 'Template detectado!',
        description: `Área verde encontrada: ${result.area.width}x${result.area.height}px`,
      });
    } catch (err) {
      console.error('Error processing template:', err);
      setError('Erro ao processar o template');
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível processar o template.',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [onTemplateDetected, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processTemplate(file);
  }, [processTemplate]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processTemplate(file);
  }, [processTemplate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Template Avançado
        </CardTitle>
        <CardDescription>
          Faça upload do template do Canva com área verde (#00FF00)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`
            relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
            ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
            ${isProcessing ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:border-primary/50'}
          `}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />

          {isProcessing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Detectando área verde...</p>
            </div>
          ) : previewUrl && greenArea && templateDimensions ? (
            <div className="space-y-4">
              <div className="relative inline-block">
                <img src={previewUrl} alt="Template preview" className="max-h-48 rounded-lg shadow-md" />
                <div
                  className="absolute border-2 border-primary bg-primary/20"
                  style={{
                    left: `${(greenArea.x / templateDimensions.width) * 100}%`,
                    top: `${(greenArea.y / templateDimensions.height) * 100}%`,
                    width: `${(greenArea.width / templateDimensions.width) * 100}%`,
                    height: `${(greenArea.height / templateDimensions.height) * 100}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-center gap-2 text-primary">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Template detectado</span>
              </div>
              <p className="text-sm text-muted-foreground">Área: {greenArea.width}x{greenArea.height}px</p>
              <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>Trocar</Button>
            </div>
          ) : error ? (
            <div className="space-y-2">
              <AlertCircle className="h-10 w-10 mx-auto text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm">Tentar novamente</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Arraste seu template ou clique para selecionar</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}