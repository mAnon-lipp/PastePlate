const MAX_IMAGE_SIZE = 12 * 1024 * 1024

const FALLBACK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <rect width="800" height="450" fill="#f1ede4"/>
  <circle cx="400" cy="205" r="58" fill="#ddd4c4"/>
  <path d="M375 205a25 25 0 1 0 50 0 25 25 0 1 0-50 0" fill="#faf8f3"/>
  <path d="M330 286c25-45 115-45 140 0" fill="none" stroke="#c2b69f" stroke-width="18" stroke-linecap="round"/>
</svg>`

function sendFallback(event: Parameters<typeof setResponseHeaders>[0]) {
  setResponseHeaders(event, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
    'X-Image-Fallback': 'true',
  })
  return FALLBACK_SVG
}

function isAllowedImageHost(hostname: string): boolean {
  const allowedHosts = [
    'cdninstagram.com',
    'fbcdn.net',
    'instagram.com',
    'tiktokcdn.com',
    'tiktokcdn-eu.com',
    'tiktokv.com',
  ]

  return allowedHosts.some((host) =>
    hostname === host || hostname.endsWith(`.${host}`)
  )
}

export default defineEventHandler(async (event) => {
  const { url } = getQuery(event)

  if (typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'URL image manquante.' })
  }

  let imageUrl: URL
  try {
    imageUrl = new URL(url)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'URL image invalide.' })
  }

  if (
    (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') ||
    !isAllowedImageHost(imageUrl.hostname.toLowerCase())
  ) {
    return sendFallback(event)
  }

  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: imageUrl.hostname.includes('instagram') ||
        imageUrl.hostname.includes('cdninstagram') ||
        imageUrl.hostname.includes('fbcdn')
        ? 'https://www.instagram.com/'
        : 'https://www.tiktok.com/',
    },
    signal: AbortSignal.timeout(15_000),
  }).catch((error) => {
    console.error('[IMAGE PROXY] Échec réseau :', error)
    return null
  })

  if (!response || !response.ok) {
    return sendFallback(event)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) {
    return sendFallback(event)
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_IMAGE_SIZE) {
    throw createError({ statusCode: 413, statusMessage: 'Image trop volumineuse.' })
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_IMAGE_SIZE) {
    throw createError({ statusCode: 413, statusMessage: 'Image trop volumineuse.' })
  }

  setResponseHeaders(event, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400, s-maxage=604800',
  })

  return bytes
})
