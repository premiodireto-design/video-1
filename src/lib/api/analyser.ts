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

// ⚠️ Integrações oficiais ainda não configuradas neste projeto.
// Mantemos esta camada para quando você quiser habilitar:
// - TikTok: apenas APIs oficiais aprovadas pelo TikTok
// - Instagram: Meta/Instagram Graph API com OAuth (conta Business/Creator)
export const analyserApi = {
  async getTikTokUserFeed(_username: string): Promise<ApiResponse<UserFeedData>> {
    return {
      success: false,
      error: 'Integração oficial do TikTok não configurada. Use o Modo Upload.',
    };
  },

  async getInstagramUserFeed(_username: string): Promise<ApiResponse<UserFeedData>> {
    return {
      success: false,
      error: 'Integração oficial do Instagram não configurada. Use o Modo Upload.',
    };
  },
};
