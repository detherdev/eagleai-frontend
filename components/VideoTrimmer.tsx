
import React, { useRef, useEffect, useState } from 'react';
import { formatTime } from '../services/videoService';

interface VideoTrimmerProps {
  duration: number;
  range: [number, number];
  onChange: (newRange: [number, number]) => void;
  onPreviewTime: (time: number) => void;
}

export const VideoTrimmer: React.FC<VideoTrimmerProps> = ({ 
  duration, 
  range, 
  onChange,
  onPreviewTime
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | null>(null);

  // Helper to get time from X position
  const getTimeFromX = (x: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return percent * duration;
  };

  const handlePointerDown = (type: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    containerRef.current?.setPointerCapture(e.pointerId);
    setIsDragging(type);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    
    const time = getTimeFromX(e.clientX);
    const [start, end] = range;
    const minGap = 1; // Minimum 1 second clip

    if (isDragging === 'start') {
      const newStart = Math.min(time, end - minGap);
      onChange([newStart, end]);
      onPreviewTime(newStart);
    } else {
      const newEnd = Math.max(time, start + minGap);
      onChange([start, newEnd]);
      onPreviewTime(newEnd);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(null);
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  // Percentages for UI
  const startPercent = (range[0] / duration) * 100;
  const endPercent = (range[1] / duration) * 100;

  return (
    <div className="w-full space-y-2 select-none animate-fade-in">
      <div className="flex justify-between text-xs font-bold text-gray-400 uppercase tracking-wider">
        <span>Start: {formatTime(range[0])}</span>
        <span>Duration: {formatTime(range[1] - range[0])}</span>
        <span>End: {formatTime(range[1])}</span>
      </div>
      
      <div 
        ref={containerRef}
        className="relative h-12 flex items-center cursor-pointer group"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Background Track */}
        <div className="absolute left-0 right-0 h-2 bg-gray-200 rounded-full overflow-hidden">
            {/* Active Range Track */}
            <div 
                className="absolute h-full bg-blue-500 opacity-30"
                style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
            />
        </div>

        {/* Start Handle */}
        <div 
            className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white border-2 border-gray-400 rounded-sm shadow-md cursor-ew-resize z-20 flex items-center justify-center hover:border-gray-800 hover:scale-110 transition-transform"
            style={{ left: `${startPercent}%`, marginLeft: '-8px' }}
            onPointerDown={handlePointerDown('start')}
        >
            <div className="w-0.5 h-3 bg-gray-300"></div>
        </div>

        {/* End Handle */}
        <div 
            className="absolute top-1/2 -translate-y-1/2 w-4 h-8 bg-white border-2 border-gray-400 rounded-sm shadow-md cursor-ew-resize z-20 flex items-center justify-center hover:border-gray-800 hover:scale-110 transition-transform"
            style={{ left: `${endPercent}%`, marginLeft: '-8px' }}
            onPointerDown={handlePointerDown('end')}
        >
            <div className="w-0.5 h-3 bg-gray-300"></div>
        </div>

        {/* Connector Line (High visibility) */}
        <div 
            className="absolute h-2 bg-gray-800 rounded-full z-10 pointer-events-none"
            style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
        />
      </div>
    </div>
  );
};
