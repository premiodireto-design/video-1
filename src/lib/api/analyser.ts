import { supabase } from '@/integrations/supabase/client';
import type { AnalyserVideo } from '@/types/analyser';
import { getCookie } from '@/components/analyser/CookieInput';

interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

interface UserFeedData {
  videos: AnalyserVideo[];
  username: string;
  totalCount: number;
  hasMore?: boolean;
  cursor?: string;
}

export const analyserApi = {
  async getInstagramUserFeed(username: string, limit: number = 50): Promise<ApiResponse<UserFeedData>> {
    try {
      // Get cookie from localStorage
      const cookie = getCookie('instagram');
      
      const { data, error } = await supabase.functions.invoke('instagram-feed', {
        body: { username, limit, cookie },
      });
      
      if (error) {
        console.error('Edge function error:', error);
        return {
          success: false,
          error: error.message || 'Erro ao carregar feed do Instagram',
        };
      }
      
      if (!data?.success) {
        return {
          success: false,
          error: data?.error || 'Erro desconhecido',
        };
      }
      
      return {
        success: true,
        data: {
          videos: data.data.videos,
          username: data.data.username,
          totalCount: data.data.totalCount,
          hasMore: data.data.hasMore,
          cursor: data.data.cursor,
        },
      };
    } catch (err) {
      console.error('API Error:', err);
      return {
        success: false,
        error: 'Erro de conexão ao carregar Instagram',
      };
    }
  },

  async getTikTokUserFeed(_username: string, _limit: number = 50): Promise<ApiResponse<UserFeedData>> {
    // TikTok implementation will come next
    return {
      success: false,
      error: 'TikTok Analyser em desenvolvimento',
    };
  },
};
