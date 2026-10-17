'use client'

import * as Sentry from '@sentry/nextjs'
import { useState } from 'react'

export default function SentryTestPage() {
  const [hasError, setHasError] = useState(false)

  const triggerClientError = () => {
    try {
      throw new Error('Sentry Test Error (Client-side): Verificación de conexión Legatix')
    } catch (error) {
      Sentry.captureException(error)
      setHasError(true)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full bg-card/60 backdrop-blur-xl border border-border/50 p-8 rounded-2xl shadow-2xl space-y-6">
        <div className="h-12 w-12 rounded-xl bg-primary/20 text-primary flex items-center justify-center mx-auto text-xl font-bold">
          S
        </div>
        <div>
          <h1 className="text-xl font-bold">Diagnóstico Sentry — Legatix Pro</h1>
          <p className="text-xs text-muted-foreground mt-2">
            Proyecto: <strong className="text-primary">legatix-licoreria</strong> | Organización: <strong className="text-primary">legatix</strong>
          </p>
        </div>

        <div className="pt-2">
          <button
            onClick={triggerClientError}
            className="w-full py-3 px-4 rounded-xl font-bold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all shadow-lg"
          >
            Disparar Error de Prueba a Sentry
          </button>
        </div>

        {hasError && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-medium">
            ¡Evento de prueba enviado a Sentry con éxito! Revisa tu panel en sentry.io.
          </div>
        )}
      </div>
    </div>
  )
}
