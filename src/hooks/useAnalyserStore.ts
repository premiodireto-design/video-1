import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import JSZip from 'jszip';
import type { 
  AnalyserVideo, 
  VideoFilters, 
  SortBy, 
  SortOrder, 
  DownloadProgress 
} from '@/types/analyser';

const initialFilters: VideoFilters = {
  searchText: '',
  dateFrom: '',
  dateTo: '',
  minViews: 0,
  minLikes: 0,
  minComments: 0,
};

export function useAnalyserStore(platform: 'tiktok' | 'instagram') {
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [videos, setVideos] = useState<AnalyserVideo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<VideoFilters>(initialFilters);
  const [sortBy, setSortBy] = useState<SortBy>('likes');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);

  // Filter and sort videos
  const filteredVideos = useMemo(() => {
    let result = [...videos];

    // Apply filters
    if (filters.searchText) {
      const search = filters.searchText.toLowerCase();
      result = result.filter(v => v.caption.toLowerCase().includes(search));
    }

    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      result = result.filter(v => new Date(v.publishedAt) >= fromDate);
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      result = result.filter(v => new Date(v.publishedAt) <= toDate);
    }

    if (filters.minViews > 0) {
      result = result.filter(v => v.views >= filters.minViews);
    }

    if (filters.minLikes > 0) {
      result = result.filter(v => v.likes >= filters.minLikes);
    }

    if (filters.minComments > 0) {
      result = result.filter(v => v.comments >= filters.minComments);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'likes':
          comparison = a.likes - b.likes;
          break;
        case 'views':
          comparison = a.views - b.views;
          break;
        case 'comments':
          comparison = a.comments - b.comments;
          break;
        case 'date':
          comparison = new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [videos, filters, sortBy, sortOrder]);

  // Calculate totals
  const totalViews = useMemo(() => 
    filteredVideos.reduce((sum, v) => sum + v.views, 0), [filteredVideos]);
  const totalLikes = useMemo(() => 
    filteredVideos.reduce((sum, v) => sum + v.likes, 0), [filteredVideos]);
  const totalComments = useMemo(() => 
    filteredVideos.reduce((sum, v) => sum + v.comments, 0), [filteredVideos]);

  // Auth methods
  const connect = useCallback(async () => {
    setIsAuthLoading(true);
    try {
      // TODO: Implement actual OAuth flow with backend
      // This is a placeholder - real implementation requires API credentials
      toast.info(
        platform === 'tiktok' 
          ? 'A API do TikTok requer aprovação prévia. Use o Modo Upload por enquanto.'
          : 'Configure as credenciais da API do Instagram nas configurações.',
        { duration: 5000 }
      );
      // For demo, simulate connection
      // setIsConnected(true);
    } catch (error) {
      toast.error('Erro ao conectar. Tente novamente.');
    } finally {
      setIsAuthLoading(false);
    }
  }, [platform]);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setVideos([]);
    setSelectedIds([]);
    toast.success('Conta desconectada');
  }, []);

  // Load videos from API
  const loadVideos = useCallback(async (username: string) => {
    setIsLoadingVideos(true);
    try {
      // TODO: Implement actual API call
      // This requires backend edge function with proper API credentials
      toast.info('Funcionalidade requer configuração da API. Use o Modo Upload.');
    } catch (error) {
      toast.error('Erro ao carregar vídeos');
    } finally {
      setIsLoadingVideos(false);
    }
  }, []);

  // Load uploaded videos
  const loadUploadedVideos = useCallback((uploadedVideos: AnalyserVideo[]) => {
    setVideos(uploadedVideos);
    setSelectedIds([]);
    toast.success(`${uploadedVideos.length} vídeos carregados!`);
  }, []);

  // Set sorting
  const setSort = useCallback((newSortBy: SortBy, newSortOrder: SortOrder) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
  }, []);

  // Download methods
  const downloadSelected = useCallback(async () => {
    const selectedVideos = filteredVideos.filter(v => selectedIds.includes(v.id));
    await downloadVideos(selectedVideos);
  }, [filteredVideos, selectedIds]);

  const downloadAll = useCallback(async () => {
    await downloadVideos(filteredVideos);
  }, [filteredVideos]);

  const downloadVideos = async (videosToDownload: AnalyserVideo[]) => {
    if (videosToDownload.length === 0) {
      toast.error('Nenhum vídeo para baixar');
      return;
    }

    setIsDownloading(true);
    setCancelRequested(false);

    const zip = new JSZip();
    const total = videosToDownload.length;

    try {
      for (let i = 0; i < total; i++) {
        if (cancelRequested) {
          toast.info('Download cancelado');
          break;
        }

        const video = videosToDownload[i];
        
        setDownloadProgress({
          percentage: Math.round(((i + 1) / total) * 100),
          currentItem: i + 1,
          totalItems: total,
          remainingItems: total - i - 1,
        });

        // Format filename
        const index = String(i + 1).padStart(4, '0');
        const date = video.publishedAt.split('T')[0].replace(/-/g, '');
        const filename = `${index}-${video.likes}-${video.views}-${date}-${video.id}.mp4`;

        if (video.localFile) {
          // Use local file directly
          const buffer = await video.localFile.arrayBuffer();
          zip.file(filename, buffer);
        } else if (video.downloadable && video.videoUrl) {
          // Fetch from URL (only for owned content)
          try {
            const response = await fetch(video.videoUrl);
            if (response.ok) {
              const blob = await response.blob();
              zip.file(filename, blob);
            }
          } catch {
            console.warn(`Could not download ${video.id}`);
          }
        }
      }

      // Generate and download zip
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${platform}-videos-${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success('Download concluído!');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Erro ao criar arquivo zip');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
      setCancelRequested(false);
    }
  };

  const cancelDownload = useCallback(() => {
    setCancelRequested(true);
  }, []);

  // Export CSV
  const exportCSV = useCallback(() => {
    if (filteredVideos.length === 0) {
      toast.error('Nenhum vídeo para exportar');
      return;
    }

    const headers = ['platform', 'id', 'url', 'date', 'caption', 'views', 'likes', 'comments', 'shares', 'saves'];
    const rows = filteredVideos.map(v => [
      v.platform,
      v.id,
      v.permalink,
      v.publishedAt,
      `"${(v.caption || '').replace(/"/g, '""')}"`,
      v.views,
      v.likes,
      v.comments,
      v.shares || 0,
      v.saves || 0,
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${platform}-videos-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('CSV exportado!');
  }, [filteredVideos, platform]);

  return {
    isConnected,
    isAuthLoading,
    isLoadingVideos,
    videos,
    filteredVideos,
    selectedIds,
    filters,
    sortBy,
    sortOrder,
    downloadProgress,
    isDownloading,
    totalViews,
    totalLikes,
    totalComments,
    connect,
    disconnect,
    loadVideos,
    loadUploadedVideos,
    setSelectedIds,
    setFilters,
    setSort,
    downloadSelected,
    downloadAll,
    cancelDownload,
    exportCSV,
  };
}
