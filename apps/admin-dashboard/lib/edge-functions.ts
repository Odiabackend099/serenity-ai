export type EdgeFunctionCallResult = {
  ok: boolean
  status: number
  statusText: string
  errorText?: string
  json?: unknown
}

export function resolveEdgeFunctionBaseUrl(
  supabaseUrl: string | null | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  overrideBaseUrl: string | null | undefined = process.env.DASHBOARD_EDGE_FUNCTION_BASE_URL ?? process.env.SUPABASE_FUNCTIONS_URL,
): string | null {
  const override = overrideBaseUrl?.trim()
  if (override) return override.replace(/\/+$/, '')

  const url = supabaseUrl?.trim()
  if (!url) return null
  return `${url.replace(/\/+$/, '')}/functions/v1`
}

export function getEdgeFunctionConfig() {
  const baseUrl = resolveEdgeFunctionBaseUrl()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const internalSecret = process.env.INTERNAL_FUNCTION_SECRET
  const token = internalSecret || serviceKey

  if (!baseUrl || !token) return null

  return {
    baseUrl,
    token,
    serviceKey,
  }
}

export async function callInternalEdgeFunction(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<EdgeFunctionCallResult | null> {
  const config = getEdgeFunctionConfig()
  if (!config) return null

  const response = await fetch(`${config.baseUrl}/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(config.serviceKey ? { apikey: config.serviceKey } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text().catch(() => '')
  let json: unknown
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    errorText: response.ok ? undefined : text || response.statusText,
    json,
  }
}
