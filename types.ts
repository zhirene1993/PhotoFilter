export enum ClassificationCategory {
  KEEP = 'KEEP',
  DISCARD = 'DISCARD',
  UNSURE = 'UNSURE',
  PENDING = 'PENDING'
}

export interface AnalysisResult {
  category: ClassificationCategory;
  confidence: number;
  reason: string;
  tags: string[];
}

export interface QualityScore {
  sharpness: number;
  exposure: number;
  resolution: number;
  total: number;
  details: string[];
}

export interface MediaItem {
  id: string;
  file: File;
  previewUrl: string;
  type: 'image' | 'video';
  size: number; // bytes
  name: string;
  timestamp: number;
  
  // Analysis State
  status: 'queued' | 'analyzing' | 'done' | 'error';
  analysis?: AnalysisResult;
  
  // For Duplicates
  hash?: string;
  quality?: QualityScore;
}

export interface DuplicateGroup {
  id: string;
  items: MediaItem[];
  bestItemId: string;
  scoreGap: number; // How much better the best item is compared to the average
}

export enum AppMode {
  LANDING = 'LANDING',
  SCANNING = 'SCANNING',
  REVIEW = 'REVIEW',
  DUPLICATES = 'DUPLICATES',
  TRASH = 'TRASH'
}

export interface Stats {
  totalSize: number;
  keepSize: number;
  discardSize: number;
  countKeep: number;
  countDiscard: number;
  countUnsure: number;
}