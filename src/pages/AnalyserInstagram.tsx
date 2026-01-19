import { useState, useCallback } from 'react';
import { Header } from '@/components/layout/Header';
import { AnalyserHeader } from '@/components/analyser/AnalyserHeader';
import { ProfileInput } from '@/components/analyser/ProfileInput';
import { CookieInput } from '@/components/analyser/CookieInput';
import { KPICards } from '@/components/analyser/KPICards';
import { FiltersSection } from '@/components/analyser/FiltersSection';
import { VideoList } from '@/components/analyser/VideoList';
import { DownloadSection } from '@/components/analyser/DownloadSection';
import { useAnalyserStore } from '@/hooks/useAnalyserStore';

export default function AnalyserInstagram() {
  const store = useAnalyserStore('instagram');
  const [hasCookie, setHasCookie] = useState(false);

  const handleCookieChange = useCallback((hasIt: boolean) => {
    setHasCookie(hasIt);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 space-y-6">
        <AnalyserHeader 
          platform="instagram"
          title="Analyser Instagram"
          subtitle="Carregue perfis públicos, filtre por métricas e exporte vídeos"
        />

        <CookieInput 
          platform="instagram"
          onCookieChange={handleCookieChange}
        />

        {hasCookie && (
          <ProfileInput 
            platform="instagram"
            onLoadVideos={store.loadVideos}
            isLoading={store.isLoadingVideos}
            loadedUsername={store.loadedUsername}
            onClear={store.clearVideos}
          />
        )}

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

        {store.videos.length === 0 && !store.isLoadingVideos && hasCookie && (
          <div className="text-center py-12 text-muted-foreground">
            <p>Digite um @ ou URL de perfil acima para carregar os vídeos.</p>
            <p className="text-sm mt-2">Funciona apenas com perfis públicos.</p>
          </div>
        )}
      </main>
    </div>
  );
}
