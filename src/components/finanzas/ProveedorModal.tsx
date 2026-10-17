'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

interface ProveedorModalProps {
  open: boolean
  onClose: () => void
  onSuccess: (proveedor: any) => void
  empresaId: string
  proveedor?: any
}

export function ProveedorModal({ open, onClose, onSuccess, empresaId, proveedor }: ProveedorModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isEditing = !!proveedor

  const [formData, setFormData] = useState({
    rif: proveedor?.rif || '',
    razon_social: proveedor?.razon_social || '',
    direccion: proveedor?.direccion || '',
    telefono: proveedor?.telefono || '',
    contacto: proveedor?.contacto || ''
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    
    const payload = {
      ...formData,
      empresa_id: empresaId,
      activo: true
    }

    try {
      if (isEditing) {
        const { data, error: updateError } = await supabase
          .from('proveedores')
          .update(payload)
          .eq('id', proveedor.id)
          .select()
          .single()

        if (updateError) throw updateError
        onSuccess(data)
      } else {
        const { data, error: insertError } = await supabase
          .from('proveedores')
          .insert([payload])
          .select()
          .single()

        if (insertError) throw insertError
        onSuccess(data)
      }
      onClose()
    } catch (err: any) {
      setError(err.message || 'Error al guardar el proveedor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val: boolean) => !val && onClose()}>
      <DialogContent className="sm:max-w-[425px] bg-black/95 border-white/10 text-white backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar Proveedor' : 'Nuevo Proveedor'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {error && <div className="text-red-500 text-sm bg-red-500/10 p-3 rounded-md">{error}</div>}
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Razón Social</label>
            <Input 
              name="razon_social"
              required
              value={formData.razon_social}
              onChange={handleChange}
              className="bg-white/5 border-white/10"
              placeholder="Ej: Distribuidora Polar C.A."
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">RIF</label>
            <Input 
              name="rif"
              required
              value={formData.rif}
              onChange={handleChange}
              className="bg-white/5 border-white/10"
              placeholder="J-12345678-9"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Persona de Contacto (Opcional)</label>
            <Input 
              name="contacto"
              value={formData.contacto}
              onChange={handleChange}
              className="bg-white/5 border-white/10"
              placeholder="Nombre del vendedor"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Teléfono</label>
            <Input 
              name="telefono"
              value={formData.telefono}
              onChange={handleChange}
              className="bg-white/5 border-white/10"
              placeholder="0414-0000000"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Dirección</label>
            <Input 
              name="direccion"
              value={formData.direccion}
              onChange={handleChange}
              className="bg-white/5 border-white/10"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading} className="bg-transparent border-white/10">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="bg-primary text-primary-foreground">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
