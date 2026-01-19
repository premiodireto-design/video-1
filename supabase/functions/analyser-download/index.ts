const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL é obrigatória' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Downloading video from:', url.substring(0, 100) + '...');

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Referer': url.includes('tiktok') ? 'https://www.tiktok.com/' : 'https://www.instagram.com/',
      },
    });

    if (!response.ok) {
      console.error('Download failed with status:', response.status);
      throw new Error(`Download falhou com status ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    
    console.log('Content-Type:', contentType, 'Size:', contentLength);

    // For large files, we might hit edge function limits
    // Check if file is too large (> 50MB)
    if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Vídeo muito grande para download direto. Tente baixar individualmente.',
          directUrl: url,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert to base64
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binary += String.fromCharCode.apply(null, [...chunk]);
    }
    const base64 = btoa(binary);

    console.log('Download complete, base64 length:', base64.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        base64,
        contentType: contentType || 'video/mp4',
        size: uint8Array.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyser-download:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
