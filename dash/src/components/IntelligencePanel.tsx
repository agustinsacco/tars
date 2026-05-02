'use client';
import { useEffect, useState, memo } from 'react';
import { useSocket } from '@/context/SocketContext';
import {
    Brain,
    Calendar,
    History,
    Fingerprint,
    Database,
    Sparkles,
    Hash,
    Clock,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SectionHeader = ({ icon: Icon, title, color }: any) => (
    <div className="flex items-center gap-3 mb-3">
        <div
            className={`p-1.5 rounded-lg bg-opacity-10 ${color.replace('text-', 'bg-')} border border-white/5`}
        >
            <Icon size={12} className={color} />
        </div>
        <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">{title}</h3>
        <div className="h-[1px] bg-white/5 flex-1 ml-4"></div>
    </div>
);

const MemoryItem = memo(({ fact, value }: { fact: string; value: any }) => {
    const displayValue =
        typeof value === 'object' && value !== null
            ? value.value || JSON.stringify(value)
            : String(value);

    return (
        <div className="flex flex-col gap-1 p-1.5 rounded-lg hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5 group">
            <div className="flex items-center gap-2">
                <Fingerprint
                    size={10}
                    className="text-accent-primary opacity-60 group-hover:opacity-100 transition-opacity"
                />
                <span className="text-[9px] font-black text-accent-primary uppercase tracking-tighter">
                    {fact.replace(/_/g, ' ')}
                </span>
            </div>
            <span className="text-[11px] text-white font-medium leading-relaxed pl-4 break-words">
                {displayValue}
            </span>
        </div>
    );
});

const TaskItem = memo(({ task }: { task: any }) => {
    const isEnabled = task.enabled;
    return (
        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-accent-warning/30 transition-all group">
            <div
                className={`p-1.5 rounded-lg ${isEnabled ? 'bg-accent-warning/10' : 'bg-white/5 opacity-40'}`}
            >
                <Calendar size={14} className={isEnabled ? 'text-accent-warning' : 'text-white'} />
            </div>
            <div className="flex-1 flex flex-col min-w-0">
                <span
                    className={`text-[10px] font-black truncate uppercase tracking-tight ${isEnabled ? 'text-white' : 'text-white/30'}`}
                >
                    {task.title}
                </span>
                <span className="text-[8px] text-white/40 font-mono mt-0.5 truncate italic">
                    {task.schedule}
                </span>
            </div>
            <div className="flex flex-col items-end gap-1">
                {task.lastRun && (
                    <div className="flex items-center gap-1.5 text-[8px] font-bold text-accent-secondary uppercase">
                        <CheckCircle2 size={10} />
                        <span className="text-white">Success</span>
                    </div>
                )}
                {!isEnabled && (
                    <span className="text-[8px] font-black text-white/20 uppercase tracking-widest border border-white/10 px-1.5 py-0.5 rounded">
                        Paused
                    </span>
                )}
            </div>
        </div>
    );
});

export const CognitiveBuffer = memo(({ data }: { data: any }) => {
    const factsList = data.facts?.facts || data.facts || {};
    return (
        <div className="card bg-[#0c0c0c] border-white/10 flex flex-col h-[400px] p-4">
            <div className="card-header-btop">Cognitive Buffer (Memory)</div>
            <div className="mt-2 flex-1 overflow-y-auto custom-scrollbar pr-2">
                <SectionHeader icon={Brain} title="Long-Term Facts" color="text-accent-primary" />
                <div className="flex flex-col gap-1.5">
                    {Object.entries(factsList).map(([key, value]: any) => (
                        <MemoryItem key={key} fact={key} value={value} />
                    ))}
                </div>
            </div>
        </div>
    );
});

export const JobQueue = memo(({ data }: { data: any }) => {
    return (
        <div className="card bg-[#0c0c0c] border-white/10 flex flex-col h-[400px] p-4">
            <div className="card-header-btop">Autonomous Job Queue</div>
            <div className="mt-2 flex-1 overflow-y-auto custom-scrollbar pr-2">
                <SectionHeader
                    icon={Calendar}
                    title="Scheduled Actions"
                    color="text-accent-warning"
                />
                <div className="flex flex-col gap-2">
                    {data.tasks && data.tasks.length > 0 ? (
                        data.tasks.map((task: any) => <TaskItem key={task.id} task={task} />)
                    ) : (
                        <div className="p-12 text-center opacity-20 italic text-[10px] uppercase font-black tracking-widest text-white">
                            No Active Tasks
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export const SessionIntelligence = memo(({ data }: { data: any }) => {
    const formatUptime = (ms: number) => {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    return (
        <div className="card bg-[#0c0c0c] border-white/10 flex flex-col h-[400px] p-4 shadow-2xl">
            <div className="card-header-btop text-accent-primary border-accent-primary/30">
                Session Intelligence
            </div>
            <div className="mt-2 flex-1 overflow-y-auto custom-scrollbar pr-2">
                <SectionHeader
                    icon={Sparkles}
                    title="Current Context"
                    color="text-accent-primary"
                />

                <div className="grid grid-cols-2 gap-2.5 mb-4">
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <span className="text-[8px] font-black text-white/40 uppercase block mb-1">
                            Interactions
                        </span>
                        <span className="text-base font-black text-white font-mono leading-none">
                            {data.session?.interactionCount || 0}
                        </span>
                    </div>
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <span className="text-[8px] font-black text-white/40 uppercase block mb-1">
                            Context Depth
                        </span>
                        <span className="text-base font-black text-white font-mono leading-none">
                            {Math.round((data.session?.lastInputTokens || 0) / 1000)}K
                        </span>
                    </div>
                </div>

                <SectionHeader
                    icon={Database}
                    title="Token Telemetry"
                    color="text-accent-secondary"
                />
                <div className="space-y-3 px-1">
                    {[
                        {
                            label: 'Input Tokens (Cumulative)',
                            value: data.session?.totalInputTokens,
                            color: 'bg-accent-primary',
                            max: Math.max(data.session?.totalNetTokens || 1000000, 10000)
                        },
                        {
                            label: 'Output Tokens',
                            value: data.session?.totalOutputTokens,
                            color: 'bg-accent-secondary',
                            max: Math.max((data.session?.totalNetTokens || 1000000) / 10, 1000)
                        },
                        {
                            label: 'Context Size (Current)',
                            value: data.session?.lastInputTokens,
                            color: 'bg-accent-warning',
                            max: data.session?.totalNetTokens || 1000000
                        }
                    ].map((stat) => (
                        <div key={stat.label} className="space-y-1">
                            <div className="flex justify-between items-baseline">
                                <span className="text-[8px] font-black text-white/40 uppercase tracking-tighter">
                                    {stat.label}
                                </span>
                                <span className="text-[9px] font-bold text-white font-mono">
                                    {(stat.value || 0).toLocaleString()}
                                </span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{
                                        width: `${Math.min(100, ((stat.value || 0) / stat.max) * 100)}%`
                                    }}
                                    className={`h-full ${stat.color} opacity-60`}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-8">
                    <SectionHeader
                        icon={History}
                        title="Session Lifecycle"
                        color="text-accent-warning"
                    />
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Database size={8} className="text-white/40" />
                            <span className="text-[8px] font-black text-white/40 uppercase block">
                                Total Sessions
                            </span>
                        </div>
                        <span className="text-sm font-black text-white font-mono">
                            {data.sessionStats?.total || 0}
                        </span>
                    </div>
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Clock size={8} className="text-white/40" />
                            <span className="text-[8px] font-black text-white/40 uppercase block">
                                Last Switch
                            </span>
                        </div>
                        <span className="text-[10px] font-bold text-white font-mono leading-tight">
                            {data.sessionStats?.lastSwitch
                                ? new Date(data.sessionStats.lastSwitch).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit'
                                  })
                                : 'N/A'}
                        </span>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Sparkles size={8} className="text-accent-primary/40" />
                            <span className="text-[8px] font-black text-white/40 uppercase block">
                                Compressions
                            </span>
                        </div>
                        <span className="text-sm font-black text-white font-mono">
                            {data.session?.compressionCount || 0}
                        </span>
                    </div>
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Clock size={8} className="text-accent-secondary/40" />
                            <span className="text-[8px] font-black text-white/40 uppercase block">
                                Uptime
                            </span>
                        </div>
                        <span className="text-[10px] font-bold text-white font-mono leading-tight">
                            {data.session?.createdAt
                                ? formatUptime(
                                      Date.now() - new Date(data.session.createdAt).getTime()
                                  )
                                : 'N/A'}
                        </span>
                    </div>
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Sparkles size={8} className="text-accent-warning/40" />
                            <span className="text-[8px] font-black text-white/40 uppercase block">
                                Context Window
                            </span>
                        </div>
                        <span className="text-[10px] font-bold text-white font-mono leading-tight">
                            {data.session?.lastInputTokens
                                ? `${Math.round((data.session.lastInputTokens / 1000000) * 100) / 100}M`
                                : 'N/A'}
                        </span>
                    </div>
                </div>
                {data.session?.compressionCount ? (
                    <div className="mt-2 p-2 bg-accent-warning/5 border border-accent-warning/20 rounded-lg flex items-center gap-2">
                        <Sparkles size={12} className="text-accent-warning opacity-60" />
                        <span className="text-[8px] font-bold text-white/60">
                            Session compressed {data.session.compressionCount} time
                            {data.session.compressionCount > 1 ? 's' : ''}
                        </span>
                    </div>
                ) : null}

                <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar pr-1">
                    {data.sessionStats?.history?.map((s: any, i: number) => (
                        <div
                            key={i}
                            className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors group"
                        >
                            <div className="flex items-center gap-2">
                                <div className="w-1 h-1 rounded-full bg-accent-primary opacity-40 group-hover:opacity-100 transition-opacity" />
                                <span className="text-[9px] font-mono font-bold text-white/60">
                                    S_{s.id.slice(0, 6)}
                                </span>
                            </div>
                            <span className="text-[8px] font-mono text-white/30">
                                {new Date(s.time).toLocaleDateString()}{' '}
                                {new Date(s.time).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="mt-6 p-3 bg-accent-primary/5 border border-accent-primary/20 rounded-xl flex items-center gap-3">
                    <div className="p-1.5 bg-accent-primary/20 rounded-lg">
                        <Hash size={14} className="text-accent-primary" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[8px] font-black text-white/40 uppercase leading-none">
                            Session_ID
                        </span>
                        <span className="text-[9px] font-mono text-white mt-1 break-all">
                            {data.session?.sessionId?.split('-')[0]}...
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
});

export function IntelligencePanel() {
    const { socket, subscribe, unsubscribe } = useSocket();
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!socket) return;
        subscribe('intelligence');

        const handleInit = (initData: any) => setData(initData);
        const handleUpdate = ({ type, data: updateData }: any) => {
            setData((prev: any) => ({ ...prev, [type]: updateData }));
        };

        socket.on('intelligence_init', handleInit);
        socket.on('intelligence_update', handleUpdate);

        return () => {
            unsubscribe('intelligence');
            socket.off('intelligence_init', handleInit);
            socket.off('intelligence_update', handleUpdate);
        };
    }, [socket, subscribe, unsubscribe]);

    if (!data) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <CognitiveBuffer data={data} />
            <JobQueue data={data} />
            <SessionIntelligence data={data} />
        </div>
    );
}
