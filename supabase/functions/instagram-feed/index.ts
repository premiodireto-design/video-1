import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InstagramMedia {
  id: string;
  platform: 'instagram';
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
    /instagram\.com\/([^\/\?]+)/i,
    /instagr\.am\/([^\/\?]+)/i,
  ];
  
  for (const pattern of urlPatterns) {
    const match = input.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return input.split('/')[0].split('?')[0];
}

// Check if a node is a video
function isVideoNode(node: any): boolean {
  if (!node) return false;
  
  // Check multiple indicators
  if (node.is_video === true) return true;
  if (node.__typename === 'GraphVideo') return true;
  if (node.__typename === 'XDTGraphVideo') return true;
  if (node.media_type === 2) return true; // 2 = video in Instagram API
  if (node.product_type === 'clips' || node.product_type === 'reels') return true;
  if (node.video_url) return true;
  if (node.video_versions && node.video_versions.length > 0) return true;
  
  return false;
}

// Parse Instagram post data from various formats
function parsePostData(node: any): InstagramMedia | null {
  try {
    const id = node.id || node.pk || String(Date.now());
    const shortcode = node.shortcode || node.code || '';
    
    // Get thumbnail
    let thumbnail = '';
    if (node.thumbnail_src) thumbnail = node.thumbnail_src;
    else if (node.display_url) thumbnail = node.display_url;
    else if (node.image_versions2?.candidates?.[0]?.url) thumbnail = node.image_versions2.candidates[0].url;
    else if (node.thumbnail_url) thumbnail = node.thumbnail_url;
    
    // Get caption
    let caption = '';
    if (node.edge_media_to_caption?.edges?.[0]?.node?.text) {
      caption = node.edge_media_to_caption.edges[0].node.text;
    } else if (node.caption?.text) {
      caption = node.caption.text;
    } else if (typeof node.caption === 'string') {
      caption = node.caption;
    }
    
    // Get timestamp
    let timestamp = Date.now();
    if (node.taken_at_timestamp) timestamp = node.taken_at_timestamp * 1000;
    else if (node.taken_at) timestamp = node.taken_at * 1000;
    
    // Get metrics
    const likes = node.edge_media_preview_like?.count || node.like_count || node.likes?.count || 0;
    const comments = node.edge_media_to_comment?.count || node.comment_count || node.comments?.count || 0;
    const views = node.video_view_count || node.view_count || node.play_count || 0;
    
    // Get video URL
    let videoUrl = '';
    if (node.video_url) videoUrl = node.video_url;
    else if (node.video_versions?.[0]?.url) videoUrl = node.video_versions[0].url;
    
    return {
      id: String(id),
      platform: 'instagram',
      thumbnail,
      caption,
      publishedAt: new Date(timestamp).toISOString(),
      views,
      likes,
      comments,
      shares: 0,
      saves: 0,
      permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/` : `https://www.instagram.com/reel/${id}/`,
      videoUrl,
      downloadable: !!videoUrl,
    };
  } catch (err) {
    console.error('Error parsing post:', err);
    return null;
  }
}

// Get common headers for Instagram requests
function getHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-App-ID': '936619743392459',
    'X-ASBD-ID': '129477',
    'X-IG-WWW-Claim': '0',
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Referer': 'https://www.instagram.com/',
    'Origin': 'https://www.instagram.com',
  };
  
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  
  return headers;
}

// Fetch user media using the v1 API endpoint (most reliable with auth)
async function fetchUserMediaV1(
  userId: string, 
  count: number = 50, 
  maxId?: string,
  cookie?: string
): Promise<{ items: any[]; hasMore: boolean; nextMaxId?: string }> {
  let url = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=${count}`;
  if (maxId) {
    url += `&max_id=${maxId}`;
  }
  
  try {
    const response = await fetch(url, {
      headers: getHeaders(cookie),
    });
    
    console.log(`V1 API status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`V1 API returned ${data.items?.length || 0} items, more: ${data.more_available}`);
      return {
        items: data.items || [],
        hasMore: data.more_available || false,
        nextMaxId: data.next_max_id,
      };
    } else {
      console.log(`V1 API error: ${response.status}`);
    }
  } catch (err) {
    console.log('V1 API fetch failed:', err);
  }
  
  return { items: [], hasMore: false };
}

// Get user ID and initial posts from profile
async function getProfileData(username: string, cookie?: string): Promise<{ 
  userId?: string; 
  posts: any[]; 
  hasNextPage: boolean; 
  endCursor?: string;
  totalCount?: number;
}> {
  try {
    console.log('Fetching profile data...');
    
    const response = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers: getHeaders(cookie),
    });
    
    console.log(`Profile API status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      const user = data?.data?.user;
      
      if (user) {
        const mediaData = user.edge_owner_to_timeline_media;
        const reelsData = user.edge_felix_video_timeline;
        
        console.log(`Profile found. User ID: ${user.id}`);
        console.log(`  - Timeline posts: ${mediaData?.count || 0}`);
        console.log(`  - Reels: ${reelsData?.count || 0}`);
        
        return {
          userId: user.id,
          posts: mediaData?.edges || [],
          hasNextPage: mediaData?.page_info?.has_next_page || false,
          endCursor: mediaData?.page_info?.end_cursor,
          totalCount: mediaData?.count || 0,
        };
      }
    } else if (response.status === 401) {
      console.log('Unauthorized - cookie may be invalid or expired');
    }
    
  } catch (err) {
    console.log('Profile fetch failed:', err);
  }
  
  return { posts: [], hasNextPage: false };
}

// Fetch all videos with pagination using V1 API
async function fetchAllVideos(username: string, maxVideos: number, cookie?: string): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];
  const seenIds = new Set<string>();
  
  // Get initial profile data to get user ID
  const profileData = await getProfileData(username, cookie);
  
  if (!profileData.userId) {
    console.log('Could not get user ID - check if cookie is valid');
    return results;
  }
  
  console.log(`Total posts in profile: ${profileData.totalCount || 'unknown'}`);
  
  // Process initial GraphQL posts first
  for (const edge of profileData.posts) {
    const node = edge.node;
    if (isVideoNode(node)) {
      const media = parsePostData(node);
      if (media && !seenIds.has(media.id)) {
        seenIds.add(media.id);
        results.push(media);
      }
    }
  }
  
  console.log(`Got ${results.length} videos from initial fetch`);
  
  // Now use V1 API for pagination (more reliable)
  let maxId: string | undefined;
  let pageCount = 0;
  const maxPages = 30; // Allow up to 30 pages
  
  while (results.length < maxVideos && pageCount < maxPages) {
    console.log(`Fetching V1 page ${pageCount + 1}...`);
    
    await new Promise(r => setTimeout(r, 400));
    
    const pageData = await fetchUserMediaV1(profileData.userId, 50, maxId, cookie);
    
    if (pageData.items.length === 0) {
      console.log('No more items from V1 API');
      break;
    }
    
    let videosInPage = 0;
    for (const item of pageData.items) {
      if (isVideoNode(item)) {
        const media = parsePostData(item);
        if (media && !seenIds.has(media.id)) {
          seenIds.add(media.id);
          results.push(media);
          videosInPage++;
        }
      }
    }
    
    console.log(`V1 Page ${pageCount + 1}: +${videosInPage} videos, total: ${results.length}`);
    
    if (!pageData.hasMore) {
      console.log('No more pages from V1 API');
      break;
    }
    
    maxId = pageData.nextMaxId;
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
    const effectiveCookie = cookie || Deno.env.get('INSTAGRAM_COOKIE') || '';
    
    const cleanUsername = extractUsername(username);
    
    console.log(`=== Fetching Instagram feed for: ${cleanUsername}, limit: ${limit}, hasCookie: ${!!effectiveCookie} ===`);
    
    if (!effectiveCookie) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cookie do Instagram não configurado. Configure seu cookie para acessar os vídeos.' 
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
      JSON.stringify({ success: false, error: 'Erro ao carregar perfil do Instagram' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
