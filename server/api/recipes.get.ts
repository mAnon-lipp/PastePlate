import { prisma } from "../utils/prisma"

const MAX_EMBEDDED_THUMBNAIL_SIZE = 1_000_000

async function downloadThumbnail(url: string): Promise<string | null> {
  if (!url || url.startsWith('data:image/')) return url

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'image/*',
        Referer: url.includes('instagram') || url.includes('fbcdn')
          ? 'https://www.instagram.com/'
          : 'https://www.tiktok.com/',
      },
      signal: AbortSignal.timeout(12_000),
    })

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return null

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_EMBEDDED_THUMBNAIL_SIZE) {
      return null
    }

    return `data:${contentType};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

async function refreshInstagramThumbnails(
  recipes: Array<{ id: string; platform: string; sourceUrl: string; thumbnailUrl: string | null }>,
  apifyApiToken: string
) {
  const candidates = recipes.filter(
    (recipe) =>
      recipe.platform !== 'tiktok' &&
      recipe.sourceUrl
  )

  if (candidates.length === 0) return

  try {
    const apifyRes = await $fetch<any[]>(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyApiToken}&timeout=30`,
      {
        method: 'POST',
        timeout: 35_000,
        body: {
          directUrls: candidates.map((recipe) => recipe.sourceUrl),
          resultsType: 'posts',
          resultsLimit: candidates.length,
        },
      }
    )

    await Promise.all(
      candidates.map(async (recipe, index) => {
        const item = apifyRes[index]
        const freshUrl =
          item?.displayUrl ||
          item?.images?.[0] ||
          item?.childPosts?.[0]?.displayUrl ||
          null

        if (!freshUrl) return

        const embeddedUrl = await downloadThumbnail(freshUrl)
        if (!embeddedUrl) return

        await prisma.recipe.update({
          where: { id: recipe.id },
          data: { thumbnailUrl: embeddedUrl },
        })
      })
    )
  } catch (error) {
    console.warn('[THUMBNAILS] Actualisation Instagram impossible :', error)
  }
}

async function refreshTikTokThumbnails(
  recipes: Array<{ id: string; platform: string; sourceUrl: string; thumbnailUrl: string | null }>,
  apifyApiToken: string
) {
  const candidates = recipes.filter(
    (recipe) =>
      recipe.platform === 'tiktok' &&
      recipe.sourceUrl
  )

  if (candidates.length === 0) return

  try {
    const apifyRes = await $fetch<any[]>(
      `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${apifyApiToken}&timeout=30`,
      {
        method: 'POST',
        timeout: 35_000,
        body: {
          postURLs: candidates.map((recipe) => recipe.sourceUrl),
          resultsPerPage: 1,
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
        },
      }
    )

    await Promise.all(
      candidates.map(async (recipe, index) => {
        const item = apifyRes[index]
        const freshUrl =
          item?.videoMeta?.coverUrl ||
          item?.coverUrl ||
          item?.thumbnailUrl ||
          null

        if (!freshUrl) return

        const embeddedUrl = await downloadThumbnail(freshUrl)
        if (!embeddedUrl) return

        await prisma.recipe.update({
          where: { id: recipe.id },
          data: { thumbnailUrl: embeddedUrl },
        })
      })
    )
  } catch (error) {
    console.warn('[THUMBNAILS] Actualisation TikTok impossible :', error)
  }
}

export default defineEventHandler(async () => {
  const recipes = await prisma.recipe.findMany({
    orderBy: { createdAt: 'desc' },
  })

  const config = useRuntimeConfig()
  if (config.apifyApiToken) {
    await Promise.all([
      refreshInstagramThumbnails(recipes, config.apifyApiToken),
      refreshTikTokThumbnails(recipes, config.apifyApiToken),
    ])

    return await prisma.recipe.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  return recipes
})