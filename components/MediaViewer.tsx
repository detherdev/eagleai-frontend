
import React, { useRef, useEffect, useState } from 'react';
import { AnalysisResult, MediaType, Point, DetectionMode, BoundingBox } from '../types';
import { IconUpload, IconCamera, IconX, IconPlay, IconScreen } from './Icons';
import { VideoTrimmer } from './VideoTrimmer';

interface MediaViewerProps {
  mediaType: MediaType;
  mediaUrl: string | null;
  isCameraActive: boolean;
  result: AnalysisResult | null;
  
  // Streams passed from Parent
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  
  // App State context for interaction modes
  mode?: DetectionMode;
  points?: Point[];
  box?: BoundingBox | null;
  onPointClick?: (point: Point) => void;
  onBoxComplete?: (box: BoundingBox) => void;
  
  // Video Props
  videoDuration: number;
  trimRange: [number, number];
  onVideoMetadataLoad: (duration: number) => void;
  onTrimChange: (range: [number, number]) => void;
  
  // Trim Action
  onTrimConfirm?: () => void;
  isTrimming?: boolean;

  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCameraStart: () => void;
  onScreenShareStart: () => void;
  onCameraCapture: (base64: string) => void;
  onClear: () => void;
  
  showLoadingOverlay?: boolean;
  loadingStatus?: string;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({
  mediaType,
  mediaUrl,
  isCameraActive,
  result,
  localStream,
  remoteStream,
  mode,
  points = [],
  box,
  onPointClick,
  onBoxComplete,
  videoDuration,
  trimRange,
  onVideoMetadataLoad,
  onTrimChange,
  onTrimConfirm,
  isTrimming,
  onUpload,
  onCameraStart,
  onScreenShareStart,
  onCameraCapture,
  onClear,
  showLoadingOverlay,
  loadingStatus
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  // We use a ref to store the request ID for cleanup
  const requestRef = useRef<any>(null);
  
  // Local state to prevent result flash before new image loads
  const [mediaLoaded, setMediaLoaded] = useState(false);
  
  // Video Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Tracking Overlay State
  const [currentOverlayUrl, setCurrentOverlayUrl] = useState<string | null>(null);
  
  // Interaction State
  const [startClientPos, setStartClientPos] = useState<{x: number, y: number} | null>(null);
  const [startNaturalPos, setStartNaturalPos] = useState<{x: number, y: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [currentDragRect, setCurrentDragRect] = useState<BoundingBox | null>(null);

  useEffect(() => {
    if (result) {
        setMediaLoaded(false); 
        setCurrentOverlayUrl(null);
        
        // Fallback: Clear loading state after 2 seconds if image hasn't loaded
        // This handles cases where onLoad doesn't fire (e.g., data URLs, cached images)
        const timeoutId = setTimeout(() => {
            console.log("⏱️ [MediaViewer] Timeout fallback: clearing loading state");
            setMediaLoaded(true);
        }, 2000);
        
        return () => clearTimeout(timeoutId);
    }
  }, [result]);

  // Video Autoplay & Tracking Logic
  useEffect(() => {
    const video = videoRef.current;
    if (result?.trackingFrames && video) {
        // Reset to start and ensure muted for autoplay compliance
        video.currentTime = 0;
        video.muted = true;
        setIsPlaying(false); 
        
        const handlePlay = async () => {
            try {
                await video.play();
            } catch (err) {
                console.warn("Auto-play blocked or interrupted:", err);
                setIsPlaying(false); 
            }
        };

        if (video.readyState >= 3) { // HAVE_FUTURE_DATA
            handlePlay();
        } else {
            const onCanPlay = () => {
                handlePlay();
                video.removeEventListener('canplay', onCanPlay);
            };
            video.addEventListener('canplay', onCanPlay);
        }
    }
  }, [result]);

  // Video Tracking Sync Loop
  // Optimized using requestVideoFrameCallback for precise frame synchronization
  useEffect(() => {
    if (mediaType === 'video' && result?.trackingFrames && videoRef.current) {
         const video = videoRef.current;
         const frames = result.trackingFrames;
         
         const updateOverlay = () => {
             if (!video) return;
             
             const currentTime = video.currentTime;
             const duration = video.duration;
             const frameCount = frames.length;
             
             if (duration > 0 && frameCount > 0) {
                 // Calculate progress (0 to 1)
                 const progress = Math.max(0, Math.min(1, currentTime / duration));
                 // Map to frame index
                 const frameIndex = Math.min(
                     frameCount - 1, 
                     Math.floor(progress * frameCount)
                 );
                 
                 const overlay = frames[frameIndex];
                 setCurrentOverlayUrl(prev => prev !== overlay ? overlay : prev);
             }
         };

         const loop = () => {
             updateOverlay();
             
             // Prefer requestVideoFrameCallback if available (Chrome/Edge/newer browsers)
             // It fires exactly when a new video frame is presented
             if ('requestVideoFrameCallback' in video) {
                 requestRef.current = (video as any).requestVideoFrameCallback(loop);
             } else {
                 requestRef.current = requestAnimationFrame(loop);
             }
         };
         
         // Start loop
         if ('requestVideoFrameCallback' in video) {
             requestRef.current = (video as any).requestVideoFrameCallback(loop);
         } else {
             requestRef.current = requestAnimationFrame(loop);
         }

         // Cleanup
         return () => {
             if (requestRef.current) {
                 if ('cancelVideoFrameCallback' in video) {
                     (video as any).cancelVideoFrameCallback(requestRef.current);
                 } else {
                     cancelAnimationFrame(requestRef.current);
                 }
             }
         };
    }
  }, [mediaType, result]); // Removed videoRef.current dependency to avoid unnecessary re-runs


  // Handle Stream Attachment
  useEffect(() => {
    if (videoRef.current) {
        // If we have a processed remote stream (WebRTC result), show that.
        // Otherwise, if camera is active, show local stream.
        if (remoteStream) {
            if (videoRef.current.srcObject !== remoteStream) {
                videoRef.current.srcObject = remoteStream;
                videoRef.current.play().catch(e => console.error("Remote play error", e));
            }
        } else if (isCameraActive && localStream) {
             if (videoRef.current.srcObject !== localStream) {
                videoRef.current.srcObject = localStream;
                videoRef.current.play().catch(e => console.error("Local play error", e));
            }
        }
    }
  }, [isCameraActive, localStream, remoteStream]);


  // Handle Video Metadata for original uploaded video
  const handleMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    // Only for file-based video
    if (mediaType === 'video' && !isCameraActive && !remoteStream) {
        const duration = e.currentTarget.duration;
        if (duration && isFinite(duration)) {
            onVideoMetadataLoad(duration);
        }
    }
  };

  const handlePreviewSeek = (time: number) => {
    if (videoRef.current && mediaType === 'video' && !isCameraActive) {
        videoRef.current.currentTime = time;
    }
  };

  // --- Interaction Handlers (Unified for Image & Video) ---
  
  // New: Toggle Play/Pause on Click for improved UX when overlay is active
  const togglePlay = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (videoRef.current) {
          if (videoRef.current.paused) {
              videoRef.current.play().catch(() => setIsPlaying(false));
          } else {
              videoRef.current.pause();
          }
      }
  };

  const getCoordinates = (e: React.MouseEvent, element: HTMLElement, naturalWidth: number, naturalHeight: number) => {
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Scale to natural dimensions
    const scaleX = naturalWidth / rect.width;
    const scaleY = naturalHeight / rect.height;
    
    const clampedNaturalX = Math.max(0, Math.min(naturalWidth - 1, Math.round(x * scaleX)));
    const clampedNaturalY = Math.max(0, Math.min(naturalHeight - 1, Math.round(y * scaleY)));

    return {
        x: clampedNaturalX,
        y: clampedNaturalY,
        displayX: x, 
        displayY: y
    };
  };

  const handlePointerDown = (e: React.MouseEvent) => {
    if (showProcessed) return;

    // If tracking is active, clicking should toggle play/pause instead of drawing points
    if (mediaType === 'video' && !!result?.trackingFrames) {
        togglePlay(e);
        return;
    }

    if (!onPointClick) return;

    e.preventDefault();

    let element: HTMLElement | null = null;
    let nw = 0, nh = 0;

    if (mediaType === 'image' && imageRef.current) {
        element = imageRef.current;
        nw = imageRef.current.naturalWidth;
        nh = imageRef.current.naturalHeight;
    } else if ((mediaType === 'video' || mediaType === 'stream') && videoRef.current) {
        element = videoRef.current;
        nw = videoRef.current.videoWidth;
        nh = videoRef.current.videoHeight;
    }

    if (element && nw > 0 && nh > 0) {
        const coords = getCoordinates(e, element, nw, nh);
        setStartClientPos({ x: e.clientX, y: e.clientY });
        setStartNaturalPos({ x: coords.x, y: coords.y });
        setIsDragging(true);
        setCurrentDragRect(null);
    }
  };

  const handlePointerMove = (e: React.MouseEvent) => {
    if (!isDragging || !startNaturalPos) return;

    let element: HTMLElement | null = null;
    let nw = 0, nh = 0;

    if (mediaType === 'image' && imageRef.current) {
        element = imageRef.current;
        nw = imageRef.current.naturalWidth;
        nh = imageRef.current.naturalHeight;
    } else if ((mediaType === 'video' || mediaType === 'stream') && videoRef.current) {
        element = videoRef.current;
        nw = videoRef.current.videoWidth;
        nh = videoRef.current.videoHeight;
    }

    if (element && nw > 0) {
        const coords = getCoordinates(e, element, nw, nh);
        const xmin = Math.min(startNaturalPos.x, coords.x);
        const ymin = Math.min(startNaturalPos.y, coords.y);
        const xmax = Math.max(startNaturalPos.x, coords.x);
        const ymax = Math.max(startNaturalPos.y, coords.y);
        setCurrentDragRect({ xmin, ymin, xmax, ymax });
    }
  };

  const handlePointerUp = (e: React.MouseEvent) => {
    if (!isDragging || !startNaturalPos || !startClientPos) return;
    setIsDragging(false);

    let element: HTMLElement | null = null;
    let nw = 0, nh = 0;

    if (mediaType === 'image' && imageRef.current) {
        element = imageRef.current;
        nw = imageRef.current.naturalWidth;
        nh = imageRef.current.naturalHeight;
    } else if ((mediaType === 'video' || mediaType === 'stream') && videoRef.current) {
        element = videoRef.current;
        nw = videoRef.current.videoWidth;
        nh = videoRef.current.videoHeight;
    }

    if (element && nw > 0) {
        const coords = getCoordinates(e, element, nw, nh);
        const screenDx = Math.abs(e.clientX - startClientPos.x);
        const screenDy = Math.abs(e.clientY - startClientPos.y);
        const screenThreshold = 4; 

        if (screenDx < screenThreshold && screenDy < screenThreshold) {
            const isRightClick = e.button === 2;
            if (onPointClick) {
                onPointClick({
                    x: coords.x,
                    y: coords.y,
                    label: isRightClick ? 0 : 1 
                });
            }
        } else {
            if (onBoxComplete && currentDragRect) {
                if (Math.abs(currentDragRect.xmax - currentDragRect.xmin) > 5 && 
                    Math.abs(currentDragRect.ymax - currentDragRect.ymin) > 5) {
                    onBoxComplete(currentDragRect);
                }
            }
        }
    }
    setStartClientPos(null);
    setStartNaturalPos(null);
    setCurrentDragRect(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      if (!showProcessed) {
        e.preventDefault();
      }
  };

  const showProcessed = !!result?.processedMediaUrl && !remoteStream;
  const processedType = result?.processedMediaType;
  const isLoading = showLoadingOverlay || (showProcessed && !mediaLoaded);

  const showTrimmer = mediaType === 'video' && mediaUrl && !showProcessed && !isCameraActive && videoDuration > 0;
  const isRangeModified = showTrimmer && (trimRange[0] > 0.1 || trimRange[1] < videoDuration - 0.1);

  const cursorStyle = (!showProcessed && !remoteStream) 
    ? (mediaType === 'video' && !!result?.trackingFrames ? 'cursor-pointer' : 'cursor-crosshair')
    : 'cursor-default';
    
  // Scaling helpers
  const getDisplayScale = () => {
      if (mediaType === 'image' && imageRef.current) {
          const rect = imageRef.current.getBoundingClientRect();
          return {
              x: rect.width / imageRef.current.naturalWidth,
              y: rect.height / imageRef.current.naturalHeight
          };
      }
      if ((mediaType === 'video' || mediaType === 'stream') && videoRef.current) {
          const rect = videoRef.current.getBoundingClientRect();
          return {
              x: rect.width / videoRef.current.videoWidth,
              y: rect.height / videoRef.current.videoHeight
          };
      }
      return { x: 1, y: 1 };
  };

  const scale = getDisplayScale();
  
  const shouldMute = isCameraActive || !!remoteStream || (mediaType === 'video' && !!result?.trackingFrames);
  
  const showNativeControls = mediaType === 'video' && !isDragging && !isCameraActive && !remoteStream && !result?.trackingFrames;

  return (
    <div className="relative w-full h-full flex flex-col gap-4">
    <div className="relative w-full flex-1 bg-gray-100 rounded-3xl overflow-hidden shadow-inner border border-gray-200 flex items-center justify-center group select-none">
      
      {/* Empty State */}
      {!mediaUrl && !isCameraActive && !showProcessed && !remoteStream && (
        <div className="text-center p-8 space-y-8 flex flex-col items-center animate-fade-in">
          <div className="space-y-2">
            <h3 className="text-gray-800 text-xl font-medium">Input Source</h3>
            <p className="text-gray-500 text-sm">Upload media, start a live stream, or share your screen.</p>
          </div>
          
          <div className="flex flex-wrap gap-4 w-full max-w-2xl justify-center">
            <label className="cursor-pointer flex flex-col items-center justify-center gap-3 p-6 bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all w-32 h-32 sm:w-40 sm:h-40 group">
              <div className="bg-gray-50 p-3 rounded-full group-hover:bg-blue-50 transition-colors">
                <IconUpload className="text-gray-600 w-6 h-6 group-hover:text-blue-600" />
              </div>
              <span className="text-sm font-medium text-gray-600 group-hover:text-gray-900">Upload</span>
              <input type="file" className="hidden" accept="image/*,video/*,.heic,.HEIC,.heif,.HEIF" onChange={onUpload} />
            </label>
            
            <button 
              onClick={onCameraStart}
              className="flex flex-col items-center justify-center gap-3 p-6 bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all w-32 h-32 sm:w-40 sm:h-40 group"
            >
              <div className="bg-gray-50 p-3 rounded-full group-hover:bg-red-50 transition-colors">
                <IconCamera className="text-gray-600 w-6 h-6 group-hover:text-red-600" />
              </div>
              <span className="text-sm font-medium text-gray-600 group-hover:text-gray-900">Live Stream</span>
            </button>

            <button 
              onClick={onScreenShareStart}
              className="flex flex-col items-center justify-center gap-3 p-6 bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all w-32 h-32 sm:w-40 sm:h-40 group"
            >
              <div className="bg-gray-50 p-3 rounded-full group-hover:bg-purple-50 transition-colors">
                <IconScreen className="text-gray-600 w-6 h-6 group-hover:text-purple-600" />
              </div>
              <span className="text-sm font-medium text-gray-600 group-hover:text-gray-900">Screen Share</span>
            </button>
          </div>
        </div>
      )}

      {/* Media Content Container */}
      <div 
        className="relative w-full h-full flex items-center justify-center"
        onContextMenu={handleContextMenu}
      >
         
         {/* 1. Show Processed Result (Static Image/Video) */}
         {showProcessed && result?.processedMediaUrl && (
            <div className={`relative w-full h-full transition-opacity duration-500 ${mediaLoaded ? 'opacity-100' : 'opacity-0'}`}>
                {processedType === 'video' ? (
                     <video 
                     src={result!.processedMediaUrl} 
                     controls 
                     autoPlay
                     loop
                     onLoadedData={() => {
                         console.log("✅ [MediaViewer] Video loaded");
                         setMediaLoaded(true);
                     }}
                     onError={(e) => {
                         console.error("❌ [MediaViewer] Video load error:", e);
                         setMediaLoaded(true); // Clear loading state even on error
                     }}
                     className="w-full h-full object-contain bg-black"
                   />
                ) : (
                    <img 
                    src={result!.processedMediaUrl || ''} 
                    alt="Processed Result" 
                    onLoad={() => {
                        console.log("✅ [MediaViewer] Image loaded successfully");
                        setMediaLoaded(true);
                    }}
                    onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        console.error("❌ [MediaViewer] Image load error:", {
                            src: target?.src?.substring(0, 50) + '...',
                            naturalWidth: target?.naturalWidth,
                            naturalHeight: target?.naturalHeight,
                            complete: target?.complete,
                            error: e
                        });
                        // Clear loading state even on error
                        setMediaLoaded(true);
                        // Try to show original image if processed one fails
                        if (result!.processedMediaUrl && mediaUrl) {
                            console.warn("⚠️ [MediaViewer] Falling back to original image");
                        }
                    }}
                    onLoadStart={() => {
                        console.log("🔄 [MediaViewer] Image load started");
                        if (result!.processedMediaUrl) {
                            const urlPreview = result!.processedMediaUrl.substring(0, 50);
                            console.log(`📸 [MediaViewer] Loading image: ${urlPreview}...`);
                        }
                    }}
                    onAbort={(e) => {
                        console.warn("⚠️ [MediaViewer] Image load aborted");
                        setMediaLoaded(true);
                    }}
                    className="w-full h-full object-contain bg-gray-50"
                  />
                )}
                <div className="absolute top-4 left-4 bg-black/70 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm shadow-sm">
                    Processed Output
                </div>
            </div>
         )}

         {/* 2. Show Original Image */}
         {!showProcessed && mediaType === 'image' && mediaUrl && (
             <div className="relative w-full h-full flex items-center justify-center">
                <img 
                ref={imageRef}
                src={mediaUrl} 
                alt="Analysis Target" 
                className={`max-w-full max-h-full object-contain bg-gray-50 ${cursorStyle}`}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                />
            </div>
         )}

         {/* 3. Show Video or Stream (Raw or Remote) */}
         {/* This handles Uploaded Video, Local Camera Preview, AND WebRTC Remote Stream */}
         {!showProcessed && (mediaType === 'video' || isCameraActive || remoteStream) && (
            <div className="relative w-full h-full flex items-center justify-center bg-black">
                <video 
                ref={videoRef}
                src={mediaUrl || undefined} // Only set src for file-based video
                controls={showNativeControls}
                playsInline
                muted={shouldMute}
                loop={mediaType === 'video' && !!result?.trackingFrames} // Loop video if tracking
                className={`w-full h-full object-contain ${cursorStyle}`}
                onLoadedMetadata={handleMetadata}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                />
                
                {/* Visual Overlay for Tracked Video */}
                {mediaType === 'video' && result?.trackingFrames && (
                    <>
                        {currentOverlayUrl && (
                            <img 
                                src={currentOverlayUrl}
                                alt="Tracking Overlay"
                                className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
                            />
                        )}
                        <div className="absolute top-4 left-4 bg-indigo-600 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm shadow-sm z-20 flex items-center gap-2 pointer-events-none">
                            <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                            Tracking Overlay Active
                        </div>

                        {/* Manual Play Overlay - Appears if video is paused */}
                        {!isPlaying && (
                             <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/10 hover:bg-black/20 transition-colors pointer-events-none">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        togglePlay();
                                    }}
                                    className="bg-white/90 p-5 rounded-full shadow-2xl backdrop-blur-sm text-blue-600 hover:scale-105 transition-all pointer-events-auto cursor-pointer animate-fade-in"
                                >
                                    <IconPlay className="w-10 h-10 fill-current ml-1" />
                                </button>
                             </div>
                        )}
                    </>
                )}
            </div>
         )}

         {/* --- Overlays for Points and Boxes --- */}
         {!showProcessed && !remoteStream && (mediaType === 'image' || mediaType === 'video' || isCameraActive) && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
                <div className="relative w-full h-full flex items-center justify-center">
                    {points.map((p, i) => (
                        <div 
                            key={i}
                            className={`absolute w-3 h-3 rounded-full border-2 border-white shadow-sm ${p.label === 0 ? 'bg-red-500' : 'bg-green-500'}`}
                            style={{
                                left: `calc(50% + ${(p.x * scale.x) - (imageRef.current ? (imageRef.current.getBoundingClientRect().width/2) : (videoRef.current ? videoRef.current.getBoundingClientRect().width/2 : 0))}px)`,
                                top: `calc(50% + ${(p.y * scale.y) - (imageRef.current ? (imageRef.current.getBoundingClientRect().height/2) : (videoRef.current ? videoRef.current.getBoundingClientRect().height/2 : 0))}px)`,
                                transform: 'translate(-50%, -50%)' 
                            }}
                        />
                    ))}

                    {currentDragRect && (
                        <div 
                            className="absolute border-2 border-blue-500 bg-blue-500/20 shadow-sm"
                            style={{
                                width: (currentDragRect.xmax - currentDragRect.xmin) * scale.x,
                                height: (currentDragRect.ymax - currentDragRect.ymin) * scale.y,
                                left: `calc(50% + ${(currentDragRect.xmin * scale.x) - (imageRef.current ? (imageRef.current.getBoundingClientRect().width/2) : (videoRef.current ? videoRef.current.getBoundingClientRect().width/2 : 0))}px)`,
                                top: `calc(50% + ${(currentDragRect.ymin * scale.y) - (imageRef.current ? (imageRef.current.getBoundingClientRect().height/2) : (videoRef.current ? videoRef.current.getBoundingClientRect().height/2 : 0))}px)`,
                            }}
                        />
                    )}

                    {box && (
                        <div 
                             className="absolute border-2 border-blue-600 shadow-md"
                             style={{
                                 width: (box.xmax - box.xmin) * scale.x,
                                 height: (box.ymax - box.ymin) * scale.y,
                                 left: `calc(50% + ${(box.xmin * scale.x) - (imageRef.current ? (imageRef.current.getBoundingClientRect().width/2) : (videoRef.current ? videoRef.current.getBoundingClientRect().width/2 : 0))}px)`,
                                 top: `calc(50% + ${(box.ymin * scale.y) - (imageRef.current ? (imageRef.current.getBoundingClientRect().height/2) : (videoRef.current ? videoRef.current.getBoundingClientRect().height/2 : 0))}px)`,
                             }}
                        >
                            <span className="absolute -top-6 left-0 bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded">Selection</span>
                        </div>
                    )}
                </div>
            </div>
         )}

         {/* Loading / Processing Overlay */}
         {isLoading && (
            <div className="absolute inset-0 z-20 bg-white/40 backdrop-blur-md flex flex-col items-center justify-center transition-all duration-300">
                 <div className="bg-white p-4 rounded-full shadow-xl mb-4">
                    <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                 </div>
                 <span className="text-gray-800 font-semibold tracking-wide text-sm bg-white/80 px-4 py-1 rounded-full shadow-sm">
                    {loadingStatus || (showProcessed ? "Rendering Output..." : "Processing Media...")}
                 </span>
            </div>
         )}
         
         {/* Live Stream Indicator */}
         {remoteStream && (
             <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse shadow-sm z-20">
                 <div className="w-2 h-2 bg-white rounded-full"></div>
                 LIVE PROCESSING
             </div>
         )}

         {/* Clear Button */}
         {(mediaUrl || isCameraActive || showProcessed) && !isLoading && !isTrimming && (
           <button 
            onClick={onClear}
            className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur-md rounded-full shadow-lg hover:bg-white text-gray-700 transition z-10"
           >
             <IconX className="w-5 h-5" />
           </button>
         )}
      </div>
    </div>
    
    {/* Video Trimmer */}
    {showTrimmer && (
        <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col gap-4">
             <VideoTrimmer 
                duration={videoDuration}
                range={trimRange}
                onChange={onTrimChange}
                onPreviewTime={handlePreviewSeek}
             />
             
             {onTrimConfirm && (
                <div className="flex justify-end">
                    <button 
                        onClick={onTrimConfirm}
                        disabled={!isRangeModified || isTrimming}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                            isRangeModified 
                            ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm' 
                            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                        <span>✂️ Crop Clip</span>
                        {isRangeModified && <span className="text-[10px] bg-white/20 px-1.5 rounded">Required</span>}
                    </button>
                </div>
             )}
        </div>
    )}
    </div>
  );
};
