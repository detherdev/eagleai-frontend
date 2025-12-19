
import React, { useState, useRef, useEffect } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { MediaViewer } from './components/MediaViewer';
import { AppState, Point, BoundingBox } from './types';
import { analyzeMedia, establishWebRTCSession, closeWebRTCSession, trackVideoText } from './services/aiService';
import { trimVideoFile } from './services/videoService';

// heic2any is loaded via script tag in index.html
declare global {
  interface Window {
    heic2any: any;
  }
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    mode: 'segment',
    mediaType: 'image',
    mediaUrl: null,
    prompt: '',
    points: [],
    box: null,
    confidence: 0.50,
    maskQuality: 0.50,
    isAnalyzing: false,
    isTrimming: false,
    processingStatus: '',
    result: null,
    isCameraActive: false,
    isStreaming: false,
    streamSessionId: null,
    videoDuration: 0,
    trimRange: [0, 0]
  });

  const [file, setFile] = useState<File | null>(null);
  
  // Streaming State
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const updateState = (updates: Partial<AppState>) => {
    setState(prev => ({ ...prev, ...updates }));
  };

  // Cleanup streams on unmount
  useEffect(() => {
    return () => {
      stopLocalStream();
      closePeerConnection();
    };
  }, []);

  const stopLocalStream = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
  };

  const closePeerConnection = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      console.log(`📁 [Upload] File selected: ${selectedFile.name}, type: ${selectedFile.type}, size: ${(selectedFile.size / 1024 / 1024).toFixed(2)}MB`);
      
      // Cleanup previous state
      stopLocalStream();
      closePeerConnection();

      let fileToProcess = selectedFile;
      
      // HEIC/HEIF Conversion Logic
      const isHeic = fileToProcess.type === 'image/heic' || 
                     fileToProcess.type === 'image/heif' ||
                     fileToProcess.name.toLowerCase().endsWith('.heic') ||
                     fileToProcess.name.toLowerCase().endsWith('.heif');

      if (isHeic) {
          console.log("🔄 [Upload] Converting HEIC to JPEG...");
          updateState({ processingStatus: 'Converting HEIC image...' });
          try {
              const heic2any = window.heic2any;
              if (!heic2any) throw new Error("HEIC conversion library (heic2any) not loaded.");
              const convertedBlob = await heic2any({ blob: fileToProcess, toType: "image/jpeg", quality: 0.9 });
              const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
              fileToProcess = new File([blob], fileToProcess.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
              console.log("✅ [Upload] HEIC conversion complete");
          } catch (err: any) {
              console.error("❌ [Upload] HEIC Conversion failed:", err);
              alert(`HEIC Conversion Failed: ${err.message || 'Unknown error'}`);
              updateState({ processingStatus: '' });
              return;
          }
      }

      const url = URL.createObjectURL(fileToProcess);
      const type = fileToProcess.type.startsWith('video') ? 'video' : 'image';
      
      console.log(`✅ [Upload] File processed: type=${type}, URL created`);
      
      setFile(fileToProcess);
      updateState({
        mediaUrl: url,
        mediaType: type,
        isCameraActive: false,
        isStreaming: false,
        result: null,
        videoDuration: 0,
        trimRange: [0, 0],
        points: [],
        box: null,
        processingStatus: ''
      });
      
      // Reset file input so same file can be selected again
      e.target.value = '';
    } else {
      console.warn("⚠️ [Upload] No file selected");
    }
  };

  const handleVideoMetadata = (duration: number) => {
      if (state.trimRange[1] === 0) {
        updateState({ videoDuration: duration, trimRange: [0, duration] });
      } else {
        updateState({ videoDuration: duration, trimRange: [0, duration] });
      }
  };

  const handleTrimChange = (range: [number, number]) => {
      updateState({ trimRange: range });
  };

  const handleTrimVideo = async () => {
      if (!file || state.mediaType !== 'video') return;
      const [start, end] = state.trimRange;
      if (start === 0 && end === state.videoDuration) return;

      updateState({ isTrimming: true, processingStatus: 'Starting crop...' });
      try {
          const trimmedFile = await trimVideoFile(file, start, end, (progress) => {
              updateState({ processingStatus: `Cropping... ${Math.round(progress)}%` });
          });
          const newUrl = URL.createObjectURL(trimmedFile);
          setFile(trimmedFile);
          updateState({
              mediaUrl: newUrl,
              videoDuration: 0,
              trimRange: [0, 0],
              processingStatus: '',
              result: null,
              points: [],
              box: null
          });
      } catch (e) {
          console.error("Trim failed", e);
          alert("Failed to crop video.");
      } finally {
          updateState({ isTrimming: false, processingStatus: '' });
      }
  };

  const handleCameraStart = async () => {
    // Cleanup previous file/stream
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    setFile(null);
    closePeerConnection();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false 
        });
        setLocalStream(stream);
        
        updateState({
          isCameraActive: true,
          mediaUrl: null,
          mediaType: 'stream',
          result: null,
          videoDuration: 0,
          points: [],
          box: null,
          processingStatus: '',
          isStreaming: false
        });
    } catch (e) {
        console.error("Camera access failed", e);
        alert("Failed to access camera.");
    }
  };

  const handleScreenShareStart = async () => {
    // Cleanup previous file/stream
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    setFile(null);
    closePeerConnection();
    stopLocalStream();

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { cursor: "always" } as any,
            audio: false 
        });
        
        // Handle user stopping share via browser UI
        stream.getVideoTracks()[0].onended = () => {
             handleClear();
        };

        setLocalStream(stream);
        
        updateState({
          isCameraActive: true, // Reuse this flag for any local stream active
          mediaUrl: null,
          mediaType: 'stream',
          result: null,
          videoDuration: 0,
          points: [],
          box: null,
          processingStatus: '',
          isStreaming: false
        });
    } catch (e: any) {
        // Only log if it's not a user cancellation
        if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
            console.error("Screen share error:", e);
        }
        // Silently handle user cancellation - no need to show error
    }
  };

  const handleClear = async () => {
    if (state.streamSessionId) {
        await closeWebRTCSession(state.streamSessionId);
    }
    stopLocalStream();
    closePeerConnection();

    updateState({
      mediaUrl: null,
      isCameraActive: false,
      isStreaming: false,
      streamSessionId: null,
      result: null,
      videoDuration: 0,
      points: [],
      box: null,
      processingStatus: ''
    });
    setFile(null);
  };

  const handleUndoPoint = () => {
      if (state.points.length > 0) {
          const newPoints = state.points.slice(0, -1);
          updateState({ points: newPoints });
      }
  };

  const handleClearPoints = () => {
      updateState({ points: [], box: null });
  };

  const captureFrame = async (): Promise<string | undefined> => {
    try {
      // Find the video element - prefer the one in MediaViewer
      const videos = document.querySelectorAll('video');
      let video: HTMLVideoElement | null = null;
      
      // Find the first video that has valid dimensions and is ready
      for (const v of Array.from(videos)) {
        if (v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2) {
          video = v;
          break;
        }
      }
      
      // If no ready video found, try the first one anyway
      if (!video && videos.length > 0) {
        video = videos[0] as HTMLVideoElement;
      }
      
      if (!video) {
        console.warn("⚠️ [Capture] No video element found");
        throw new Error("No video element found. Please ensure the video is loaded.");
      }
      
      // Wait for video to be ready if it's not already
      if (video.readyState < 2) {
        console.log(`⏳ [Capture] Video not ready (readyState: ${video.readyState}), waiting...`);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            video?.removeEventListener('loadeddata', onLoadedData);
            video?.removeEventListener('loadedmetadata', onLoadedMetadata);
            video?.removeEventListener('canplay', onCanPlay);
            video?.removeEventListener('error', onError);
            reject(new Error("Video load timeout - video may not be fully loaded"));
          }, 10000); // Increased timeout to 10 seconds
          
          const onLoadedData = () => {
            console.log("✅ [Capture] Video loadeddata event fired");
            cleanup();
            resolve();
          };
          
          const onLoadedMetadata = () => {
            console.log("✅ [Capture] Video loadedmetadata event fired");
            // Metadata loaded, but might need more data
            if (video.readyState >= 2) {
              cleanup();
              resolve();
            }
          };
          
          const onCanPlay = () => {
            console.log("✅ [Capture] Video canplay event fired");
            cleanup();
            resolve();
          };
          
          const onError = (e: Event) => {
            console.error("❌ [Capture] Video error event:", e);
            cleanup();
            reject(new Error(`Video load error: ${video.error?.message || 'Unknown error'}`));
          };
          
          const cleanup = () => {
            clearTimeout(timeout);
            video?.removeEventListener('loadeddata', onLoadedData);
            video?.removeEventListener('loadedmetadata', onLoadedMetadata);
            video?.removeEventListener('canplay', onCanPlay);
            video?.removeEventListener('error', onError);
          };
          
          video.addEventListener('loadeddata', onLoadedData);
          video.addEventListener('loadedmetadata', onLoadedMetadata);
          video.addEventListener('canplay', onCanPlay);
          video.addEventListener('error', onError);
          
          // If video is already ready, resolve immediately
          if (video.readyState >= 2) {
            cleanup();
            resolve();
          }
        });
      }
      
      console.log(`📊 [Capture] Video state: readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}, currentTime=${video.currentTime.toFixed(2)}s`);
      
      // Check video dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error(`Video has invalid dimensions: ${video.videoWidth}x${video.videoHeight}`);
      }
      
      console.log(`📸 [Capture] Capturing frame from video: ${video.videoWidth}x${video.videoHeight}`);
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Validate canvas has content before converting
      const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
      const hasContent = imageData.data.some((val, idx) => idx % 4 !== 3 && val !== 0); // Check if any non-alpha pixel is non-zero
      
      if (!hasContent) {
        console.warn("⚠️ [Capture] Canvas appears to be empty - video frame may be blank");
      }
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      
      // Validate data URL
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        throw new Error("Failed to generate valid data URL from video frame");
      }
      
      // Test if the data URL can be loaded as an image (validate it's a valid image)
      await new Promise<void>((resolve, reject) => {
        const testImg = new Image();
        const timeout = setTimeout(() => {
          testImg.onload = null;
          testImg.onerror = null;
          reject(new Error("Data URL image validation timeout"));
        }, 5000);
        
        testImg.onload = () => {
          clearTimeout(timeout);
          console.log(`✅ [Capture] Data URL validated: image loads successfully (${testImg.width}x${testImg.height})`);
          resolve();
        };
        
        testImg.onerror = (e) => {
          clearTimeout(timeout);
          console.error("❌ [Capture] Data URL validation failed: image cannot be loaded");
          reject(new Error("Captured frame data URL is invalid and cannot be loaded as an image"));
        };
        
        testImg.src = dataUrl;
      });
      
      console.log(`✅ [Capture] Frame captured and validated successfully: ${dataUrl.substring(0, 50)}...`);
      return dataUrl;
      
    } catch (error: any) {
      console.error("❌ [Capture] Frame capture failed:", error);
      throw new Error(`Failed to capture video frame: ${error.message || 'Unknown error'}`);
    }
  };

  // Perform Analysis (Generic)
  const performAnalysis = async (fileInput: File | null, points: Point[] = [], promptInput: string = '', box: BoundingBox | null = null) => {
    
    // --- STOP STREAMING MODE ---
    if (state.isStreaming && state.streamSessionId) {
        updateState({ processingStatus: 'Stopping stream...' });
        await closeWebRTCSession(state.streamSessionId);
        closePeerConnection();
        updateState({ isStreaming: false, streamSessionId: null, processingStatus: '' });
        return;
    }

    // --- START ANALYSIS / STREAM ---
    updateState({ isAnalyzing: true, processingStatus: (points.length > 0 || box) ? 'Analyzing selection...' : 'Initializing analysis...' });

    try {
      
      // 1. Streaming Mode (WebRTC)
      // This handles both Camera and Screen Share streams automatically
      if (state.mediaType === 'stream' && localStream) {
          updateState({ processingStatus: 'Establishing WebRTC connection...' });
          // ... WebRTC setup ...
          const pc = new RTCPeerConnection({
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });
          pcRef.current = pc;

          localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

          pc.ontrack = (event) => {
              console.log("📡 [WebRTC] Received Remote Track");
              setRemoteStream(event.streams[0]);
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          const { sdp, type, session_id } = await establishWebRTCSession(
              offer.sdp!,
              offer.type,
              promptInput || "object",
              state.confidence,
              state.maskQuality
          );

          await pc.setRemoteDescription(new RTCSessionDescription({ type: type as RTCSdpType, sdp }));

          updateState({ 
              isStreaming: true, 
              streamSessionId: session_id,
              isAnalyzing: false, 
              processingStatus: '' 
          });
          return;
      }

      // 2. Video Analysis - Route to Video API
      if (state.mediaType === 'video' && fileInput) {
          updateState({ processingStatus: 'Processing video with SAM3...' });
          
          // Use video tracking API instead of capturing frames
          const result = await trackVideoText(
              fileInput,
              promptInput || "object",
              {
                  confidence: state.confidence,
                  maskQuality: state.maskQuality
              },
              0 // max_frames: 0 = use all frames
          );
          
          // Update result and clear loading state immediately
          updateState({ 
            result, 
            isAnalyzing: false, 
            processingStatus: '' 
          });
          return;
      }

      // 3. Static Analysis (Image / Camera Snapshot)
      let imageBase64 = undefined;
      let targetFile = fileInput;

      // Regular Camera/Stream Snapshot
      if (state.isCameraActive) {
        updateState({ processingStatus: 'Capturing frame...' });
        imageBase64 = await captureFrame();
      }

      updateState({ result: null, processingStatus: 'Uploading to AI...' });

      let result;
      try {
        result = await analyzeMedia(
          state.mode,
          targetFile,
          promptInput,
          imageBase64,
          {
              confidence: state.confidence,
              maskQuality: state.maskQuality
          },
          points, 
          box     
        );
      } catch (analyzeError: any) {
        // Convert Event objects to Error objects
        if (analyzeError instanceof Event) {
          const eventError = analyzeError as Event;
          const target = eventError.target as HTMLElement;
          let errorMessage = `Media loading error: ${eventError.type}`;
          
          if (target instanceof HTMLImageElement) {
            errorMessage = `Image failed to load. Source: ${target.src?.substring(0, 100) || 'unknown'}`;
          } else if (target instanceof HTMLVideoElement) {
            errorMessage = `Video failed to load. Source: ${target.src?.substring(0, 100) || 'unknown'}`;
          }
          
          console.error("❌ [Analysis] Event error converted to Error:", errorMessage);
          throw new Error(errorMessage);
        }
        // Re-throw if it's already an Error
        throw analyzeError;
      }

      // Update result and clear loading state immediately
      updateState({ 
        result, 
        isAnalyzing: false, 
        processingStatus: '' 
      });
    
    } catch (error: any) {
      console.error("❌ [Analysis] Error during analysis:", error);
      console.error("❌ [Analysis] Error type:", typeof error);
      console.error("❌ [Analysis] Error details:", {
        message: error?.message,
        name: error?.name,
        type: error?.type,
        target: error?.target,
        isTrusted: error?.isTrusted,
        stack: error?.stack
      });
      
      // Handle Event objects (from image/video load errors)
      let errorMessage = "Analysis failed";
      if (error instanceof Event) {
        const target = error.target as HTMLElement;
        if (target instanceof HTMLImageElement) {
          errorMessage = `Image failed to load: ${target.src?.substring(0, 100) || 'unknown source'}`;
        } else if (target instanceof HTMLVideoElement) {
          errorMessage = `Video failed to load: ${target.src?.substring(0, 100) || 'unknown source'}`;
        } else {
          errorMessage = `Media element error: ${error.type}`;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (error?.name) {
        errorMessage = `${error.name}: ${error.message || 'Unknown error'}`;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // Check if it's a video-related error
      if (state.mediaType === 'video' && (errorMessage.includes('video') || errorMessage.includes('Image failed'))) {
        errorMessage += "\n\nTip: Make sure the video is fully loaded before analyzing. Try playing the video first, then click Analyze.";
      }
      
      alert(`Analysis failed: ${errorMessage}`);
      
      // Clear loading state on error too
      if (!state.isStreaming) {
        updateState({ isAnalyzing: false, processingStatus: '' });
      }
    }
  };

  const handleAnalyzeButton = async () => {
    if (!state.mediaUrl && !state.isCameraActive) return;
    await performAnalysis(file, state.points, state.prompt, state.box);
  };

  const handlePointClick = (point: Point) => {
    const newPoints = [...state.points, point];
    updateState({ points: newPoints }); 
  };

  const handleBoxComplete = (box: BoundingBox) => {
      updateState({ box: box, points: [] });
  };

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-white">
      {/* Control Panel */}
      <div className="w-full md:w-[380px] h-[45vh] md:h-full border-r border-gray-100 flex flex-col order-2 md:order-1 bg-white z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <ControlPanel 
          state={state} 
          updateState={updateState} 
          onAnalyze={handleAnalyzeButton} 
          onUndoPoint={handleUndoPoint}
          onClearPoints={handleClearPoints}
        />
        {/* Helper text for streaming */}
        {state.isStreaming && (
            <div className="px-6 pb-4">
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-800 text-xs">
                    <span className="font-bold block mb-1">Live Stream Active</span>
                    The server is segmenting the video feed in real-time. Click "Stop" to end session.
                </div>
            </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 h-[55vh] md:h-full bg-white flex flex-col order-1 md:order-2 relative">
        <div className="px-6 pt-6 pb-2 md:px-10 md:pt-10 flex flex-col justify-center">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">EagleAI</h1>
          <p className="text-gray-500 text-sm md:text-base">Computer Vision Suite (SAM 3 v2.0)</p>
        </div>

        <div className="flex-1 p-4 md:p-10 min-h-0">
          <MediaViewer 
            mediaType={state.mediaType}
            mediaUrl={state.mediaUrl}
            isCameraActive={state.isCameraActive}
            result={state.result}
            
            // Pass Streams
            localStream={localStream}
            remoteStream={remoteStream}
            
            // Interaction Props
            mode={state.mode}
            points={state.points}
            box={state.box}
            onPointClick={handlePointClick}
            onBoxComplete={handleBoxComplete}

            videoDuration={state.videoDuration}
            trimRange={state.trimRange}
            onVideoMetadataLoad={handleVideoMetadata}
            onTrimChange={handleTrimChange}
            
            onUpload={handleUpload}
            onCameraStart={handleCameraStart}
            onScreenShareStart={handleScreenShareStart}
            onCameraCapture={() => {}} 
            onClear={handleClear}
            
            onTrimConfirm={handleTrimVideo}
            isTrimming={state.isTrimming}
            
            showLoadingOverlay={state.isAnalyzing || state.isTrimming}
            loadingStatus={state.processingStatus}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
