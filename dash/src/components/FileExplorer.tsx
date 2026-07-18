'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, File, Folder, RefreshCw, Terminal, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useSocket } from '@/context/SocketContext';

interface FileItem {
    readonly name: string;
    readonly path: string;
    readonly isDirectory: boolean;
    readonly size: number;
    readonly mtime: string;
}

interface FileRowProps {
    readonly file: FileItem;
    readonly onClick: () => void;
}

interface FileSystemEvent {
    readonly event: string;
    readonly path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileItem(value: unknown): value is FileItem {
    if (!isRecord(value)) return false;
    return (
        typeof value.name === 'string' &&
        typeof value.path === 'string' &&
        typeof value.isDirectory === 'boolean' &&
        typeof value.size === 'number' &&
        typeof value.mtime === 'string'
    );
}

function isDirectoryResponse(value: unknown): value is { readonly files: FileItem[] } {
    if (!isRecord(value) || value.type !== 'directory' || !Array.isArray(value.files)) return false;
    return value.files.every((file: unknown) => isFileItem(file));
}

function isFileResponse(value: unknown): value is { readonly content: string } {
    return isRecord(value) && value.type === 'file' && typeof value.content === 'string';
}

function isFileSystemEvent(value: unknown): value is FileSystemEvent {
    return isRecord(value) && typeof value.event === 'string' && typeof value.path === 'string';
}

const FileRow = memo(function FileRow({ file, onClick }: FileRowProps): ReactElement {
    return (
        <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent p-2 text-left transition-all hover:bg-white/5 focus-visible:border-accent-primary focus-visible:outline-none"
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
        </motion.button>
    );
});

const EventStream = memo(function EventStream(): ReactElement {
    const { socket, subscribe, unsubscribe } = useSocket();
    const [events, setEvents] = useState<FileSystemEvent[]>([]);

    useEffect(() => {
        if (!socket) return;
        subscribe('fs');

        const handleFileEvent = (event: unknown): void => {
            if (!isFileSystemEvent(event)) return;
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

export function FileExplorer(): ReactElement {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [currentPath, setCurrentPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    const closeModal = useCallback((): void => {
        setIsModalOpen(false);
    }, []);

    const fetchFiles = useCallback(async (path: string = ''): Promise<void> => {
        setLoading(true);
        try {
            const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
            const data: unknown = await res.json();
            if (isDirectoryResponse(data)) {
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

    useEffect(() => {
        if (!isModalOpen) return;

        const previousFocus =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') closeModal();
        };

        document.addEventListener('keydown', handleKeyDown);
        closeButtonRef.current?.focus();

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previousFocus?.focus();
        };
    }, [closeModal, isModalOpen]);

    const handleFileClick = async (item: FileItem): Promise<void> => {
        if (item.isDirectory) {
            fetchFiles(item.path);
        } else {
            setSelectedFile(item.name);
            try {
                const res = await fetch(`/api/files?path=${encodeURIComponent(item.path)}`);
                const data: unknown = await res.json();
                if (isFileResponse(data)) {
                    setFileContent(data.content);
                    setIsModalOpen(true);
                }
            } catch {
                setFileContent('Error loading file content');
            }
        }
    };

    const navigateUp = (): void => {
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
                    type="button"
                    onClick={navigateUp}
                    disabled={!currentPath}
                    aria-label="Navigate to parent directory"
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
                    {[...files]
                        .sort(
                            (first, second) =>
                                Number(second.isDirectory) - Number(first.isDirectory) ||
                                first.name.localeCompare(second.name)
                        )
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
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="file-preview-title"
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
                                        <span
                                            id="file-preview-title"
                                            className="text-sm font-black text-white leading-none uppercase tracking-widest"
                                        >
                                            {selectedFile}
                                        </span>
                                        <span className="text-[9px] font-bold uppercase mt-1.5 text-white/30 tracking-widest">
                                            {isMarkdown ? 'Markdown_View' : 'Raw_Output'}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    ref={closeButtonRef}
                                    type="button"
                                    onClick={closeModal}
                                    aria-label="Close file preview"
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
