'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SocketContextType {
    readonly isConnected: boolean;
    readonly socket: Socket | null;
    readonly subscribe: (room: string) => void;
    readonly unsubscribe: (room: string) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const s = io({
            autoConnect: false,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            withCredentials: true
        });

        const handleConnect = (): void => setIsConnected(true);
        const handleDisconnect = (): void => setIsConnected(false);
        s.on('connect', handleConnect);
        s.on('connect_error', handleDisconnect);
        s.on('disconnect', handleDisconnect);
        setSocket(s);
        s.connect();

        const handleFocus = (): void => {
            if (s.disconnected) {
                s.connect();
            }
        };

        window.addEventListener('focus', handleFocus);

        return () => {
            window.removeEventListener('focus', handleFocus);
            s.off('connect', handleConnect);
            s.off('connect_error', handleDisconnect);
            s.off('disconnect', handleDisconnect);
            s.disconnect();
        };
    }, []);

    const subscribe = useCallback(
        (room: string): void => {
            socket?.emit('subscribe', room);
        },
        [socket]
    );

    const unsubscribe = useCallback(
        (room: string): void => {
            socket?.emit('unsubscribe', room);
        },
        [socket]
    );

    const contextValue = useMemo<SocketContextType>(
        () => ({ isConnected, socket, subscribe, unsubscribe }),
        [isConnected, socket, subscribe, unsubscribe]
    );

    return <SocketContext.Provider value={contextValue}>{children}</SocketContext.Provider>;
};

export const useSocket = (): SocketContextType => {
    const context = useContext(SocketContext);
    if (context === undefined) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
};
