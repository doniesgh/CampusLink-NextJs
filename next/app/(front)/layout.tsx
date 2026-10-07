import React from 'react'
import { ClientMessages } from '@/components/i18n/client-messages'

export default function Frontlayout({ children }: { children: React.ReactNode }) {
    return (
        <ClientMessages namespaces={['landing']}>
            <div className="flex min-h-screen flex-col bg-background text-foreground p-10">
                {children}
            </div>
        </ClientMessages>
    )
}
