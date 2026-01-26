import JSZip from 'jszip';

const MAX_FILES_PER_ZIP = 10; // Conservative limit to prevent memory issues
const MAX_ZIP_SIZE_MB = 100; // Approximate max size before splitting (reduced for stability)

export interface ZipFileEntry {
  filename: string;
  data: Blob | ArrayBuffer;
}

export interface ZipEstimate {
  totalFiles: number;
  estimatedZips: number;
  totalSizeMB: number;
}

interface ZipGeneratorOptions {
  baseFilename: string;
  onProgress?: (current: number, total: number, stage: 'adding' | 'generating') => void;
  signal?: AbortSignal;
}

/**
 * Estimates how many ZIP files will be generated for a given set of entries.
 * Call this BEFORE generating to show the user what to expect.
 */
export function estimateZipCount(entries: ZipFileEntry[]): ZipEstimate {
  let totalSize = 0;
  let currentChunkSize = 0;
  let currentChunkCount = 0;
  let zipCount = 0;

  for (const entry of entries) {
    const entrySize = entry.data instanceof Blob 
      ? entry.data.size 
      : entry.data.byteLength;
    
    totalSize += entrySize;
    
    const wouldExceedSize = currentChunkSize + entrySize > MAX_ZIP_SIZE_MB * 1024 * 1024;
    const wouldExceedCount = currentChunkCount >= MAX_FILES_PER_ZIP;
    
    if (currentChunkCount > 0 && (wouldExceedSize || wouldExceedCount)) {
      zipCount++;
      currentChunkSize = entrySize;
      currentChunkCount = 1;
    } else {
      currentChunkSize += entrySize;
      currentChunkCount++;
    }
  }
  
  if (currentChunkCount > 0) {
    zipCount++;
  }

  return {
    totalFiles: entries.length,
    estimatedZips: Math.max(1, zipCount),
    totalSizeMB: Math.round(totalSize / (1024 * 1024) * 10) / 10,
  };
}

/**
 * Generates one or more ZIP files from a list of file entries.
 * Uses memory-optimized settings and splits into multiple ZIPs if needed.
 */
export async function generateOptimizedZip(
  entries: ZipFileEntry[],
  options: ZipGeneratorOptions
): Promise<Blob[]> {
  const { baseFilename, onProgress, signal } = options;
  const zips: Blob[] = [];
  
  // Split entries into chunks to prevent memory exhaustion
  const chunks: ZipFileEntry[][] = [];
  let currentChunk: ZipFileEntry[] = [];
  let currentChunkSize = 0;
  
  for (const entry of entries) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    
    const entrySize = entry.data instanceof Blob 
      ? entry.data.size 
      : entry.data.byteLength;
    
    // Start new chunk if this one is getting too big
    const wouldExceedSize = currentChunkSize + entrySize > MAX_ZIP_SIZE_MB * 1024 * 1024;
    const wouldExceedCount = currentChunk.length >= MAX_FILES_PER_ZIP;
    
    if (currentChunk.length > 0 && (wouldExceedSize || wouldExceedCount)) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChunkSize = 0;
    }
    
    currentChunk.push(entry);
    currentChunkSize += entrySize;
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  console.log(`[ZipGenerator] Splitting ${entries.length} files into ${chunks.length} ZIP(s)`);
  
  // Generate each ZIP
  let processedCount = 0;
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    
    const chunk = chunks[chunkIndex];
    const zip = new JSZip();
    
    // Add files to this ZIP
    for (const entry of chunk) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      
      zip.file(entry.filename, entry.data);
      processedCount++;
      onProgress?.(processedCount, entries.length, 'adding');
    }
    
    onProgress?.(processedCount, entries.length, 'generating');
    
    try {
      // Generate with memory-optimized settings:
      // - streamFiles: true - reduces memory by streaming file data
      // - compression: 'STORE' - no compression = less memory + faster
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        streamFiles: true,
        compression: 'STORE', // No compression - videos are already compressed
      });
      
      zips.push(zipBlob);
      console.log(`[ZipGenerator] Generated ZIP ${chunkIndex + 1}/${chunks.length} (${(zipBlob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (error) {
      console.error(`[ZipGenerator] Error generating ZIP ${chunkIndex + 1}:`, error);
      
      // Try with smaller batch as fallback
      if (chunk.length > 5) {
        console.log('[ZipGenerator] Retrying with smaller batch...');
        const halfLength = Math.ceil(chunk.length / 2);
        const firstHalf = chunk.slice(0, halfLength);
        const secondHalf = chunk.slice(halfLength);
        
        // Recursively process smaller batches
        const fallbackZips = await generateOptimizedZip(
          [...firstHalf],
          { ...options, baseFilename: `${baseFilename}_parte${chunkIndex + 1}a` }
        );
        zips.push(...fallbackZips);
        
        const fallbackZips2 = await generateOptimizedZip(
          [...secondHalf],
          { ...options, baseFilename: `${baseFilename}_parte${chunkIndex + 1}b` }
        );
        zips.push(...fallbackZips2);
      } else {
        throw error;
      }
    }
    
    // Allow garbage collection between ZIPs
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return zips;
}

/**
 * Downloads one or more ZIP files to the user's device.
 */
export function downloadZips(zips: Blob[], baseFilename: string) {
  for (let i = 0; i < zips.length; i++) {
    const filename = zips.length === 1 
      ? `${baseFilename}.zip`
      : `${baseFilename}_parte${i + 1}.zip`;
    
    const url = URL.createObjectURL(zips[i]);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Small delay between downloads
    if (i < zips.length - 1) {
      // Trigger next download after a brief delay
      setTimeout(() => {}, 500);
    }
  }
}

/**
 * Helper to create a ZipFileEntry from a Blob
 */
export function createZipEntry(filename: string, data: Blob | ArrayBuffer): ZipFileEntry {
  return { filename, data };
}
