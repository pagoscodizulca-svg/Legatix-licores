import { test, expect } from '@playwright/test'

test.describe('Legatix POS — Suite E2E (Playwright)', () => {
  test('1. Seguridad de Rutas (Middleware RBAC/Auth): redirige usuarios no autenticados a /login en todas las rutas protegidas', async ({ page }) => {
    const protectedRoutes = [
      '/',
      '/dashboard',
      '/pos',
      '/facturacion',
      '/inventario',
      '/finanzas',
      '/reportes',
      '/configuracion',
    ]

    for (const route of protectedRoutes) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/)
    }
  })

  test('2. Renderizado UI y Accesibilidad de Login: muestra marca LEGATIX PRO, campos requeridos y elementos visuales', async ({ page }) => {
    const response = await page.goto('/login')
    expect(response?.status()).toBe(200)

    // Verificar encabezado de seguridad HSTS configurado en next.config.mjs
    const headers = response?.headers() || {}
    expect(headers['strict-transport-security']).toContain('max-age=63072000')

    await expect(page.locator('h3')).toContainText('LEGATIX PRO')
    await expect(page.getByText('Ingresa tus credenciales para acceder al sistema')).toBeVisible()

    const emailInput = page.locator('input#email')
    const passwordInput = page.locator('input#password')
    const submitBtn = page.getByRole('button', { name: /Acceder al Sistema/i })

    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('type', 'email')
    await expect(emailInput).toHaveAttribute('required', '')

    await expect(passwordInput).toBeVisible()
    await expect(passwordInput).toHaveAttribute('type', 'password')
    await expect(passwordInput).toHaveAttribute('required', '')

    await expect(submitBtn).toBeEnabled()
  })

  test('3. Flujo de Autenticación Fallida (400 Invalid Credentials): muestra alerta de error en la UI sin romper la página', async ({ page }) => {
    // Interceptar respuesta de Supabase Auth para prueba determinista y rápida
    await page.route('**/auth/v1/token**', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
          message: 'Invalid login credentials',
        }),
      })
    })

    await page.goto('/login')
    await page.fill('input#email', 'usuario_invalido@legatix.com')
    await page.fill('input#password', 'clave_incorrecta_123')
    await page.click('button[type="submit"], button:has-text("Acceder al Sistema")')

    await expect(page.getByText(/Invalid login credentials/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Acceder al Sistema/i })).toBeEnabled()
  })

  test('4. Resiliencia ante Caída de Red / Error 500 en Login: recupera el estado del botón y notifica al usuario', async ({ page }) => {
    await page.route('**/auth/v1/token**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Database error querying schema',
        }),
      })
    })

    await page.goto('/login')
    await page.fill('input#email', 'admin@legatix.com')
    await page.fill('input#password', '12345678')
    await page.click('button:has-text("Acceder al Sistema")')

    await expect(page.getByText(/Database error querying schema/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Acceder al Sistema/i })).toBeEnabled()
  })

  test('5. API E2E POST /api/fiscal/calcular: calcula totales exactos multimoneda y rechaza payloads inválidos (400/500)', async ({ request }) => {
    // Caso 1: Cálculo exitoso (Happy Path) con producto gravado + licor adicional + exento
    const validRes = await request.post('/api/fiscal/calcular', {
      data: {
        items: [
          {
            descripcion: 'Ron Cacique Añejo',
            cantidad: 2,
            unidad_medida: 'BOTELLA',
            precio_unitario_usd: 10,
            descuento_pct: 10, // 20 - 2 = 18 USD base
            tipo_alicuota: 'GENERAL',
            aplica_alicuota_adicional: true, // +16% IVA (2.88) + 15% Adicional (2.70)
          },
          {
            descripcion: 'Bolsa de Hielo',
            cantidad: 1,
            unidad_medida: 'UNIDAD',
            precio_unitario_usd: 2,
            descuento_pct: 0,
            tipo_alicuota: 'EXENTO',
            aplica_alicuota_adicional: false,
          },
        ],
        config: {
          id: 'cfg-e2e',
          empresa_id: 'emp-e2e',
          alicuota_iva_general: 16,
          alicuota_iva_adicional: 15,
          alicuota_iva_reducida: 8,
          alicuota_igtf: 3,
        },
        tasaBcv: 876.8,
        monedaPrincipal: 'USD',
        aplicarIgtf: true,
      },
    })

    expect(validRes.status()).toBe(200)
    const body = await validRes.json()
    expect(body.subtotal).toBe(20) // 18 + 2
    expect(body.base_general).toBe(18)
    expect(body.exento).toBe(2)
    expect(body.iva_general).toBe(2.88)
    expect(body.iva_adicional).toBe(2.7)
    expect(body.total_iva).toBe(5.58)
    expect(body.igtf).toBe(0.77) // 3% de 25.58
    expect(body.total).toBe(26.35)

    // Caso 2: Error 400 Bad Request por tasaBcv <= 0
    const badRateRes = await request.post('/api/fiscal/calcular', {
      data: {
        items: [],
        config: {},
        tasaBcv: 0,
        monedaPrincipal: 'VES',
      },
    })
    expect(badRateRes.status()).toBe(400)

    // Caso 3: Error 500 ante JSON corrupto
    const invalidJsonRes = await request.fetch('/api/fiscal/calcular', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      data: '{ malformed_json ',
    })
    expect(invalidJsonRes.status()).toBe(500)
  })

  test('6. API E2E GET /api/cron/bcv: sincroniza tasa oficial del BCV en tiempo real con 2 decimales', async ({ request }) => {
    const bcvRes = await request.get('/api/cron/bcv')
    expect(bcvRes.status()).toBe(200)

    const data = await bcvRes.json()
    expect(data.success).toBe(true)
    expect(typeof data.tasa).toBe('number')
    expect(data.tasa).toBeGreaterThan(0)
    // Verificar que tiene máximo 2 decimales
    expect(Math.round(data.tasa * 100) / 100).toBe(data.tasa)
    expect(data.fecha_valor).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
