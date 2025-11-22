import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Upload, 
  Trash2, 
  Check, 
  HelpCircle, 
  X, 
  Maximize2, 
  RefreshCw, 
  ArrowLeft, 
  PieChart,
  AlertTriangle,
  Play,
  ImageIcon,
  Filter,
  Layers,
  Zap,
  Star,
  Trophy
} from './components/Icons';
import { 
  PieChart as RePieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as ReTooltip 
} from 'recharts';
import { analyzeImage, detectDuplicates } from './services/geminiService';
import { MediaItem, AppMode, ClassificationCategory, DuplicateGroup } from './types';

// --- Utils ---

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const COLORS = {
  [ClassificationCategory.KEEP]: '#10B981', // Emerald 500
  [ClassificationCategory.DISCARD]: '#EF4444', // Red 500
  [ClassificationCategory.UNSURE]: '#F59E0B', // Amber 500
  [ClassificationCategory.PENDING]: '#6B7280', // Gray 500
};

// --- Main App Component ---

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.LANDING);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<ClassificationCategory | 'ALL'>('ALL');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [trashBin, setTrashBin] = useState<MediaItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  
  // Duplicates State
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);

  // --- Logic ---

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const filesArray = Array.from(event.target.files) as File[];
      const newFiles: MediaItem[] = filesArray
        .filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
        .map(f => ({
          id: Math.random().toString(36).substring(7),
          file: f,
          previewUrl: URL.createObjectURL(f),
          type: f.type.startsWith('video/') ? 'video' : 'image',
          size: f.size,
          name: f.name,
          timestamp: f.lastModified,
          status: 'queued'
        }));

      setItems(newFiles);
      setMode(AppMode.SCANNING);
      startProcessing(newFiles);
    }
  };

  const startProcessing = useCallback(async (filesToProcess: MediaItem[]) => {
    setIsProcessing(true);
    setProgress({ processed: 0, total: filesToProcess.length });

    const BATCH_SIZE = 5; 
    
    for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
      const batch = filesToProcess.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (item) => {
        try {
          setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'analyzing' } : it));
          
          if (item.type === 'video') {
             await new Promise(r => setTimeout(r, 100));
             const isScreenRec = item.name.toLowerCase().includes('screen');
             setItems(prev => prev.map(it => it.id === item.id ? {
                ...it,
                status: 'done',
                analysis: {
                  category: isScreenRec ? ClassificationCategory.DISCARD : ClassificationCategory.KEEP,
                  confidence: 85,
                  reason: isScreenRec ? "Screen Recording Detected" : "Video content",
                  tags: ['Video']
                }
             } : it));
          } else {
             const analysis = await analyzeImage(item.file);
             setItems(prev => prev.map(it => it.id === item.id ? {
               ...it,
               status: 'done',
               analysis
             } : it));
          }
        } catch (e) {
           setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'error' } : it));
        } finally {
           setProgress(prev => ({ ...prev, processed: prev.processed + 1 }));
        }
      }));
    }

    setIsProcessing(false);
    setMode(AppMode.REVIEW);
    setActiveFilter(ClassificationCategory.DISCARD);
  }, []);

  const startDuplicateScan = async () => {
    setIsScanningDuplicates(true);
    // Only scan items that are currently KEEP or UNSURE (ignore discarded)
    const candidates = items.filter(i => i.analysis?.category !== ClassificationCategory.DISCARD);
    const groups = await detectDuplicates(candidates);
    setDuplicateGroups(groups);
    setIsScanningDuplicates(false);
  };

  // Effect to trigger scan when entering DUPLICATES mode
  useEffect(() => {
    if (mode === AppMode.DUPLICATES && duplicateGroups.length === 0 && !isScanningDuplicates) {
      startDuplicateScan();
    }
  }, [mode]);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const selectAllInView = () => {
    const visibleIds = filteredItems.map(i => i.id);
    const allSelected = visibleIds.every(id => selectedIds.has(id));
    
    const newSet = new Set(selectedIds);
    if (allSelected) {
      visibleIds.forEach(id => newSet.delete(id));
    } else {
      visibleIds.forEach(id => newSet.add(id));
    }
    setSelectedIds(newSet);
  };

  const moveToTrash = () => {
    const itemsToTrash = items.filter(i => selectedIds.has(i.id));
    const remainingItems = items.filter(i => !selectedIds.has(i.id));
    
    setTrashBin([...trashBin, ...itemsToTrash]);
    setItems(remainingItems);
    setSelectedIds(new Set());
    
    // Also cleanup duplicate groups if we deleted items
    if (duplicateGroups.length > 0) {
        const trashedIds = new Set(itemsToTrash.map(i => i.id));
        const newGroups = duplicateGroups.map(g => ({
            ...g,
            items: g.items.filter(i => !trashedIds.has(i.id))
        })).filter(g => g.items.length > 1);
        setDuplicateGroups(newGroups);
    }
  };
  
  const resolveDuplicateGroup = (group: DuplicateGroup) => {
    // Keep best, trash rest
    const toTrash = group.items.filter(i => i.id !== group.bestItemId);
    const toTrashIds = new Set(toTrash.map(i => i.id));
    
    setTrashBin([...trashBin, ...toTrash]);
    setItems(prev => prev.filter(i => !toTrashIds.has(i.id)));
    
    // Remove this group from view
    setDuplicateGroups(prev => prev.filter(g => g.id !== group.id));
  };

  const changeCategory = (id: string, newCategory: ClassificationCategory) => {
    setItems(prev => prev.map(item => {
      if (item.id === id && item.analysis) {
        return { ...item, analysis: { ...item.analysis, category: newCategory } };
      }
      return item;
    }));
  };

  // --- Derived State ---

  const filteredItems = useMemo(() => {
    if (activeFilter === 'ALL') return items;
    return items.filter(item => item.analysis?.category === activeFilter);
  }, [items, activeFilter]);

  const stats = useMemo(() => {
    const s = {
      [ClassificationCategory.KEEP]: 0,
      [ClassificationCategory.DISCARD]: 0,
      [ClassificationCategory.UNSURE]: 0,
      totalSize: 0,
      keepSize: 0,
      discardSize: 0,
    };
    items.forEach(item => {
      if (item.analysis) {
        s[item.analysis.category]++;
        if (item.analysis.category === ClassificationCategory.KEEP) s.keepSize += item.size;
        if (item.analysis.category === ClassificationCategory.DISCARD) s.discardSize += item.size;
      }
      s.totalSize += item.size;
    });
    return s;
  }, [items]);

  const pieData = [
    { name: 'Keep', value: stats.KEEP, color: COLORS.KEEP },
    { name: 'Discard', value: stats.DISCARD, color: COLORS.DISCARD },
    { name: 'Unsure', value: stats.UNSURE, color: COLORS.UNSURE },
  ].filter(d => d.value > 0);

  // --- Render Helpers ---

  if (mode === AppMode.LANDING) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white p-6 text-center">
        <div className="max-w-lg w-full space-y-8">
          <div className="space-y-2">
            <div className="mx-auto w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-6 animate-bounce">
              <RefreshCw className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">DeclutterAI</h1>
            <p className="text-gray-400 text-lg">
              Private, on-device photo organizer. Instantly separate memories from clutter.
            </p>
          </div>

          <div className="bg-gray-900 border border-gray-800 p-8 rounded-3xl shadow-2xl">
             <div className="space-y-4">
               <label className="relative block group cursor-pointer">
                  <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-teal-500 rounded-xl blur opacity-25 group-hover:opacity-75 transition duration-200"></div>
                  <div className="relative bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-xl p-8 flex flex-col items-center transition-all">
                    <Upload className="w-10 h-10 mb-3 text-blue-400" />
                    <span className="font-semibold text-lg">Select Folder or Photos</span>
                    <span className="text-sm text-gray-500 mt-1">JPG, PNG, WEBP, MP4</span>
                    <input 
                      type="file" 
                      multiple 
                      accept="image/*,video/*"
                      onChange={handleFileUpload} 
                      className="hidden" 
                    />
                  </div>
               </label>
               <div className="flex items-center justify-center space-x-2 text-xs text-green-400 mt-4 bg-green-900/20 py-2 rounded-lg border border-green-900/50">
                 <Check className="w-3 h-3" />
                 <span>100% Local Processing. No Cloud Upload.</span>
               </div>
             </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === AppMode.SCANNING) {
    const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white p-8">
        <div className="w-full max-w-md space-y-6 text-center">
           <div className="relative w-32 h-32 mx-auto">
             <svg className="w-full h-full transform -rotate-90">
               <circle cx="64" cy="64" r="60" stroke="#1f2937" strokeWidth="8" fill="none" />
               <circle 
                cx="64" cy="64" r="60" stroke="#3b82f6" strokeWidth="8" fill="none" 
                strokeDasharray="377" 
                strokeDashoffset={377 - (377 * percent) / 100}
                className="transition-all duration-300 ease-out"
               />
             </svg>
             <div className="absolute inset-0 flex items-center justify-center flex-col">
               <span className="text-3xl font-bold">{percent}%</span>
               <span className="text-xs text-gray-500">Analyzed</span>
             </div>
           </div>
           <div>
             <h2 className="text-xl font-medium">Scanning Locally</h2>
             <p className="text-gray-400 text-sm mt-2">
               Processing metadata and image features...
               <br/>
               {progress.processed} / {progress.total} items
             </p>
           </div>
        </div>
      </div>
    );
  }

  // --- Main Review Interface ---

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-gray-800 flex items-center justify-between px-4 lg:px-8 bg-gray-950 z-10">
        <div className="flex items-center space-x-4">
          <button onClick={() => setMode(AppMode.LANDING)} className="p-2 hover:bg-gray-800 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <h1 className="text-lg font-semibold">Review Gallery</h1>
        </div>
        <div className="flex items-center space-x-6 text-sm text-gray-400">
          <div className="hidden md:flex items-center space-x-2">
             <div className="w-3 h-3 rounded-full bg-green-500" />
             <span>Keep: {formatBytes(stats.keepSize)}</span>
          </div>
          <div className="hidden md:flex items-center space-x-2">
             <div className="w-3 h-3 rounded-full bg-red-500" />
             <span>Clean: {formatBytes(stats.discardSize)}</span>
          </div>
          <button onClick={() => setMode(AppMode.TRASH)} className="hover:text-white relative">
            <Trash2 className="w-5 h-5" />
            {trashBin.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full">
                {trashBin.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Desktop Sidebar */}
        <div className="w-full md:w-64 bg-gray-900/50 border-r border-gray-800 flex-shrink-0 flex flex-col hidden md:flex">
          <div className="p-6 border-b border-gray-800">
             <div className="h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={pieData}
                    innerRadius={30}
                    outerRadius={50}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </RePieChart>
              </ResponsiveContainer>
             </div>
          </div>
          
          <nav className="flex-1 p-4 space-y-2">
             <FilterButton 
               active={mode === AppMode.REVIEW && activeFilter === ClassificationCategory.DISCARD} 
               onClick={() => { setMode(AppMode.REVIEW); setActiveFilter(ClassificationCategory.DISCARD); }}
               label="To Clean"
               count={stats.DISCARD}
               color="text-red-400"
               icon={<Trash2 className="w-4 h-4" />}
             />
             <FilterButton 
               active={mode === AppMode.REVIEW && activeFilter === ClassificationCategory.UNSURE} 
               onClick={() => { setMode(AppMode.REVIEW); setActiveFilter(ClassificationCategory.UNSURE); }}
               label="Review Needed"
               count={stats.UNSURE}
               color="text-amber-400"
               icon={<HelpCircle className="w-4 h-4" />}
             />
             <div className="pt-4 border-t border-gray-800">
               <FilterButton 
                 active={mode === AppMode.DUPLICATES} 
                 onClick={() => setMode(AppMode.DUPLICATES)}
                 label="Duplicates"
                 count={isScanningDuplicates ? '...' : duplicateGroups.length}
                 color="text-purple-400"
                 icon={<Layers className="w-4 h-4" />}
               />
             </div>
             <div className="pt-4 border-t border-gray-800">
               <FilterButton 
                 active={mode === AppMode.REVIEW && activeFilter === ClassificationCategory.KEEP} 
                 onClick={() => { setMode(AppMode.REVIEW); setActiveFilter(ClassificationCategory.KEEP); }}
                 label="To Keep"
                 count={stats.KEEP}
                 color="text-green-400"
                 icon={<Check className="w-4 h-4" />}
               />
               <FilterButton 
                 active={mode === AppMode.REVIEW && activeFilter === 'ALL'} 
                 onClick={() => { setMode(AppMode.REVIEW); setActiveFilter('ALL'); }}
                 label="All Files"
                 count={items.length}
                 color="text-gray-400"
                 icon={<Filter className="w-4 h-4" />}
               />
             </div>
          </nav>
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-gray-950 p-4 pb-24 md:pb-4">
           
           {/* --- DUPLICATES VIEW --- */}
           {mode === AppMode.DUPLICATES ? (
             <div className="max-w-4xl mx-auto space-y-8">
               <div className="flex items-center justify-between">
                 <h2 className="text-xl font-bold flex items-center gap-2">
                    <Layers className="w-6 h-6 text-purple-500" />
                    <span>Detected Duplicate Sets</span>
                 </h2>
                 {isScanningDuplicates && <span className="text-sm text-gray-400 animate-pulse">Scanning for similar shots...</span>}
               </div>

               {!isScanningDuplicates && duplicateGroups.length === 0 && (
                 <div className="text-center py-20 text-gray-500 border border-dashed border-gray-800 rounded-2xl">
                   <Layers className="w-16 h-16 mx-auto mb-4 opacity-20" />
                   <p>No duplicates found in the 'Keep' list.</p>
                 </div>
               )}

               {duplicateGroups.map(group => (
                 <div key={group.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                   <div className="flex items-center justify-between mb-4">
                     <div className="flex items-center gap-3">
                       <span className="px-2.5 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                         {group.items.length} Similar Shots
                       </span>
                       <span className="text-xs text-gray-500">Burst detected</span>
                     </div>
                     <button 
                       onClick={() => resolveDuplicateGroup(group)}
                       className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-full text-xs font-medium transition-colors"
                     >
                       <Zap className="w-3 h-3" />
                       Keep Best Only
                     </button>
                   </div>

                   <div className="flex gap-4 overflow-x-auto pb-2">
                     {group.items.map(item => {
                       const isBest = item.id === group.bestItemId;
                       return (
                         <div key={item.id} className="relative flex-shrink-0 w-40 group/card">
                           <div className={`relative aspect-[3/4] rounded-xl overflow-hidden border-2 ${isBest ? 'border-yellow-500 shadow-lg shadow-yellow-500/10' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                             <img src={item.previewUrl} className="w-full h-full object-cover" />
                             {isBest && (
                               <div className="absolute top-2 left-2 bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                 <Trophy className="w-3 h-3" /> Best
                               </div>
                             )}
                           </div>
                           
                           {/* Quality Specs */}
                           <div className="mt-2 text-[10px] text-gray-400 space-y-1">
                             <div className="flex justify-between">
                               <span>Sharpness</span>
                               <span className={item.quality && item.quality.sharpness > 0.6 ? 'text-green-400' : 'text-gray-500'}>
                                 {Math.round((item.quality?.sharpness || 0) * 100)}
                               </span>
                             </div>
                             <div className="flex justify-between">
                               <span>Exposure</span>
                               <span className={item.quality && item.quality.exposure > 0.7 ? 'text-green-400' : 'text-gray-500'}>
                                 {Math.round((item.quality?.exposure || 0) * 100)}
                               </span>
                             </div>
                           </div>
                         </div>
                       );
                     })}
                   </div>
                 </div>
               ))}
             </div>
           ) : (
           
           /* --- STANDARD GRID VIEW --- */
           <>
             <div className="flex items-center justify-between mb-6 sticky top-0 bg-gray-950/95 backdrop-blur z-20 py-2">
               <div className="text-sm text-gray-400">
                 Showing {filteredItems.length} items
               </div>
               <div className="flex items-center space-x-3">
                 <button 
                  onClick={selectAllInView}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                 >
                   {selectedIds.size === filteredItems.length && filteredItems.length > 0 ? 'Deselect All' : 'Select All'}
                 </button>
                 {selectedIds.size > 0 && (
                   <button 
                    onClick={moveToTrash}
                    className="text-xs font-medium px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white transition-colors flex items-center space-x-1"
                   >
                     <Trash2 className="w-3 h-3" />
                     <span>Move {selectedIds.size} to Trash</span>
                   </button>
                 )}
               </div>
             </div>

             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
               {filteredItems.map(item => (
                 <MediaCard 
                   key={item.id} 
                   item={item} 
                   selected={selectedIds.has(item.id)}
                   onSelect={() => toggleSelection(item.id)}
                   onPreview={() => setPreviewId(item.id)}
                 />
               ))}
             </div>
           </>
           )}
        </main>
      </div>

      {/* Preview Modal */}
      {previewId && (
        <PreviewModal 
          item={items.find(i => i.id === previewId)!} 
          onClose={() => setPreviewId(null)}
          onCategoryChange={changeCategory}
        />
      )}

      {/* Trash View Overlay */}
      {mode === AppMode.TRASH && (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
          <div className="h-16 border-b border-gray-800 flex items-center justify-between px-6">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Trash2 className="w-5 h-5" />
              <span>Recycle Bin ({trashBin.length})</span>
            </h2>
            <button onClick={() => setMode(AppMode.REVIEW)} className="p-2 hover:bg-gray-800 rounded-full">
              <X className="w-6 h-6 text-gray-400" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {trashBin.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                Trash is empty
              </div>
            ) : (
               <div className="grid grid-cols-3 md:grid-cols-6 gap-4 opacity-60">
                  {trashBin.map(item => (
                    <div key={item.id} className="aspect-square bg-gray-800 rounded-lg overflow-hidden relative">
                       <img src={item.previewUrl} alt="" className="w-full h-full object-cover grayscale" />
                    </div>
                  ))}
               </div>
            )}
          </div>
          <div className="p-6 border-t border-gray-800 bg-gray-900 flex justify-end space-x-4">
             <button 
               onClick={() => {
                 setItems([...items, ...trashBin]);
                 setTrashBin([]);
                 setMode(AppMode.REVIEW);
               }}
               className="px-4 py-2 text-gray-300 hover:text-white hover:underline"
             >
               Restore All
             </button>
             <button 
               onClick={() => {
                 if(confirm('Files permanently deleted.')) {
                   setTrashBin([]);
                 }
               }}
               className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-medium shadow-lg"
               disabled={trashBin.length === 0}
             >
               Empty Trash
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Sub Components ---

const FilterButton = ({ active, onClick, label, count, color, icon }: any) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
      active ? 'bg-gray-800 text-white shadow-md' : 'hover:bg-gray-800/50 text-gray-400'
    }`}
  >
    <div className="flex items-center space-x-3">
      <span className={active ? color : 'text-gray-500'}>{icon}</span>
      <span className="font-medium text-sm">{label}</span>
    </div>
    <span className="text-xs bg-gray-950/50 px-2 py-1 rounded-md">{count}</span>
  </button>
);

const MediaCard: React.FC<{ 
  item: MediaItem, 
  selected: boolean, 
  onSelect: () => void,
  onPreview: () => void
}> = ({ item, selected, onSelect, onPreview }) => {
  const categoryColor = item.analysis?.category === 'KEEP' ? 'bg-green-500' : 
                        item.analysis?.category === 'DISCARD' ? 'bg-red-500' : 'bg-amber-500';
  
  return (
    <div className={`relative group aspect-square rounded-xl overflow-hidden border-2 transition-all duration-200 ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-transparent hover:border-gray-600'}`}>
      <div onClick={onPreview} className="w-full h-full cursor-zoom-in bg-gray-800">
        {item.type === 'video' ? (
           <div className="w-full h-full flex flex-col items-center justify-center relative text-gray-400">
             <Play className="w-10 h-10 opacity-70" />
             <span className="text-xs mt-2 font-mono">{formatBytes(item.size)}</span>
           </div>
        ) : (
           <img 
            src={item.previewUrl} 
            alt="preview" 
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
           />
        )}
      </div>
      <div className="absolute top-2 left-2 z-10">
        <button 
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className={`w-6 h-6 rounded-full border border-gray-400/50 flex items-center justify-center transition-colors shadow-lg ${selected ? 'bg-blue-500 border-blue-500' : 'bg-black/40 hover:bg-black/60'}`}
        >
          {selected && <Check className="w-3 h-3 text-white" />}
        </button>
      </div>
      <div className="absolute top-2 right-2 z-10">
         <div className={`w-3 h-3 rounded-full shadow-sm border border-black/20 ${categoryColor}`} />
      </div>
    </div>
  );
};

const PreviewModal = ({ item, onClose, onCategoryChange }: { item: MediaItem, onClose: () => void, onCategoryChange: (id: string, cat: ClassificationCategory) => void }) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-6xl h-[90vh] bg-gray-900 rounded-2xl flex flex-col md:flex-row overflow-hidden shadow-2xl border border-gray-800">
        <button onClick={onClose} className="absolute top-4 right-4 z-50 p-2 bg-black/50 rounded-full hover:bg-gray-700 text-white">
          <X className="w-6 h-6" />
        </button>
        <div className="flex-1 bg-black flex items-center justify-center relative group">
           {item.type === 'video' ? (
             <video src={item.previewUrl} controls className="max-w-full max-h-full" />
           ) : (
             <img src={item.previewUrl} alt="Full" className="max-w-full max-h-full object-contain" />
           )}
        </div>
        <div className="w-full md:w-96 bg-gray-900 p-6 border-l border-gray-800 flex flex-col overflow-y-auto">
          <h2 className="text-xl font-bold mb-1 text-white truncate">{item.name}</h2>
          <p className="text-sm text-gray-500 mb-6 font-mono">{new Date(item.timestamp).toLocaleDateString()} • {formatBytes(item.size)}</p>
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700 mb-6">
             <div className="flex items-center justify-between mb-4">
               <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Local Analysis</span>
               <span className={`text-xs px-2 py-1 rounded font-bold ${
                  item.analysis?.confidence && item.analysis.confidence > 80 ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'
               }`}>
                 {item.analysis?.confidence}% Match
               </span>
             </div>
             <p className="text-white mb-4 leading-relaxed">
               {item.analysis?.reason || "Processing..."}
             </p>
             <div className="flex flex-wrap gap-2">
               {item.analysis?.tags.map(tag => (
                 <span key={tag} className="px-2 py-1 rounded-md bg-gray-700 text-xs text-gray-300 border border-gray-600">
                   #{tag}
                 </span>
               ))}
             </div>
          </div>
          <div className="mt-auto space-y-3">
            <div className="grid grid-cols-3 gap-2">
               <button 
                onClick={() => onCategoryChange(item.id, ClassificationCategory.KEEP)}
                className={`py-3 rounded-lg border font-medium text-sm transition-colors ${
                  item.analysis?.category === ClassificationCategory.KEEP 
                  ? 'bg-green-600 text-white border-green-500' 
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
               >
                 Keep
               </button>
               <button 
                onClick={() => onCategoryChange(item.id, ClassificationCategory.UNSURE)}
                className={`py-3 rounded-lg border font-medium text-sm transition-colors ${
                  item.analysis?.category === ClassificationCategory.UNSURE 
                  ? 'bg-amber-600 text-white border-amber-500' 
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
               >
                 Unsure
               </button>
               <button 
                onClick={() => onCategoryChange(item.id, ClassificationCategory.DISCARD)}
                className={`py-3 rounded-lg border font-medium text-sm transition-colors ${
                  item.analysis?.category === ClassificationCategory.DISCARD 
                  ? 'bg-red-600 text-white border-red-500' 
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
               >
                 Discard
               </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;