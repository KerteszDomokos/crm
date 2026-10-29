export type CitySuggestion = {
  id: string
  label: string
  subtitle?: string
  countryCode?: string | null
  latitude?: number | null
  longitude?: number | null
  providerPlaceId?: string | null
}

type CacheEntry = { expiresAt: number; items: CitySuggestion[] }

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60_000
const MIN_INTERVAL_MS = 1_100
let lastRequestAt = 0

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim()
}

function providerBaseUrl(): string | null {
  const configured = env('GEOCODER_BASE_URL')
  if (configured) return configured.replace(/\/$/, '')
  // Local/dev convenience only — production should set GEOCODER_BASE_URL explicitly.
  if (env('NODE_ENV') === 'production' || env('GEOCODER_DISABLED') === 'true') return null
  return 'https://photon.komoot.io'
}

function providerKind(baseUrl: string): 'photon' | 'nominatim' {
  const forced = env('GEOCODER_PROVIDER').toLowerCase()
  if (forced === 'photon' || forced === 'nominatim') return forced
  return /nominatim/i.test(baseUrl) ? 'nominatim' : 'photon'
}

function normalizeCityLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function dedupe(items: CitySuggestion[]): CitySuggestion[] {
  const seen = new Set<string>()
  const result: CitySuggestion[] = []
  for (const item of items) {
    const key = item.label.toLocaleLowerCase()
    if (!item.label || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function fromPhoton(payload: unknown): CitySuggestion[] {
  if (!payload || typeof payload !== 'object') return []
  const features = (payload as { features?: unknown }).features
  if (!Array.isArray(features)) return []
  return features.flatMap((feature) => {
    if (!feature || typeof feature !== 'object') return []
    const properties = (feature as { properties?: Record<string, unknown> }).properties ?? {}
    const geometry = (feature as { geometry?: { coordinates?: unknown } }).geometry
    const type = String(properties.type ?? properties.osm_value ?? '').toLowerCase()
    if (type && !['city', 'town', 'village', 'municipality', 'locality', 'hamlet', 'borough', 'suburb', 'county', 'district'].includes(type)) {
      // Prefer settlement-like results; still accept unnamed types when a city field is present.
      if (!properties.city && !properties.name) return []
    }
    const label = normalizeCityLabel(String(properties.name ?? properties.city ?? ''))
    if (!label) return []
    const country = typeof properties.country === 'string' ? properties.country.trim() : ''
    const state = typeof properties.state === 'string' ? properties.state.trim() : ''
    const countryCode = typeof properties.countrycode === 'string' ? properties.countrycode.toUpperCase() : null
    const osmType = typeof properties.osm_type === 'string' ? properties.osm_type : null
    const osmId = properties.osm_id != null ? String(properties.osm_id) : null
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null
    const longitude = typeof coordinates?.[0] === 'number' ? coordinates[0] : null
    const latitude = typeof coordinates?.[1] === 'number' ? coordinates[1] : null
    const subtitle = [state && state !== label ? state : null, country].filter(Boolean).join(', ') || undefined
    return [{
      id: label,
      label,
      subtitle,
      countryCode,
      latitude,
      longitude,
      providerPlaceId: osmType && osmId ? `${osmType}:${osmId}` : null,
    }]
  })
}

function fromNominatim(payload: unknown): CitySuggestion[] {
  if (!Array.isArray(payload)) return []
  return payload.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    const address = item.address && typeof item.address === 'object' ? item.address as Record<string, unknown> : {}
    const label = normalizeCityLabel(String(
      address.city
      ?? address.town
      ?? address.village
      ?? address.municipality
      ?? address.locality
      ?? item.name
      ?? '',
    ))
    if (!label) return []
    const country = typeof address.country === 'string' ? address.country.trim() : ''
    const state = typeof address.state === 'string' ? address.state.trim() : ''
    const countryCode = typeof address.country_code === 'string' ? address.country_code.toUpperCase() : null
    const latitude = Number(item.lat)
    const longitude = Number(item.lon)
    return [{
      id: label,
      label,
      subtitle: [state && state !== label ? state : null, country].filter(Boolean).join(', ') || undefined,
      countryCode,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      providerPlaceId: typeof item.place_id === 'number' || typeof item.place_id === 'string' ? `nominatim:${item.place_id}` : null,
    }]
  })
}

async function throttle(): Promise<void> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt))
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}

export async function searchProviderCities(query: string, limit = 8): Promise<CitySuggestion[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const baseUrl = providerBaseUrl()
  if (!baseUrl) return []

  const cacheKey = `${baseUrl}|${trimmed.toLocaleLowerCase()}|${limit}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.items

  const kind = providerKind(baseUrl)
  const url = new URL(kind === 'nominatim' ? `${baseUrl}/search` : `${baseUrl}/api/`)
  if (kind === 'nominatim') {
    url.searchParams.set('q', trimmed)
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('featuretype', 'city')
    url.searchParams.set('limit', String(limit))
  } else {
    url.searchParams.set('q', trimmed)
    url.searchParams.set('limit', String(limit))
    url.searchParams.append('osm_tag', 'place:city')
    url.searchParams.append('osm_tag', 'place:town')
    url.searchParams.append('osm_tag', 'place:village')
    url.searchParams.append('osm_tag', 'place:municipality')
  }

  await throttle()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': env('GEOCODER_USER_AGENT', 'ResoloonCRM/0.1 (city-autocomplete)'),
      },
    })
    if (!response.ok) return []
    const payload = await response.json()
    const items = dedupe(kind === 'nominatim' ? fromNominatim(payload) : fromPhoton(payload)).slice(0, limit)
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items })
    return items
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export function __resetGeocoderForTests() {
  cache.clear()
  lastRequestAt = 0
}

export const __testables = { fromPhoton, fromNominatim, dedupe, normalizeCityLabel }
