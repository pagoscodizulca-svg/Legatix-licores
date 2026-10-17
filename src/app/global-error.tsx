'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="es">
      <body className="bg-black text-white flex min-h-screen items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-2xl font-bold text-red-500">Ocurrió un error inesperado</h2>
          <p className="text-sm text-gray-400">
            El error ha sido registrado y reportado automáticamente a la consola de monitoreo de Sentry.
          </p>
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  )
}
