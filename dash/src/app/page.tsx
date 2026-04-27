'use client';
import { MetricsPanel, LogViewer } from '@/components/MetricsPanel';
import { FileExplorer } from '@/components/FileExplorer';
import {
    IntelligencePanel,
    SessionIntelligence,
    CognitiveBuffer,
    JobQueue
} from '@/components/IntelligencePanel';
import { SystemActions } from '@/components/SystemActions';
import { SocketProvider, useSocket } from '@/context/SocketContext';
import { Shield, Box, RefreshCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import Image from 'next/image';

function DashboardContent() {
    const { socket, subscribe, unsubscribe } = useSocket();
    const [intelData, setIntelligenceData] = useState<any>(null);

    useEffect(() => {
        if (!socket) return;
        subscribe('intelligence');

        const handleInit = (initData: any) => setIntelligenceData(initData);
        const handleUpdate = ({ type, data }: any) => {
            setIntelligenceData((prev: any) => ({ ...prev, [type]: data }));
        };

        socket.on('intelligence_init', handleInit);
        socket.on('intelligence_update', handleUpdate);

        return () => {
            unsubscribe('intelligence');
            socket.off('intelligence_init', handleInit);
            socket.off('intelligence_update', handleUpdate);
        };
    }, [socket, subscribe, unsubscribe]);

    const handleFullRefresh = () => {
        window.location.reload();
    };

    return (
        <main className="min-h-screen bg-background text-white p-4 md:p-8 selection:bg-accent-primary selection:text-white overflow-x-hidden font-mono">
            {/* Responsive Header */}
            <motion.header
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="flex flex-row justify-between items-center mb-12 border border-card-border bg-card-bg/50 backdrop-blur-md p-3 px-4 md:px-6 rounded-2xl shadow-xl border-white/5"
            >
                <div className="flex items-center gap-3 md:gap-5">
                    <div className="relative w-10 h-10 md:w-12 md:h-12 flex-shrink-0">
                        <Image
                            src="/tars-logo.png"
                            alt="Tars Logo"
                            fill
                            className="object-contain"
                            priority
                        />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-sm md:text-lg font-black tracking-widest text-white uppercase flex items-center gap-2">
                            Tars <span className="text-accent-primary">Dash</span>
                        </h1>
                        <div className="flex items-center gap-2 text-[9px] md:text-[10px] font-bold text-accent-secondary">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent-secondary animate-pulse shadow-[0_0_8px_#10B981]"></span>
                            OPERATIONAL
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 md:gap-6">
                    <button
                        onClick={handleFullRefresh}
                        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 p-2 px-3 rounded-xl transition-all group"
                    >
                        <RefreshCcw
                            size={14}
                            className="text-accent-primary group-active:rotate-180 transition-transform duration-500"
                        />
                        <span className="hidden xs:block text-[10px] font-black uppercase tracking-widest">
                            Full Refresh
                        </span>
                    </button>

                    <div className="hidden sm:flex flex-col items-end">
                        <span className="opacity-40 uppercase text-[8px] font-bold tracking-tighter">
                            Current Session
                        </span>
                        <span className="text-[10px] md:text-xs font-black text-white">
                            ADMIN@SACCO_LABS
                        </span>
                    </div>
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl border border-white/10 flex items-center justify-center bg-white/5 shadow-inner">
                        <Shield size={16} className="text-accent-primary" />
                    </div>
                </div>
            </motion.header>

            {/* TOP SECTION: Host Resources (Metrics) */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 mb-12">
                <div className="xl:col-span-12">
                    <MetricsPanel />
                </div>
            </div>

            {/* SECOND SECTION: Session, System Control & Supervisor Logs */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 mb-12">
                <div className="xl:col-span-3 flex flex-col gap-6">
                    {intelData ? (
                        <SessionIntelligence data={intelData} />
                    ) : (
                        <div className="card h-[400px] flex items-center justify-center border-white/5 bg-black/20 text-accent-primary">
                            <RefreshCcw className="animate-spin" />
                        </div>
                    )}
                </div>
                <div className="xl:col-span-3">
                    <SystemActions />
                </div>
                <div className="xl:col-span-6">
                    <LogViewer />
                </div>
            </div>

            {/* THIRD SECTION: File Explorer + Cognitive Layers */}
            <div className="pt-8 border-t border-white/5 mb-12">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 mb-10">
                    <div className="xl:col-span-5">
                        <FileExplorer />
                    </div>
                    <div className="xl:col-span-7">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            {intelData && <CognitiveBuffer data={intelData} />}
                            {intelData && <JobQueue data={intelData} />}
                        </div>
                    </div>
                </div>
            </div>

            {/* Responsive Footer */}
            <footer className="mt-20 pt-10 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-8 text-[10px] uppercase font-bold tracking-widest text-white/30">
                <div className="flex items-center gap-4 bg-white/5 p-3 px-6 rounded-full border border-white/5 shadow-lg">
                    <Box size={14} className="text-accent-primary" />
                    <span>&copy; 2026 Tars Intelligence Core</span>
                </div>

                <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4 px-4">
                    <div className="flex items-center gap-2">
                        <span className="opacity-40">Lat:</span>
                        <span className="text-accent-secondary">12ms</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="opacity-40">Feed:</span>
                        <span className="text-white/60">Live_Socket</span>
                    </div>
                    <div className="hidden xs:flex items-center gap-2">
                        <span className="opacity-40">Sec:</span>
                        <span className="text-accent-primary">Local_Node</span>
                    </div>
                </div>
            </footer>
        </main>
    );
}

export default function Home() {
    return (
        <SocketProvider>
            <DashboardContent />
        </SocketProvider>
    );
}
