<script setup lang="ts">
const route = useRoute()
const { data: recipe, error, refresh } = await useFetch<any>(`/api/recipes/${route.params.id}`)

// Suivi local des ingrédients et étapes cochés
const checkedIngredients = ref<Record<number, boolean>>({})
const checkedSteps = ref<Record<number, boolean>>({})

// --- 1. AJUSTEMENT DES PORTIONS ---
const currentServings = ref<number>(2)

watch(
  () => recipe.value,
  (val) => {
    if (val?.servings && val.servings > 0) {
      currentServings.value = val.servings
    }
  },
  { immediate: true }
)

function cleanUnit(unit: string | null | undefined): string {
  if (!unit) return ''
  const u = unit.trim().toLowerCase()
  if (['pièce', 'pièces', 'piece', 'pieces', 'unité', 'unités', 'unite', 'unites'].includes(u)) {
    return ''
  }
  return unit.trim()
}

function formatScaledQuantity(rawQty: string | number | null | undefined): string {
  if (rawQty === null || rawQty === undefined || rawQty === '') return ''
  const str = String(rawQty).trim()

  const baseServings = recipe.value?.servings || 2
  const ratio = currentServings.value / baseServings
  if (ratio === 1) return str

  const fractionMatch = str.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (fractionMatch) {
    const num = parseFloat(fractionMatch[1]!)
    const den = parseFloat(fractionMatch[2]!)
    if (den !== 0) {
      const scaled = (num / den) * ratio
      return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1).replace(/\.0$/, '')
    }
  }

  const normalized = str.replace(',', '.')
  if (!isNaN(Number(normalized)) && normalized !== '') {
    const scaled = parseFloat(normalized) * ratio
    if (scaled >= 10) return String(Math.round(scaled))
    return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1).replace(/\.0$/, '')
  }

  return str
}

const groupedIngredients = computed(() => {
  if (!recipe.value?.ingredients) return {}
  const groups: Record<string, Array<{ item: any; index: number }>> = {}

  recipe.value.ingredients.forEach((item: any, index: number) => {
    const cat = item.category || 'Autres'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push({ item, index })
  })

  return groups
})

// --- 2. MODE CUISINE (Screen Wake Lock) ---
const cookingMode = ref(false)
let wakeLockSentinel: any = null

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return
  try {
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen')
  } catch (err) {
    console.warn('Wake Lock non disponible :', err)
  }
}

async function releaseWakeLock() {
  if (wakeLockSentinel) {
    await wakeLockSentinel.release()
    wakeLockSentinel = null
  }
}

async function toggleCookingMode() {
  cookingMode.value = !cookingMode.value
  if (cookingMode.value) {
    await requestWakeLock()
  } else {
    await releaseWakeLock()
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && cookingMode.value) {
    requestWakeLock()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  releaseWakeLock()
})

// --- 3. ÉDITION & SUPPRESSION ---
const isEditing = ref(false)
const saving = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)

const editForm = ref({
  title: '',
  prepTime: '',
  servings: 2,
  ingredients: [] as Array<{ name: string; quantity: string; unit: string; category: string }>,
  steps: [] as string[],
})

const categoriesList = [
  'Fruits & Légumes',
  'Frais & Crèmerie',
  'Viandes & Poissons',
  'Épicerie',
  'Épices & Condiments',
]

function startEditing() {
  if (!recipe.value) return
  // Copie profonde pour ne pas modifier l'affichage avant sauvegarde
  editForm.value = {
    title: recipe.value.title || '',
    prepTime: recipe.value.prepTime || '',
    servings: recipe.value.servings || 2,
    ingredients: JSON.parse(JSON.stringify(recipe.value.ingredients || [])),
    steps: [...(recipe.value.steps || [])],
  }
  isEditing.value = true
  confirmDelete.value = false
}

function addIngredient() {
  editForm.value.ingredients.push({
    name: '',
    quantity: '',
    unit: '',
    category: 'Épicerie',
  })
}

function removeIngredient(idx: number) {
  editForm.value.ingredients.splice(idx, 1)
}

function addStep() {
  editForm.value.steps.push('')
}

function removeStep(idx: number) {
  editForm.value.steps.splice(idx, 1)
}

async function saveEdits() {
  saving.value = true
  try {
    // Nettoie les lignes vides avant d'envoyer
    const cleanedIngredients = editForm.value.ingredients.filter((i) => i.name.trim() !== '')
    const cleanedSteps = editForm.value.steps.filter((s) => s.trim() !== '')

    await $fetch(`/api/recipes/${route.params.id}`, {
      method: 'PATCH',
      body: {
        title: editForm.value.title.trim() || 'Recette sans titre',
        prepTime: editForm.value.prepTime.trim() || null,
        servings: Number(editForm.value.servings) || 2,
        ingredients: cleanedIngredients,
        steps: cleanedSteps,
      },
    })

    await refresh()
    isEditing.value = false
  } catch (err) {
    console.error('Erreur sauvegarde :', err)
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  deleting.value = true
  try {
    await $fetch(`/api/recipes/${route.params.id}`, { method: 'DELETE' })
    await navigateTo('/')
  } catch (err) {
    console.error('Erreur suppression :', err)
    deleting.value = false
  }
}
</script>

<template>
  <main
    :class="cookingMode ? 'max-w-2xl py-4' : 'max-w-xl py-6'"
    class="mx-auto px-4 pb-24 transition-all"
  >
    <!-- Barre de navigation supérieure -->
    <div class="flex items-center justify-between gap-2 mb-6">
      <NuxtLink to="/" class="inline-flex items-center text-sm text-neutral-400 hover:text-white">
        ← Retour
      </NuxtLink>

      <div v-if="recipe && !isEditing" class="flex items-center gap-2">
        <button
          type="button"
          @click="startEditing"
          class="px-3 py-2 rounded-xl text-xs font-medium bg-neutral-900 text-neutral-300 border border-neutral-800 hover:border-neutral-700 transition"
        >
          Modifier
        </button>

        <button
          type="button"
          @click="toggleCookingMode"
          :class="
            cookingMode
              ? 'bg-emerald-500 text-neutral-950 font-bold shadow-lg shadow-emerald-500/20'
              : 'bg-neutral-900 text-neutral-200 border border-neutral-800 hover:border-neutral-700'
          "
          class="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition"
        >
          <span
            :class="cookingMode ? 'bg-neutral-950 animate-pulse' : 'bg-emerald-500'"
            class="w-2 h-2 rounded-full"
          />
          {{ cookingMode ? 'Mode Cuisine actif' : 'Mode Cuisine' }}
        </button>
      </div>
    </div>

    <div v-if="error || !recipe" class="text-red-400">
      Recette introuvable.
    </div>

    <!-- MODE ÉDITION -->
    <form v-else-if="isEditing" @submit.prevent="saveEdits" class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold">Modifier la recette</h1>
        <button
          type="button"
          @click="isEditing = false"
          class="text-xs text-neutral-400 hover:text-white"
        >
          Annuler
        </button>
      </div>

      <!-- Infos générales -->
      <div class="space-y-3 bg-neutral-900/70 border border-neutral-800 rounded-2xl p-4">
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Titre du plat</label>
          <input
            v-model="editForm.title"
            type="text"
            required
            class="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-neutral-400 mb-1">Temps de préparation</label>
            <input
              v-model="editForm.prepTime"
              type="text"
              placeholder="ex: 25 min"
              class="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label class="block text-xs text-neutral-400 mb-1">Portions de base</label>
            <input
              v-model.number="editForm.servings"
              type="number"
              min="1"
              class="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      <!-- Édition des ingrédients -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-neutral-400">Ingrédients</h2>
          <button
            type="button"
            @click="addIngredient"
            class="text-xs text-emerald-400 hover:underline font-medium"
          >
            + Ajouter un ingrédient
          </button>
        </div>

        <div
          v-for="(ing, idx) in editForm.ingredients"
          :key="idx"
          class="bg-neutral-900/70 border border-neutral-800 rounded-xl p-3 space-y-2"
        >
          <div class="flex gap-2">
            <input
              v-model="ing.quantity"
              type="text"
              placeholder="Qté"
              class="w-16 bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            />
            <input
              v-model="ing.unit"
              type="text"
              placeholder="Unité"
              class="w-16 bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            />
            <input
              v-model="ing.name"
              type="text"
              placeholder="Nom de l'ingrédient"
              class="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              @click="removeIngredient(idx)"
              class="text-neutral-500 hover:text-red-400 px-1.5 text-sm"
              title="Supprimer"
            >
              ✕
            </button>
          </div>

          <select
            v-model="ing.category"
            class="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-emerald-500"
          >
            <option v-for="cat in categoriesList" :key="cat" :value="cat">
              {{ cat }}
            </option>
          </select>
        </div>
      </div>

      <!-- Édition des étapes -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-neutral-400">Étapes</h2>
          <button
            type="button"
            @click="addStep"
            class="text-xs text-emerald-400 hover:underline font-medium"
          >
            + Ajouter une étape
          </button>
        </div>

        <div
          v-for="(_, idx) in editForm.steps"
          :key="idx"
          class="flex gap-2 items-start"
        >
          <span class="text-xs font-bold text-neutral-500 mt-2.5 w-5">{{ idx + 1 }}.</span>
          <textarea
            v-model="editForm.steps[idx]"
            rows="2"
            class="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl p-2.5 text-xs leading-relaxed focus:outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            @click="removeStep(idx)"
            class="text-neutral-500 hover:text-red-400 px-1.5 mt-2 text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Boutons d'action -->
      <div class="flex items-center justify-between pt-4 border-t border-neutral-800">
        <button
          type="button"
          @click="handleDelete"
          :disabled="deleting"
          class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-red-950/60 text-red-400 border border-red-900/80 hover:bg-red-900/60 transition"
        >
          {{ deleting ? 'Suppression...' : confirmDelete ? 'Confirmer la suppression ?' : 'Supprimer la recette' }}
        </button>

        <button
          type="submit"
          :disabled="saving"
          class="px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-neutral-950 transition disabled:opacity-50"
        >
          {{ saving ? 'Enregistrement...' : 'Enregistrer' }}
        </button>
      </div>
    </form>

    <!-- MODE LECTURE -->
    <article v-else>
      <div class="mb-6">
        <div class="flex items-center gap-2 text-xs text-neutral-400 mb-2">
          <span class="uppercase font-bold px-2 py-0.5 rounded bg-neutral-800 text-neutral-200">
            {{ recipe.platform }}
          </span>
          <span v-if="recipe.prepTime">• {{ recipe.prepTime }}</span>
        </div>

        <h1
          :class="cookingMode ? 'text-3xl' : 'text-2xl'"
          class="font-bold leading-snug mb-3 transition-all"
        >
          {{ recipe.title }}
        </h1>

        <a
          v-if="!cookingMode"
          :href="recipe.sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-emerald-400 hover:underline"
        >
          Voir la vidéo originale ↗
        </a>
      </div>

      <!-- Sélecteur de portions -->
      <div class="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-2xl px-4 py-3 mb-6">
        <div>
          <span class="text-sm font-medium text-neutral-200">Portions</span>
          <span
            v-if="currentServings !== (recipe.servings || 2)"
            class="block text-[11px] text-emerald-400"
          >
            Quantités ajustées (base : {{ recipe.servings || 2 }})
          </span>
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            @click="currentServings = Math.max(1, currentServings - 1)"
            :disabled="currentServings <= 1"
            class="w-9 h-9 rounded-xl bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-lg font-bold disabled:opacity-30 transition"
          >
            −
          </button>
          <span class="w-8 text-center font-bold text-base tabular-nums">
            {{ currentServings }}
          </span>
          <button
            type="button"
            @click="currentServings++"
            class="w-9 h-9 rounded-xl bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-lg font-bold transition"
          >
            +
          </button>
        </div>
      </div>

      <!-- Ingrédients triés par catégorie -->
      <section class="mb-8">
        <h2 :class="cookingMode ? 'text-xl' : 'text-lg'" class="font-semibold mb-4">
          Ingrédients
        </h2>

        <div class="space-y-4">
          <div
            v-for="(items, category) in groupedIngredients"
            :key="category"
            class="bg-neutral-900/70 border border-neutral-800 rounded-2xl p-4"
          >
            <h3 class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3">
              {{ category }}
            </h3>

            <ul class="space-y-3">
              <li
                v-for="{ item, index } in items"
                :key="index"
                @click="checkedIngredients[index] = !checkedIngredients[index]"
                class="flex items-center gap-3 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  :checked="!!checkedIngredients[index]"
                  class="w-5 h-5 rounded accent-emerald-500 pointer-events-none shrink-0"
                />
                <span
                  :class="[
                    checkedIngredients[index] ? 'line-through text-neutral-500' : 'text-neutral-200',
                    cookingMode ? 'text-base' : 'text-sm',
                  ]"
                >
                  <strong v-if="item.quantity" class="font-semibold text-white">
                    {{ formatScaledQuantity(item.quantity) }}<template v-if="cleanUnit(item.unit)"> {{ cleanUnit(item.unit) }}</template>
                  </strong>
                  {{ item.name }}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Étapes -->
      <section>
        <h2 :class="cookingMode ? 'text-xl' : 'text-lg'" class="font-semibold mb-4">
          Préparation
        </h2>

        <ol class="space-y-3.5">
          <li
            v-for="(step, idx) in recipe.steps"
            :key="idx"
            @click="checkedSteps[Number(idx)] = !checkedSteps[Number(idx)]"
            :class="[
              checkedSteps[Number(idx)] ? 'opacity-35' : '',
              cookingMode ? 'p-5 border-neutral-700 bg-neutral-900' : 'p-4 border-neutral-800/80 bg-neutral-900/50',
            ]"
            class="flex gap-4 border rounded-2xl cursor-pointer transition"
          >
            <span
              :class="cookingMode ? 'w-7 h-7 text-sm bg-emerald-500/20 text-emerald-400' : 'w-6 h-6 text-xs bg-neutral-800'"
              class="rounded-full font-bold flex items-center justify-center shrink-0 mt-0.5"
            >
              {{ Number(idx) + 1 }}
            </span>
            <p
              :class="cookingMode ? 'text-base leading-relaxed text-white' : 'text-sm leading-relaxed text-neutral-200'"
            >
              {{ step }}
            </p>
          </li>
        </ol>
      </section>
    </article>
  </main>
</template>