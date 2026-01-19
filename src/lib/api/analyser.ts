import { supabase } from '@/integrations/supabase/client';
import type { AnalyserVideo } from '@/types/analyser';

interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
}

interface UserFeedData {
  videos: AnalyserVideo[];
  username: string;
  totalCount: number;
  hasMore?: boolean;
}

export const analyserApi = {
  // TikTok: Get all videos from a user profile
  async getTikTokUserFeed(username: string): Promise<ApiResponse<UserFeedData>> {
    const { data, error } = await supabase.functions.invoke('analyser-tiktok', {
      body: { action: 'user-feed', username },
    });

    if (error) {
      console.error('TikTok API error:', error);
      return { success: false, error: error.message };
    }
    return data;
  },

  // TikTok: Get info for a single video
  async getTikTokVideoInfo(videoUrl: string): Promise<ApiResponse<{ video: AnalyserVideo }>> {
    const { data, error } = await supabase.functions.invoke('analyser-tiktok', {
      body: { action: 'video-info', videoUrl },
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return data;
  },

  // Instagram: Get all videos from a user profile  
  async getInstagramUserFeed(username: string): Promise<ApiResponse<UserFeedData>> {
    const { data, error } = await supabase.functions.invoke('analyser-instagram', {
      body: { action: 'user-feed', username },
    });

    if (error) {
      console.error('Instagram API error:', error);
      return { success: false, error: error.message };
    }
    return data;
  },

  // Instagram: Get info for a single post
  async getInstagramPostInfo(postUrl: string): Promise<ApiResponse<{ video: AnalyserVideo }>> {
    const { data, error } = await supabase.functions.invoke('analyser-instagram', {
      body: { action: 'post-info', postUrl },
    });

    if (error) {
      return { success: false, error: error.message };
    }
    return data;
  },

  // Download video to blob (for zip creation)
  async downloadVideo(url: string): Promise<Blob | null> {
    try {
      // Use edge function to proxy the download (avoids CORS issues)
      const { data, error } = await supabase.functions.invoke('analyser-download', {
        body: { url },
      });

      if (error || !data?.success) {
        console.error('Download error:', error || data?.error);
        return null;
      }

      // The response contains base64 encoded video
      if (data.base64) {
        const binaryString = atob(data.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'video/mp4' });
      }

      return null;
    } catch (err) {
      console.error('Download failed:', err);
      return null;
    }
  },
};
