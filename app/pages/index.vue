<script setup lang="ts">
const urlInput = ref('')
const urlInputEl = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const failedImages = ref<Set<string>>(new Set())

function markImageFailed(recipeId: string) {
  failedImages.value = new Set([...failedImages.value, recipeId])
}

// Recherche et filtres
const searchQuery = ref('')
const selectedPlatform = ref<'all' | 'tiktok' | 'instagram'>('all')
const selectedTaste = ref<'all' | 'savory' | 'sweet'>('all')
type DurationFilter = 'all' | 'under15' | '15to30' | '30to60' | 'over60'
const selectedDuration = ref<DurationFilter>('all')

const { data: recipes, refresh } = await useFetch<any[]>('/api/recipes')

const route = useRoute()

const sweetTerms = [
  'sucre',
  'chocolat',
  'caramel',
  'gateau',
  'gâteau',
  'dessert',
  'cookie',
  'muffin',
  'brownie',
  'tarte',
  'pancake',
  'crepe',
  'crêpe',
  'gaufre',
  'compote',
  'confiture',
  'miel',
  'vanille',
  'fraise',
  'framboise',
  'patisserie',
  'pâtisserie',
  'nutella',
  'blondies'
]
const savoryTerms = [
  'sel',
  'poivre',
  'poulet',
  'boeuf',
  'bœuf',
  'porc',
  'saumon',
  'thon',
  'viande',
  'poisson',
  'jambon',
  'lard',
  'fromage',
  'pate',
  'pâtes',
  'riz',
  'pomme de terre',
  'oignon',
  'ail',
  'tomate',
  'courgette',
  'salade',
  'soupe',
  'quiche',
  'pizza',
]

function normalizedText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function recipeTaste(recipe: any): 'savory' | 'sweet' | 'unknown' {
  const ingredientText = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
        .map((ingredient: any) =>
          typeof ingredient === 'string'
            ? ingredient
            : `${ingredient?.name || ''} ${ingredient?.category || ''}`
        )
        .join(' ')
    : ''
  const titleText = normalizedText(recipe.title)
  const ingredients = normalizedText(ingredientText)
  const score = (terms: string[], text: string) =>
    terms.filter((term) => text.includes(normalizedText(term))).length
  const sweetScore = score(sweetTerms, titleText) * 2 + score(sweetTerms, ingredients)
  const savoryScore = score(savoryTerms, titleText) * 2 + score(savoryTerms, ingredients)

  if (sweetScore === savoryScore) return 'unknown'
  return sweetScore > savoryScore ? 'sweet' : 'savory'
}

function recipeDurationMinutes(value: unknown): number | null {
  const text = normalizedText(value).replace(',', '.')
  if (!text) return null

  const compactHours = text.match(/(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2}))?\b/)
  if (compactHours) {
    return Number(compactHours[1]) * 60 + Number(compactHours[2] || 0)
  }

  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:heure|heures)\b/)
  const minutes = text.match(/(\d+)\s*(?:min|minute|minutes)\b/)
  if (hours || minutes) {
    return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
  }

  const number = text.match(/\b(\d+)\b/)
  return number ? Number(number[1]) : null
}

function matchesDurationFilter(value: unknown): boolean {
  if (selectedDuration.value === 'all') return true

  const duration = recipeDurationMinutes(value)
  if (duration === null) return false

  switch (selectedDuration.value) {
    case 'under15':
      return duration < 15
    case '15to30':
      return duration >= 15 && duration < 30
    case '30to60':
      return duration >= 30 && duration <= 60
    case 'over60':
      return duration > 60
  }
}

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

    const taste = recipeTaste(recipe)
    if (selectedTaste.value !== 'all' && taste !== 'unknown' && taste !== selectedTaste.value) {
      return false
    }

    if (!matchesDurationFilter(recipe.prepTime)) {
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

function focusUrlInput() {
  urlInputEl.value?.focus()
}
</script>

<template>
  <main class="relative mx-auto min-h-screen max-w-3xl overflow-hidden px-5 py-10 sm:px-8 lg:px-10">
    <div class="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-accent-soft opacity-80" />

    <header class="relative mb-8">
      <p class="mb-2 text-base font-medium text-muted">Ce soir, on cuisine quoi&nbsp;?</p>
      <h1 class="font-serif text-5xl font-bold leading-none tracking-tight text-ink sm:text-6xl">Mes recettes</h1>
    </header>

    <form @submit.prevent="handleExtract" class="relative mb-8 rounded-[2rem] bg-ink p-5 shadow-sm sm:p-7">
      <h2 class="mb-5 text-xl font-bold text-canvas">Importer une vidéo</h2>
      <input
        ref="urlInputEl"
        v-model="urlInput"
        type="url"
        required
        placeholder="Colle un lien TikTok ou Instagram"
        :disabled="loading"
        class="mb-4 w-full rounded-2xl bg-canvas px-5 py-4 text-base text-ink outline-none placeholder:text-muted/70 disabled:opacity-60"
      />
      <BaseButton
        type="submit"
        :disabled="loading || !urlInput"
        size="lg"
        class="w-full rounded-2xl px-5 py-4 text-lg"
      >
        {{ loading ? 'Analyse en cours...' : 'Extraire la recette' }}
      </BaseButton>
      <p v-if="loading" class="mt-4 animate-pulse text-sm text-accent-soft">
        Récupération de la vidéo et structuration de la recette...
      </p>
      <p v-if="errorMsg" class="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
        {{ errorMsg }}
      </p>
    </form>

    <section v-if="recipes?.length" class="relative mb-8 space-y-4">
      <div class="relative">
        <span class="pointer-events-none absolute inset-y-0 left-5 flex items-center text-2xl text-muted/70">⌕</span>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Titre ou ingrédient..."
          class="w-full rounded-full border-2 border-border bg-surface px-14 py-4 text-base text-ink outline-none placeholder:text-muted/70 focus:border-accent-strong"
        />
      </div>

      <div class="flex gap-3 overflow-x-auto pb-1">
        <button
          v-for="tab in [
            { id: 'all', label: 'Tout' },
            { id: 'savory', label: 'Salé' },
            { id: 'sweet', label: 'Sucré' },
          ]"
          :key="tab.id"
          type="button"
          @click="selectedTaste = tab.id as 'all' | 'savory' | 'sweet'"
          :aria-pressed="selectedTaste === tab.id"
          :class="selectedTaste === tab.id ? 'bg-accent-strong text-white' : 'bg-accent-soft/45 text-ink'"
          class="shrink-0 rounded-full px-6 py-3 text-base font-medium transition"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="flex gap-3 overflow-x-auto pb-1">
        <button
          v-for="filter in [
            { id: 'all', label: 'Tous les temps' },
            { id: 'under15', label: '< 15 min' },
            { id: '15to30', label: '15–30 min' },
            { id: '30to60', label: '30–60 min' },
            { id: 'over60', label: '> 1 h' },
          ]"
          :key="filter.id"
          type="button"
          @click="selectedDuration = filter.id as DurationFilter"
          :aria-pressed="selectedDuration === filter.id"
          :class="selectedDuration === filter.id ? 'bg-accent-strong text-white' : 'bg-accent-soft/45 text-ink'"
          class="shrink-0 rounded-full px-5 py-3 text-base transition"
        >
          {{ filter.label }}
        </button>
      </div>
    </section>

    <section class="relative">
      <div v-if="!recipes?.length" class="py-16 text-center">
        <div class="mx-auto mb-8 h-44 w-44 rounded-full bg-accent-soft" />
        <h2 class="font-serif text-4xl font-bold text-ink">Ta bibliothèque est vide</h2>
        <p class="mx-auto mt-4 max-w-md text-lg leading-relaxed text-muted">
          Colle un lien TikTok ou Instagram, on s'occupe du reste.
        </p>
        <button
          type="button"
          @click="focusUrlInput"
          class="mt-8 rounded-full bg-accent-strong px-8 py-4 text-lg font-bold text-white transition hover:bg-accent-strong/85"
        >
          Importer ma première recette
        </button>
      </div>

      <BaseCard v-else-if="!filteredRecipes.length" padding="lg" class="rounded-3xl border-2 border-border text-center text-muted">
        Aucune recette ne correspond à ta recherche.
      </BaseCard>

      <div v-else class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <NuxtLink
          v-for="(recipe, index) in filteredRecipes"
          :key="recipe.id"
          :to="`/recipe/${recipe.id}`"
          class="overflow-hidden rounded-[2rem] bg-surface shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <img
            v-if="recipe.thumbnailUrl && !failedImages.has(recipe.id)"
            :src="recipe.thumbnailUrl.startsWith('data:')
              ? recipe.thumbnailUrl
              : `/api/image?url=${encodeURIComponent(recipe.thumbnailUrl)}`"
            :alt="recipe.title"
            class="h-48 w-full object-cover"
            @error="markImageFailed(recipe.id)"
          />
          <div
            v-else
            :class="index % 2 ? 'bg-accent/80' : 'bg-accent-strong/90'"
            class="h-48 w-full"
          />
          <div class="p-5">
            <h3 class="font-serif text-2xl font-bold leading-tight text-ink">{{ recipe.title }}</h3>
            <p class="mt-3 text-base text-muted">
              {{ recipe.prepTime || 'Durée inconnue' }} · {{ recipe.platform }}
            </p>
          </div>
        </NuxtLink>
      </div>
    </section>
  </main>
</template>