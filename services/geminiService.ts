import { ClassificationCategory, AnalysisResult, MediaItem, DuplicateGroup, QualityScore } from '../types';

// --- Local Analysis Service ---

const loadImage = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
};

// --- 1. Scoring Heuristics ---

// Laplacian Variance for Sharpness
const calculateSharpness = (ctx: CanvasRenderingContext2D, width: number, height: number): number => {
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let sum = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 16) { // Step 4 (r,g,b,a) * 4 pixels skip
      if (i + 4 < data.length) {
        const current = (data[i] + data[i+1] + data[i+2]) / 3;
        const next = (data[i+4] + data[i+5] + data[i+6]) / 3;
        sum += Math.abs(current - next);
        count++;
      }
    }
    return count > 0 ? (sum / count) : 0;
  } catch (e) {
    return 0;
  }
};

// Exposure Analysis (0 = bad, 1 = good)
const calculateExposureScore = (ctx: CanvasRenderingContext2D, width: number, height: number): number => {
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let totalLuma = 0;
    
    for (let i = 0; i < data.length; i += 4) {
       totalLuma += (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
    }
    
    const avgLuma = totalLuma / (width * height);
    // Ideal luma is around 128. Penalize deviation.
    // Score: 1.0 at 128, dropping to 0.0 at 0 or 255
    const dist = Math.abs(128 - avgLuma);
    return Math.max(0, 1 - (dist / 128));
  } catch {
    return 0.5;
  }
};

// --- 2. Similarity Algorithms ---

// Difference Hash (dHash) implementation
// Resizes to 9x8, grayscale, compares adjacent pixels
const computeDHash = (ctx: CanvasRenderingContext2D, img: HTMLImageElement): string => {
  // 1. Resize to 9x8 (9 columns, 8 rows)
  // We need 9 cols to make 8 comparisons per row
  ctx.canvas.width = 9;
  ctx.canvas.height = 8;
  ctx.drawImage(img, 0, 0, 9, 8);
  
  const imageData = ctx.getImageData(0, 0, 9, 8);
  const data = imageData.data;
  
  let hash = '';
  
  // 2. Iterate rows
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
       // 3. Get grayscale value of P(x,y) and P(x+1, y)
       const iLeft = (y * 9 + x) * 4;
       const iRight = (y * 9 + x + 1) * 4;
       
       const leftVal = (data[iLeft] + data[iLeft+1] + data[iLeft+2]) / 3;
       const rightVal = (data[iRight] + data[iRight+1] + data[iRight+2]) / 3;
       
       // 4. Compute bit
       hash += (leftVal > rightVal ? '1' : '0');
    }
  }
  return hash;
};

const calculateHammingDistance = (hash1: string, hash2: string): number => {
  let dist = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) dist++;
  }
  return dist;
};

// --- Public API ---

export const calculateImageQuality = async (file: File): Promise<QualityScore> => {
  try {
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("No context");

    // Analysis size
    const w = 320;
    const h = Math.floor(img.height * (w / img.width));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    const sharpness = calculateSharpness(ctx, w, h); // Range usually 2-15
    const exposure = calculateExposureScore(ctx, w, h); // 0-1
    const resolution = (img.width * img.height) / 1000000; // Megapixels

    // Normalize Sharpness (approx 2.0 to 8.0 mapped to 0-1)
    const normSharpness = Math.min(Math.max((sharpness - 2) / 6, 0), 1);
    
    // Normalize Resolution (2MP to 12MP mapped to 0-1)
    const normRes = Math.min(Math.max((resolution - 2) / 10, 0), 1);

    // Weighted Total
    // Sharpness is king for "best shot"
    const total = (normSharpness * 0.6) + (exposure * 0.2) + (normRes * 0.2);
    
    const details = [];
    if (normSharpness > 0.7) details.push("Very Sharp");
    else if (normSharpness < 0.3) details.push("Blurry");
    
    if (exposure > 0.8) details.push("Good Exposure");
    else if (exposure < 0.4) details.push("Poor Exposure");
    
    details.push(`${resolution.toFixed(1)}MP`);

    return {
      sharpness: normSharpness,
      exposure,
      resolution: normRes,
      total,
      details
    };

  } catch (e) {
    return { sharpness: 0, exposure: 0, resolution: 0, total: 0, details: [] };
  }
};

export const analyzeImage = async (file: File): Promise<AnalysisResult> => {
  try {
    const name = file.name.toLowerCase();
    const sizeKB = file.size / 1024;

    // --- Metadata Heuristics ---
    if (name.includes('screenshot') || name.includes('screen_recording')) {
      return {
        category: ClassificationCategory.DISCARD,
        confidence: 98,
        reason: "Filename indicates a screenshot",
        tags: ['Screenshot']
      };
    }
    if (sizeKB < 150) {
      return {
        category: ClassificationCategory.DISCARD,
        confidence: 85,
        reason: "Low resolution (small file size)",
        tags: ['Small']
      };
    }

    // --- Visual Analysis ---
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Context error");
    
    const w = 320;
    const h = Math.floor(img.height * (w / img.width));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    
    const ratio = img.width / img.height;
    const sharpness = calculateSharpness(ctx, w, h);

    // Discard logic
    if (ratio < 0.48 || ratio > 2.2) {
      return { category: ClassificationCategory.DISCARD, confidence: 80, reason: "Unusual aspect ratio", tags: ['Aspect'] };
    }
    if (sharpness < 2.5) {
      return { category: ClassificationCategory.DISCARD, confidence: 75, reason: "Image appears blurry", tags: ['Blurry'] };
    }

    return {
      category: ClassificationCategory.KEEP,
      confidence: 65,
      reason: "Standard image resolution",
      tags: ['Image']
    };

  } catch (error) {
    return {
      category: ClassificationCategory.UNSURE,
      confidence: 0,
      reason: "Analysis failed",
      tags: ["Error"],
    };
  }
};

// --- Duplicate Detection ---

export const detectDuplicates = async (items: MediaItem[]): Promise<DuplicateGroup[]> => {
  // 1. Pre-compute hashes and quality for all items (expensive, so we do it selectively or assume pre-processed)
  // For this demo, we will process them on the fly
  
  const processedItems: MediaItem[] = [];
  
  // Sort by timestamp to find burst shots easily
  const sortedItems = [...items].sort((a, b) => a.timestamp - b.timestamp);
  
  // We need hashes. 
  for (const item of sortedItems) {
    if (item.type === 'video') continue; // Skip videos for simple hash check
    
    if (!item.hash || !item.quality) {
      const img = await loadImage(item.file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      // Compute Hash
      const hash = computeDHash(ctx, img);
      
      // Compute Quality (for ranking later)
      // Re-use canvas context for efficiency? Need resize.
      // Just call the helper for clean code, though slightly inefficient on creating new canvas
      const quality = await calculateImageQuality(item.file);
      
      item.hash = hash;
      item.quality = quality;
    }
    processedItems.push(item);
  }

  const groups: DuplicateGroup[] = [];
  const visited = new Set<string>();

  for (let i = 0; i < processedItems.length; i++) {
    const current = processedItems[i];
    if (visited.has(current.id)) continue;

    const currentGroupItems = [current];
    visited.add(current.id);

    // Look ahead in the window
    // Burst shots are usually within seconds, but duplicates can be anywhere if we scan strictly by visual
    // Optimization: Check next 20 items (time locality) OR check all if list is small (<500)
    // For robustness, let's check the next 50 items in sorted list (burst mode assumption)
    
    const lookAhead = Math.min(processedItems.length, i + 50);

    for (let j = i + 1; j < lookAhead; j++) {
      const candidate = processedItems[j];
      if (visited.has(candidate.id)) continue;

      // Time Check (optional, but good for "bursts")
      // If diff > 30 seconds, unlikely to be a burst of same scene unless static.
      // Let's rely mostly on Hash.
      
      if (current.hash && candidate.hash) {
        const dist = calculateHammingDistance(current.hash, candidate.hash);
        // Distance threshold: < 5 bits different = Very Similar
        if (dist <= 5) {
          currentGroupItems.push(candidate);
          visited.add(candidate.id);
        }
      }
    }

    if (currentGroupItems.length > 1) {
      // Find Best
      // Sort by Quality Total Descending
      currentGroupItems.sort((a, b) => (b.quality?.total || 0) - (a.quality?.total || 0));
      
      const best = currentGroupItems[0];
      const runnerUp = currentGroupItems[1];
      const gap = (best.quality?.total || 0) - (runnerUp.quality?.total || 0);

      groups.push({
        id: `group-${current.id}`,
        items: currentGroupItems,
        bestItemId: best.id,
        scoreGap: gap
      });
    }
  }

  return groups;
};