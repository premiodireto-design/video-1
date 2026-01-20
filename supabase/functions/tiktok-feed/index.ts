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

// Get common headers for TikTok requests
function getHeaders(cookie: string): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cookie': cookie,
  };
}

// Parse video from TikTok data structures
function parseVideoItem(item: any, authorUsername: string): TikTokMedia | null {
  try {
    const id = item.id || item.video?.id || String(Date.now());
    
    // Get thumbnail
    let thumbnail = '';
    if (item.video?.cover) thumbnail = item.video.cover;
    else if (item.video?.dynamicCover) thumbnail = item.video.dynamicCover;
    else if (item.video?.originCover) thumbnail = item.video.originCover;
    
    // Get caption/description
    const caption = item.desc || '';
    
    // Get timestamp
    let timestamp = Date.now();
    if (item.createTime) timestamp = Number(item.createTime) * 1000;
    
    // Get metrics from stats
    const stats = item.stats || {};
    const likes = stats.diggCount || 0;
    const comments = stats.commentCount || 0;
    const shares = stats.shareCount || 0;
    const views = stats.playCount || 0;
    const saves = stats.collectCount || 0;
    
    // Video URL - TikTok requires download from their API
    // We'll use the permalink for downloading with watermark
    const videoUrl = item.video?.downloadAddr || item.video?.playAddr || '';
    
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
      permalink: `https://www.tiktok.com/@${authorUsername}/video/${id}`,
      videoUrl,
      downloadable: true,
    };
  } catch (err) {
    console.error('Error parsing TikTok item:', err);
    return null;
  }
}

// Scrape profile page to get videos
async function scrapeProfilePage(username: string, cookie: string): Promise<{ videos: TikTokMedia[]; secUid?: string; cursor?: string }> {
  const videos: TikTokMedia[] = [];
  
  try {
    console.log(`Fetching profile page for @${username}...`);
    
    const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: getHeaders(cookie),
    });
    
    console.log(`Profile page status: ${response.status}`);
    
    if (!response.ok) {
      console.log(`Profile page fetch failed: ${response.status}`);
      return { videos };
    }
    
    const html = await response.text();
    console.log(`Got HTML (${html.length} bytes)`);
    
    // Try multiple patterns to find video data
    
    // Pattern 1: __UNIVERSAL_DATA_FOR_REHYDRATION__
    const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
    if (universalMatch) {
      try {
        console.log('Found __UNIVERSAL_DATA_FOR_REHYDRATION__');
        const data = JSON.parse(universalMatch[1]);
        const defaultScope = data?.["__DEFAULT_SCOPE__"] || {};
        
        // Get user detail
        const userDetail = defaultScope["webapp.user-detail"];
        const user = userDetail?.userInfo?.user;
        const secUid = user?.secUid;
        
        console.log(`User: ${user?.uniqueId}, secUid: ${secUid ? secUid.slice(0, 20) + '...' : 'none'}`);
        
        // Get videos from user-post
        const userPost = defaultScope["webapp.user-post"];
        const itemList = userPost?.itemList || [];
        
        console.log(`Found ${itemList.length} videos in webapp.user-post`);
        
        for (const item of itemList) {
          const video = parseVideoItem(item, username);
          if (video) videos.push(video);
        }
        
        return { videos, secUid, cursor: userPost?.cursor };
      } catch (e) {
        console.log('Failed to parse UNIVERSAL_DATA:', e);
      }
    }
    
    // Pattern 2: SIGI_STATE
    const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
    if (sigiMatch) {
      try {
        console.log('Found SIGI_STATE');
        const data = JSON.parse(sigiMatch[1]);
        
        // Get user info
        const userModule = data?.UserModule || {};
        const users = userModule?.users || {};
        const userData = Object.values(users)[0] as any;
        const secUid = userData?.secUid;
        
        // Get items
        const itemModule = data?.ItemModule || {};
        const items = Object.values(itemModule) as any[];
        
        console.log(`Found ${items.length} videos in SIGI_STATE`);
        
        for (const item of items) {
          const video = parseVideoItem(item, username);
          if (video) videos.push(video);
        }
        
        return { videos, secUid };
      } catch (e) {
        console.log('Failed to parse SIGI_STATE:', e);
      }
    }
    
    // Pattern 3: Look for JSON-LD or other embedded data
    const scriptMatches = html.matchAll(/<script[^>]*>([^<]*itemList[^<]*)<\/script>/g);
    for (const match of scriptMatches) {
      try {
        const content = match[1];
        if (content.includes('"itemList"')) {
          // Try to parse as JSON
          const jsonMatch = content.match(/\{.*"itemList".*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            const itemList = data.itemList || [];
            console.log(`Found ${itemList.length} videos via itemList pattern`);
            
            for (const item of itemList) {
              const video = parseVideoItem(item, username);
              if (video) videos.push(video);
            }
          }
        }
      } catch (e) {
        // Continue to next match
      }
    }
    
    // Pattern 4: Look for video IDs and basic data in the HTML
    if (videos.length === 0) {
      console.log('Trying regex extraction...');
      
      // Extract video IDs
      const videoIdMatches = html.matchAll(/"id":"(\d{19,})"/g);
      const videoIds = [...new Set([...videoIdMatches].map(m => m[1]))];
      
      // Extract stats where possible
      const statsMatches = html.matchAll(/"playCount":(\d+).*?"diggCount":(\d+).*?"commentCount":(\d+)/g);
      const stats = [...statsMatches];
      
      console.log(`Found ${videoIds.length} video IDs via regex`);
      
      for (let i = 0; i < Math.min(videoIds.length, 30); i++) {
        videos.push({
          id: videoIds[i],
          platform: 'tiktok',
          thumbnail: '',
          caption: '',
          publishedAt: new Date().toISOString(),
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          permalink: `https://www.tiktok.com/@${username}/video/${videoIds[i]}`,
          videoUrl: '',
          downloadable: true,
        });
      }
    }
    
  } catch (err) {
    console.error('Error scraping profile:', err);
  }
  
  return { videos };
}

// Fetch more videos via API with secUid
async function fetchMoreVideos(secUid: string, cursor: string, count: number, cookie: string): Promise<{ items: any[]; cursor?: string; hasMore: boolean }> {
  try {
    const apiUrl = `https://www.tiktok.com/api/post/item_list/?WebIdLastTime=1704067200&aid=1988&app_language=en&app_name=tiktok_web&browser_language=en-US&browser_name=Mozilla&browser_online=true&browser_platform=Win32&browser_version=5.0&channel=tiktok_web&cookie_enabled=true&count=${count}&coverFormat=2&cursor=${cursor}&device_id=7321234567890123456&device_platform=web_pc&focus_state=true&from_page=user&history_len=3&is_fullscreen=false&is_page_visible=true&language=en&os=windows&priority_region=&referer=&region=US&screen_height=1080&screen_width=1920&secUid=${encodeURIComponent(secUid)}&tz_name=America/New_York&webcast_language=en`;
    
    console.log(`Fetching more videos, cursor: ${cursor}...`);
    
    const response = await fetch(apiUrl, {
      headers: {
        ...getHeaders(cookie),
        'Accept': 'application/json',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Referer': 'https://www.tiktok.com/',
      },
    });
    
    console.log(`API response status: ${response.status}`);
    
    if (!response.ok) {
      return { items: [], hasMore: false };
    }
    
    const text = await response.text();
    console.log(`API response length: ${text.length}`);
    
    if (text.length < 10) {
      console.log('Empty response from API');
      return { items: [], hasMore: false };
    }
    
    const data = JSON.parse(text);
    
    return {
      items: data.itemList || [],
      cursor: data.cursor,
      hasMore: data.hasMore || false,
    };
  } catch (err) {
    console.error('Error fetching more videos:', err);
    return { items: [], hasMore: false };
  }
}

// Main function to get all videos
async function getAllVideos(username: string, maxVideos: number, cookie: string): Promise<TikTokMedia[]> {
  const allVideos: TikTokMedia[] = [];
  const seenIds = new Set<string>();
  
  // Start with profile scrape
  const initial = await scrapeProfilePage(username, cookie);
  
  for (const video of initial.videos) {
    if (!seenIds.has(video.id)) {
      seenIds.add(video.id);
      allVideos.push(video);
    }
  }
  
  console.log(`Initial scrape: ${allVideos.length} videos`);
  
  // If we have secUid and need more videos, paginate
  if (initial.secUid && initial.cursor && allVideos.length < maxVideos) {
    let cursor = initial.cursor;
    let pageCount = 0;
    const maxPages = 30;
    
    while (allVideos.length < maxVideos && pageCount < maxPages) {
      await new Promise(r => setTimeout(r, 800)); // Rate limiting
      
      const more = await fetchMoreVideos(initial.secUid, cursor, 35, cookie);
      
      if (more.items.length === 0) {
        console.log('No more items from API');
        break;
      }
      
      for (const item of more.items) {
        const video = parseVideoItem(item, username);
        if (video && !seenIds.has(video.id)) {
          seenIds.add(video.id);
          allVideos.push(video);
        }
      }
      
      console.log(`Page ${pageCount + 1}: total ${allVideos.length} videos`);
      
      if (!more.hasMore || !more.cursor) break;
      
      cursor = more.cursor;
      pageCount++;
    }
  }
  
  return allVideos.slice(0, maxVideos);
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
    
    const effectiveCookie = cookie || Deno.env.get('TIKTOK_COOKIE') || '';
    
    if (!effectiveCookie) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cookie do TikTok não configurado. Configure seu cookie para acessar os vídeos.' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }
    
    const cleanUsername = extractUsername(username);
    
    console.log(`=== Fetching TikTok feed for: ${cleanUsername}, limit: ${limit} ===`);
    
    const videos = await getAllVideos(cleanUsername, limit, effectiveCookie);
    
    if (videos.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Nenhum vídeo encontrado para @${cleanUsername}. Verifique se o perfil existe, está público, e se seu cookie está válido.` 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }
    
    console.log(`=== Success: returning ${videos.length} videos ===`);
    
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
