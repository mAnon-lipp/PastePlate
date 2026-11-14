import { GoogleGenAI, Type } from '@google/genai'
import { prisma } from "../utils/prisma"

// Helper pour résoudre les liens courts (ex: vm.tiktok.com/xxx -> www.tiktok.com/@user/video/xxx)
async function resolveFinalUrl(rawUrl: string): Promise<string> {
  try {
    const res = await fetch(rawUrl, { method: 'HEAD', redirect: 'follow' })
    const [resolvedUrl] = res.url.split('?')
    const [fallbackUrl] = rawUrl.split('?')
    return resolvedUrl || fallbackUrl || rawUrl
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl
  }
}

export default defineEventHandler(async (event) => {
  const startTotal = Date.now()
  const config = useRuntimeConfig()
  const body = await readBody<{ url?: string }>(event)

  if (!body?.url) {
    throw createError({ statusCode: 400, statusMessage: 'URL manquante.' })
  }

  // 1. Nettoyage et résolution de l'URL
  console.log('[1/5] Résolution de l’URL :', body.url.trim())
  const cleanUrl = await resolveFinalUrl(body.url.trim())
  const isTikTok = cleanUrl.includes('tiktok.com')
  const isInstagram = cleanUrl.includes('instagram.com')

  if (!isTikTok && !isInstagram) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Lien non supporté. Colle un lien TikTok ou Instagram.',
    })
  }

  const platform = isTikTok ? 'tiktok' : 'instagram'
  console.log(`[1/5] URL nettoyée (${platform}) :`, cleanUrl)

  // 2. Vérifier si la recette existe déjà en base
  const existing = await prisma.recipe.findUnique({
    where: { sourceUrl: cleanUrl },
  })
  if (existing) {
    console.log('[CACHE] Recette déjà en base, renvoi immédiat.')
    return { recipe: existing, cached: true }
  }

  // 3. Extraction via Apify
  let caption = ''
  let thumbnailUrl: string | null = null
  const startApify = Date.now()

  try {
    console.log('[2/5] Appel Apify en cours...')
    if (isTikTok) {
      const apifyRes = await $fetch<any[]>(
        `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${config.apifyApiToken}&timeout=45`,
        {
          method: 'POST',
          timeout: 50000, // Timeout client HTTP à 50s
          body: {
            postURLs: [cleanUrl],
            resultsPerPage: 1,
            shouldDownloadVideos: false,
            shouldDownloadCovers: false,
          },
        }
      )
      const item = apifyRes?.[0]
      caption = item?.text || ''
      thumbnailUrl = item?.videoMeta?.coverUrl || null
    } else {
      const apifyRes = await $fetch<any[]>(
        `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${config.apifyApiToken}&timeout=45`,
        {
          method: 'POST',
          timeout: 50000,
          body: {
            username: [cleanUrl],
            resultsLimit: 1,
          },
        }
      )
      const item = apifyRes?.[0]
      caption = item?.caption || ''
      thumbnailUrl = item?.displayUrl || null
    }
    console.log(`[3/5] Apify terminé en ${((Date.now() - startApify) / 1000).toFixed(1)}s | Description : ${caption.length} caractères`)
  } catch (err: any) {
    console.error('[ERREUR APIFY] :', err?.data || err?.message || err)
    throw createError({
      statusCode: 502,
      statusMessage: "Impossible de récupérer les infos de la vidéo (timeout Apify, compte privé ou lien invalide).",
    })
  }

  if (!caption || caption.trim().length < 15) {
    console.warn('[STOP] Description vide ou trop courte :', caption)
    throw createError({
      statusCode: 422,
      statusMessage: "La description est vide ou trop courte (la recette est peut-être uniquement à l'oral dans la vidéo).",
    })
  }

  // 4. Analyse et structuration via Gemini (avec fallback automatique si surcharge 503)
  const startGemini = Date.now()
  let parsed: any = {}

  const prompt = `Extrais la recette de cuisine contenue dans cette description de post ${platform}. 
Ignore tous les hashtags, appels à l'action ("abonne-toi", "like") et emojis superflus.
Traduis en français si nécessaire et normalise les unités (g, ml, cl, càs, càc, pincée).
RÈGLE IMPORTANTE SUR LES UNITÉS : Si un ingrédient se compte à l'unité (ex: 2 œufs, 1 oignon, 3 gousses d'ail), laisse le champ "unit" strictement VIDE (""). N'écris JAMAIS "pièce", "pièces" ou "unité".

Texte brut :
"""
${caption}
"""`

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Nom propre et appétissant du plat' },
        prepTime: { type: Type.STRING, description: 'Temps estimé ex: 20 min' },
        servings: { type: Type.INTEGER, description: 'Nombre de portions (défaut 2)' },
        ingredients: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Nom de l'ingrédient sans quantité" },
              quantity: { type: Type.STRING, description: 'Quantité ex: 200, 1/2, ou vide si au goût' },
              unit: {
                type: Type.STRING,
                description: 'Unité de mesure (g, ml, cl, càs, càc, pincée) ou chaîne VIDE "" si dénombrable (ex: œufs, oignons)',
              },
              category: {
                type: Type.STRING,
                description: 'Catégorie parmi : Fruits & Légumes, Frais & Crèmerie, Viandes & Poissons, Épicerie, Épices & Condiments',
              },
            },
            required: ['name', 'quantity', 'unit', 'category'],
          },
        },
        steps: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Étapes de préparation claires et ordonnées',
        },
      },
      required: ['title', 'prepTime', 'servings', 'ingredients', 'steps'],
    },
  }

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey })

  // Récupération dynamique des modèles Flash disponibles sur ta clé API
  let modelsToTry: string[] = ['gemini-3.8-flash']
  try {
    const pager = await ai.models.list()
    const availableFlash: string[] = []
    for await (const m of pager) {
      const name = m.name?.replace('models/', '') || ''
      if (
        name.includes('flash') &&
        !name.includes('image') &&
        !name.includes('audio') &&
        !name.includes('tts') &&
        !name.includes('thinking') &&
        !name.includes('2.0') &&
        !name.includes('2.5')
      ) {
        availableFlash.push(name)
      }
    }
    if (availableFlash.length > 0) {
      modelsToTry = availableFlash
    }
    console.log('[INFO GEMINI] Modèles Flash détectés sur ton compte :', modelsToTry)
  } catch (listErr) {
    console.warn('[WARN] Impossible de lister les modèles, utilisation de gemini-3.8-flash par défaut.')
  }

  let lastError: any = null

  for (const modelName of modelsToTry) {
    try {
      console.log(`[4/5] Envoi à Gemini (${modelName})...`)
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: generationConfig,
      })

      console.log(`[4/5] Gemini (${modelName}) terminé en ${((Date.now() - startGemini) / 1000).toFixed(1)}s`)
      parsed = JSON.parse(response.text || '{}')
      lastError = null
      break
    } catch (err: any) {
      lastError = err
      console.warn(`[WARN GEMINI] ${modelName} a échoué (${err?.status || err?.message}), test du suivant...`)
      await new Promise((r) => setTimeout(r, 1500)) // Petite pause de 1.5s avant le fallback
    }
  }

  if (lastError) {
    console.error('[ERREUR GEMINI FINALE] :', lastError?.message || lastError)
    throw createError({
      statusCode: 502,
      statusMessage: `Erreur Gemini (${lastError?.status || 'inconnue'}) : ${lastError?.message || 'Serveurs surchargés'}`,
    })
  }

  // 5. Sauvegarde dans PostgreSQL via Prisma
  try {
    console.log('[5/5] Sauvegarde dans PostgreSQL (Supabase)...')
    const recipe = await prisma.recipe.create({
      data: {
        sourceUrl: cleanUrl,
        platform,
        title: parsed.title || 'Recette sans titre',
        prepTime: parsed.prepTime || null,
        servings: parsed.servings || 2,
        thumbnailUrl,
        ingredients: parsed.ingredients || [],
        steps: parsed.steps || [],
      },
    })

    console.log(`[SUCCÈS] Recette enregistrée en ${((Date.now() - startTotal) / 1000).toFixed(1)}s total ! ID :`, recipe.id)
    return { recipe, cached: false }
  } catch (err: any) {
    console.error('[ERREUR PRISMA] :', err)
    throw createError({
      statusCode: 500,
      statusMessage: 'Erreur lors de la sauvegarde en base de données.',
    })
  }
})