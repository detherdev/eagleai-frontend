
import { AnalysisResult, DetectionMode, Point, BoundingBox } from "../types";

// API Config
const HF_TOKEN = import.meta.env.VITE_HF_TOKEN || "";
const SAM_API_BASE = import.meta.env.VITE_SAM_API_BASE || "https://daveyri-samx.hf.space";

// Helper: Convert base64 data URL to Blob
const dataURLtoBlob = (dataurl: string): Blob => {
    if (!dataurl || !dataurl.startsWith('data:')) {
        console.error("❌ [dataURLtoBlob] Invalid data URL format");
        throw new Error("Invalid data URL format");
    }
    
    try {
        const arr = dataurl.split(',');
        if (arr.length < 2) {
            throw new Error("Invalid data URL: missing comma separator");
        }
        
        const match = arr[0].match(/:(.*?);/);
        const mime = match ? match[1] : 'image/jpeg';
        const base64Data = arr[1];
        
        if (!base64Data || base64Data.length === 0) {
            throw new Error("Invalid data URL: empty base64 data");
        }
        
        const bstr = atob(base64Data);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        
        const blob = new Blob([u8arr], { type: mime });
        console.log(`✅ [dataURLtoBlob] Converted data URL to blob: ${(blob.size / 1024).toFixed(2)}KB, type: ${mime}`);
        return blob;
    } catch (e) {
        console.error("❌ [dataURLtoBlob] Conversion error:", e);
        throw new Error(`Failed to convert data URL to blob: ${e}`);
    }
}

/**
 * Creates a video blob from an array of base64-encoded image frames
 * @param frames Array of base64 image data URLs (with or without data: prefix)
 * @param fps Frames per second for the output video (default: 30)
 * @returns Promise resolving to a video Blob URL
 */
const createVideoFromFrames = async (
    frames: string[],
    fps: number = 30
): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!frames || frames.length === 0) {
            reject(new Error("No frames provided"));
            return;
        }

        console.log(`🎬 [createVideoFromFrames] Creating video from ${frames.length} frames at ${fps} FPS`);

        // Create canvas and context
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });
        
        if (!ctx) {
            reject(new Error("Failed to get canvas context"));
            return;
        }

        // Load first frame to get dimensions
        const firstFrame = new Image();
        const firstFrameUrl = frames[0].startsWith('data:') ? frames[0] : `data:image/png;base64,${frames[0]}`;
        
        firstFrame.onload = () => {
            canvas.width = firstFrame.width;
            canvas.height = firstFrame.height;
            console.log(`📐 [createVideoFromFrames] Canvas size: ${canvas.width}x${canvas.height}`);

            // Create MediaRecorder stream
            const stream = canvas.captureStream(fps);
            
            // Determine best codec
            const options: MediaRecorderOptions = {
                mimeType: 'video/webm;codecs=vp9'
            };
            
            if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
                if (MediaRecorder.isTypeSupported('video/webm')) {
                    options.mimeType = 'video/webm';
                } else {
                    delete options.mimeType; // Let browser choose default
                }
            }

            const mediaRecorder = new MediaRecorder(stream, options);
            const chunks: BlobPart[] = [];
            let frameIndex = 0;

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'video/webm' });
                const videoUrl = URL.createObjectURL(blob);
                console.log(`✅ [createVideoFromFrames] Video created: ${(blob.size / 1024 / 1024).toFixed(2)}MB, ${frames.length} frames`);
                resolve(videoUrl);
            };

            mediaRecorder.onerror = (e) => {
                console.error("❌ [createVideoFromFrames] MediaRecorder error:", e);
                reject(new Error("MediaRecorder error"));
            };

            // Draw frames sequentially
            const drawNextFrame = () => {
                if (frameIndex >= frames.length) {
                    // All frames drawn, stop recording
                    setTimeout(() => {
                        if (mediaRecorder.state === 'recording') {
                            mediaRecorder.stop();
                        }
                    }, 100); // Small delay to ensure last frame is captured
                    return;
                }

                const frameUrl = frames[frameIndex].startsWith('data:') 
                    ? frames[frameIndex] 
                    : `data:image/png;base64,${frames[frameIndex]}`;
                
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    
                    // Start recording on first frame
                    if (frameIndex === 0) {
                        mediaRecorder.start();
                        console.log(`🎥 [createVideoFromFrames] Recording started`);
                    }
                    
                    frameIndex++;
                    
                    // Schedule next frame (1000ms / fps = delay between frames)
                    setTimeout(drawNextFrame, 1000 / fps);
                };
                
                img.onerror = () => {
                    console.warn(`⚠️ [createVideoFromFrames] Failed to load frame ${frameIndex}, skipping`);
                    frameIndex++;
                    setTimeout(drawNextFrame, 1000 / fps);
                };
                
                img.src = frameUrl;
            };

            // Start drawing frames (recording will start after first frame is drawn)
            drawNextFrame();
        };

        firstFrame.onerror = () => {
            reject(new Error("Failed to load first frame"));
        };

        firstFrame.src = firstFrameUrl;
    });
};

// Convert image to standard JPEG Blob
const processImageForApi = async (file: File | Blob): Promise<{ blob: Blob, scaleX: number, scaleY: number, width: number, height: number }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        img.onload = () => {
            const MAX_DIM = 800;
            let width = img.naturalWidth;
            let height = img.naturalHeight;
            const originalWidth = img.naturalWidth;
            const originalHeight = img.naturalHeight;
            
            if (width > MAX_DIM || height > MAX_DIM) {
                const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            width = Math.round(width / 32) * 32;
            height = Math.round(height / 32) * 32;
            width = Math.max(32, width);
            height = Math.max(32, height);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error("Canvas context failed")); return; }
            
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, width, height);
            
            const scaleX = width / originalWidth;
            const scaleY = height / originalHeight;

            canvas.toBlob((blob) => {
                URL.revokeObjectURL(url);
                if (blob) {
                    resolve({ blob, scaleX, scaleY, width, height });
                }
                else reject(new Error("Image processing failed"));
            }, 'image/jpeg', 0.8); 
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
};

// Decode multiple RLE masks (white for composition)
const decodeMasksToDataURL = (masks: { size: [number, number], counts: number[] }[]): string => {
    if (!masks || masks.length === 0) {
        console.warn("⚠️ [Mask Decode] No masks provided");
        return '';
    }
    
    console.log(`🎨 [Mask Decode] Decoding ${masks.length} masks...`);
    
    try {
        const [height, width] = masks[0].size;
        console.log(`📐 [Mask Decode] Canvas size: ${width}x${height}`);
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error("❌ [Mask Decode] Failed to get canvas context");
            return '';
        }
        
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        
        // Decode all masks into a single composite mask
        for (let maskIdx = 0; maskIdx < masks.length; maskIdx++) {
            const mask = masks[maskIdx];
            const counts = mask.counts;
            
            // Verify mask size matches canvas
            if (mask.size[0] !== height || mask.size[1] !== width) {
                console.warn(`⚠️ [Mask Decode] Mask ${maskIdx} size mismatch: ${mask.size[1]}x${mask.size[0]} vs canvas ${width}x${height}`);
            }
            
            let p = 0; 
            let val = 0; 
            
            for (let i = 0; i < counts.length; i++) {
                const count = counts[i];
                if (val === 1) {
                    // Set pixels to white (255, 255, 255, 255)
                    const endIdx = Math.min(p + count, width * height);
                    for (let j = p; j < endIdx; j++) {
                        const idx = j * 4;
                        if (idx + 3 < data.length) {
                            data[idx] = 255;     // R
                            data[idx + 1] = 255; // G
                            data[idx + 2] = 255; // B
                            data[idx + 3] = 255; // A
                        }
                    }
                }
                p += count;
                val = 1 - val;
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        console.log(`✅ [Mask Decode] Successfully decoded ${masks.length} masks`);
        return dataUrl;
    } catch (error) {
        console.error("❌ [Mask Decode] Error decoding masks:", error);
        return '';
    }
};

const compositeOverlay = async (originalBlob: Blob, maskDataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        console.log("🖼️ [Overlay] Starting composite overlay...");
        
        // Validate original blob
        if (!originalBlob || originalBlob.size === 0) {
            console.error("❌ [Overlay] Invalid original blob");
            reject(new Error("Invalid image blob provided"));
            return;
        }
        
        console.log(`📦 [Overlay] Original blob: ${(originalBlob.size / 1024).toFixed(2)}KB, type: ${originalBlob.type}`);
        
        if (!maskDataUrl) {
            console.warn("⚠️ [Overlay] No mask data URL provided, returning original image");
            try {
                const url = URL.createObjectURL(originalBlob);
                resolve(url);
            } catch (e) {
                console.error("❌ [Overlay] Failed to create object URL:", e);
                reject(new Error("Failed to create image URL"));
            }
            return;
        }
        
        // Validate mask data URL
        if (!maskDataUrl.startsWith('data:image/')) {
            console.warn("⚠️ [Overlay] Invalid mask data URL format, continuing without mask");
            try {
                const url = URL.createObjectURL(originalBlob);
                resolve(url);
            } catch (e) {
                console.error("❌ [Overlay] Failed to create object URL:", e);
                reject(new Error("Failed to create image URL"));
            }
            return;
        }
        
        const img = new Image();
        const mask = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) { 
            console.error("❌ [Overlay] Canvas context error");
            reject(new Error("Canvas context error")); 
            return; 
        }

        let imgLoaded = false;
        let maskLoaded = false;
        let imgError = false;
        let maskError = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let objectUrl: string | null = null;
        
        const tryComposite = () => {
            if (!imgLoaded || (!maskLoaded && !maskError)) return;
            
            // Clear timeout since we're proceeding
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            
            console.log(`🖼️ [Overlay] Both images loaded. Original: ${img.width}x${img.height}`);
            
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            if (!maskError && mask.complete && mask.naturalWidth > 0) {
                console.log(`🎨 [Overlay] Applying mask: ${mask.width}x${mask.height}`);
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.globalCompositeOperation = 'source-over';
                const offCanvas = document.createElement('canvas');
                offCanvas.width = canvas.width;
                offCanvas.height = canvas.height;
                const offCtx = offCanvas.getContext('2d');
                if (offCtx) {
                    offCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);
                    offCtx.globalCompositeOperation = 'source-in';
                    offCtx.fillStyle = '#4f46e5'; 
                    offCtx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(offCanvas, 0, 0);
                } else {
                    ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
                }
                ctx.restore();
            } else {
                console.warn("⚠️ [Overlay] Mask failed to load, skipping overlay");
            }
            
            try {
                const result = canvas.toDataURL('image/jpeg', 0.9);
                
                // Clean up object URL
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                    objectUrl = null;
                }
                
                // Validate the data URL
                if (!result || !result.startsWith('data:image/')) {
                    console.error("❌ [Overlay] Invalid data URL generated");
                    reject(new Error("Failed to generate valid image data URL"));
                    return;
                }
                
                // Check data URL size (some browsers have limits)
                const sizeInMB = (result.length * 3) / 4 / 1024 / 1024;
                if (sizeInMB > 10) {
                    console.warn(`⚠️ [Overlay] Large data URL: ${sizeInMB.toFixed(2)}MB`);
                }
                
                console.log(`✅ [Overlay] Composite complete: ${sizeInMB.toFixed(2)}MB`);
                resolve(result);
            } catch (e) {
                console.error("❌ [Overlay] Error generating data URL:", e);
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                reject(new Error(`Failed to generate image: ${e}`));
            }
        };

        img.onload = () => {
            console.log(`✅ [Overlay] Original image loaded: ${img.width}x${img.height}, natural: ${img.naturalWidth}x${img.naturalHeight}`);
            imgLoaded = true;
            tryComposite();
        };
        
        img.onerror = (e) => {
            const target = e.target as HTMLImageElement;
            console.error("❌ [Overlay] Original image failed to load:", {
                error: e,
                errorType: e.type,
                src: target?.src?.substring(0, 100) || img.src?.substring(0, 100),
                complete: target?.complete ?? img.complete,
                naturalWidth: target?.naturalWidth ?? img.naturalWidth,
                naturalHeight: target?.naturalHeight ?? img.naturalHeight,
                blobType: originalBlob.type,
                blobSize: originalBlob.size
            });
            imgError = true;
            if (timeoutId) clearTimeout(timeoutId);
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrl = null;
            }
            // Convert Event to Error to prevent Event propagation
            const errorMsg = `Failed to load original image. Blob type: ${originalBlob.type || 'unknown'}, size: ${originalBlob.size} bytes. Image src: ${target?.src?.substring(0, 50) || 'unknown'}`;
            reject(new Error(errorMsg));
        };
        
        mask.onload = () => {
            console.log(`✅ [Overlay] Mask image loaded: ${mask.width}x${mask.height}`);
            maskLoaded = true;
            tryComposite();
        };
        
        mask.onerror = (e) => {
            const target = e.target as HTMLImageElement;
            console.warn("⚠️ [Overlay] Mask image failed to load:", {
                error: e,
                errorType: e.type,
                src: target?.src?.substring(0, 100) || mask.src?.substring(0, 100),
                maskDataUrlPreview: maskDataUrl?.substring(0, 100)
            });
            maskError = true;
            // Continue without mask overlay - don't reject, just skip mask
            tryComposite();
        };
        
        // Set timeout to prevent infinite waiting
        timeoutId = setTimeout(() => {
            if (!imgLoaded || (!maskLoaded && !maskError)) {
                console.error("❌ [Overlay] Timeout waiting for images to load");
                reject(new Error("Timeout waiting for images"));
            }
        }, 30000); // 30 second timeout
        
        // Start loading images
        try {
            // Validate blob before creating URL
            if (!originalBlob || originalBlob.size === 0) {
                throw new Error(`Invalid blob: size=${originalBlob?.size || 0}, type=${originalBlob?.type || 'unknown'}`);
            }
            
            objectUrl = URL.createObjectURL(originalBlob);
            
            // Validate object URL was created
            if (!objectUrl || objectUrl === 'null' || objectUrl === 'undefined') {
                throw new Error("Failed to create valid object URL");
            }
            
            img.src = objectUrl;
            mask.src = maskDataUrl;
            
            console.log(`🔄 [Overlay] Started loading images:`);
            console.log(`  - Original: ${objectUrl.substring(0, 80)}...`);
            console.log(`  - Blob size: ${(originalBlob.size / 1024).toFixed(2)}KB, type: ${originalBlob.type}`);
            console.log(`  - Mask: ${maskDataUrl.substring(0, 80)}...`);
        } catch (e) {
            console.error("❌ [Overlay] Failed to create object URL:", e);
            if (timeoutId) clearTimeout(timeoutId);
            reject(new Error(`Failed to create image URL: ${e}`));
        }
    });
};

const processSamResponse = async (data: any, originalBlob: Blob): Promise<AnalysisResult> => {
    console.log("📦 [Response] Processing SAM3 response...");
    console.log(`📦 [Response] Masks: ${data.masks?.length || 0}, Boxes: ${data.boxes?.length || 0}, Scores: ${data.scores?.length || 0}`);
    
    try {
        if (data.masks && data.masks.length > 0) {
            console.log(`🎨 [Response] Decoding ${data.masks.length} masks...`);
            const maskDataUrl = decodeMasksToDataURL(data.masks);
            
            if (!maskDataUrl) {
                console.warn("⚠️ [Response] Mask decoding returned empty, continuing without overlay");
            }
            
            console.log("🖼️ [Response] Compositing overlay...");
            let overlayUrl: string;
            try {
                overlayUrl = await compositeOverlay(originalBlob, maskDataUrl);
            } catch (overlayError: any) {
                console.error("❌ [Response] Overlay composition failed:", overlayError);
                console.warn("⚠️ [Response] Falling back to original image without overlay");
                // Fallback: return original image URL
                try {
                    overlayUrl = URL.createObjectURL(originalBlob);
                } catch (urlError: any) {
                    console.error("❌ [Response] Failed to create fallback URL:", urlError);
                    throw new Error(`Failed to create image URL: ${overlayError.message || overlayError}`);
                }
            }
            
            const count = data.masks.length;
            const maxScore = data.scores ? Math.max(...data.scores) : 0;
            const scoreText = `Found ${count} object${count !== 1 ? 's' : ''}. ` + 
                (data.scores && data.scores.length > 0 ? `Max Confidence: ${(maxScore * 100).toFixed(1)}%` : "");
            
            console.log(`✅ [Response] Processing complete: ${scoreText}`);
            
            return {
                text: scoreText,
                processedMediaUrl: overlayUrl,
                processedMediaType: 'image',
                rawMasks: data.masks,
                rawBoxes: data.boxes
            };
        } else {
            console.log("⚠️ [Response] No masks found in response");
            return { text: "No objects found matching the prompt." };
        }
    } catch (error) {
        console.error("❌ [Response] Error processing SAM3 response:", error);
        throw error;
    }
};

/**
 * WebRTC Streaming
 */
export const establishWebRTCSession = async (offerSdp: string, offerType: string, prompt: string, confidence: number, maskQuality: number): Promise<{ sdp: string, type: string, session_id: string }> => {
    console.log("📡 [WebRTC] Sending Offer to SAM3 API...");
    const payload: any = { sdp: offerSdp, type: offerType, threshold: confidence, mask_threshold: maskQuality };
    // WebRTC endpoint specifically uses 'text_prompt' in the JSON body
    payload.text_prompt = prompt || null;
    const response = await fetch(`${SAM_API_BASE}/v1/stream/webrtc/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${HF_TOKEN}` },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`WebRTC Offer failed (${response.status}): ${err}`);
    }
    return await response.json();
};

export const closeWebRTCSession = async (sessionId: string) => {
    if (!sessionId) return;
    try {
        await fetch(`${SAM_API_BASE}/v1/stream/webrtc/session/${sessionId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${HF_TOKEN}` }
        });
        console.log("🔒 [WebRTC] Session closed.");
    } catch (e) {
        console.warn("Failed to close WebRTC session", e);
    }
};

/**
 * Convert video file to base64 string (without data URL prefix)
 */
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:video/quicktime;base64,")
            // Keep only the base64 string
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            
            if (!base64 || base64.length === 0) {
                reject(new Error("Failed to read file as base64"));
                return;
            }
            
            console.log(`✅ [fileToBase64] Converted ${file.name}: ${(base64.length * 3 / 4 / 1024 / 1024).toFixed(2)}MB base64`);
            resolve(base64);
        };
        reader.onerror = (error) => {
            console.error("❌ [fileToBase64] FileReader error:", error);
            reject(new Error(`Failed to read file: ${error}`));
        };
        reader.readAsDataURL(file);
    });
};

/**
 * Video Tracking (Text-based)
 */
export const trackVideoText = async (
    file: File,
    text: string,
    settings: { confidence: number, maskQuality: number },
    maxFrames: number = 0
): Promise<AnalysisResult> => {
    console.log(`🎥 [Video API] Starting text-based video tracking: text='${text}', max_frames=${maxFrames}`);
    
    try {
        // Check file size before processing (limit to 50MB to prevent OOM)
        const fileSizeMB = file.size / 1024 / 1024;
        if (fileSizeMB > 50) {
            throw new Error(`Video file too large (${fileSizeMB.toFixed(2)}MB). Maximum size is 50MB. Please compress or trim your video.`);
        }
        
        // Convert video file to base64
        console.log(`🔄 [Video API] Converting video to base64: ${file.name}, size: ${fileSizeMB.toFixed(2)}MB`);
        const videoBase64 = await fileToBase64(file);
        
        // Validate base64
        if (!videoBase64 || videoBase64.length === 0) {
            throw new Error("Failed to convert video to base64");
        }
        
        // Check base64 size (base64 is ~33% larger than original)
        const base64SizeMB = (videoBase64.length * 3 / 4) / 1024 / 1024;
        console.log(`📊 [Video API] Base64 size: ${base64SizeMB.toFixed(2)}MB`);
        
        if (base64SizeMB > 70) {
            throw new Error(`Video too large after encoding (${base64SizeMB.toFixed(2)}MB). Maximum size is 50MB original file.`);
        }
        
        const payload = {
            video: { b64: videoBase64 },
            text: text,
            max_frames: maxFrames,
            mask_threshold: settings.maskQuality
        };
        
        console.log(`📡 [Video API] Sending request to /v1/video/track_text...`);
        console.log(`📡 [Video API] Payload size: ${(JSON.stringify(payload).length / 1024 / 1024).toFixed(2)}MB`);
        
        const response = await fetch(`${SAM_API_BASE}/v1/video/track_text`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${HF_TOKEN}`
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            let errText = await response.text();
            
            // Try to parse as JSON if possible
            try {
                const errJson = JSON.parse(errText);
                if (errJson.detail) {
                    errText = errJson.detail;
                }
            } catch {
                // Not JSON, use text as-is
                // If it's HTML, extract just the error message
                if (errText.includes('<!DOCTYPE html>')) {
                    const match = errText.match(/<h1>(\d+)<\/h1>|<p[^>]*>([^<]+)<\/p>/);
                    if (match) {
                        errText = `Server Error ${match[1] || '500'}: ${match[2] || 'Internal Server Error'}`;
                    } else {
                        errText = `Server Error ${response.status}: Internal Server Error`;
                    }
                }
            }
            
            // Handle memory errors specifically
            if (response.status === 413 || errText.toLowerCase().includes('memory') || errText.toLowerCase().includes('oom')) {
                console.error(`❌ [Video API] Memory error (${response.status}):`, errText);
                throw new Error(`Video too large for processing. ${errText}\n\nTip: Try a shorter video (under 30 seconds) or reduce the video resolution.`);
            }
            
            console.error(`❌ [Video API] Server error (${response.status}):`, errText);
            throw new Error(`Video tracking failed (${response.status}): ${errText}`);
        }
        
        const data = await response.json();
        console.log(`✅ [Video API] Video tracking complete: ${data.frames?.length || 0} frames processed`);
        
        // Process video tracking response
        if (data.frames && data.frames.length > 0) {
            // Use rendered frames if available, otherwise use first frame
            let frames = data.rendered_frames || (data.frames[0]?.rendered_frame ? [data.frames[0].rendered_frame] : []);
            
            if (!frames || frames.length === 0) {
                return { text: "No rendered frames available." };
            }
            
            // Ensure frames have data URL prefix (backend returns raw base64)
            frames = frames.map((frame: string) => {
                if (!frame) return frame;
                // If it already has data: prefix, use as-is
                if (frame.startsWith('data:')) {
                    return frame;
                }
                // Otherwise, add data:image/png;base64, prefix
                return `data:image/png;base64,${frame}`;
            });
            
            console.log(`🎬 [Video API] Creating video from ${frames.length} frames...`);
            
            // Create video from all frames
            try {
                // Estimate FPS based on original video duration (if available)
                // Default to 30 FPS if we can't determine
                const estimatedFPS = 30;
                
                const videoUrl = await createVideoFromFrames(frames, estimatedFPS);
                
                return {
                    text: `Tracked ${data.frames.length} frames. Found ${data.frames[0]?.object_ids?.length || 0} object(s).`,
                    processedMediaUrl: videoUrl, // Video blob URL
                    processedMediaType: 'video', // Now it's a real video!
                    rawMasks: data.frames.flatMap((f: any) => f.masks || []),
                    rawBoxes: data.frames.flatMap((f: any) => f.boxes || []),
                    trackingFrames: frames // Keep frames for reference
                };
            } catch (videoError) {
                console.error("❌ [Video API] Failed to create video from frames:", videoError);
                // Fallback to first frame as image preview
                return {
                    text: `Tracked ${data.frames.length} frames. Found ${data.frames[0]?.object_ids?.length || 0} object(s). (Video creation failed, showing first frame)`,
                    processedMediaUrl: frames[0] || null,
                    processedMediaType: 'image',
                    rawMasks: data.frames.flatMap((f: any) => f.masks || []),
                    rawBoxes: data.frames.flatMap((f: any) => f.boxes || []),
                    trackingFrames: frames
                };
            }
        } else {
            return { text: "No objects tracked in video." };
        }
    } catch (error: any) {
        console.error("❌ [Video API] Video tracking error:", error);
        throw error;
    }
};

/**
 * Main Analysis Entry Point
 */
export const analyzeMedia = async (
  mode: DetectionMode,
  file: File | null,
  prompt: string,
  imageBase64: string | undefined,
  settings: { confidence: number, maskQuality: number },
  points: Point[] = [],
  box: BoundingBox | null = null
): Promise<AnalysisResult> => {

    const formData = new FormData();
    
    // Determine Input Source
    if (file) {
        const { blob } = await processImageForApi(file);
        formData.append("image", blob, "input.jpg");
    } else if (imageBase64) {
        const blob = dataURLtoBlob(imageBase64);
        formData.append("image", blob, "capture.jpg");
    } else {
        throw new Error("No media provided for analysis");
    }

    // Build Request
    let hasPrompt = false;

    if (points.length > 0) {
        // Point-based Prompting
        // Backend expects: points (JSON string), point_labels (JSON string)
        formData.append("points", JSON.stringify(points.map(p => [p.x, p.y])));
        formData.append("point_labels", JSON.stringify(points.map(p => p.label))); // 1=Include, 0=Exclude
        hasPrompt = true;
    } else if (box) {
        // Box-based Prompting
        // Backend expects: boxes (JSON string), box_labels (JSON string, optional)
        const boxArr = [[box.xmin, box.ymin, box.xmax, box.ymax]];
        formData.append("boxes", JSON.stringify(boxArr));
        // Default to positive label (1) for box prompts
        formData.append("box_labels", JSON.stringify([1]));
        hasPrompt = true;
    }

    // Text Prompt - Passed to SAM3
    // Backend expects: text (not 'prompt')
    if (prompt && prompt.trim()) {
        formData.append("text", prompt.trim()); 
        hasPrompt = true;
    }

    if (!hasPrompt) {
        throw new Error("Please provide a text prompt, or click/box on the image to select an object.");
    }

    // Parameters
    // Backend expects: threshold (not 'conf_threshold')
    formData.append("threshold", settings.confidence.toString());
    formData.append("mask_threshold", settings.maskQuality.toString());

    console.log(`🚀 [API] Sending ${mode} request to SAM3...`);
    
    // Choose Endpoint based on logic (Simplify to generic segmentation for this demo)
    const endpoint = `${SAM_API_BASE}/v1/segment`; 

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${HF_TOKEN}`
        },
        body: formData
    });

    if (!response.ok) {
        const errText = await response.text();
        // Handle common server errors more gracefully
        if (response.status === 500) {
             throw new Error(`Server Error (500). The model may have failed to process the input. Ensure your prompt matches the image content.`);
        }
        throw new Error(`API Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    
    // Re-process image blob for overlay composition
    let originalBlob: Blob;
    try {
        if (file) {
            // Use processed blob (to match dimension if resized)
            console.log("🔄 [Analyze] Processing file for overlay...");
            const processed = await processImageForApi(file);
            originalBlob = processed.blob;
            console.log(`✅ [Analyze] File processed: ${(originalBlob.size / 1024).toFixed(2)}KB, type: ${originalBlob.type}`);
        } else if (imageBase64) {
            console.log("🔄 [Analyze] Converting base64 to blob for overlay...");
            
            // Validate base64 data URL first
            if (!imageBase64 || !imageBase64.startsWith('data:image/')) {
                throw new Error(`Invalid base64 data URL format: ${imageBase64?.substring(0, 50) || 'empty'}`);
            }
            
            originalBlob = dataURLtoBlob(imageBase64);
            
            // Validate blob was created successfully
            if (!originalBlob || originalBlob.size === 0) {
                throw new Error("Failed to create valid blob from base64 data");
            }
            
            console.log(`✅ [Analyze] Base64 converted: ${(originalBlob.size / 1024).toFixed(2)}KB, type: ${originalBlob.type}`);
        } else {
            throw new Error("No image source provided for overlay");
        }
    } catch (blobError: any) {
        console.error("❌ [Analyze] Failed to create blob for overlay:", blobError);
        throw new Error(`Failed to prepare image for overlay: ${blobError.message || blobError}`);
    }

    return await processSamResponse(data, originalBlob);
};
