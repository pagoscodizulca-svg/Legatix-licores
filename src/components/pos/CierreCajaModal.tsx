'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { impresoraFiscal } from '@/lib/impresora-fiscal'
import { createClient } from '@/lib/supabase/client'

interface Props {
  open: boolean
  turnoId?: string
  onClose: () => void
  onSuccess?: () => void
}

export function CierreCajaModal({ open, turnoId, onClose, onSuccess }: Props) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [efectivoVesDeclarado, setEfectivoVesDeclarado] = useState('')
  const [efectivoUsdDeclarado, setEfectivoUsdDeclarado] = useState('')
  const supabase = createClient()

  const handleCierre = async () => {
    setIsProcessing(true)
    try {
      // 1. Validar y guardado en base de datos del cuadre de caja
      if (turnoId) {
        await supabase
          .from('cajas_turnos')
          .update({
            estatus: 'CERRADO',
            fecha_cierre: new Date().toISOString(),
            monto_cierre_ves_declarado: parseFloat(efectivoVesDeclarado || '0') || 0,
            monto_cierre_usd_declarado: parseFloat(efectivoUsdDeclarado || '0') || 0
          })
          .eq('id', turnoId)
      }
      
      // 2. Disparar el comando del Reporte Z a la impresora fiscal (la cual totaliza e imprime)
      // En una impresora real, este comando saca el reporte físico y blanquea las memorias diarias.
      console.log('Enviando comando de Reporte Z a la impresora fiscal...')
      const resFiscal = await impresoraFiscal.imprimirReporteZ()
      
      if (!resFiscal.exito) {
        toast.error('Error Fiscal', { description: resFiscal.mensaje })
        return
      }

      toast.success('Caja Cerrada Exitosamente', { 
        description: 'El Reporte Z ha sido impreso y el turno cerrado en el sistema.' 
      })
      
      onClose()
      if (onSuccess) onSuccess()

    } catch (e: any) {
      toast.error('Error cerrando caja', { description: e.message })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val: boolean) => !val && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cierre de Caja (Reporte Z)</DialogTitle>
          <DialogDescription>
            Por favor, declare el efectivo actual en la gaveta antes de emitir el Reporte Z.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Efectivo Físico en Bolívares (VES)</Label>
            <Input 
              type="number" 
              placeholder="Ej: 500.00" 
              value={efectivoVesDeclarado}
              onChange={e => setEfectivoVesDeclarado(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Efectivo Físico en Dólares (USD)</Label>
            <Input 
              type="number" 
              placeholder="Ej: 150.00" 
              value={efectivoUsdDeclarado}
              onChange={e => setEfectivoUsdDeclarado(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>Cancelar</Button>
          <Button 
            onClick={handleCierre} 
            disabled={isProcessing}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isProcessing ? 'Procesando...' : 'Emitir Reporte Z'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
