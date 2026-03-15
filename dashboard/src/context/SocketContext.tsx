'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SocketContextType {
    socket: Socket | null;
    subscribe: (room: string) => void;
    unsubscribe: (room: string) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<Socket | null>(null);

    useEffect(() => {
        const s = io({
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });

        setSocket(s);

        const handleFocus = () => {
            if (s.disconnected) {
                s.connect();
            }
        };

        window.addEventListener('focus', handleFocus);

        return () => {
            window.removeEventListener('focus', handleFocus);
            s.disconnect();
        };
    }, []);

    const subscribe = (room: string) => {
        socket?.emit('subscribe', room);
    };

    const unsubscribe = (room: string) => {
        socket?.emit('unsubscribe', room);
    };

    return (
        <SocketContext.Provider value={{ socket, subscribe, unsubscribe }}>
            {children}
        </SocketContext.Provider>
    );
};

export const useSocket = () => {
    const context = useContext(SocketContext);
    if (context === undefined) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
};
