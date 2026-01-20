import { useState, useCallback } from 'react';
import { Header } from '@/components/layout/Header';
import { AnalyserHeader } from '@/components/analyser/AnalyserHeader';
import { ProfileInput } from '@/components/analyser/ProfileInput';
import { CookieInput } from '@/components/analyser/CookieInput';
import { KPICards } from '@/components/analyser/KPICards';
import { FiltersSection } from '@/components/analyser/FiltersSection';
import { VideoList } from '@/components/analyser/VideoList';
import { DownloadSection } from '@/components/analyser/DownloadSection';
import { TikTokModeSelector, type TikTokMode } from '@/components/analyser/TikTokModeSelector';
import { TikTokJsonImport } from '@/components/analyser/TikTokJsonImport';
import { TikTokScraperMode } from '@/components/analyser/TikTokScraperMode';
import { useAnalyserStore } from '@/hooks/useAnalyserStore';
import type { AnalyserVideo } from '@/types/analyser';

export default function AnalyserTikTok() {
  const store = useAnalyserStore('tiktok');
  const [hasCookie, setHasCookie] = useState(false);
  const [selectedMode, setSelectedMode] = useState<TikTokMode>('json');
  const [scraperLoading, setScraperLoading] = useState(false);

  const handleCookieChange = useCallback((hasIt: boolean) => {
    setHasCookie(hasIt);
  }, []);

  const handleJsonImport = useCallback((videos: AnalyserVideo[], username: string) => {
    // Directly set videos in the store
    store.setVideosDirectly(videos, username);
  }, [store]);

  const handleScraperLoad = useCallback((videos: AnalyserVideo[], username: string) => {
    store.setVideosDirectly(videos, username);
  }, [store]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-8 space-y-6">
        <AnalyserHeader 
          platform="tiktok"
          title="Analyser TikTok"
          subtitle="Carregue perfis públicos, filtre por métricas e exporte vídeos"
        />

        <TikTokModeSelector
          selectedMode={selectedMode}
          onModeChange={setSelectedMode}
        />

        {selectedMode === 'cookie' && (
          <>
            <CookieInput 
              platform="tiktok"
              onCookieChange={handleCookieChange}
            />

            {hasCookie && (
              <ProfileInput 
                platform="tiktok"
                onLoadVideos={store.loadVideos}
                isLoading={store.isLoadingVideos}
                loadedUsername={store.loadedUsername}
                onClear={store.clearVideos}
              />
            )}
          </>
        )}

        {selectedMode === 'json' && (
          <TikTokJsonImport
            onImport={handleJsonImport}
            isLoading={store.isLoadingVideos}
          />
        )}

        {selectedMode === 'scraper' && (
          <TikTokScraperMode
            onLoadVideos={handleScraperLoad}
            isLoading={scraperLoading}
            setIsLoading={setScraperLoading}
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

        {store.videos.length === 0 && !store.isLoadingVideos && !scraperLoading && (
          <div className="text-center py-12 text-muted-foreground">
            {selectedMode === 'cookie' && hasCookie && (
              <>
                <p>Digite um @ ou URL de perfil acima para carregar os vídeos.</p>
                <p className="text-sm mt-2">⚠️ O modo Cookie pode falhar se o TikTok bloquear o servidor.</p>
              </>
            )}
            {selectedMode === 'cookie' && !hasCookie && (
              <p>Configure seu cookie do TikTok para começar.</p>
            )}
            {selectedMode === 'json' && (
              <>
                <p>Cole o JSON dos vídeos acima para começar.</p>
                <p className="text-sm mt-2">💡 Use extensões como "Sort for TikTok" para exportar os dados.</p>
              </>
            )}
            {selectedMode === 'scraper' && (
              <>
                <p>Configure sua API key e digite um perfil para fazer scrape.</p>
                <p className="text-sm mt-2">💡 O Firecrawl é um serviço pago de scraping profissional.</p>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
