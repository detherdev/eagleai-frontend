
export type DetectionMode = 'segment' | 'track';

export type MediaType = 'image' | 'video' | 'stream';

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  label?: string;
}

export interface SegmentationMask {
  path: string; // SVG Path data
  color: string;
  opacity: number;
}

export interface Point {
  x: number;
  y: number;
  label: number; // 1 for positive (include), 0 for negative (exclude), 2 for box-tl, 3 for box-br
}

export interface AnalysisResult {
  text?: string;
  boxes?: BoundingBox[];
  masks?: SegmentationMask[];
  
  // Raw data needed for cropping/overlays
  rawMasks?: { size: [number, number], counts: number[] }[];
  rawBoxes?: number[][];

  // Output fields
  processedMediaUrl?: string;
  processedMediaType?: 'image' | 'video';
  
  // Performance tracking
  latency?: number; // milliseconds
  
  // Video Tracking
  trackingFrames?: string[]; // Array of DataURLs (masks) for each frame
}

export interface AppState {
  mode: DetectionMode;
  mediaType: MediaType;
  mediaUrl: string | null;
  prompt: string;
  points: Point[]; // Store user clicks
  box: BoundingBox | null; // Store user drawn box
  confidence: number;
  maskQuality: number;
  isAnalyzing: boolean;
  isTrimming: boolean; 
  processingStatus: string; 
  result: AnalysisResult | null;
  
  isCameraActive: boolean;
  
  // Streaming State
  isStreaming: boolean;
  streamSessionId: string | null;
  
  // Video specific
  videoDuration: number;
  trimRange: [number, number]; // [start, end] in seconds
  
  // Fast tracking mode
  fastMode: boolean;
  keyframeIdx: number;
}
