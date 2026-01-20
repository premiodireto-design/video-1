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

function getHeaders(cookie: string): Record<string, string> {
  // Keep headers browser-like; TikTok can be picky with server requests.
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
    Cookie: cookie,
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

    // thumbnail can have many shapes
    const thumbnail =
      item?.video?.cover ??
      item?.video?.dynamicCover ??
      item?.video?.originCover ??
      item?.video?.cover?.url_list?.[0] ??
      item?.video?.dynamic_cover?.url_list?.[0] ??
      item?.video?.origin_cover?.url_list?.[0] ??
      "";

    // Keep watermark: best approach is using the canonical permalink; downloader will resolve.
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

async function scrapeProfilePage(
  username: string,
  cookie: string,
): Promise<{ videos: TikTokMedia[]; secUid?: string; cursor?: string }> {
  const videos: TikTokMedia[] = [];
  let extractedSecUid: string | undefined;
  let extractedCursor: string | undefined;

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

    // Pattern A: __UNIVERSAL_DATA_FOR_REHYDRATION__
    const universalMatch = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/,
    );

    if (universalMatch) {
      try {
        console.log("Found __UNIVERSAL_DATA_FOR_REHYDRATION__");
        const data = JSON.parse(universalMatch[1]);
        const defaultScope = data?.["__DEFAULT_SCOPE__"] || {};

        const userDetail = defaultScope["webapp.user-detail"];
        const user = userDetail?.userInfo?.user;
        extractedSecUid = user?.secUid;

        // posts can be empty here; do NOT early return
        const userPost = defaultScope["webapp.user-post"];
        const itemList = userPost?.itemList || [];
        extractedCursor = userPost?.cursor != null ? String(userPost.cursor) : undefined;

        console.log(
          `User: ${user?.uniqueId}, secUid: ${extractedSecUid ? extractedSecUid.slice(0, 20) + "..." : "none"}`,
        );
        console.log(`Found ${itemList.length} videos in webapp.user-post`);

        for (const item of itemList) {
          const v = parseVideoItem(item, username);
          if (v) videos.push(v);
        }
      } catch (e) {
        console.log("Failed to parse UNIVERSAL_DATA:", e);
      }
    }

    // Pattern B: SIGI_STATE (often includes ItemModule)
    const sigiMatch = html.match(/<script id="SIGI_STATE"[^>]*>([^<]+)<\/script>/);
    if (sigiMatch) {
      try {
        console.log("Found SIGI_STATE");
        const data = JSON.parse(sigiMatch[1]);

        const userModule = data?.UserModule || {};
        const users = userModule?.users || {};
        const userData = Object.values(users)[0] as any;
        if (!extractedSecUid) extractedSecUid = userData?.secUid;

        const itemModule = data?.ItemModule || {};
        const items = Object.values(itemModule) as any[];

        console.log(`Found ${items.length} videos in SIGI_STATE`);
        for (const item of items) {
          const v = parseVideoItem(item, username);
          if (v) videos.push(v);
        }
      } catch (e) {
        console.log("Failed to parse SIGI_STATE:", e);
      }
    }

    // Pattern C: last resort - regex ids
    if (videos.length === 0) {
      console.log("Trying regex extraction...");
      const videoIdMatches = html.matchAll(/\"id\":\"(\d{19,})\"/g);
      const videoIds = [...new Set([...videoIdMatches].map((m) => m[1]))];
      console.log(`Found ${videoIds.length} video IDs via regex`);

      for (let i = 0; i < Math.min(videoIds.length, 30); i++) {
        videos.push({
          id: videoIds[i],
          platform: "tiktok",
          thumbnail: "",
          caption: "",
          publishedAt: new Date().toISOString(),
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          permalink: `https://www.tiktok.com/@${username}/video/${videoIds[i]}`,
          videoUrl: "",
          downloadable: true,
        });
      }
    }
  } catch (err) {
    console.error("Error scraping profile:", err);
  }

  return { videos, secUid: extractedSecUid, cursor: extractedCursor };
}

async function fetchMoreVideos(
  secUid: string,
  cursor: string,
  count: number,
  cookie: string,
): Promise<{ items: any[]; cursor?: string; hasMore: boolean }> {
  try {
    // Keep this endpoint simple; if it returns empty, TikTok is likely blocking server-side.
    const apiUrl = `https://www.tiktok.com/api/post/item_list/?secUid=${encodeURIComponent(secUid)}&count=${count}&cursor=${encodeURIComponent(cursor)}`;

    console.log(`Fetching API page cursor=${cursor}...`);

    const response = await fetch(apiUrl, {
      headers: {
        ...getHeaders(cookie),
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.tiktok.com/",
        Origin: "https://www.tiktok.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
    });

    console.log(`API response status: ${response.status}`);

    if (!response.ok) {
      return { items: [], hasMore: false };
    }

    const text = await response.text();
    console.log(`API response length: ${text.length}`);

    if (text.trim().length < 10) {
      console.log("Empty response from API");
      return { items: [], hasMore: false };
    }

    const data = JSON.parse(text);

    return {
      items: data.itemList || [],
      cursor: data.cursor != null ? String(data.cursor) : undefined,
      hasMore: !!data.hasMore,
    };
  } catch (err) {
    console.error("Error fetching more videos:", err);
    return { items: [], hasMore: false };
  }
}

async function getAllVideos(username: string, maxVideos: number, cookie: string): Promise<TikTokMedia[]> {
  const allVideos: TikTokMedia[] = [];
  const seenIds = new Set<string>();

  const initial = await scrapeProfilePage(username, cookie);

  for (const v of initial.videos) {
    if (!seenIds.has(v.id)) {
      seenIds.add(v.id);
      allVideos.push(v);
    }
  }

  console.log(`Initial scrape: ${allVideos.length} videos`);

  // If we have secUid, try pagination even if cursor is missing.
  if (initial.secUid && allVideos.length < maxVideos) {
    let cursor = initial.cursor ?? "0";
    let pageCount = 0;
    const maxPages = 30;

    while (allVideos.length < maxVideos && pageCount < maxPages) {
      await new Promise((r) => setTimeout(r, 900));

      const more = await fetchMoreVideos(initial.secUid, cursor, 35, cookie);

      if (more.items.length === 0) {
        console.log("No more items from API (or blocked)");
        break;
      }

      for (const item of more.items) {
        const v = parseVideoItem(item, username);
        if (v && !seenIds.has(v.id)) {
          seenIds.add(v.id);
          allVideos.push(v);
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
      return new Response(JSON.stringify({ success: false, error: "Username é obrigatório" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const effectiveCookie = cookie || Deno.env.get("TIKTOK_COOKIE") || "";
    if (!effectiveCookie) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Cookie do TikTok não configurado. Configure seu cookie para acessar os vídeos.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        },
      );
    }

    const cleanUsername = extractUsername(username);

    console.log(`=== Fetching TikTok feed for: ${cleanUsername}, limit: ${limit} ===`);

    const videos = await getAllVideos(cleanUsername, Number(limit), effectiveCookie);

    if (videos.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Nenhum vídeo encontrado para @${cleanUsername}. (TikTok pode estar bloqueando requisições do servidor; nesse caso precisamos mudar para uma estratégia 100% no navegador.)`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        },
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
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ success: false, error: "Erro ao carregar perfil do TikTok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
