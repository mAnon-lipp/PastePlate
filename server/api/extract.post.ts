import { GoogleGenAI, Type } from '@google/genai'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Helper pour résoudre les liens courts (ex: vm.tiktok.com/xxx)
async function resolveFinalUrl(rawUrl: string): Promise<string> {
  try {
    const res = await fetch(rawUrl, { method: 'HEAD', redirect: 'follow' })
    return res.url.split('?')[0] ?? rawUrl.split('?')[0] ?? rawUrl
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl
  }
}

// Helper de secours pour extraire caption + vidéo/images depuis la page embed publique d'Instagram
async function fetchInstagramEmbedFallback(postUrl: string) {
  try {
    const cleanBase = postUrl.replace(/\/$/, '')
    const html = await $fetch<string>(`${cleanBase}/embed/captioned/`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      responseType: 'text',
    })

    const videoMatch = html.match(/"video_url":"([^"]+)"/)
    const videoUrl = videoMatch
      ? videoMatch[1]!.replace(/\\u0026/g, '&').replace(/\\\//g, '/')
      : null

    const captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/)
    const caption = captionMatch
      ? captionMatch[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : ''

    const imgMatch = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/)
    const imageUrl = imgMatch ? imgMatch[1]!.replace(/&amp;/g, '&') : null

    return { videoUrl, caption, imageUrl }
  } catch {
    return { videoUrl: null, caption: '', imageUrl: null }
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

  // 3. Extraction des métadonnées + sous-titres + médias via Apify
  let caption = ''
  let subtitles = ''
  let thumbnailUrl: string | null = null
  let videoUrl: string | null = null
  let imageUrls: string[] = []

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
            shouldDownloadSubtitles: true,
            shouldDownloadCovers: false,
          },
        }
      )
      const item = apifyRes?.[0]

      caption = item?.text || ''
      thumbnailUrl = item?.videoMeta?.coverUrl || null

      // Récupération des sous-titres/transcription vocale si disponibles
      if (Array.isArray(item?.videoMeta?.subtitleLinks) && item.videoMeta.subtitleLinks.length > 0) {
        try {
          const subUrl =
            item.videoMeta.subtitleLinks[0].tiktokLink ||
            item.videoMeta.subtitleLinks[0].downloadLink
          if (subUrl) {
            subtitles = await $fetch<string>(subUrl, { responseType: 'text' })
          }
        } catch (subErr) {
          console.warn('[WARN SUBTITLES] Impossible de lire les sous-titres :', subErr)
        }
      }

      videoUrl =
        item?.mediaUrls?.[0] ||
        item?.videoUrl ||
        item?.videoMeta?.downloadAddr ||
        null
    } else {
      const apifyRes = await $fetch<any[]>(
        `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${config.apifyApiToken}&timeout=45`,
        {
          method: 'POST',
          timeout: 50000,
          body: {
            directUrls: [cleanUrl],
            resultsType: 'posts',
            resultsLimit: 1,
          },
        }
      )
      const item = apifyRes?.[0]

      caption = item?.caption || ''
      thumbnailUrl = item?.displayUrl || item?.images?.[0] || null
      videoUrl =
        item?.videoUrl ||
        item?.video_url ||
        item?.videoPlaybackUrl ||
        item?.childPosts?.find((c: any) => c.videoUrl)?.videoUrl ||
        null

      if (Array.isArray(item?.images) && item.images.length > 0) {
        imageUrls = item.images
      } else if (Array.isArray(item?.childPosts) && item.childPosts.length > 0) {
        imageUrls = item.childPosts.map((c: any) => c.displayUrl).filter(Boolean)
      } else if (item?.displayUrl && !videoUrl) {
        imageUrls = [item.displayUrl]
      }

      // Fallback sur la page embed publique Instagram si Apify n'a rien renvoyé
      if (!caption && !videoUrl && imageUrls.length === 0) {
        console.log('[INSTA FALLBACK] Tentative via la page embed publique...')
        const embedData = await fetchInstagramEmbedFallback(cleanUrl)
        if (embedData.caption) caption = embedData.caption
        if (embedData.videoUrl) videoUrl = embedData.videoUrl
        if (embedData.imageUrl) {
          thumbnailUrl = thumbnailUrl || embedData.imageUrl
          if (!videoUrl) imageUrls = [embedData.imageUrl]
        }
      }

      if (!videoUrl && imageUrls.length === 0 && item) {
        console.warn('[APIFY INSTA DEBUG] Clés reçues :', Object.keys(item))
      }
    }

    console.log(
      `[APIFY RÉSULTAT] Caption: ${caption.length}c | Subtitles: ${subtitles.length}c | VideoURL: ${videoUrl ? 'OK' : 'NULL'} | Images: ${imageUrls.length}`
    )
  } catch (err: any) {
    console.error('[ERREUR APIFY] :', err?.data || err?.message || err)
    throw createError({
      statusCode: 502,
      statusMessage: "Impossible de récupérer le post (compte privé, timeout ou lien invalide).",
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
  const combinedText = [caption, subtitles].filter(Boolean).join('\n\n--- Transcription audio ---\n')

  // 4A. TENTATIVE 1 : Analyse de la description texte + sous-titres automatiques
  if (combinedText.trim().length >= 30) {
    console.log('[GEMINI TEXTE] Analyse de la description et des sous-titres...')
    const textPrompt = `Extrais la recette de cuisine contenue dans ces informations de post ${platform}.
Ignore tous les hashtags, timecodes WebVTT (00:00.000 --> ...), appels à l'action et emojis.
Traduis en français si nécessaire et normalise les unités (g, ml, cl, càs, càc, pincée).
RÈGLE IMPORTANTE SUR LES UNITÉS : Si un ingrédient se compte à l'unité (ex: 2 œufs, 1 oignon), laisse le champ "unit" strictement VIDE (""). N'écris JAMAIS "pièce" ou "unité".
Si le texte ne contient PAS la recette (ex: "la recette est dans la vidéo"), mets "hasRecipe": false.

Texte brut :
"""
${combinedText}
"""`
    try {
      const result = await runGeminiWithFallback(textPrompt)
      if (result?.hasRecipe && Array.isArray(result.ingredients) && result.ingredients.length > 0) {
        parsed = result
      } else {
        console.log('[GEMINI TEXTE] Pas de recette complète dans le texte, bascule vers le média...')
      }
    } catch {
      console.warn('[GEMINI TEXTE] Échec analyse texte, tentative via média...')
    }
  }

  // 4B. TENTATIVE 2 (FALLBACK MULTIMODAL) : Vidéo OU Images (carrousel)
  if (!parsed) {
    // Résolution TikWM si TikTok sans vidéo directe
    if (isTikTok && !videoUrl) {
      try {
        const tikwm = await $fetch<any>('https://www.tikwm.com/api/', {
          method: 'POST',
          body: new URLSearchParams({ url: cleanUrl, hd: '1' }).toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        if (tikwm?.data?.play) {
          videoUrl = tikwm.data.play
        }
      } catch (tikwmErr) {
        console.warn('[WARN TIKWM] Fallback sur videoUrl Apify :', tikwmErr)
      }
    }

    // CAS 1 : On a une vidéo MP4 (TikTok ou Reel/Vidéo Instagram)
    if (videoUrl) {
      console.log('[GEMINI VIDÉO] Téléchargement temporaire du MP4 pour analyse audio/visuelle...')
      const tempFilePath = join(tmpdir(), `pasteplate_${Date.now()}.mp4`)
      let uploadedFile: any = null

      try {
        let directMp4Url = videoUrl
        if (isTikTok) {
          try {
            const tikwm = await $fetch<any>('https://www.tikwm.com/api/', {
              method: 'POST',
              body: new URLSearchParams({ url: cleanUrl, hd: '1' }).toString(),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            })
            if (tikwm?.data?.play) {
              directMp4Url = tikwm.data.play
            }
          } catch {}
        }

        const videoRes = await fetch(directMp4Url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        })

        if (!videoRes.ok) {
          throw new Error(`Échec téléchargement vidéo (${videoRes.status})`)
        }

        const arrayBuffer = await videoRes.arrayBuffer()
        await writeFile(tempFilePath, Buffer.from(arrayBuffer))

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
          statusMessage: `Échec extraction vidéo : ${err?.message || 'erreur inconnue'}`,
        })
      } finally {
        await unlink(tempFilePath).catch(() => {})
        if (uploadedFile?.name) {
          await ai.files.delete({ name: uploadedFile.name }).catch(() => {})
        }
      }
    }
    // CAS 2 : Post photo ou carrousel Instagram (recette écrite sur les images)
    else if (imageUrls.length > 0) {
      console.log(`[GEMINI IMAGES] Analyse de ${imageUrls.length} image(s) du post...`)
      try {
        const imageParts: any[] = []
        for (const imgUrl of imageUrls.slice(0, 6)) {
          const imgRes = await fetch(imgUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          })
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer())
            imageParts.push({
              inlineData: {
                data: buf.toString('base64'),
                mimeType: imgRes.headers.get('content-type') || 'image/jpeg',
              },
            })
          }
        }

        if (imageParts.length === 0) {
          throw new Error('Impossible de télécharger les images du post')
        }

        const imagePrompt = `Lis attentivement le texte présent sur ces images d'un post culinaire ${platform}.
Extrais la recette complète : titre du plat, temps estimé, portions, liste exacte des ingrédients avec leurs quantités et étapes de préparation.
Traduis en français si nécessaire et normalise les unités (g, ml, cl, càs, càc, pincée).
RÈGLE IMPORTANTE SUR LES UNITÉS : Si un ingrédient se compte à l'unité (ex: 2 œufs, 1 oignon), laisse le champ "unit" strictement VIDE (""). N'écris JAMAIS "pièce" ou "unité".
${caption ? `Contexte supplémentaire de la légende : "${caption}"` : ''}`

        parsed = await runGeminiWithFallback([...imageParts, imagePrompt])
      } catch (err: any) {
        console.error('[ERREUR GEMINI IMAGES] :', err?.message || err)
        throw createError({
          statusCode: 502,
          statusMessage: `Échec extraction images : ${err?.message || 'erreur inconnue'}`,
        })
      }
    } else {
      throw createError({
        statusCode: 422,
        statusMessage:
          "Instagram a bloqué l'accès à ce post (compte privé, restriction d'âge ou contenu protégé).",
      })
    }
  }

  if (!parsed || !parsed.ingredients?.length) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Aucune recette détectée dans cette publication.',
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