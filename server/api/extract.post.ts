import { GoogleGenAI, Type } from '@google/genai'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Helper pour résoudre les liens courts (ex: vm.tiktok.com/xxx)
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

  // 2. Vérifier le cache en base
  const existing = await prisma.recipe.findUnique({
    where: { sourceUrl: cleanUrl },
  })
  if (existing) {
    return { recipe: existing, cached: true }
  }

  // 3. Extraction des métadonnées + lien vidéo via Apify
  let caption = ''
  let thumbnailUrl: string | null = null
  let videoUrl: string | null = null

  try {
    console.log(`[APIFY] Extraction ${platform} pour :`, cleanUrl)
    if (isTikTok) {
      const apifyRes = await $fetch<any[]>(
        `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${config.apifyApiToken}&timeout=45`,
        {
          method: 'POST',
          timeout: 50000,
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
      // Récupération du lien MP4 direct renvoyé par TikTok/Apify
      videoUrl =
        item?.videoMeta?.downloadAddr ||
        item?.mediaUrls?.[0] ||
        item?.videoUrl ||
        null
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
      videoUrl = item?.videoUrl || null
    }
  } catch (err: any) {
    console.error('[ERREUR APIFY] :', err?.data || err?.message || err)
    throw createError({
      statusCode: 502,
      statusMessage: "Impossible de récupérer la vidéo (compte privé, timeout ou lien invalide).",
    })
  }

  // Configuration commune du schéma JSON Gemini
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey })

  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        hasRecipe: {
          type: Type.BOOLEAN,
          description: 'true si une vraie recette avec des ingrédients est présente, false sinon',
        },
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
      required: ['hasRecipe', 'title', 'prepTime', 'servings', 'ingredients', 'steps'],
    },
  }

  // Détection des modèles Flash disponibles
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
    if (availableFlash.length > 0) modelsToTry = availableFlash
  } catch {}

  async function runGeminiWithFallback(contents: any) {
    let lastErr: any = null
    for (const modelName of modelsToTry) {
      try {
        const res = await ai.models.generateContent({
          model: modelName,
          contents,
          config: generationConfig,
        })
        return JSON.parse(res.text || '{}')
      } catch (err: any) {
        lastErr = err
        console.warn(`[WARN GEMINI] ${modelName} échec (${err?.status || err?.message})`)
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
    throw lastErr
  }

  let parsed: any = null

  // 4A. TENTATIVE 1 : Analyse de la description texte (si assez longue)
  if (caption && caption.trim().length >= 30) {
    console.log('[GEMINI TEXTE] Analyse de la description...')
    const textPrompt = `Extrais la recette de cuisine contenue dans cette description de post ${platform}.
Ignore tous les hashtags, appels à l'action et emojis.
Traduis en français si nécessaire et normalise les unités (g, ml, cl, càs, càc, pincée).
RÈGLE IMPORTANTE SUR LES UNITÉS : Si un ingrédient se compte à l'unité (ex: 2 œufs, 1 oignon), laisse le champ "unit" strictement VIDE (""). N'écris JAMAIS "pièce" ou "unité".
Si le texte ne contient PAS la recette (ex: "la recette est dans la vidéo"), mets "hasRecipe": false.

Texte brut :
"""
${caption}
"""`
    try {
      const result = await runGeminiWithFallback(textPrompt)
      if (result?.hasRecipe && Array.isArray(result.ingredients) && result.ingredients.length > 0) {
        parsed = result
      } else {
        console.log('[GEMINI TEXTE] Pas de recette trouvée dans la légende, bascule vers la vidéo...')
      }
    } catch (err) {
      console.warn('[GEMINI TEXTE] Échec analyse texte, tentative via vidéo...')
    }
  }

  // 4B. TENTATIVE 2 (FALLBACK MULTIMODAL) : Analyse directe de la vidéo + audio
  if (!parsed) {
    if (!videoUrl) {
      throw createError({
        statusCode: 422,
        statusMessage: "Aucune recette trouvée dans la description et flux vidéo inaccessible.",
      })
    }

    console.log('[GEMINI VIDÉO] Téléchargement temporaire du MP4 pour analyse audio/visuelle...')
    const tempFilePath = join(tmpdir(), `pasteplate_${Date.now()}.mp4`)
    let uploadedFile: any = null

    try {
      // Téléchargement du flux vidéo vers /tmp
      const videoRes = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: isTikTok ? 'https://www.tiktok.com/' : 'https://www.instagram.com/',
        },
      })

      if (!videoRes.ok) {
        throw new Error(`Échec téléchargement vidéo (${videoRes.status})`)
      }

      const arrayBuffer = await videoRes.arrayBuffer()
      await writeFile(tempFilePath, Buffer.from(arrayBuffer))

      // Upload vers la File API de Gemini
      console.log('[GEMINI VIDÉO] Envoi du fichier à Gemini...')
      uploadedFile = await ai.files.upload({
        file: tempFilePath,
        config: { mimeType: 'video/mp4' },
      })

      // Attente que Gemini termine l'indexation de la vidéo
      let fileState = await ai.files.get({ name: uploadedFile.name })
      let retries = 0
      while (fileState.state === 'PROCESSING' && retries < 15) {
        await new Promise((r) => setTimeout(r, 2000))
        fileState = await ai.files.get({ name: uploadedFile.name })
        retries++
      }

      if (fileState.state !== 'ACTIVE') {
        throw new Error(`Traitement vidéo Gemini incomplet (${fileState.state})`)
      }

      console.log('[GEMINI VIDÉO] Analyse audio + visuelle en cours...')
      const videoPrompt = `Regarde et écoute attentivement cette vidéo de cuisine ${platform} (lis le texte affiché à l'écran ET écoute la voix off).
Extrais la recette complète : titre du plat, temps estimé, portions, liste exacte des ingrédients avec leurs quantités et étapes de préparation.
Traduis en français si nécessaire et normalise les unités (g, ml, cl, càs, càc, pincée).
RÈGLE IMPORTANTE SUR LES UNITÉS : Si un ingrédient se compte à l'unité (ex: 2 œufs, 1 oignon), laisse le champ "unit" strictement VIDE (""). N'écris JAMAIS "pièce" ou "unité".
${caption ? `Contexte supplémentaire de la légende : "${caption}"` : ''}`

      parsed = await runGeminiWithFallback([
        {
          fileData: {
            fileUri: fileState.uri,
            mimeType: fileState.mimeType,
          },
        },
        videoPrompt,
      ])
    } catch (err: any) {
      console.error('[ERREUR GEMINI VIDÉO] :', err?.message || err)
      throw createError({
        statusCode: 502,
        statusMessage: "Impossible d'extraire la recette depuis la vidéo (flux protégé ou trop lourd).",
      })
    } finally {
      // Nettoyage systématique du fichier local /tmp et du fichier distant chez Gemini
      await unlink(tempFilePath).catch(() => {})
      if (uploadedFile?.name) {
        await ai.files.delete({ name: uploadedFile.name }).catch(() => {})
      }
    }
  }

  if (!parsed || !parsed.ingredients?.length) {
    throw createError({
      statusCode: 422,
      statusMessage: "Aucune recette détectée dans cette vidéo.",
    })
  }

  // 5. Sauvegarde dans PostgreSQL
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

  console.log(`[SUCCÈS] Recette enregistrée en ${((Date.now() - startTotal) / 1000).toFixed(1)}s !`)
  return { recipe, cached: false }
})