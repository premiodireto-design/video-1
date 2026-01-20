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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username, apiKey } = await req.json();

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: "Username é obrigatório" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "API key do Firecrawl é obrigatória" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}`;

    console.log(`Scraping TikTok profile: ${profileUrl}`);

    // Call Firecrawl API to scrape the page
    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: profileUrl,
        formats: ["extract"],
        extract: {
          schema: {
            type: "object",
            properties: {
              username: { type: "string" },
              videos: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    description: { type: "string" },
                    views: { type: "number" },
                    likes: { type: "number" },
                    comments: { type: "number" },
                    shares: { type: "number" },
                    thumbnail: { type: "string" },
                    url: { type: "string" },
                  },
                },
              },
            },
          },
          prompt: "Extract all videos from this TikTok profile page. For each video, get the video ID, description/caption, view count, like count, comment count, share count, thumbnail image URL, and the video URL/permalink.",
        },
        waitFor: 5000,
      }),
    });

    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text();
      console.error("Firecrawl error:", errorText);
      return new Response(
        JSON.stringify({ success: false, error: `Erro no Firecrawl: ${scrapeResponse.status}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const scrapeData = await scrapeResponse.json();
    console.log("Firecrawl response:", JSON.stringify(scrapeData).slice(0, 500));

    const extracted = scrapeData?.data?.extract || {};
    const rawVideos = extracted.videos || [];

    const videos: TikTokMedia[] = rawVideos.map((v: any, i: number) => ({
      id: v.id || String(Date.now() + i),
      platform: "tiktok" as const,
      thumbnail: v.thumbnail || "",
      caption: v.description || "",
      publishedAt: new Date().toISOString(),
      views: Number(v.views) || 0,
      likes: Number(v.likes) || 0,
      comments: Number(v.comments) || 0,
      shares: Number(v.shares) || 0,
      saves: 0,
      permalink: v.url || `https://www.tiktok.com/@${username}/video/${v.id}`,
      videoUrl: "",
      downloadable: true,
    }));

    console.log(`Scraped ${videos.length} videos`);

    if (videos.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Nenhum vídeo encontrado. O Firecrawl pode não ter conseguido extrair os dados." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          username,
          videos,
          totalCount: videos.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Erro ao fazer scrape do perfil" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
