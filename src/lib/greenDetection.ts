export interface GreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  success: boolean;
  area?: GreenArea;
  error?: string;
}

/**
 * Detects a solid green (#00FF00) rectangular area in an image
 * Uses tolerance to handle compression artifacts
 */
export async function detectGreenArea(imageFile: File | Blob): Promise<DetectionResult> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);

    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ success: false, error: 'Não foi possível criar contexto de canvas' });
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      // Find green pixels with tolerance
      const greenPixels: { x: number; y: number }[] = [];
      const tolerance = 60; // Tolerance for compression artifacts

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];

          // Check if pixel is close to #00FF00 (pure green)
          // Green should be high (>200), red and blue should be low (<tolerance)
          if (r < tolerance && g > 200 && b < tolerance) {
            greenPixels.push({ x, y });
          }
        }
      }

      if (greenPixels.length < 100) {
        resolve({
          success: false,
          error: 'Não foi possível detectar a área verde (#00FF00). Verifique se o retângulo está preenchido com verde sólido (sem gradiente/sombra) e exporte novamente do Canva.',
        });
        return;
      }

      // Calculate bounding box
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;

      for (const pixel of greenPixels) {
        if (pixel.x < minX) minX = pixel.x;
        if (pixel.y < minY) minY = pixel.y;
        if (pixel.x > maxX) maxX = pixel.x;
        if (pixel.y > maxY) maxY = pixel.y;
      }

      const area: GreenArea = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };

      // Validate the detected area is a reasonable size
      if (area.width < 50 || area.height < 50) {
        resolve({
          success: false,
          error: 'A área verde detectada é muito pequena. Certifique-se de que o retângulo verde tem pelo menos 50x50 pixels.',
        });
        return;
      }

      // Check if it's roughly rectangular (density check)
      const expectedPixels = area.width * area.height;
      const actualDensity = greenPixels.length / expectedPixels;

      if (actualDensity < 0.7) {
        resolve({
          success: false,
          error: 'A área verde não parece ser um retângulo sólido. Verifique se não há gradientes, sombras ou formas irregulares.',
        });
        return;
      }

      resolve({ success: true, area });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ success: false, error: 'Não foi possível carregar a imagem' });
    };

    img.src = url;
  });
}

/**
 * Creates a mask image from template where green area is transparent
 */
export async function createTemplateMask(imageFile: File | Blob, greenArea: GreenArea): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);

    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Cannot create canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      const tolerance = 60;

      // Make green pixels transparent
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];

          if (r < tolerance && g > 200 && b < tolerance) {
            pixels[i + 3] = 0; // Set alpha to 0 (transparent)
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob'));
        }
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}
