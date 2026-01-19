import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { AnalyserHeader } from '@/components/analyser/AnalyserHeader';
import { ProfileInput } from '@/components/analyser/ProfileInput';
import { KPICards } from '@/components/analyser/KPICards';
import { FiltersSection } from '@/components/analyser/FiltersSection';
import { VideoList } from '@/components/analyser/VideoList';
import { DownloadSection } from '@/components/analyser/DownloadSection';
import { UploadFallback } from '@/components/analyser/UploadFallback';
import { useAnalyserStore } from '@/hooks/useAnalyserStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Info, AlertTriangle } from 'lucide-react';

export default function AnalyserInstagram() {
  const [activeTab, setActiveTab] = useState<'api' | 'upload'>('api');
  const store = useAnalyserStore('instagram');

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 space-y-6">
        <AnalyserHeader 
          platform="instagram"
          title="Analyser Instagram"
          subtitle="Analise perfis públicos, ordene Reels por métricas e baixe vídeos"
        />

        <Card className="border-purple-500/20 bg-purple-500/5">
          <CardContent className="pt-4">
            <div className="flex gap-3 items-start">
              <Info className="h-5 w-5 text-purple-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-purple-700 dark:text-purple-300">Como funciona:</p>
                <p className="text-muted-foreground">
                  Digite o @ de qualquer perfil público do Instagram. O sistema irá carregar os Reels/vídeos 
                  com métricas e você poderá ordenar, filtrar e baixar.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4">
            <div className="flex gap-3 items-start">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-300">Limitação do Instagram:</p>
                <p className="text-muted-foreground">
                  O Instagram tem proteções mais rígidas que o TikTok. Se a busca por perfil não funcionar, 
                  use o "Modo Upload" para carregar seus próprios vídeos exportados.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'api' | 'upload')}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="api">Carregar Perfil</TabsTrigger>
            <TabsTrigger value="upload">Modo Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="space-y-6 mt-6">
            <ProfileInput 
              platform="instagram"
              onLoadVideos={store.loadVideos}
              isLoading={store.isLoadingVideos}
            />

            {store.videos.length > 0 && (
              <>
                <KPICards 
                  totalVideos={store.filteredVideos.length}
                  totalViews={store.totalViews}
                  totalLikes={store.totalLikes}
                  totalComments={store.totalComments}
                />

                <FiltersSection 
                  filters={store.filters}
                  onFiltersChange={store.setFilters}
                  sortBy={store.sortBy}
                  sortOrder={store.sortOrder}
                  onSortChange={store.setSort}
                />

                <VideoList 
                  videos={store.filteredVideos}
                  selectedIds={store.selectedIds}
                  onSelectionChange={store.setSelectedIds}
                  platform="instagram"
                />

                <DownloadSection 
                  platform="instagram"
                  selectedCount={store.selectedIds.length}
                  totalCount={store.filteredVideos.length}
                  onDownloadSelected={store.downloadSelected}
                  onDownloadAll={store.downloadAll}
                  onExportCSV={store.exportCSV}
                  downloadProgress={store.downloadProgress}
                  isDownloading={store.isDownloading}
                  onCancelDownload={store.cancelDownload}
                />
              </>
            )}

            {store.videos.length === 0 && !store.isLoadingVideos && (
              <div className="text-center py-12 text-muted-foreground">
                <p>Digite um @ ou URL de perfil acima para carregar os vídeos.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload" className="space-y-6 mt-6">
            <UploadFallback 
              platform="instagram"
              onVideosLoaded={store.loadUploadedVideos}
              videos={store.videos}
            />

            {store.videos.length > 0 && (
              <>
                <KPICards 
                  totalVideos={store.filteredVideos.length}
                  totalViews={store.totalViews}
                  totalLikes={store.totalLikes}
                  totalComments={store.totalComments}
                />

                <FiltersSection 
                  filters={store.filters}
                  onFiltersChange={store.setFilters}
                  sortBy={store.sortBy}
                  sortOrder={store.sortOrder}
                  onSortChange={store.setSort}
                />

                <VideoList 
                  videos={store.filteredVideos}
                  selectedIds={store.selectedIds}
                  onSelectionChange={store.setSelectedIds}
                  platform="instagram"
                />

                <DownloadSection 
                  platform="instagram"
                  selectedCount={store.selectedIds.length}
                  totalCount={store.filteredVideos.length}
                  onDownloadSelected={store.downloadSelected}
                  onDownloadAll={store.downloadAll}
                  onExportCSV={store.exportCSV}
                  downloadProgress={store.downloadProgress}
                  isDownloading={store.isDownloading}
                  onCancelDownload={store.cancelDownload}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
