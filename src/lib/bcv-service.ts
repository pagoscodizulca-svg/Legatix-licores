import https from 'https'
import { createClient } from '@supabase/supabase-js'

// Inicialización perezosa exclusiva de servidor (protege SUPABASE_SERVICE_ROLE_KEY contra ejecución en cliente)
function getSupabaseClient() {
  if (typeof window !== 'undefined') {
    throw new Error('Acceso denegado: bcv-service es exclusivo del servidor')
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}

const BCV_URL = 'https://www.bcv.org.ve/estadisticas/indice-de-inversion'

/**
 * Realiza una petición HTTPS al BCV ignorando el error de certificado (UNABLE_TO_VERIFY_LEAF_SIGNATURE).
 */
async function fetchBcvHtml(): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({
      rejectUnauthorized: false // Ignorar error de certificado del BCV
    })

    const req = https.get(BCV_URL, {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`El servidor del BCV respondió con estado ${res.statusCode}`))
      }

      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    })

    req.on('error', (e) => reject(new Error(`Error de red conectando al BCV: ${e.message}`)))
    req.setTimeout(15000, () => {
      req.destroy()
      reject(new Error('Timeout de 15s excedido conectando al BCV'))
    })
  })
}

/**
 * Extrae la tasa del bloque "Dólar" y la "Fecha Valor".
 */
export async function sincronizarTasaBcv() {
  console.log('[BCV] Iniciando sincronización...')
  try {
    const html = await fetchBcvHtml()
    
    // 1. Extraer el valor del Dólar
    // Buscamos algo como: id="dolar" ... <strong> 36,45670000 </strong>
    const dolarIndex = html.indexOf('id="dolar"')
    if (dolarIndex === -1) throw new Error('No se encontró el bloque del Dólar en el HTML')
    
    const dolarHtml = html.substring(dolarIndex, dolarIndex + 500)
    const strongMatch = dolarHtml.match(/<strong[^>]*>\s*([\d,]+)\s*<\/strong>/)
    if (!strongMatch) throw new Error('No se encontró la etiqueta strong con la tasa del Dólar')
    
    const tasaStr = strongMatch[1].replace(',', '.')
    const rawTasa = parseFloat(tasaStr)
    const tasaUsd = Math.round(rawTasa * 100) / 100
    
    if (isNaN(tasaUsd) || tasaUsd <= 0) throw new Error(`Tasa extraída es inválida: ${tasaStr}`)

    // 2. Extraer la Fecha Valor
    // Buscamos algo como: Fecha Valor: <span ... content="2024-03-12T00:00:00-04:00">
    let fechaValorStr = new Date().toISOString().split('T')[0] // Fallback a hoy
    const contentMatch = html.match(/Fecha Valor:[\s\S]*?content="([^"]+)"/i)
    if (contentMatch) {
      // Extraemos solo la parte YYYY-MM-DD
      fechaValorStr = contentMatch[1].split('T')[0]
    }

    console.log(`[BCV] Tasa extraída: ${tasaUsd} Bs/USD | Fecha Valor: ${fechaValorStr}`)

    // 3. Guardar en Supabase (requiere que exista la tabla tasas_bcv)
    const { error } = await getSupabaseClient()
      .from('tasas_bcv')
      .upsert({
        fecha_valor: fechaValorStr,
        usd: tasaUsd,
        fuente: 'BCV_OFICIAL',
        url_origen: BCV_URL,
        obtenida_en: new Date().toISOString()
      }, { onConflict: 'fecha_valor' })

    if (error) {
      console.warn(`[BCV] Aviso al persistir en BD: ${error.message}. Continuando con la tasa en vivo obtenida.`)
    } else {
      console.log('[BCV] Tasa guardada exitosamente en la BD.')
    }

    return {
      success: true,
      tasa: tasaUsd,
      fecha_valor: fechaValorStr,
      guardado: !error
    }

  } catch (error: any) {
    console.error('[BCV] Error en sincronización:', error.message)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Obtiene la tasa más reciente registrada en la BD.
 */
export async function obtenerUltimaTasaBcv() {
  try {
    const { data, error } = await getSupabaseClient()
      .from('tasas_bcv')
      .select('usd, fecha_valor, obtenida_en')
      .order('fecha_valor', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'No hay tasas registradas en la base de datos' }
      }
      throw error
    }

    return {
      success: true,
      tasa: Number(data.usd),
      fecha_valor: data.fecha_valor,
      obtenida_en: data.obtenida_en
    }
  } catch (error: any) {
    console.error('[BCV] Error obteniendo tasa de BD:', error.message)
    return { success: false, error: error.message }
  }
}
