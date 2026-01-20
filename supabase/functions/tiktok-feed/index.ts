import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TikTokMedia {
  id: string;
  platform: "tiktok";
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

function extractUsername(input: string): string {
  input = input.trim();
  if (input.startsWith("@")) input = input.substring(1);

  const urlPatterns = [/tiktok\.com\/@([^\/\?]+)/i, /tiktok\.com\/([^\/\?@]+)/i];
  for (const pattern of urlPatterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }

  return input.split("/")[0].split("?")[0];
}

// Mobile app headers - more reliable than web
function getMobileHeaders(cookie: string): Record<string, string> {
  return {
    "User-Agent": "com.ss.android.ugc.trill/2613 (Linux; U; Android 10; en_US; Pixel 4; Build/QQ3A.200805.001; Cronet/58.0.2991.0)",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Cookie": cookie,
  };
}

// Web headers with full browser simulation
function getWebHeaders(cookie: string): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cookie": cookie,
  };
}

function parseVideoItem(item: any, authorUsername: string): TikTokMedia | null {
  try {
    const id = item?.id || item?.aweme_id || item?.video?.id;
    if (!id) return null;

    const desc = item?.desc ?? "";
    const createTime = item?.createTime ?? item?.create_time;
    const timestampMs = createTime ? Number(createTime) * 1000 : Date.now();

    const stats = item?.stats ?? item?.statistics ?? item?.statsV2 ?? {};

    const likes = Number(stats?.diggCount ?? stats?.digg_count ?? 0);
    const comments = Number(stats?.commentCount ?? stats?.comment_count ?? 0);
    const shares = Number(stats?.shareCount ?? stats?.share_count ?? 0);
    const views = Number(stats?.playCount ?? stats?.play_count ?? 0);
    const saves = Number(stats?.collectCount ?? stats?.collect_count ?? 0);

    const thumbnail =
      item?.video?.cover ??
      item?.video?.dynamicCover ??
      item?.video?.originCover ??
      item?.video?.cover?.url_list?.[0] ??
      "";

    const permalink = `https://www.tiktok.com/@${authorUsername}/video/${id}`;
    const videoUrl = item?.video?.downloadAddr ?? item?.video?.playAddr ?? "";

    return {
      id: String(id),
      platform: "tiktok",
      thumbnail,
      caption: String(desc),
      publishedAt: new Date(timestampMs).toISOString(),
      views,
      likes,
      comments,
      shares,
      saves,
      permalink,
      videoUrl,
      downloadable: true,
    };
  } catch (err) {
    console.error("Error parsing TikTok item:", err);
    return null;
  }
}

// Try to get user data from mobile API
async function tryMobileApi(username: string, cookie: string): Promise<{ videos: TikTokMedia[]; secUid?: string }> {
  const videos: TikTokMedia[] = [];
  
  try {
    // First get user info via web to get secUid
    const webResponse = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: getWebHeaders(cookie),
    });
    
    if (!webResponse.ok) {
      console.log(`Web response failed: ${webResponse.status}`);
      return { videos };
    }
    
    const html = await webResponse.text();
    console.log(`Got HTML: ${html.length} bytes`);
    
    // Extract data from SIGI_STATE or UNIVERSAL_DATA
    let secUid = "";
    let itemsFromPage: any[] = [];
    
    // Try __UNIVERSAL_DATA_FOR_REHYDRATION__
    const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/);
    if (universalMatch) {
      try {
        const data = JSON.parse(universalMatch[1]);
        const defaultScope = data?.["__DEFAULT_SCOPE__"] || {};
        
        const userDetail = defaultScope["webapp.user-detail"];
        secUid = userDetail?.userInfo?.user?.secUid || "";
        
        const userPost = defaultScope["webapp.user-post"];
        itemsFromPage = userPost?.itemList || [];
        
        console.log(`UNIVERSAL_DATA: secUid=${secUid ? "found" : "none"}, items=${itemsFromPage.length}`);
      } catch (e) {
        console.log("Failed to parse UNIVERSAL_DATA");
      }
    }
    
    // Try SIGI_STATE
    const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
    if (sigiMatch) {
      try {
        const data = JSON.parse(sigiMatch[1]);
        
        if (!secUid) {
          const userModule = data?.UserModule?.users || {};
          const userData = Object.values(userModule)[0] as any;
          secUid = userData?.secUid || "";
        }
        
        const itemModule = data?.ItemModule || {};
        const sigiItems = Object.values(itemModule) as any[];
        
        if (sigiItems.length > itemsFromPage.length) {
          itemsFromPage = sigiItems;
        }
        
        console.log(`SIGI_STATE: secUid=${secUid ? "found" : "none"}, items=${sigiItems.length}`);
      } catch (e) {
        console.log("Failed to parse SIGI_STATE");
      }
    }
    
    // Try __NEXT_DATA__
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
    if (nextDataMatch && itemsFromPage.length === 0) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const pageProps = data?.props?.pageProps;
        
        if (!secUid && pageProps?.userInfo?.user?.secUid) {
          secUid = pageProps.userInfo.user.secUid;
        }
        
        const items = pageProps?.items || [];
        if (items.length > 0) {
          itemsFromPage = items;
          console.log(`NEXT_DATA: items=${items.length}`);
        }
      } catch (e) {
        console.log("Failed to parse NEXT_DATA");
      }
    }
    
    // Parse items from page
    for (const item of itemsFromPage) {
      const video = parseVideoItem(item, username);
      if (video) videos.push(video);
    }
    
    console.log(`Parsed ${videos.length} videos from page`);
    
    // If we have secUid, try to get more via API
    if (secUid && videos.length > 0) {
      console.log("Attempting to fetch more via API...");
      
      // Try the post list API with proper parameters
      let cursor = 0;
      let hasMore = true;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (hasMore && attempts < maxAttempts && videos.length < 500) {
        attempts++;
        await new Promise(r => setTimeout(r, 1000)); // Rate limit
        
        const apiUrl = `https://www.tiktok.com/api/post/item_list/?WebIdLastTime=${Math.floor(Date.now() / 1000)}&aid=1988&app_language=pt&app_name=tiktok_web&browser_language=pt-BR&browser_name=Mozilla&browser_online=true&browser_platform=Win32&browser_version=5.0&channel=tiktok_web&cookie_enabled=true&count=35&coverFormat=2&cursor=${cursor}&device_id=${Date.now()}&device_platform=web_pc&focus_state=true&from_page=user&history_len=2&is_fullscreen=false&is_page_visible=true&language=pt&os=windows&priority_region=&referer=&region=BR&screen_height=1080&screen_width=1920&secUid=${encodeURIComponent(secUid)}&tz_name=America/Sao_Paulo&webcast_language=pt`;
        
        try {
          const apiResponse = await fetch(apiUrl, {
            headers: {
              ...getWebHeaders(cookie),
              "Accept": "application/json, text/plain, */*",
              "Referer": `https://www.tiktok.com/@${username}`,
            },
          });
          
          if (apiResponse.ok) {
            const apiText = await apiResponse.text();
            if (apiText.length > 50) {
              const apiData = JSON.parse(apiText);
              const newItems = apiData?.itemList || [];
              
              console.log(`API page ${attempts}: ${newItems.length} items`);
              
              for (const item of newItems) {
                const video = parseVideoItem(item, username);
                if (video && !videos.find(v => v.id === video.id)) {
                  videos.push(video);
                }
              }
              
              hasMore = apiData?.hasMore || false;
              cursor = apiData?.cursor || 0;
            } else {
              console.log("Empty API response");
              break;
            }
          } else {
            console.log(`API response failed: ${apiResponse.status}`);
            break;
          }
        } catch (e) {
          console.log("API fetch error:", e);
          break;
        }
      }
    }
    
    return { videos, secUid };
  } catch (err) {
    console.error("Error in tryMobileApi:", err);
    return { videos };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username, limit = 50, cookie } = await req.json();

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: "Username é obrigatório" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const effectiveCookie = cookie || Deno.env.get("TIKTOK_COOKIE") || "";
    if (!effectiveCookie) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cookie do TikTok não configurado. Configure seu cookie para acessar os vídeos.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const cleanUsername = extractUsername(username);
    console.log(`=== Fetching TikTok feed for: ${cleanUsername}, limit: ${limit} ===`);

    const result = await tryMobileApi(cleanUsername, effectiveCookie);
    
    if (result.videos.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Nenhum vídeo encontrado para @${cleanUsername}. Verifique se o perfil existe e está público, e se seu cookie está válido e atualizado.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // Limit results
    const videos = result.videos.slice(0, Number(limit));
    
    console.log(`=== Success: returning ${videos.length} videos ===`);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          username: cleanUsername,
          videos,
          totalCount: videos.length,
          hasMore: result.videos.length > videos.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Erro ao carregar perfil do TikTok" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
