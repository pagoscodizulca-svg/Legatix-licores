'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { productoSchema, type ProductoFormValues } from '@/lib/validations/producto.schema'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function ProductoFormDialog({ open, onOpenChange, empresaId, initialProduct }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  empresaId?: string
  initialProduct?: any
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const { register, handleSubmit, formState: { errors }, reset } = useForm<ProductoFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(productoSchema) as any,
    values: initialProduct ? {
      codigo_sku: initialProduct.codigo_sku || '',
      nombre: initialProduct.nombre || '',
      descripcion: initialProduct.descripcion || '',
      categoria_id: initialProduct.categoria_id || null,
      proveedor_id: initialProduct.proveedor_id || null,
      unidad_medida: initialProduct.unidad_medida || 'UNIDAD',
      precio_costo: initialProduct.precio_costo || 0,
      precio_venta: initialProduct.precio_venta || 0,
      precio_venta_usd: initialProduct.precio_venta_usd || 0,
      stock_actual: initialProduct.stock_actual || 0,
      stock_minimo: initialProduct.stock_minimo || 5,
      es_licor: initialProduct.es_licor || false,
      es_promo: initialProduct.es_promo || false,
      volumen_litros: initialProduct.volumen_litros || null,
      grado_alcoholico: initialProduct.grado_alcoholico || null,
      gravado_iva: initialProduct.gravado_iva ?? true,
      alicuota_iva: initialProduct.alicuota_iva || 16,
      activo: initialProduct.activo ?? true
    } : {
      codigo_sku: '',
      nombre: '',
      descripcion: '',
      categoria_id: null,
      proveedor_id: null,
      unidad_medida: 'UNIDAD',
      precio_costo: 0,
      precio_venta: 0,
      precio_venta_usd: 0,
      stock_actual: 0,
      stock_minimo: 5,
      es_licor: false,
      es_promo: false,
      volumen_litros: null,
      grado_alcoholico: null,
      gravado_iva: true,
      alicuota_iva: 16,
      activo: true
    },
    resetOptions: {
      keepDirtyValues: false,
    }
  })

  useEffect(() => {
    if (open) {
      if (initialProduct) {
        reset({
          codigo_sku: initialProduct.codigo_sku || '',
          nombre: initialProduct.nombre || '',
          descripcion: initialProduct.descripcion || '',
          categoria_id: initialProduct.categoria_id || null,
          proveedor_id: initialProduct.proveedor_id || null,
          unidad_medida: initialProduct.unidad_medida || 'UNIDAD',
          precio_costo: initialProduct.precio_costo ?? 0,
          precio_venta: initialProduct.precio_venta ?? 0,
          precio_venta_usd: initialProduct.precio_venta_usd ?? 0,
          stock_actual: initialProduct.stock_actual ?? 0,
          stock_minimo: initialProduct.stock_minimo ?? 5,
          es_licor: initialProduct.es_licor ?? false,
          es_promo: initialProduct.es_promo ?? false,
          volumen_litros: initialProduct.volumen_litros ?? null,
          grado_alcoholico: initialProduct.grado_alcoholico ?? null,
          gravado_iva: initialProduct.gravado_iva ?? true,
          alicuota_iva: initialProduct.alicuota_iva ?? 16,
          activo: initialProduct.activo ?? true
        })
      } else {
        reset({
          codigo_sku: '',
          nombre: '',
          descripcion: '',
          categoria_id: null,
          proveedor_id: null,
          unidad_medida: 'UNIDAD',
          precio_costo: 0,
          precio_venta: 0,
          precio_venta_usd: 0,
          stock_actual: 0,
          stock_minimo: 5,
          es_licor: false,
          es_promo: false,
          volumen_litros: null,
          grado_alcoholico: null,
          gravado_iva: true,
          alicuota_iva: 16,
          activo: true
        })
      }
    }
  }, [open, initialProduct, reset])

  const onSubmit = async (data: ProductoFormValues) => {
    setLoading(true)

    let eid = empresaId
    if (!eid) {
      // Fallback: obtener empresa_id desde Supabase si no fue pasado como prop
      const { data: userResponse } = await supabase.auth.getUser()
      const { data: usuario } = await supabase.from('usuarios').select('empresa_id').eq('id', userResponse.user?.id).single()
      eid = usuario?.empresa_id
    }

    if (!eid) {
      console.error('No se encontró la empresa del usuario')
      setLoading(false)
      return
    }

    const payload = { ...data, empresa_id: eid }

    let error;
    if (initialProduct) {
      const res = await supabase.from('productos').update(payload).eq('id', initialProduct.id)
      error = res.error
    } else {
      const res = await supabase.from('productos').insert(payload)
      error = res.error
    }
    
    setLoading(false)
    if (!error) {
      onOpenChange(false)
      router.refresh()
    } else {
      console.error(error)
      // Mostrar toast de error
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val: boolean) => {
      if (!val) reset()
      onOpenChange(val)
    }}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialProduct ? 'Editar Producto' : 'Nuevo Producto'}</DialogTitle>
          <DialogDescription>
            {initialProduct 
              ? 'Modifica los detalles del producto a continuación.' 
              : 'Añade un nuevo producto al inventario. Completa los detalles a continuación.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="codigo_sku">Código SKU</Label>
              <Input id="codigo_sku" {...register('codigo_sku')} />
              {errors.codigo_sku && <p className="text-xs text-red-500">{errors.codigo_sku.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" {...register('nombre')} />
              {errors.nombre && <p className="text-xs text-red-500">{errors.nombre.message}</p>}
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Input id="descripcion" {...register('descripcion')} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="precio_costo">Costo (USD)</Label>
              <Input id="precio_costo" type="number" step="0.01" {...register('precio_costo')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="precio_venta_usd">Venta (USD)</Label>
              <Input id="precio_venta_usd" type="number" step="0.01" {...register('precio_venta_usd')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="precio_venta">Venta (VES)</Label>
              <Input id="precio_venta" type="number" step="0.01" {...register('precio_venta')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="stock_actual">Stock Inicial</Label>
              <Input id="stock_actual" type="number" {...register('stock_actual')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock_minimo">Stock Mínimo</Label>
              <Input id="stock_minimo" type="number" {...register('stock_minimo')} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2 flex flex-col justify-end">
              <Label className="flex items-center gap-2 mb-2">
                <input type="checkbox" {...register('es_licor')} className="rounded border-gray-300 text-black focus:ring-black" />
                ¿Es Licor?
              </Label>
              <p className="text-[10px] text-muted-foreground leading-tight">Activa validaciones de alcohol y volumen.</p>
            </div>
            <div className="space-y-2 flex flex-col justify-end">
              <Label className="flex items-center gap-2 mb-2 font-bold text-amber-600">
                <input type="checkbox" {...register('es_promo')} className="rounded border-amber-500 text-amber-500 focus:ring-amber-500" />
                🔥 Promoción Activa
              </Label>
              <p className="text-[10px] text-muted-foreground leading-tight">Muestra este producto en la pestaña de promociones del POS.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="volumen_litros">Volumen (Litros)</Label>
              <Input id="volumen_litros" type="number" step="0.001" placeholder="Ej: 0.75" {...register('volumen_litros')} />
              {errors.volumen_litros && <p className="text-xs text-red-500">{errors.volumen_litros.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="grado_alcoholico">% Alcohol</Label>
              <Input id="grado_alcoholico" type="number" step="0.1" placeholder="Ej: 12.5" {...register('grado_alcoholico')} />
              {errors.grado_alcoholico && <p className="text-xs text-red-500">{errors.grado_alcoholico.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="unidad_medida">Unidad de Medida</Label>
              <Input id="unidad_medida" {...register('unidad_medida')} />
            </div>
          </div>

          <div className="pt-4 flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading} className="bg-black text-white hover:bg-gray-800">
              {loading ? 'Guardando...' : (initialProduct ? 'Actualizar Producto' : 'Guardar Producto')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
