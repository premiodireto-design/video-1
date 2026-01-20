import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TikTokMedia {
  id: string;
  platform: 'tiktok';
  thumbnail: string;
  caption: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  permalink: string;
  videoUrl: string;
  downloadable: boolean;
}

// Helper to extract username from URL or handle
function extractUsername(input: string): string {
  input = input.trim();
  
  if (input.startsWith('@')) {
    input = input.substring(1);
  }
  
  const urlPatterns = [
    /tiktok\.com\/@([^\/\?]+)/i,
    /tiktok\.com\/([^\/\?@]+)/i,
  ];
  
  for (const pattern of urlPatterns) {
    const match = input.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return input.split('/')[0].split('?')[0];
}

// Parse TikTok post data
function parsePostData(item: any): TikTokMedia | null {
  try {
    const id = item.id || item.aweme_id || String(Date.now());
    
    // Get thumbnail
    let thumbnail = '';
    if (item.video?.cover?.url_list?.[0]) thumbnail = item.video.cover.url_list[0];
    else if (item.video?.dynamic_cover?.url_list?.[0]) thumbnail = item.video.dynamic_cover.url_list[0];
    else if (item.video?.origin_cover?.url_list?.[0]) thumbnail = item.video.origin_cover.url_list[0];
    
    // Get caption/description
    const caption = item.desc || item.description || '';
    
    // Get timestamp
    let timestamp = Date.now();
    if (item.create_time) timestamp = item.create_time * 1000;
    else if (item.createTime) timestamp = item.createTime * 1000;
    
    // Get metrics
    const stats = item.statistics || item.stats || {};
    const likes = stats.digg_count || stats.diggCount || item.digg_count || 0;
    const comments = stats.comment_count || stats.commentCount || item.comment_count || 0;
    const shares = stats.share_count || stats.shareCount || item.share_count || 0;
    const views = stats.play_count || stats.playCount || item.play_count || 0;
    const saves = stats.collect_count || stats.collectCount || item.collect_count || 0;
    
    // Get video URL - TikTok has multiple formats
    let videoUrl = '';
    if (item.video?.play_addr?.url_list?.[0]) {
      videoUrl = item.video.play_addr.url_list[0];
    } else if (item.video?.download_addr?.url_list?.[0]) {
      videoUrl = item.video.download_addr.url_list[0];
    }
    
    // Get author for permalink
    const authorId = item.author?.unique_id || item.author?.uniqueId || '';
    
    return {
      id: String(id),
      platform: 'tiktok',
      thumbnail,
      caption,
      publishedAt: new Date(timestamp).toISOString(),
      views,
      likes,
      comments,
      shares,
      saves,
      permalink: `https://www.tiktok.com/@${authorId}/video/${id}`,
      videoUrl,
      downloadable: !!videoUrl,
    };
  } catch (err) {
    console.error('Error parsing TikTok post:', err);
    return null;
  }
}

// Get common headers for TikTok requests
function getHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tiktok.com/',
    'Origin': 'https://www.tiktok.com',
  };
  
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  
  return headers;
}

// Get user info and secUid
async function getUserInfo(username: string, cookie?: string): Promise<{ 
  secUid?: string; 
  userId?: string;
  nickname?: string;
}> {
  try {
    console.log('Fetching TikTok user info...');
    
    // Try the user detail API
    const response = await fetch(`https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(username)}&secUid=`, {
      headers: getHeaders(cookie),
    });
    
    console.log(`User detail API status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      const user = data?.userInfo?.user;
      
      if (user) {
        console.log(`User found: ${user.uniqueId}, secUid: ${user.secUid?.slice(0, 20)}...`);
        return {
          secUid: user.secUid,
          userId: user.id,
          nickname: user.nickname,
        };
      }
    }
    
    // Fallback: try scraping the profile page
    console.log('Trying profile page scraping...');
    const pageResponse = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: getHeaders(cookie),
    });
    
    if (pageResponse.ok) {
      const html = await pageResponse.text();
      
      // Try to find SIGI_STATE or similar data
      const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
      if (sigiMatch) {
        try {
          const sigiData = JSON.parse(sigiMatch[1]);
          const userData = Object.values(sigiData?.UserModule?.users || {})[0] as any;
          if (userData) {
            console.log(`Found via SIGI_STATE: ${userData.uniqueId}`);
            return {
              secUid: userData.secUid,
              userId: userData.id,
              nickname: userData.nickname,
            };
          }
        } catch (e) {
          console.log('Failed to parse SIGI_STATE');
        }
      }
      
      // Try __UNIVERSAL_DATA_FOR_REHYDRATION__
      const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
      if (universalMatch) {
        try {
          const universalData = JSON.parse(universalMatch[1]);
          const userDetail = universalData?.["__DEFAULT_SCOPE__"]?.["webapp.user-detail"]?.userInfo?.user;
          if (userDetail) {
            console.log(`Found via UNIVERSAL_DATA: ${userDetail.uniqueId}`);
            return {
              secUid: userDetail.secUid,
              userId: userDetail.id,
              nickname: userDetail.nickname,
            };
          }
        } catch (e) {
          console.log('Failed to parse UNIVERSAL_DATA');
        }
      }
      
      // Try regex for secUid
      const secUidMatch = html.match(/"secUid":"([^"]+)"/);
      if (secUidMatch) {
        console.log(`Found secUid via regex: ${secUidMatch[1].slice(0, 20)}...`);
        return { secUid: secUidMatch[1] };
      }
    }
    
  } catch (err) {
    console.log('User info fetch failed:', err);
  }
  
  return {};
}

// Fetch user posts
async function fetchUserPosts(
  secUid: string, 
  count: number = 30, 
  cursor: number = 0,
  cookie?: string
): Promise<{ items: any[]; hasMore: boolean; cursor: number }> {
  try {
    const url = `https://www.tiktok.com/api/post/item_list/?secUid=${encodeURIComponent(secUid)}&count=${count}&cursor=${cursor}`;
    
    const response = await fetch(url, {
      headers: getHeaders(cookie),
    });
    
    console.log(`Post list API status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`Got ${data.itemList?.length || 0} posts, hasMore: ${data.hasMore}`);
      
      return {
        items: data.itemList || [],
        hasMore: data.hasMore || false,
        cursor: data.cursor || 0,
      };
    }
  } catch (err) {
    console.log('Post list fetch failed:', err);
  }
  
  return { items: [], hasMore: false, cursor: 0 };
}

// Fetch all videos with pagination
async function fetchAllVideos(username: string, maxVideos: number, cookie?: string): Promise<TikTokMedia[]> {
  const results: TikTokMedia[] = [];
  const seenIds = new Set<string>();
  
  // Get user info first
  const userInfo = await getUserInfo(username, cookie);
  
  if (!userInfo.secUid) {
    console.log('Could not get secUid - check if cookie is valid');
    return results;
  }
  
  console.log(`Fetching videos for secUid: ${userInfo.secUid.slice(0, 20)}...`);
  
  let cursor = 0;
  let pageCount = 0;
  const maxPages = 50;
  
  while (results.length < maxVideos && pageCount < maxPages) {
    console.log(`Fetching page ${pageCount + 1}, cursor: ${cursor}...`);
    
    await new Promise(r => setTimeout(r, 500));
    
    const pageData = await fetchUserPosts(userInfo.secUid, 30, cursor, cookie);
    
    if (pageData.items.length === 0) {
      console.log('No more items');
      break;
    }
    
    for (const item of pageData.items) {
      const media = parsePostData(item);
      if (media && !seenIds.has(media.id)) {
        seenIds.add(media.id);
        results.push(media);
      }
    }
    
    console.log(`Page ${pageCount + 1}: total ${results.length} videos`);
    
    if (!pageData.hasMore) {
      console.log('No more pages');
      break;
    }
    
    cursor = pageData.cursor;
    pageCount++;
  }
  
  console.log(`Final count: ${results.length} videos`);
  return results.slice(0, maxVideos);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { username, limit = 50, cookie } = await req.json();
    
    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username é obrigatório' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    // Use cookie from request, or fallback to env
    const effectiveCookie = cookie || Deno.env.get('TIKTOK_COOKIE') || '';
    
    const cleanUsername = extractUsername(username);
    
    console.log(`=== Fetching TikTok feed for: ${cleanUsername}, limit: ${limit}, hasCookie: ${!!effectiveCookie} ===`);
    
    if (!effectiveCookie) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cookie do TikTok não configurado. Configure seu cookie para acessar os vídeos.' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }
    
    const videos = await fetchAllVideos(cleanUsername, limit, effectiveCookie);
    
    if (videos.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Nenhum vídeo encontrado para @${cleanUsername}. Verifique se o perfil existe e possui vídeos, ou se seu cookie está válido.` 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        data: {
          username: cleanUsername,
          videos,
          totalCount: videos.length,
          hasMore: false,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Erro ao carregar perfil do TikTok' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
