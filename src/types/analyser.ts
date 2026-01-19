export interface AnalyserVideo {
  id: string;
  platform: 'tiktok' | 'instagram';
  thumbnail: string;
  caption: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  saves?: number;
  permalink: string;
  videoUrl: string;
  downloadable: boolean;
  localFile?: File;
}

export interface VideoFilters {
  searchText: string;
  dateFrom: string;
  dateTo: string;
  minViews: number;
  minLikes: number;
  minComments: number;
}

export type SortBy = 'likes' | 'views' | 'comments' | 'date';
export type SortOrder = 'asc' | 'desc';

export interface DownloadProgress {
  percentage: number;
  currentItem: number;
  totalItems: number;
  remainingItems: number;
}

export interface AnalyserState {
  isConnected: boolean;
  isAuthLoading: boolean;
  isLoadingVideos: boolean;
  videos: AnalyserVideo[];
  filteredVideos: AnalyserVideo[];
  selectedIds: string[];
  filters: VideoFilters;
  sortBy: SortBy;
  sortOrder: SortOrder;
  downloadProgress: DownloadProgress | null;
  isDownloading: boolean;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
}
