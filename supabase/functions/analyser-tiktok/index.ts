const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TikWMVideoData {
  id: string;
  title: string;
  create_time: number;
  play_count: number;
  digg_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  cover: string;
  origin_cover: string;
  play: string; // Watermark-free video URL
  wmplay: string; // With watermark
  hdplay: string; // HD watermark-free
  author: {
    id: string;
    unique_id: string;
    nickname: string;
    avatar: string;
  };
}

interface TikWMUserFeedResponse {
  code: number;
  msg: string;
  data: {
    videos: TikWMVideoData[];
    cursor: string;
    hasMore: boolean;
  };
}

interface TikWMVideoResponse {
  code: number;
  msg: string;
  data: TikWMVideoData;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, username, videoUrl, cursor } = await req.json();

    if (action === 'user-feed') {
      // Get all videos from a user profile
      if (!username) {
        return new Response(
          JSON.stringify({ success: false, error: 'Username é obrigatório' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Clean username (remove @ if present)
      const cleanUsername = username.replace(/^@/, '').replace(/https?:\/\/(www\.)?tiktok\.com\/@?/, '').split('/')[0].split('?')[0];

      console.log('Fetching TikTok feed for:', cleanUsername);

      const allVideos: TikWMVideoData[] = [];
      let currentCursor = cursor || '0';
      let hasMore = true;
      let requestCount = 0;
      const maxRequests = 20; // Safety limit

      while (hasMore && requestCount < maxRequests) {
        const url = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(cleanUsername)}&count=35&cursor=${currentCursor}`;
        
        console.log(`Request ${requestCount + 1}: cursor=${currentCursor}`);
        
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (!response.ok) {
          console.error('TikWM API error:', response.status);
          throw new Error(`API retornou status ${response.status}`);
        }

        const data: TikWMUserFeedResponse = await response.json();

        if (data.code !== 0) {
          console.error('TikWM error:', data.msg);
          throw new Error(data.msg || 'Erro ao buscar vídeos');
        }

        if (data.data?.videos?.length) {
          allVideos.push(...data.data.videos);
          console.log(`Fetched ${data.data.videos.length} videos, total: ${allVideos.length}`);
        }

        hasMore = data.data?.hasMore || false;
        currentCursor = data.data?.cursor || '0';
        requestCount++;

        // Small delay to avoid rate limiting
        if (hasMore) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      console.log(`Total videos fetched: ${allVideos.length}`);

      // Transform to our format
      const videos = allVideos.map(v => ({
        id: v.id,
        platform: 'tiktok',
        thumbnail: v.cover || v.origin_cover,
        caption: v.title || '',
        publishedAt: new Date(v.create_time * 1000).toISOString(),
        views: v.play_count || 0,
        likes: v.digg_count || 0,
        comments: v.comment_count || 0,
        shares: v.share_count || 0,
        saves: v.collect_count || 0,
        permalink: `https://www.tiktok.com/@${cleanUsername}/video/${v.id}`,
        videoUrl: v.hdplay || v.play, // HD watermark-free URL
        videoUrlWatermark: v.wmplay,
        downloadable: true,
      }));

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: { 
            videos,
            username: cleanUsername,
            totalCount: videos.length,
          } 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'video-info') {
      // Get info for a single video
      if (!videoUrl) {
        return new Response(
          JSON.stringify({ success: false, error: 'URL do vídeo é obrigatória' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const url = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}&hd=1`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`API retornou status ${response.status}`);
      }

      const data: TikWMVideoResponse = await response.json();

      if (data.code !== 0) {
        throw new Error(data.msg || 'Erro ao buscar vídeo');
      }

      const v = data.data;
      const video = {
        id: v.id,
        platform: 'tiktok',
        thumbnail: v.cover || v.origin_cover,
        caption: v.title || '',
        publishedAt: new Date(v.create_time * 1000).toISOString(),
        views: v.play_count || 0,
        likes: v.digg_count || 0,
        comments: v.comment_count || 0,
        shares: v.share_count || 0,
        saves: v.collect_count || 0,
        permalink: `https://www.tiktok.com/@${v.author.unique_id}/video/${v.id}`,
        videoUrl: v.hdplay || v.play,
        videoUrlWatermark: v.wmplay,
        downloadable: true,
      };

      return new Response(
        JSON.stringify({ success: true, data: { video } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Ação inválida' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error in analyser-tiktok:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
