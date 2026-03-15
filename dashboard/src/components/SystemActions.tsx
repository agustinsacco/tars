'use client';
import { useState } from 'react';
import { RefreshCw, Lock, Send, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function SystemActions() {
    const [isRestarting, setIsRestarting] = useState(false);
    const [secretKey, setSecretKey] = useState('');
    const [secretValue, setSecretValue] = useState('');
    const [isSettingSecret, setIsSettingSecret] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
        null
    );

    const runCommand = async (body: any) => {
        try {
            const res = await fetch('/api/tars/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Command failed');
            return data;
        } catch (err: any) {
            throw err;
        }
    };

    const handleRestart = async () => {
        if (
            !confirm(
                'Are you sure? This will restart the Tars supervisor and terminate the current session.'
            )
        )
            return;

        setIsRestarting(true);
        setStatus(null);
        try {
            await runCommand({ action: 'restart' });
            setStatus({
                type: 'success',
                message: 'Restart command issued successfully. Check logs.'
            });
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message });
        } finally {
            setIsRestarting(false);
        }
    };

    const handleSetSecret = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!secretKey || !secretValue) return;

        setIsSettingSecret(true);
        setStatus(null);
        try {
            await runCommand({ action: 'secret', key: secretKey, value: secretValue });
            setStatus({ type: 'success', message: `Secret '${secretKey}' updated successfully.` });
            setSecretKey('');
            setSecretValue('');
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message });
        } finally {
            setIsSettingSecret(false);
        }
    };

    return (
        <div className="card bg-[#0c0c0c] border-white/10 p-4 shadow-2xl flex flex-col gap-6">
            <div className="card-header-btop text-accent-danger border-accent-danger/30">
                System Control
            </div>

            {/* Restart Section */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={12} className="text-accent-warning" />
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                        Supervisor Management
                    </span>
                </div>
                <button
                    onClick={handleRestart}
                    disabled={isRestarting}
                    className="w-full flex items-center justify-center gap-3 bg-accent-danger/10 hover:bg-accent-danger/20 border border-accent-danger/30 p-3 rounded-xl transition-all group disabled:opacity-50"
                >
                    <RefreshCw
                        size={16}
                        className={`text-accent-danger ${isRestarting ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`}
                    />
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-white">
                        Restart Tars Core
                    </span>
                </button>
            </div>

            {/* Secret Manager Section */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                    <Lock size={12} className="text-accent-primary" />
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                        Vault (Secrets)
                    </span>
                </div>
                <form onSubmit={handleSetSecret} className="flex flex-col gap-2">
                    <input
                        type="text"
                        placeholder="KEY (e.g. OPENAI_API_KEY)"
                        value={secretKey}
                        onChange={(e) => setSecretKey(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg p-2 text-[10px] font-mono focus:border-accent-primary/50 outline-none transition-colors text-white"
                    />
                    <div className="relative">
                        <input
                            type="password"
                            placeholder="VALUE"
                            value={secretValue}
                            onChange={(e) => setSecretValue(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-[10px] font-mono focus:border-accent-primary/50 outline-none transition-colors text-white pr-10"
                        />
                        <button
                            type="submit"
                            disabled={isSettingSecret || !secretKey || !secretValue}
                            className="absolute right-1 top-1 bottom-1 px-2 bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary rounded flex items-center justify-center transition-all disabled:opacity-0"
                        >
                            {isSettingSecret ? (
                                <RefreshCw size={12} className="animate-spin" />
                            ) : (
                                <Send size={12} />
                            )}
                        </button>
                    </div>
                </form>
            </div>

            {/* Status Feedback */}
            <AnimatePresence>
                {status && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`p-3 rounded-xl flex items-start gap-3 border ${
                            status.type === 'success'
                                ? 'bg-accent-secondary/10 border-accent-secondary/20'
                                : 'bg-accent-danger/10 border-accent-danger/20'
                        }`}
                    >
                        {status.type === 'success' ? (
                            <CheckCircle2
                                size={14}
                                className="text-accent-secondary shrink-0 mt-0.5"
                            />
                        ) : (
                            <XCircle size={14} className="text-accent-danger shrink-0 mt-0.5" />
                        )}
                        <span className="text-[9px] font-bold text-white leading-relaxed uppercase tracking-tight">
                            {status.message}
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
