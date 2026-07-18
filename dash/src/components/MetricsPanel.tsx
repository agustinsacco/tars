'use client';

import { motion } from 'framer-motion';
import {
    Activity,
    ArrowDownLeft,
    ArrowUpRight,
    Clock,
    Cpu,
    HardDrive,
    MemoryStick as Memory,
    RefreshCw,
    Server,
    Zap,
    type LucideIcon
} from 'lucide-react';
import {
    memo,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactElement,
    type ReactNode
} from 'react';

import { useSocket } from '@/context/SocketContext';

type MetricValue = string | number;

interface MetricCardProps {
    readonly icon: LucideIcon;
    readonly label: string;
    readonly value: MetricValue;
    readonly unit: string;
    readonly color: string;
    readonly extra?: ReactNode;
    readonly children?: ReactNode;
}

interface CpuMetrics {
    readonly load: MetricValue;
    readonly cpus: readonly string[];
    readonly temp: MetricValue;
}

interface MemoryMetrics {
    readonly usage: MetricValue;
    readonly used: MetricValue;
    readonly total: MetricValue;
    readonly cached: MetricValue;
    readonly swapUsed: MetricValue;
}

interface GpuMetrics {
    readonly usage: MetricValue;
    readonly memUsed: MetricValue;
    readonly temp: MetricValue;
    readonly power: MetricValue;
    readonly clock: MetricValue;
}

interface DiskMetrics {
    readonly mount: string;
    readonly use: MetricValue;
}

interface NetworkMetrics {
    readonly iface: string;
    readonly rx: MetricValue;
    readonly tx: MetricValue;
}

interface MetricsData {
    readonly cpu: CpuMetrics;
    readonly mem: MemoryMetrics;
    readonly gpu: GpuMetrics | null;
    readonly disks: readonly DiskMetrics[];
    readonly net: readonly NetworkMetrics[];
    readonly uptime: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMetricValue(value: unknown): value is MetricValue {
    return typeof value === 'string' || typeof value === 'number';
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCpuMetrics(value: unknown): value is CpuMetrics {
    return (
        isRecord(value) &&
        isMetricValue(value.load) &&
        isStringArray(value.cpus) &&
        isMetricValue(value.temp)
    );
}

function isMemoryMetrics(value: unknown): value is MemoryMetrics {
    return (
        isRecord(value) &&
        isMetricValue(value.usage) &&
        isMetricValue(value.used) &&
        isMetricValue(value.total) &&
        isMetricValue(value.cached) &&
        isMetricValue(value.swapUsed)
    );
}

function isGpuMetrics(value: unknown): value is GpuMetrics {
    return (
        isRecord(value) &&
        isMetricValue(value.usage) &&
        isMetricValue(value.memUsed) &&
        isMetricValue(value.temp) &&
        isMetricValue(value.power) &&
        isMetricValue(value.clock)
    );
}

function isDiskMetrics(value: unknown): value is DiskMetrics {
    return isRecord(value) && typeof value.mount === 'string' && isMetricValue(value.use);
}

function isNetworkMetrics(value: unknown): value is NetworkMetrics {
    return (
        isRecord(value) &&
        typeof value.iface === 'string' &&
        isMetricValue(value.rx) &&
        isMetricValue(value.tx)
    );
}

function isMetricsData(value: unknown): value is MetricsData {
    return (
        isRecord(value) &&
        isCpuMetrics(value.cpu) &&
        isMemoryMetrics(value.mem) &&
        (value.gpu === null || isGpuMetrics(value.gpu)) &&
        Array.isArray(value.disks) &&
        value.disks.every(isDiskMetrics) &&
        Array.isArray(value.net) &&
        value.net.every(isNetworkMetrics) &&
        typeof value.uptime === 'number'
    );
}

function formatGeminiLog(log: string): string {
    if (!log.includes('Raw Gemini Event')) return log;

    try {
        const match = log.match(/\[Turn (\d+)\]: (\{.*\})/);
        if (!match) return log;

        const data: unknown = JSON.parse(match[2]);
        if (!isRecord(data) || typeof data.type !== 'string' || !('value' in data)) return log;

        const displayValue =
            typeof data.value === 'string'
                ? data.value.slice(0, 100) + (data.value.length > 100 ? '...' : '')
                : JSON.stringify(data.value);
        return `[Turn ${match[1]}] GEMINI_${data.type.toUpperCase()}: ${displayValue}`;
    } catch {
        return log;
    }
}

const MetricCard = memo(function MetricCard({
    icon: Icon,
    label,
    value,
    unit,
    color,
    extra,
    children
}: MetricCardProps): ReactElement {
    return (
        <div className="card card-with-header relative hover:border-accent-primary/40 transition-all border-white/5 bg-[#0c0c0c] p-4">
            <div className="card-header-btop">{label}</div>
            <div className="flex items-center justify-between mb-4 mt-2">
                <div className="flex items-center gap-3">
                    <div
                        className={`p-1.5 rounded-lg bg-opacity-10 ${color.replace('text-', 'bg-')} border border-white/5`}
                    >
                        <Icon size={18} className={color} />
                    </div>
                    <span className={`text-[14px] font-black font-mono text-white`}>{value}</span>
                    <span className={`text-[9px] font-bold opacity-40 text-white uppercase`}>
                        {unit}
                    </span>
                </div>
            </div>

            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden relative mb-2">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Number.parseFloat(String(value)))}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className={`h-full ${color.replace('text-', 'bg-')} shadow-[0_0:10px_currentColor]`}
                />
            </div>

            {extra && (
                <div className="flex justify-between items-center text-[9px] font-bold text-white uppercase mt-3 tracking-widest opacity-60">
                    {extra}
                </div>
            )}
            {children}
        </div>
    );
});

export const LogViewer = memo(function LogViewer(): ReactElement {
    const { socket, subscribe, unsubscribe } = useSocket();
    const [logs, setLogs] = useState<string[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!socket) return;
        subscribe('logs');

        const handleLogsInit = (data: string[]) => setLogs(data);
        const handleLogsUpdate = (newLines: string[]) =>
            setLogs((prev) => [...prev, ...newLines].slice(-300));

        socket.on('logs_init', handleLogsInit);
        socket.on('logs_update', handleLogsUpdate);

        return () => {
            unsubscribe('logs');
            socket.off('logs_init', handleLogsInit);
            socket.off('logs_update', handleLogsUpdate);
        };
    }, [socket, subscribe, unsubscribe]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="card card-with-header flex flex-col h-[400px] shadow-2xl transition-all border-white/10 bg-black/40 p-0 overflow-visible relative">
            <div className="card-header-btop text-accent-secondary border-accent-secondary/30">
                Supervisor Feed
            </div>
            <div className="flex items-center justify-between p-3 border-b border-white/5 mb-1 bg-[#0a0a0a]/50 mt-4">
                <div className="flex items-center gap-3">
                    <span className="text-[8px] text-white/40 uppercase flex items-center gap-2 font-bold tracking-widest">
                        <Server size={10} className="text-accent-primary opacity-50" />{' '}
                        pm2_supervisor
                        <span className="w-1.5 h-1.5 bg-accent-secondary rounded-full animate-pulse shadow-[0_0_8px_#10B981]"></span>
                    </span>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-[10px] md:text-[11px] leading-relaxed custom-scrollbar selection:bg-accent-primary selection:text-white rounded-b-2xl"
            >
                {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4 opacity-30">
                        <RefreshCw size={24} className="animate-spin text-accent-primary" />
                        <span className="font-black tracking-[0.3em] uppercase text-[9px] text-white">
                            Establishing Stream...
                        </span>
                    </div>
                ) : (
                    logs.map((log, i) => {
                        const isError = log.includes('[ERR]');
                        const isWarn = log.includes('[WARN]');

                        // Clean up Gemini events for readability
                        const displayLog = formatGeminiLog(log);

                        return (
                            <div
                                key={i}
                                className={`flex gap-4 py-1 border-b border-white/[0.03] hover:bg-white/5 transition-all ${isError ? 'text-accent-danger font-bold' : isWarn ? 'text-accent-warning font-bold' : 'text-white/80'}`}
                            >
                                <span className="opacity-20 shrink-0 w-10 select-none font-black text-right">
                                    {(i + 1).toString().padStart(3, '0')}
                                </span>
                                <span className="break-all whitespace-pre-wrap flex-1">
                                    {displayLog}
                                </span>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
});

export function MetricsPanel(): ReactElement {
    const { socket, subscribe, unsubscribe } = useSocket();
    const [metrics, setMetrics] = useState<MetricsData | null>(null);

    useEffect(() => {
        if (!socket) return;
        subscribe('metrics');

        const handleMetrics = (data: unknown): void => {
            if (isMetricsData(data)) setMetrics(data);
        };
        socket.on('metrics_update', handleMetrics);

        return () => {
            unsubscribe('metrics');
            socket.off('metrics_update', handleMetrics);
        };
    }, [socket, subscribe, unsubscribe]);

    const formatUptime = useCallback((seconds: number): string => {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    }, []);

    if (!metrics)
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-6 opacity-30">
                <RefreshCw size={32} className="animate-spin text-accent-primary" />
                <span className="text-white font-black tracking-[0.5em] uppercase text-xs">
                    Syncing...
                </span>
            </div>
        );

    return (
        <div className="flex flex-col gap-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                <MetricCard
                    icon={Cpu}
                    label="Processor"
                    value={metrics.cpu.load}
                    unit="%"
                    color="text-accent-primary"
                    extra={
                        <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                                <Clock size={10} className="opacity-50" />
                                <span className="text-white">
                                    UP: {formatUptime(metrics.uptime)}
                                </span>
                            </div>
                            <span className="text-white font-bold">{metrics.cpu.temp}°C</span>
                        </div>
                    }
                >
                    <div className="grid grid-cols-8 gap-1 mt-3">
                        {metrics.cpu.cpus?.map((load: string, i: number) => (
                            <div
                                key={i}
                                className="h-4 bg-white/5 w-full overflow-hidden rounded-sm relative group"
                            >
                                <div
                                    className="absolute bottom-0 left-0 right-0 bg-accent-primary opacity-60"
                                    style={{ height: `${load}%` }}
                                />
                            </div>
                        ))}
                    </div>
                </MetricCard>

                <MetricCard
                    icon={Memory}
                    label="Memory"
                    value={metrics.mem.usage}
                    unit="%"
                    color="text-accent-primary"
                    extra={
                        <div className="flex justify-between w-full">
                            <span className="text-white font-bold">{metrics.mem.used}G USED</span>
                            <span className="text-white opacity-40">{metrics.mem.total}G</span>
                        </div>
                    }
                >
                    <div className="flex flex-col gap-1.5 mt-3">
                        <div className="flex justify-between items-center text-[8px] font-black opacity-40 uppercase text-white px-1">
                            <span>Cached: {metrics.mem.cached}G</span>
                            <span>Swap: {metrics.mem.swapUsed}G</span>
                        </div>
                    </div>
                </MetricCard>

                {metrics.gpu && (
                    <MetricCard
                        icon={Zap}
                        label="Graphics (AMD)"
                        value={metrics.gpu.usage}
                        unit="%"
                        color="text-accent-secondary"
                        extra={
                            <div className="flex justify-between w-full">
                                <span className="text-white font-bold">
                                    {metrics.gpu.memUsed}G VRAM
                                </span>
                                <span className="text-white opacity-40">{metrics.gpu.temp}°C</span>
                            </div>
                        }
                    >
                        <div className="flex flex-col gap-1.5 mt-3">
                            <div className="flex justify-between items-center bg-white/[0.03] p-1.5 px-2.5 rounded-lg border border-white/5">
                                <span className="text-[8px] font-black opacity-40 uppercase text-white">
                                    Power
                                </span>
                                <span className="text-[11px] text-white font-black font-mono">
                                    {metrics.gpu.power}W
                                </span>
                            </div>
                            <div className="flex justify-between items-center bg-white/[0.03] p-1.5 px-2.5 rounded-lg border border-white/5">
                                <span className="text-[8px] font-black opacity-40 uppercase text-white">
                                    Clock
                                </span>
                                <span className="text-[11px] text-white font-black font-mono">
                                    {metrics.gpu.clock}
                                </span>
                            </div>
                        </div>
                    </MetricCard>
                )}

                <MetricCard
                    icon={HardDrive}
                    label="Storage"
                    value={metrics.disks[0]?.use || 0}
                    unit="%"
                    color="text-accent-warning"
                    extra={
                        <span className="text-white truncate max-w-full">
                            {metrics.disks[0]?.mount}
                        </span>
                    }
                >
                    <div className="flex flex-col gap-1.5 mt-3">
                        {metrics.disks.slice(1, 3).map((d, i) => (
                            <div
                                key={i}
                                className="flex justify-between items-center bg-white/[0.03] p-1.5 px-2.5 rounded-lg border border-white/5"
                            >
                                <span className="text-[8px] font-black opacity-40 uppercase text-white truncate max-w-[60px]">
                                    {d.mount}
                                </span>
                                <span className="text-[10px] text-white font-black font-mono">
                                    {d.use}%
                                </span>
                            </div>
                        ))}
                    </div>
                </MetricCard>

                <MetricCard
                    icon={Activity}
                    label="Traffic"
                    value={metrics.net[0]?.rx || 0}
                    unit=" KB/s"
                    color="text-accent-secondary"
                >
                    <div className="flex flex-col gap-1.5 mt-3">
                        {metrics.net.slice(0, 1).map((n, i) => (
                            <div key={i} className="flex flex-col gap-1">
                                <div className="flex justify-between items-center bg-white/[0.03] p-1.5 px-2.5 rounded-lg border border-white/5">
                                    <div className="flex items-center gap-2">
                                        <ArrowDownLeft
                                            size={10}
                                            className="text-accent-secondary"
                                        />
                                        <span className="text-[8px] font-black opacity-40 uppercase text-white">
                                            {n.iface} In
                                        </span>
                                    </div>
                                    <span className="text-[11px] text-white font-black font-mono">
                                        {n.rx}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center bg-white/[0.03] p-1.5 px-2.5 rounded-lg border border-white/5">
                                    <div className="flex items-center gap-2">
                                        <ArrowUpRight size={10} className="text-accent-warning" />
                                        <span className="text-[8px] font-black opacity-40 uppercase text-white">
                                            {n.iface} Out
                                        </span>
                                    </div>
                                    <span className="text-[11px] text-white font-black font-mono">
                                        {n.tx}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </MetricCard>
            </div>
        </div>
    );
}
