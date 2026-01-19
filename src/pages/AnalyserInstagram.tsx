import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { AnalyserHeader } from '@/components/analyser/AnalyserHeader';
import { AuthSection } from '@/components/analyser/AuthSection';
import { ProfileInput } from '@/components/analyser/ProfileInput';
import { KPICards } from '@/components/analyser/KPICards';
import { FiltersSection } from '@/components/analyser/FiltersSection';
import { VideoList } from '@/components/analyser/VideoList';
import { DownloadSection } from '@/components/analyser/DownloadSection';
import { UploadFallback } from '@/components/analyser/UploadFallback';
import { useAnalyserStore } from '@/hooks/useAnalyserStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
          subtitle="Analise seus Reels e posts do Instagram, filtre por métricas e exporte organizados"
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'api' | 'upload')}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="api">Conectar Conta</TabsTrigger>
            <TabsTrigger value="upload">Modo Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="space-y-6 mt-6">
            <AuthSection 
              platform="instagram"
              isConnected={store.isConnected}
              onConnect={store.connect}
              onDisconnect={store.disconnect}
              isLoading={store.isAuthLoading}
            />

            {store.isConnected && (
              <>
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
              </>
            )}

            {!store.isConnected && (
              <div className="text-center py-12 text-muted-foreground">
                <p>Conecte sua conta Instagram Business/Creator para começar a análise.</p>
                <p className="text-sm mt-2">
                  Requer conta Business ou Creator conectada ao Facebook.
                  Use o "Modo Upload" como alternativa.
                </p>
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
