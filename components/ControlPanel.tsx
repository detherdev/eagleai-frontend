
import React from 'react';
import { DetectionMode, AppState } from '../types';
import { IconCube, IconCursor, IconPlay } from './Icons';

interface ControlPanelProps {
  state: AppState;
  updateState: (updates: Partial<AppState>) => void;
  onAnalyze: () => void;
  onUndoPoint?: () => void;
  onClearPoints?: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ 
    state, 
    updateState, 
    onAnalyze,
    onUndoPoint,
    onClearPoints
}) => {
  
  const modes = [
    { id: 'segment', icon: <IconCube className="w-5 h-5" />, label: 'Segment' },
    { id: 'track', icon: <IconCursor className="w-5 h-5" />, label: 'Track' },
  ];

  // Logic to determine if we can run analysis
  const hasInput = !!state.prompt || state.points.length > 0 || !!state.box;
  const canAnalyze = (!!state.mediaUrl || state.isCameraActive) && hasInput;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
      
        <div className="space-y-8 py-2">
            
            {/* Mode Selector */}
            <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 tracking-wider uppercase">Task (SAM 3)</label>
            <div className="grid grid-cols-2 gap-3">
                {modes.map((mode) => (
                <button
                    key={mode.id}
                    onClick={() => updateState({ mode: mode.id as DetectionMode })}
                    className={`flex items-center justify-center gap-2 py-3 px-3 rounded-xl border transition-all ${
                    state.mode === mode.id
                        ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    {mode.icon}
                    <span className="text-sm font-semibold">{mode.label}</span>
                </button>
                ))}
            </div>
            </div>

            {/* Prompt Input */}
            <div className="space-y-3">
            <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-gray-400 tracking-wider uppercase">
                    Instruction
                </label>
                {!hasInput && (
                    <span className="text-[10px] text-red-500 font-medium">Required (Text or Click)</span>
                )}
            </div>
            <textarea
                value={state.prompt}
                onChange={(e) => updateState({ prompt: e.target.value })}
                placeholder={
                    state.mode === 'track' ? "Object to track (e.g. 'Red Car')..." : "Describe object (e.g. 'Face') or click on image..."
                }
                className={`w-full h-24 p-4 bg-gray-50 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none placeholder:text-gray-400 ${
                    !hasInput ? 'border-red-200 focus:border-red-400' : 'border-gray-200'
                }`}
            />
            </div>

            {/* Interaction Hint */}
            {!state.result && !state.isStreaming && (
                <div className="space-y-2">
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                        <p className="text-xs text-blue-800 font-medium mb-1">Visual Prompting:</p>
                        <ul className="text-[10px] text-blue-600 space-y-1 list-disc pl-3">
                            <li><span className="font-bold">Click</span> to add an INCLUDE point (Green).</li>
                            <li><span className="font-bold">Right-Click</span> to add an EXCLUDE point (Red).</li>
                            <li><span className="font-bold">Drag</span> to draw a selection BOX.</li>
                        </ul>
                    </div>
                    {(state.points.length > 0 || state.box) && (
                        <div className="flex gap-2">
                            <button 
                                onClick={onUndoPoint}
                                className="flex-1 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                Undo Point
                            </button>
                            <button 
                                onClick={onClearPoints}
                                className="flex-1 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                            >
                                Clear Selection
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Advanced Settings */}
            <div className="space-y-6 pt-2 border-t border-gray-100">
                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 tracking-wider uppercase">Confidence</label>
                    <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600">{(state.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.05" 
                    value={state.confidence}
                    onChange={(e) => updateState({ confidence: parseFloat(e.target.value) })}
                    className="w-full accent-blue-600"
                    />
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 tracking-wider uppercase">Mask Quality</label>
                        <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600">{(state.maskQuality * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.05" 
                    value={state.maskQuality}
                    onChange={(e) => updateState({ maskQuality: parseFloat(e.target.value) })}
                    className="w-full accent-blue-600"
                    />
                </div>
            </div>
        </div>
      
      </div>

      {/* Main Action Button */}
      <div className="p-6 border-t border-gray-100 mt-auto bg-white">
        <button
          onClick={onAnalyze}
          disabled={state.isAnalyzing || !canAnalyze}
          className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 font-semibold shadow-lg transition-all active:scale-[0.98] ${
            state.isStreaming
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/30'
                : state.isAnalyzing || !canAnalyze
                    ? 'bg-gray-300 cursor-not-allowed shadow-none text-gray-500' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/30'
          }`}
        >
           {state.isAnalyzing ? (
             <>
               <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
               Processing...
             </>
           ) : state.isStreaming ? (
                <>Stop Streaming</>
           ) : (
             <>
               <IconPlay className="w-5 h-5 fill-current" />
               Run Analysis
             </>
           )}
        </button>
        {state.result?.text && !state.result.processedMediaUrl && !state.isStreaming && (
             <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-100 text-sm text-blue-900 leading-relaxed">
                 <div className="flex flex-col gap-1">
                     <span>{state.result.text}</span>
                     {state.result.latency && (
                         <span className="text-[10px] text-gray-400 font-mono mt-1 pt-1 border-t border-blue-100">
                             Latency: {(state.result.latency / 1000).toFixed(2)}s
                         </span>
                     )}
                 </div>
             </div>
        )}
      </div>
    </div>
  );
};
