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

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

// Fetch a single page of posts using GraphQL
async function fetchGraphQLPage(
  userId: string, 
  first: number = 50, 
  after?: string
): Promise<{ posts: any[]; hasNextPage: boolean; endCursor?: string }> {
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  const variables = {
    id: userId,
    first,
    after: after || null,
  };
  
  // This is the query hash for user media
  const queryHash = 'e769aa130647d2354c40ea6a439bfc08';
  const graphqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
  
  try {
    const response = await fetch(graphqlUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.instagram.com/',
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      const mediaData = data?.data?.user?.edge_owner_to_timeline_media;
      
      if (mediaData) {
        return {
          posts: mediaData.edges || [],
          hasNextPage: mediaData.page_info?.has_next_page || false,
          endCursor: mediaData.page_info?.end_cursor,
        };
      }
    }
  } catch (err) {
    console.log('GraphQL page fetch failed:', err);
  }
  
  return { posts: [], hasNextPage: false };
}

// Get user ID and initial posts from profile
async function getProfileData(username: string): Promise<{ 
  userId?: string; 
  posts: any[]; 
  hasNextPage: boolean; 
  endCursor?: string;
  totalCount?: number;
}> {
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  try {
    console.log('Fetching profile data...');
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
      const user = data?.data?.user;
      
      if (user) {
        const mediaData = user.edge_owner_to_timeline_media;
        const reelsData = user.edge_felix_video_timeline;
        
        // Prefer reels data if available, otherwise use timeline
        const primaryData = (reelsData?.count > 0) ? reelsData : mediaData;
        
        console.log(`Profile found. User ID: ${user.id}, Total posts: ${mediaData?.count || 0}, Reels: ${reelsData?.count || 0}`);
        
        return {
          userId: user.id,
          posts: primaryData?.edges || [],
          hasNextPage: primaryData?.page_info?.has_next_page || false,
          endCursor: primaryData?.page_info?.end_cursor,
          totalCount: primaryData?.count || 0,
        };
      }
    } else {
      console.log('Profile API returned:', response.status);
    }
  } catch (err) {
    console.log('Profile fetch failed:', err);
  }
  
  return { posts: [], hasNextPage: false };
}

// Fetch all videos with pagination
async function fetchAllVideos(username: string, maxVideos: number): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];
  const seenIds = new Set<string>();
  
  // Get initial profile data
  const profileData = await getProfileData(username);
  
  if (!profileData.userId) {
    console.log('Could not get user ID');
    return results;
  }
  
  console.log(`Total content count: ${profileData.totalCount}`);
  
  // Process initial posts
  for (const edge of profileData.posts) {
    const node = edge.node;
    if (node.is_video || node.__typename === 'GraphVideo') {
      const media = parsePostData(node);
      if (media && !seenIds.has(media.id)) {
        seenIds.add(media.id);
        results.push(media);
      }
    }
  }
  
  console.log(`Got ${results.length} videos from initial fetch`);
  
  // If we need more and there are more pages, fetch them
  let hasMore = profileData.hasNextPage;
  let cursor = profileData.endCursor;
  let pageCount = 1;
  const maxPages = Math.ceil(maxVideos / 12) + 1; // Instagram returns ~12 per page
  
  while (hasMore && results.length < maxVideos && pageCount < maxPages) {
    console.log(`Fetching page ${pageCount + 1}... (cursor: ${cursor?.slice(0, 20)}...)`);
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
    
    const pageData = await fetchGraphQLPage(profileData.userId, 50, cursor);
    
    if (pageData.posts.length === 0) {
      console.log('No more posts returned');
      break;
    }
    
    for (const edge of pageData.posts) {
      const node = edge.node;
      if (node.is_video || node.__typename === 'GraphVideo') {
        const media = parsePostData(node);
        if (media && !seenIds.has(media.id)) {
          seenIds.add(media.id);
          results.push(media);
        }
      }
    }
    
    console.log(`Page ${pageCount + 1}: Found ${results.length} total videos`);
    
    hasMore = pageData.hasNextPage;
    cursor = pageData.endCursor;
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
    const { username, limit = 50 } = await req.json();
    
    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username é obrigatório' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    const cleanUsername = extractUsername(username);
    console.log(`=== Fetching Instagram feed for: ${cleanUsername}, limit: ${limit} ===`);
    
    const videos = await fetchAllVideos(cleanUsername, limit);
    
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
