'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'
import { Proveedor } from '@/types/finanzas.types'

interface RegistrarCompraModalProps {
  open: boolean
  onClose: () => void
  onSuccess: (compra: any) => void
  empresaId: string
  userId: string
  proveedores: Proveedor[]
}

export function RegistrarCompraModal({ open, onClose, onSuccess, empresaId, userId, proveedores }: RegistrarCompraModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    proveedor_id: '',
    numero_factura: '',
    numero_control: '',
    fecha_emision: new Date().toISOString().split('T')[0],
    condicion_pago: 'CONTADO',
    dias_credito: '15',
    total_factura: ''
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (!formData.proveedor_id) {
      setError('Seleccione un proveedor')
      setLoading(false)
      return
    }

    const supabase = createClient()
    
    // Calcular fecha de vencimiento si es a crédito
    let fechaVencimiento = formData.fecha_emision
    if (formData.condicion_pago === 'CREDITO') {
      const fechaObj = new Date(formData.fecha_emision)
      fechaObj.setDate(fechaObj.getDate() + parseInt(formData.dias_credito || '0'))
      fechaVencimiento = fechaObj.toISOString().split('T')[0]
    }
    
    const payload = {
      empresa_id: empresaId,
      usuario_id: userId,
      proveedor_id: formData.proveedor_id,
      numero_factura: formData.numero_factura,
      numero_control: formData.numero_control,
      fecha_emision: formData.fecha_emision,
      fecha_vencimiento: fechaVencimiento,
      condicion_pago: formData.condicion_pago,
      estatus: formData.condicion_pago === 'CONTADO' ? 'PAGADA' : 'PENDIENTE',
      total_factura: parseFloat(formData.total_factura),
      moneda: 'USD',
      base_imponible_general: parseFloat(formData.total_factura), // Simplificado para no hacer desglose de IVA por ahora
    }

    try {
      const { data, error: insertError } = await supabase
        .from('facturas_compras')
        .insert([payload])
        .select(`*, proveedor:proveedores(razon_social, rif)`)
        .single()

      if (insertError) throw insertError
      
      onSuccess(data)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Error al registrar la factura de compra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val: boolean) => !val && onClose()}>
      <DialogContent className="sm:max-w-[450px] bg-black/95 border-white/10 text-white backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle>Registrar Factura de Compra</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {error && <div className="text-red-500 text-sm bg-red-500/10 p-3 rounded-md">{error}</div>}
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Proveedor</label>
            <select
              name="proveedor_id"
              required
              value={formData.proveedor_id}
              onChange={handleChange}
              className="w-full flex h-10 w-full items-center justify-between rounded-md border bg-white/5 border-white/10 px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" className="bg-zinc-900 text-white">Seleccionar proveedor...</option>
              {proveedores.map(p => (
                <option key={p.id} value={p.id} className="bg-zinc-900 text-white">
                  {p.razon_social} ({p.rif})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">N° Factura</label>
              <Input 
                name="numero_factura"
                required
                value={formData.numero_factura}
                onChange={handleChange}
                className="bg-white/5 border-white/10"
                placeholder="000123"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">N° Control</label>
              <Input 
                name="numero_control"
                required
                value={formData.numero_control}
                onChange={handleChange}
                className="bg-white/5 border-white/10"
                placeholder="00-12345"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Fecha de Emisión</label>
              <Input 
                name="fecha_emision"
                type="date"
                required
                value={formData.fecha_emision}
                onChange={handleChange}
                className="bg-white/5 border-white/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Condición</label>
              <select
                name="condicion_pago"
                required
                value={formData.condicion_pago}
                onChange={handleChange}
                className="w-full flex h-10 w-full items-center justify-between rounded-md border bg-white/5 border-white/10 px-3 py-2 text-sm text-white focus:outline-none"
              >
                <option value="CONTADO" className="bg-zinc-900 text-white">Contado</option>
                <option value="CREDITO" className="bg-zinc-900 text-white">Crédito</option>
              </select>
            </div>
          </div>

          {formData.condicion_pago === 'CREDITO' && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
              <label className="text-sm font-medium text-muted-foreground">Días de Crédito (Plazo)</label>
              <Input 
                name="dias_credito"
                type="number"
                min="1"
                required={formData.condicion_pago === 'CREDITO'}
                value={formData.dias_credito}
                onChange={handleChange}
                className="bg-amber-500/10 border-amber-500/30 text-amber-50 focus-visible:ring-amber-500"
                placeholder="Ej: 15"
              />
              <p className="text-[11px] text-muted-foreground">La fecha de vencimiento se calculará automáticamente sumando estos días a la fecha de emisión.</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Monto Total (USD)</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-muted-foreground sm:text-sm">$</span>
              </div>
              <Input 
                name="total_factura"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={formData.total_factura}
                onChange={handleChange}
                className="bg-white/5 border-white/10 pl-7 font-bold text-lg"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading} className="bg-transparent border-white/10">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="bg-primary text-primary-foreground font-bold">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar Compra
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
