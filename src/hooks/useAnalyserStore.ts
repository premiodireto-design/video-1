import { useState, useMemo, useCallback, useRef } from 'react';
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
  const [isConnected, setIsConnected] = useState(true); // No auth needed for public profiles
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [videos, setVideos] = useState<AnalyserVideo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<VideoFilters>(initialFilters);
  const [sortBy, setSortBy] = useState<SortBy>('likes');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const cancelRef = useRef(false);

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

  // Connect (mantido para compatibilidade de UI)
  const connect = useCallback(async () => {
    setIsConnected(true);
  }, []);

  const disconnect = useCallback(() => {
    setIsConnected(true);
    setVideos([]);
    setSelectedIds([]);
  }, []);

  // Load videos from API (compliant mode: disabled unless official integrations are configured)
  const loadVideos = useCallback(async (_username: string) => {
    setIsLoadingVideos(false);
    toast.error(
      'Carregamento direto de perfis não está disponível neste app (requer integração oficial e permissões). Use o Modo Upload para carregar seus próprios vídeos.',
      { duration: 6000 }
    );
  }, []);

  // Load uploaded videos (fallback mode)
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

  // Download selected videos
  const downloadSelected = useCallback(async () => {
    const selectedVideos = filteredVideos.filter(v => selectedIds.includes(v.id));
    await downloadVideos(selectedVideos);
  }, [filteredVideos, selectedIds]);

  // Download all filtered videos
  const downloadAll = useCallback(async () => {
    await downloadVideos(filteredVideos);
  }, [filteredVideos]);

  // Main download function
  const downloadVideos = async (videosToDownload: AnalyserVideo[]) => {
    if (videosToDownload.length === 0) {
      toast.error('Nenhum vídeo para baixar');
      return;
    }

    setIsDownloading(true);
    cancelRef.current = false;

    const zip = new JSZip();
    const total = videosToDownload.length;
    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < total; i++) {
        if (cancelRef.current) {
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

        // Format filename with order, metrics, and date
        const index = String(i + 1).padStart(4, '0');
        const date = video.publishedAt.split('T')[0].replace(/-/g, '');
        const filename = `${index}-${video.likes}-${video.views}-${date}-${video.id}.mp4`;

        try {
          if (video.localFile) {
            // Use local file directly
            const buffer = await video.localFile.arrayBuffer();
            zip.file(filename, buffer);
            successCount++;
          } else {
            // Downloads via URL são desabilitados por conformidade; use Modo Upload.
            failCount++;
          }
        } catch (err) {
          console.warn(`Error downloading ${video.id}:`, err);
          failCount++;
        }

        // Small delay between downloads to avoid rate limiting
        if (i < total - 1 && !cancelRef.current) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (cancelRef.current) {
        return;
      }

      if (successCount === 0) {
        toast.error('Nenhum vídeo foi adicionado ao ZIP. Para baixar, use o Modo Upload e envie seus próprios arquivos.');
        return;
      }

      // Generate and download zip
      toast.info('Gerando arquivo ZIP...');
      const content = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${platform}-videos-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (failCount > 0) {
        toast.warning(`Download concluído! ${successCount} de ${total} vídeos baixados.`);
      } else {
        toast.success('Download concluído!');
      }
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Erro ao criar arquivo zip');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const cancelDownload = useCallback(() => {
    cancelRef.current = true;
  }, []);

  // Export CSV
  const exportCSV = useCallback(() => {
    if (filteredVideos.length === 0) {
      toast.error('Nenhum vídeo para exportar');
      return;
    }

    const headers = ['posicao', 'platform', 'id', 'url', 'date', 'caption', 'views', 'likes', 'comments', 'shares', 'saves'];
    const rows = filteredVideos.map((v, idx) => [
      idx + 1,
      v.platform,
      v.id,
      v.permalink,
      v.publishedAt,
      `"${(v.caption || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      v.views,
      v.likes,
      v.comments,
      v.shares || 0,
      v.saves || 0,
    ].join(','));

    const csv = '\ufeff' + [headers.join(','), ...rows].join('\n'); // BOM for Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${platform}-videos-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
