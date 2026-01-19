import { Header } from '@/components/layout/Header';
import { AnalyserHeader } from '@/components/analyser/AnalyserHeader';
import { ProfileInput } from '@/components/analyser/ProfileInput';
import { KPICards } from '@/components/analyser/KPICards';
import { FiltersSection } from '@/components/analyser/FiltersSection';
import { VideoList } from '@/components/analyser/VideoList';
import { DownloadSection } from '@/components/analyser/DownloadSection';
import { useAnalyserStore } from '@/hooks/useAnalyserStore';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function AnalyserTikTok() {
  const store = useAnalyserStore('tiktok');

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 space-y-6">
        <AnalyserHeader 
          platform="tiktok"
          title="Analyser TikTok"
          subtitle="Carregue perfis públicos, filtre por métricas e exporte vídeos"
        />

        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="pt-4">
            <div className="flex gap-3 items-start">
              <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-yellow-600 dark:text-yellow-400">TikTok Analyser em desenvolvimento</p>
                <p className="text-muted-foreground">
                  No momento, apenas o Instagram Analyser está funcionando. 
                  O TikTok será implementado em breve.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <ProfileInput 
          platform="tiktok"
          onLoadVideos={store.loadVideos}
          isLoading={store.isLoadingVideos}
          loadedUsername={store.loadedUsername}
          onClear={store.clearVideos}
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
              platform="tiktok"
            />

            <DownloadSection 
              platform="tiktok"
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
            <p className="text-sm mt-2">Funciona apenas com perfis públicos.</p>
          </div>
        )}
      </main>
    </div>
  );
}
