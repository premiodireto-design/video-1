const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InstagramMediaItem {
  id: string;
  shortcode: string;
  display_url: string;
  video_url?: string;
  is_video: boolean;
  edge_media_preview_like: { count: number };
  edge_media_to_comment: { count: number };
  taken_at_timestamp: number;
  edge_media_to_caption?: { edges: Array<{ node: { text: string } }> };
  video_view_count?: number;
}

interface InstagramUserData {
  id: string;
  username: string;
  full_name: string;
  profile_pic_url: string;
  edge_owner_to_timeline_media: {
    count: number;
    page_info: { has_next_page: boolean; end_cursor: string };
    edges: Array<{ node: InstagramMediaItem }>;
  };
}

// Alternative API endpoint (similar to how browser extensions work)
const INSTAGRAM_GRAPHQL_URL = 'https://www.instagram.com/graphql/query/';
const USER_POSTS_QUERY_HASH = '003056d32c2554def87228bc3fd9668a'; // May need updates

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, username, postUrl, cursor } = await req.json();

    if (action === 'user-feed') {
      if (!username) {
        return new Response(
          JSON.stringify({ success: false, error: 'Username é obrigatório' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Clean username
      const cleanUsername = username
        .replace(/^@/, '')
        .replace(/https?:\/\/(www\.)?instagram\.com\//, '')
        .split('/')[0]
        .split('?')[0];

      console.log('Fetching Instagram feed for:', cleanUsername);

      // Method 1: Try the public profile page JSON endpoint
      try {
        const profileUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${cleanUsername}`;
        
        const response = await fetch(profileUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Instagram 76.0.0.15.395 Android (24/7.0; 640dpi; 1440x2560; samsung; SM-G930F; herolte; samsungexynos8890; en_US)',
            'X-IG-App-ID': '936619743392459',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const user = data.data?.user;
          
          if (user) {
            const mediaEdges = user.edge_owner_to_timeline_media?.edges || [];
            
            const videos = mediaEdges
              .filter((edge: any) => edge.node.is_video)
              .map((edge: any) => {
                const node = edge.node;
                const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
                
                return {
                  id: node.id,
                  platform: 'instagram',
                  thumbnail: node.display_url,
                  caption,
                  publishedAt: new Date(node.taken_at_timestamp * 1000).toISOString(),
                  views: node.video_view_count || 0,
                  likes: node.edge_media_preview_like?.count || 0,
                  comments: node.edge_media_to_comment?.count || 0,
                  shares: 0,
                  saves: 0,
                  permalink: `https://www.instagram.com/reel/${node.shortcode}/`,
                  videoUrl: node.video_url || '',
                  downloadable: !!node.video_url,
                };
              });

            return new Response(
              JSON.stringify({
                success: true,
                data: {
                  videos,
                  username: cleanUsername,
                  totalCount: videos.length,
                  hasMore: user.edge_owner_to_timeline_media?.page_info?.has_next_page || false,
                },
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      } catch (err) {
        console.warn('Instagram API method 1 failed:', err);
      }

      // Method 2: Try alternative scraping service
      try {
        const scraperUrl = `https://igram.world/api/ig/userInfoByUsername/${cleanUsername}`;
        
        const response = await fetch(scraperUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.result?.user) {
            // This endpoint might have limited video data
            // We'll need the user ID to fetch posts
            const userId = data.result.user.pk;
            
            // Try to get posts using the user ID
            const postsUrl = `https://igram.world/api/ig/posts/${userId}?max_id=`;
            const postsResponse = await fetch(postsUrl, {
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            });

            if (postsResponse.ok) {
              const postsData = await postsResponse.json();
              const items = postsData.result?.items || [];
              
              const videos = items
                .filter((item: any) => item.media_type === 2 || item.video_versions)
                .map((item: any) => ({
                  id: item.pk || item.id,
                  platform: 'instagram',
                  thumbnail: item.image_versions2?.candidates?.[0]?.url || item.thumbnail_url || '',
                  caption: item.caption?.text || '',
                  publishedAt: new Date(item.taken_at * 1000).toISOString(),
                  views: item.view_count || item.play_count || 0,
                  likes: item.like_count || 0,
                  comments: item.comment_count || 0,
                  shares: item.reshare_count || 0,
                  saves: item.save_count || 0,
                  permalink: `https://www.instagram.com/reel/${item.code}/`,
                  videoUrl: item.video_versions?.[0]?.url || '',
                  downloadable: !!item.video_versions?.length,
                }));

              return new Response(
                JSON.stringify({
                  success: true,
                  data: {
                    videos,
                    username: cleanUsername,
                    totalCount: videos.length,
                  },
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          }
        }
      } catch (err) {
        console.warn('Instagram API method 2 failed:', err);
      }

      // If all methods fail, return helpful message
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Não foi possível acessar o perfil do Instagram. O perfil pode ser privado ou a API está temporariamente indisponível. Tente usar o Modo Upload com seus vídeos exportados.',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'post-info') {
      if (!postUrl) {
        return new Response(
          JSON.stringify({ success: false, error: 'URL do post é obrigatória' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Extract shortcode from URL
      const shortcodeMatch = postUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (!shortcodeMatch) {
        return new Response(
          JSON.stringify({ success: false, error: 'URL do Instagram inválida' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const shortcode = shortcodeMatch[2];
      console.log('Fetching Instagram post:', shortcode);

      // Try to get post info
      const postInfoUrl = `https://igram.world/api/ig/media_info/${shortcode}`;
      
      const response = await fetch(postInfoUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error('Não foi possível obter informações do post');
      }

      const data = await response.json();
      const item = data.result?.items?.[0];

      if (!item) {
        throw new Error('Post não encontrado');
      }

      const video = {
        id: item.pk || item.id,
        platform: 'instagram',
        thumbnail: item.image_versions2?.candidates?.[0]?.url || '',
        caption: item.caption?.text || '',
        publishedAt: new Date(item.taken_at * 1000).toISOString(),
        views: item.view_count || item.play_count || 0,
        likes: item.like_count || 0,
        comments: item.comment_count || 0,
        shares: item.reshare_count || 0,
        saves: item.save_count || 0,
        permalink: `https://www.instagram.com/reel/${item.code}/`,
        videoUrl: item.video_versions?.[0]?.url || '',
        downloadable: !!item.video_versions?.length,
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
    console.error('Error in analyser-instagram:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
