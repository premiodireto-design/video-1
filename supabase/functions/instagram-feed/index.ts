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

// Fetch Instagram profile data
async function fetchInstagramProfile(username: string, limit: number): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];
  
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ];
  
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  // Method 1: Try the web profile info API
  try {
    console.log('Trying web profile info API...');
    const response = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-IG-WWW-Claim': '0',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Got web profile info response');
      
      const user = data?.data?.user;
      if (user?.edge_owner_to_timeline_media?.edges) {
        for (const edge of user.edge_owner_to_timeline_media.edges.slice(0, limit)) {
          const node = edge.node;
          // Only include videos
          if (node.is_video) {
            const media = parsePostData(node);
            if (media) results.push(media);
          }
        }
      }
      
      // Also check reels
      if (user?.edge_felix_video_timeline?.edges) {
        for (const edge of user.edge_felix_video_timeline.edges.slice(0, limit)) {
          const node = edge.node;
          const media = parsePostData(node);
          if (media && !results.find(r => r.id === media.id)) {
            results.push(media);
          }
        }
      }
    } else {
      console.log('Web profile info API failed:', response.status);
    }
  } catch (err) {
    console.log('Web profile info method failed:', err);
  }
  
  if (results.length > 0) {
    console.log(`Found ${results.length} videos via web profile info`);
    return results.slice(0, limit);
  }
  
  // Method 2: Try to get from the public profile page
  try {
    console.log('Trying profile page scrape...');
    const response = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    
    if (response.ok) {
      const html = await response.text();
      
      // Try to find JSON data in script tags
      const patterns = [
        /window\._sharedData\s*=\s*({.+?});<\/script>/s,
        /window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\);<\/script>/s,
        /<script type="application\/json" data-sjs>({.+?})<\/script>/s,
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          try {
            const data = JSON.parse(match[1]);
            console.log('Found JSON data in page');
            
            // Try different data paths
            const user = data?.entry_data?.ProfilePage?.[0]?.graphql?.user ||
                        data?.graphql?.user ||
                        data?.data?.user;
            
            if (user) {
              const edges = user.edge_owner_to_timeline_media?.edges || 
                           user.edge_felix_video_timeline?.edges || [];
              
              for (const edge of edges.slice(0, limit)) {
                const node = edge.node;
                if (node.is_video || node.__typename === 'GraphVideo') {
                  const media = parsePostData(node);
                  if (media) results.push(media);
                }
              }
            }
          } catch (parseErr) {
            console.log('Failed to parse JSON:', parseErr);
          }
        }
      }
    }
  } catch (err) {
    console.log('Profile page scrape failed:', err);
  }
  
  if (results.length > 0) {
    console.log(`Found ${results.length} videos via page scrape`);
    return results.slice(0, limit);
  }
  
  // Method 3: Try the graphql query endpoint
  try {
    console.log('Trying graphql endpoint...');
    
    // First, get user ID from the profile page
    const profileResponse = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      headers: { 'User-Agent': userAgent },
    });
    
    if (profileResponse.ok) {
      const html = await profileResponse.text();
      const userIdMatch = html.match(/"profilePage_([0-9]+)"/);
      
      if (userIdMatch) {
        const userId = userIdMatch[1];
        console.log('Found user ID:', userId);
        
        const variables = JSON.stringify({
          id: userId,
          first: limit,
        });
        
        const queryHash = 'e769aa130647d2354c40ea6a439bfc08';
        const graphqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`;
        
        const graphqlResponse = await fetch(graphqlUrl, {
          headers: {
            'User-Agent': userAgent,
            'Accept': '*/*',
            'X-IG-App-ID': '936619743392459',
          },
        });
        
        if (graphqlResponse.ok) {
          const data = await graphqlResponse.json();
          const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges || [];
          
          for (const edge of edges.slice(0, limit)) {
            const node = edge.node;
            if (node.is_video) {
              const media = parsePostData(node);
              if (media) results.push(media);
            }
          }
        }
      }
    }
  } catch (err) {
    console.log('GraphQL method failed:', err);
  }
  
  console.log(`Total results: ${results.length}`);
  return results.slice(0, limit);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { username, limit = 50 } = await req.json();
    
    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username é obrigatório' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    const cleanUsername = extractUsername(username);
    console.log(`Fetching Instagram feed for: ${cleanUsername}, limit: ${limit}`);
    
    const videos = await fetchInstagramProfile(cleanUsername, limit);
    
    if (videos.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Nenhum vídeo encontrado para @${cleanUsername}. Verifique se o perfil é público e possui Reels/vídeos.` 
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
