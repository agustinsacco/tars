'use client';
import { useState, useEffect, useCallback, memo } from 'react';
import { useSocket } from '@/context/SocketContext';
import { Folder, File, ChevronLeft, RefreshCw, X, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';

interface FileItem {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    mtime: string;
}

const FileRow = memo(({ file, onClick }: { file: FileItem; onClick: () => void }) => (
    <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-3 p-2 hover:bg-white/5 cursor-pointer group rounded-xl border border-transparent transition-all"
        onClick={onClick}
    >
        <div className="w-5 flex justify-center shrink-0">
            {file.isDirectory ? (
                <Folder size={16} className="text-accent-warning fill-accent-warning/10" />
            ) : (
                <File
                    size={14}
                    className="text-white opacity-20 group-hover:text-accent-primary group-hover:opacity-100 transition-all"
                />
            )}
        </div>
        <span className="truncate flex-1 text-white/90 font-bold group-hover:text-white transition-colors text-[12px]">
            {file.name}
        </span>
        <span className="text-[9px] opacity-20 font-bold font-mono hidden sm:block text-white">
            {file.isDirectory ? '--' : (file.size / 1024).toFixed(1) + ' KB'}
        </span>
    </motion.div>
));

const EventStream = memo(() => {
    const { socket, subscribe, unsubscribe } = useSocket();
    const [events, setEvents] = useState<any[]>([]);

    useEffect(() => {
        if (!socket) return;
        subscribe('fs');

        const handleFileEvent = (event: any) => {
            setEvents((prev) => [event, ...prev].slice(0, 3));
        };

        socket.on('fs_event', handleFileEvent);
        return () => {
            unsubscribe('fs');
            socket.off('fs_event', handleFileEvent);
        };
    }, [socket, subscribe, unsubscribe]);

    return (
        <div className="p-2.5 border-t border-white/5 bg-black/40 overflow-hidden h-20 flex flex-col gap-1.5">
            <div className="text-[8px] font-black uppercase tracking-widest flex items-center gap-2 text-white/30">
                <Terminal size={10} className="text-accent-primary opacity-50" /> FS_MONITOR
            </div>
            <div className="flex-1 overflow-hidden space-y-0.5">
                {events.map((e, i) => (
                    <div
                        key={i}
                        className="text-[9px] truncate opacity-80 font-bold font-mono text-white"
                    >
                        <span className="text-accent-warning">[{e.event}]</span> {e.path}
                    </div>
                ))}
                {events.length === 0 && (
                    <div className="text-[9px] opacity-10 italic font-bold text-white uppercase tracking-widest">
                        Awaiting Events...
                    </div>
                )}
            </div>
        </div>
    );
});

export function FileExplorer() {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [currentPath, setCurrentPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchFiles = useCallback(async (path: string = '') => {
        setLoading(true);
        try {
            const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            if (data.type === 'directory') {
                setFiles(data.files);
                setCurrentPath(path);
            }
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFiles('');
    }, [fetchFiles]);

    const handleFileClick = async (item: FileItem) => {
        if (item.isDirectory) {
            fetchFiles(item.path);
        } else {
            setSelectedFile(item.name);
            try {
                const res = await fetch(`/api/files?path=${encodeURIComponent(item.path)}`);
                const data = await res.json();
                setFileContent(data.content);
                setIsModalOpen(true);
            } catch (err) {
                setFileContent('Error loading file content');
            }
        }
    };

    const navigateUp = () => {
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        fetchFiles(parts.join('/'));
    };

    const isMarkdown = selectedFile?.toLowerCase().endsWith('.md');

    return (
        <div className="card card-with-header flex flex-col h-full overflow-visible relative p-0">
            <div className="card-header-btop text-accent-warning border-accent-warning/30">
                File Navigator
            </div>

            {/* Path Bar */}
            <div className="flex items-center gap-3 p-2.5 bg-[#0a0a0a]/80 border-b border-white/5 mt-4">
                <button
                    onClick={navigateUp}
                    disabled={!currentPath}
                    className="p-1 hover:bg-white/10 disabled:opacity-10 rounded-lg transition-colors text-white"
                >
                    <ChevronLeft size={14} />
                </button>
                <div className="flex-1 truncate opacity-60 text-white font-bold text-[10px] tracking-tight">
                    ~/.tars{currentPath && ` / ${currentPath}`}
                </div>
                {loading && <RefreshCw size={10} className="animate-spin text-accent-primary" />}
            </div>

            <div className="flex-1 overflow-y-auto font-mono p-2 custom-scrollbar bg-black/20 min-h-[400px]">
                {files.length === 0 && !loading && (
                    <div className="p-12 text-center opacity-20 italic text-white uppercase text-[9px] font-black">
                        Empty_Directory
                    </div>
                )}

                <div className="grid grid-cols-1 gap-0.5">
                    {files
                        .sort((a, b) => (b.isDirectory ? 1 : -1))
                        .map((file) => (
                            <FileRow
                                key={file.path}
                                file={file}
                                onClick={() => handleFileClick(file)}
                            />
                        ))}
                </div>
            </div>

            <EventStream />

            <AnimatePresence>
                {isModalOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-12 bg-black/90 backdrop-blur-2xl"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full h-full bg-[#080808] border border-white/10 md:rounded-3xl flex flex-col overflow-hidden shadow-2xl"
                        >
                            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#0a0a0a]">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-accent-primary/10 rounded-xl">
                                        <File size={16} className="text-accent-primary" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-black text-white leading-none uppercase tracking-widest">
                                            {selectedFile}
                                        </span>
                                        <span className="text-[9px] font-bold uppercase mt-1.5 text-white/30 tracking-widest">
                                            {isMarkdown ? 'Markdown_View' : 'Raw_Output'}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    className="p-2 hover:bg-white/10 rounded-full transition-all text-white"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 md:p-12 custom-scrollbar bg-black/40">
                                <div className="max-w-4xl mx-auto">
                                    {isMarkdown ? (
                                        <div className="prose prose-invert prose-blue max-w-none text-white selection:bg-accent-primary selection:text-white">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {fileContent || ''}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <pre className="font-mono text-[12px] leading-relaxed text-white selection:bg-accent-primary selection:text-white whitespace-pre-wrap font-black uppercase">
                                            {fileContent}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
