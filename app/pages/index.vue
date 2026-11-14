<script setup lang="ts">
const urlInput = ref('')
const loading = ref(false)
const errorMsg = ref('')

// Recherche et filtres
const searchQuery = ref('')
const selectedPlatform = ref<'all' | 'tiktok' | 'instagram'>('all')

const { data: recipes, refresh } = await useFetch<any[]>('/api/recipes')

const route = useRoute()

// Détection automatique d'un lien partagé depuis TikTok / Instagram (Web Share Target)
onMounted(async () => {
  const sharedRaw = [route.query.url, route.query.text, route.query.title]
    .filter(Boolean)
    .join(' ')

  if (sharedRaw) {
    // Extrait la première URL http(s) trouvée dans le texte partagé
    const urlMatch = sharedRaw.match(/https?:\/\/[^\s]+/)
    if (urlMatch) {
      urlInput.value = urlMatch[0]
      // Nettoie l'URL du navigateur pour éviter de relancer au rafraîchissement
      await navigateTo('/', { replace: true })
      // Lance l'extraction automatiquement
      await handleExtract()
    }
  }
})

const filteredRecipes = computed(() => {
  if (!recipes.value) return []

  return recipes.value.filter((recipe) => {
    // Filtre plateforme
    if (selectedPlatform.value !== 'all' && recipe.platform !== selectedPlatform.value) {
      return false
    }

    // Filtre recherche (titre ou ingrédients)
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return true

    const matchTitle = recipe.title?.toLowerCase().includes(q)
    const matchIngredient = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.some((ing: any) => ing.name?.toLowerCase().includes(q))
      : false

    return matchTitle || matchIngredient
  })
})

async function handleExtract() {
  if (!urlInput.value.trim()) return
  loading.value = true
  errorMsg.value = ''

  try {
    const res = await $fetch<{ recipe: any }>('/api/extract', {
      method: 'POST',
      body: { url: urlInput.value },
    })
    urlInput.value = ''
    await refresh()
    if (res?.recipe?.id) {
      await navigateTo(`/recipe/${res.recipe.id}`)
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || "Erreur lors de l'extraction de la recette."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="max-w-xl mx-auto px-4 py-8">
    <header class="mb-8">
      <h1 class="text-2xl font-bold tracking-tight">PastePlate</h1>
      <p class="text-sm text-neutral-400 mt-1">
        Colle un lien TikTok ou Instagram pour extraire la recette.
      </p>
    </header>

    <!-- Formulaire d'import -->
    <form @submit.prevent="handleExtract" class="space-y-3 mb-8">
      <div class="flex gap-2">
        <input
          v-model="urlInput"
          type="url"
          required
          placeholder="https://www.tiktok.com/... ou instagram.com/reel/..."
          :disabled="loading"
          class="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
        />
        <button
          type="submit"
          :disabled="loading || !urlInput"
          class="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold px-5 py-3 rounded-xl text-sm transition disabled:opacity-50"
        >
          {{ loading ? 'Analyse...' : 'Extraire' }}
        </button>
      </div>

      <p v-if="loading" class="text-xs text-emerald-400 animate-pulse">
        Récupération de la vidéo et structuration des ingrédients par l'IA (5-10s)...
      </p>
      <p v-if="errorMsg" class="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-lg p-3">
        {{ errorMsg }}
      </p>
    </form>

    <!-- Barre de recherche et filtres -->
    <section v-if="recipes?.length" class="space-y-3 mb-6">
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Rechercher un plat ou un ingrédient (ex: poulet, gnocchi)..."
        class="w-full bg-neutral-900/80 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neutral-600"
      />

      <div class="flex gap-2">
        <button
          v-for="tab in [
            { id: 'all', label: 'Toutes' },
            { id: 'tiktok', label: 'TikTok' },
            { id: 'instagram', label: 'Instagram' },
          ]"
          :key="tab.id"
          type="button"
          @click="selectedPlatform = tab.id as any"
          :class="
            selectedPlatform === tab.id
              ? 'bg-neutral-100 text-neutral-950 font-semibold'
              : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'
          "
          class="px-3.5 py-1.5 rounded-lg text-xs transition"
        >
          {{ tab.label }}
        </button>
      </div>
    </section>

    <!-- Bibliothèque de recettes -->
    <section>
      <h2 class="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4">
        Mes recettes ({{ filteredRecipes.length }})
      </h2>

      <div v-if="!recipes?.length" class="text-center py-12 border border-dashed border-neutral-800 rounded-2xl text-neutral-500 text-sm">
        Aucune recette enregistrée pour l'instant.
      </div>

      <div v-else-if="!filteredRecipes.length" class="text-center py-10 text-neutral-500 text-sm">
        Aucune recette ne correspond à ta recherche.
      </div>

      <div v-else class="grid gap-3">
        <NuxtLink
          v-for="recipe in filteredRecipes"
          :key="recipe.id"
          :to="`/recipe/${recipe.id}`"
          class="flex items-center gap-4 bg-neutral-900/70 hover:bg-neutral-900 border border-neutral-800/80 rounded-2xl p-3 transition"
        >
          <img
            v-if="recipe.thumbnailUrl"
            :src="recipe.thumbnailUrl"
            :alt="recipe.title"
            class="w-16 h-16 rounded-xl object-cover bg-neutral-800 shrink-0"
          />
          <div v-else class="w-16 h-16 rounded-xl bg-neutral-800 flex items-center justify-center text-xs text-neutral-500 shrink-0">
            Plat
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">
                {{ recipe.platform }}
              </span>
              <span v-if="recipe.prepTime" class="text-xs text-neutral-400">
                • {{ recipe.prepTime }}
              </span>
            </div>
            <h3 class="font-medium text-neutral-100 truncate">{{ recipe.title }}</h3>
            <p class="text-xs text-neutral-500 mt-0.5">
              {{ Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0 }} ingrédients
            </p>
          </div>
        </NuxtLink>
      </div>
    </section>
  </main>
</template>