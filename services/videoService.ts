
/**
 * Trims a video file in the browser by playing it and recording the canvas stream.
 * This guarantees a valid video file output compatible with APIs.
 */
export const trimVideoFile = async (
    sourceFile: File | Blob,
    startTime: number,
    endTime: number,
    onProgress?: (progress: number) => void
  ): Promise<File> => {
    return new Promise((resolve, reject) => {
      // 1. Setup hidden video element
      const video = document.createElement('video');
      video.src = URL.createObjectURL(sourceFile);
      video.muted = true;
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      
      // Attach to DOM (hidden) to ensure rendering priority in Chrome/Safari
      video.style.position = "fixed";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.zIndex = "-1";
      document.body.appendChild(video);
  
      // 2. Setup Canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for video (no alpha)
  
      if (!ctx) {
        document.body.removeChild(video);
        reject(new Error("Could not get canvas context"));
        return;
      }
  
      let mediaRecorder: MediaRecorder | null = null;
      const chunks: BlobPart[] = [];
      let animationId: number;
      let isRecording = false;
  
      // Cleanup function
      const cleanup = () => {
        if (animationId) cancelAnimationFrame(animationId);
        if (video.parentNode) document.body.removeChild(video);
        URL.revokeObjectURL(video.src);
      };
  
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Seek to start point
        video.currentTime = startTime;
      };
  
      // Draw loop
      const processFrame = () => {
        if (!isRecording) return;
        
        if (video.ended || video.currentTime >= endTime) {
          stopRecording();
          return;
        }
  
        // Draw current video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Update progress
        if (onProgress) {
             const duration = endTime - startTime;
             const current = video.currentTime - startTime;
             onProgress(Math.min(100, Math.max(0, (current / duration) * 100)));
        }
  
        animationId = requestAnimationFrame(processFrame);
      };
  
      const startRecording = () => {
        isRecording = true;
        
        // Capture stream at 6 FPS (Efficient for AI Analysis)
        const stream = canvas.captureStream(6);
        
        const options: MediaRecorderOptions = {
             mimeType: 'video/webm;codecs=vp9'
        };
        
        // Safari/Firefox fallback
        if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
             if (MediaRecorder.isTypeSupported('video/webm')) {
                 options.mimeType = 'video/webm';
             } else {
                 delete options.mimeType; // Let browser choose default (usually mp4 on Safari)
             }
        }
  
        try {
            mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            console.warn("MediaRecorder setup failed, trying default", e);
            mediaRecorder = new MediaRecorder(stream);
        }
  
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };
  
        mediaRecorder.onstop = () => {
           const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'video/webm' });
           const file = new File([blob], "trimmed_clip.webm", { type: blob.type });
           cleanup();
           resolve(file);
        };
  
        mediaRecorder.start();
        video.play().then(() => {
            processFrame();
        }).catch(err => {
            cleanup();
            reject(err);
        });
      };
  
      const stopRecording = () => {
        isRecording = false;
        video.pause();
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      };
  
      // Wait for seek to complete before starting
      video.onseeked = () => {
        if (!isRecording && video.currentTime < endTime) {
            // Check if we are at start
            if (Math.abs(video.currentTime - startTime) < 0.5) {
                startRecording();
            }
        }
      };
  
      video.onerror = (e) => {
          cleanup();
          reject(new Error("Video playback error"));
      };
    });
  };
  
  export const formatTime = (seconds: number): string => {
      const min = Math.floor(seconds / 60);
      const sec = Math.floor(seconds % 60);
      return `${min}:${sec.toString().padStart(2, '0')}`;
  };
