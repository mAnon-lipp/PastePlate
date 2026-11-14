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
const cookingStepIndex = ref(0)
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
    cookingStepIndex.value = 0
    await requestWakeLock()
  } else {
    await releaseWakeLock()
  }
}

function previousCookingStep() {
  cookingStepIndex.value = Math.max(0, cookingStepIndex.value - 1)
}

function nextCookingStep() {
  const stepsCount = recipe.value?.steps?.length || 1
  cookingStepIndex.value = Math.min(stepsCount - 1, cookingStepIndex.value + 1)
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
    :class="cookingMode ? 'min-h-screen max-w-none bg-dark-canvas text-canvas py-5' : 'max-w-3xl bg-accent-strong/90 py-8'"
    class="mx-auto min-h-screen px-5 pb-10 transition-all sm:px-8"
  >
    <div class="relative mb-8 flex items-center justify-between gap-3">
      <NuxtLink
        to="/"
        class="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-4xl leading-none text-ink transition hover:scale-105"
        aria-label="Retour à la bibliothèque"
      >
        ‹
      </NuxtLink>

      <div v-if="recipe && !isEditing" class="flex items-center gap-2">
        <button
          type="button"
          @click="startEditing"
          class="rounded-full bg-surface px-7 py-4 text-base font-medium text-ink transition hover:bg-white"
        >
          Modifier
        </button>

        <button
          type="button"
          @click="toggleCookingMode"
          :class="
            cookingMode
              ? 'bg-accent text-ink font-bold'
              : 'bg-surface text-ink hover:bg-white'
          "
          class="hidden rounded-full px-5 py-3 text-sm font-medium transition sm:inline-flex"
        >
          {{ cookingMode ? 'Quitter' : 'Mode cuisine' }}
        </button>
      </div>
    </div>

    <div v-if="error || !recipe" class="rounded-3xl bg-surface p-8 text-center text-danger">
      Recette introuvable.
    </div>

    <!-- MODE ÉDITION -->
    <form v-else-if="isEditing" @submit.prevent="saveEdits" class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold">Modifier la recette</h1>
        <button
          type="button"
          @click="isEditing = false"
          class="text-xs text-muted hover:text-surface"
        >
          Annuler
        </button>
      </div>

      <!-- Infos générales -->
      <div class="space-y-3 rounded-2xl border border-dark-border bg-dark-surface/70 p-4">
        <div>
          <label class="mb-1 block text-xs text-muted">Titre du plat</label>
          <input
            v-model="editForm.title"
            type="text"
            required
            class="field-control w-full"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs text-muted">Temps de préparation</label>
            <input
              v-model="editForm.prepTime"
              type="text"
              placeholder="ex: 25 min"
              class="field-control w-full"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-muted">Portions de base</label>
            <input
              v-model.number="editForm.servings"
              type="number"
              min="1"
              class="field-control w-full"
            />
          </div>
        </div>
      </div>

      <!-- Édition des ingrédients -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Ingrédients</h2>
          <button
            type="button"
            @click="addIngredient"
            class="text-xs font-medium text-accent hover:underline"
          >
            + Ajouter un ingrédient
          </button>
        </div>

        <div
          v-for="(ing, idx) in editForm.ingredients"
          :key="idx"
          class="space-y-2 rounded-xl border border-dark-border bg-dark-surface/70 p-3"
        >
          <div class="flex gap-2">
            <input
              v-model="ing.quantity"
              type="text"
              placeholder="Qté"
              class="field-control w-16 rounded-lg px-2.5 py-1.5 text-xs"
            />
            <input
              v-model="ing.unit"
              type="text"
              placeholder="Unité"
              class="field-control w-16 rounded-lg px-2.5 py-1.5 text-xs"
            />
            <input
              v-model="ing.name"
              type="text"
              placeholder="Nom de l'ingrédient"
              class="field-control flex-1 rounded-lg px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              @click="removeIngredient(idx)"
              class="shrink-0 rounded-lg bg-danger px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-danger/85"
              aria-label="Supprimer cet ingrédient"
              title="Supprimer cet ingrédient"
            >
              Supprimer
            </button>
          </div>

          <select
            v-model="ing.category"
            class="field-control w-full rounded-lg px-2.5 py-1.5 text-xs"
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
          <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Étapes</h2>
          <button
            type="button"
            @click="addStep"
            class="text-xs font-medium text-accent hover:underline"
          >
            + Ajouter une étape
          </button>
        </div>

        <div
          v-for="(_, idx) in editForm.steps"
          :key="idx"
          class="flex gap-2 items-start"
        >
          <span class="mt-2.5 w-5 text-xs font-bold text-muted">{{ idx + 1 }}.</span>
          <textarea
            v-model="editForm.steps[idx]"
            rows="2"
            class="field-control flex-1 rounded-xl p-2.5 text-xs leading-relaxed"
          />
          <button
            type="button"
            @click="removeStep(idx)"
            class="mt-2 px-1.5 text-sm text-muted hover:text-danger"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Boutons d'action -->
      <div class="flex items-center justify-between border-t border-dark-border pt-4">
        <button
          type="button"
          @click="handleDelete"
          :disabled="deleting"
          class="rounded-xl bg-danger px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-danger/85 disabled:opacity-50"
        >
          {{ deleting ? 'Suppression...' : confirmDelete ? 'Confirmer la suppression ?' : 'Supprimer la recette' }}
        </button>

        <button
          type="submit"
          :disabled="saving"
          class="rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-ink transition hover:bg-accent/85 disabled:opacity-50"
        >
          {{ saving ? 'Enregistrement...' : 'Enregistrer' }}
        </button>
      </div>
    </form>

    <!-- MODE LECTURE -->
    <article v-else>
      <div class="mb-8">
        <div v-if="!cookingMode" class="mb-4 flex items-center gap-3 text-base text-canvas">
          <a
            :href="recipe.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-full bg-ink px-5 py-3 font-medium text-canvas transition hover:bg-ink/85"
          >
            Voir sur {{ recipe.platform }}
          </a>
          <span v-if="recipe.prepTime" class="text-muted">{{ recipe.prepTime }}</span>
        </div>

        <div v-else class="flex items-center justify-between text-accent-soft">
          <button type="button" @click="toggleCookingMode" class="rounded-full bg-dark-surface px-6 py-4 font-medium">
            Quitter
          </button>
          <span class="text-base">Écran toujours allumé</span>
        </div>

        <p v-if="cookingMode" class="mt-10 text-lg font-bold uppercase tracking-wider text-accent-soft">
          Étape {{ cookingStepIndex + 1 }} sur {{ recipe.steps?.length || 1 }}
        </p>
        <h1
          :class="cookingMode ? 'mt-10 text-5xl text-canvas sm:text-6xl' : 'text-5xl text-ink sm:text-6xl'"
          class="font-serif font-bold leading-[0.98] transition-all"
        >
          {{ recipe.title }}
        </h1>
      </div>

      <!-- Sélecteur de portions -->
      <div v-if="!cookingMode" class="mb-8 flex items-center justify-between rounded-3xl bg-surface px-6 py-5">
        <div>
          <span class="text-lg font-medium text-ink">Portions</span>
          <span
            v-if="currentServings !== (recipe.servings || 2)"
            class="block text-[11px] text-accent"
          >
            Quantités ajustées (base : {{ recipe.servings || 2 }})
          </span>
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            @click="currentServings = Math.max(1, currentServings - 1)"
            :disabled="currentServings <= 1"
            class="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft/45 text-2xl font-bold text-ink transition hover:bg-border disabled:opacity-30"
          >
            −
          </button>
          <span class="w-8 text-center text-2xl font-bold tabular-nums text-ink">
            {{ currentServings }}
          </span>
          <button
            type="button"
            @click="currentServings++"
            class="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft/45 text-2xl font-bold text-ink transition hover:bg-border"
          >
            +
          </button>
        </div>
      </div>

      <!-- Ingrédients triés par catégorie -->
      <section class="mb-8">
        <div v-if="cookingMode" class="mb-8 h-4 overflow-hidden rounded-full bg-dark-surface">
          <div
            class="h-full rounded-full bg-accent transition-all"
            :style="{ width: `${((cookingStepIndex + 1) / (recipe.steps?.length || 1)) * 100}%` }"
          />
        </div>
        <h2 v-if="!cookingMode" class="mb-4 text-2xl font-bold text-ink">
          Ingrédients
        </h2>

        <div v-if="!cookingMode" class="space-y-4">
          <div
            v-for="(items, category) in groupedIngredients"
            :key="category"
            class="rounded-3xl bg-accent-soft/35 p-5"
          >
            <h3 class="mb-3 text-sm font-bold uppercase tracking-wider text-muted">
              {{ category }}
            </h3>

            <ul class="space-y-3">
              <li
                v-for="{ item, index } in items"
                :key="index"
                @click="checkedIngredients[index] = !checkedIngredients[index]"
                class="flex cursor-pointer select-none items-center gap-3 border-b border-border py-3"
              >
                <input
                  type="checkbox"
                  :checked="!!checkedIngredients[index]"
                  class="pointer-events-none h-6 w-6 shrink-0 rounded accent-accent-strong"
                />
                <span
                  :class="[
                    checkedIngredients[index] ? 'line-through text-muted/70' : 'text-ink',
                    'text-base',
                  ]"
                >
                  <strong v-if="item.quantity" class="font-semibold text-ink">
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
      <section :class="cookingMode ? 'mt-8' : ''">
        <h2 v-if="!cookingMode" class="mb-4 text-2xl font-bold text-ink">Préparation</h2>
        <div v-if="cookingMode && recipe.steps?.length" class="rounded-3xl bg-dark-surface p-6 text-canvas">
          <p class="mb-3 text-lg font-bold uppercase tracking-wider text-accent-soft">Pour cette étape</p>
          <p class="text-2xl">{{ recipe.steps[cookingStepIndex] }}</p>
        </div>

        <ol class="space-y-3.5">
          <li
            v-for="(step, idx) in recipe.steps"
            :key="idx"
            @click="checkedSteps[Number(idx)] = !checkedSteps[Number(idx)]"
            :class="[
              checkedSteps[Number(idx)] ? 'opacity-35' : '',
              cookingMode ? 'hidden' : 'rounded-3xl border-border bg-surface p-5',
            ]"
            class="flex gap-4 border rounded-2xl cursor-pointer transition"
          >
            <span
              class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft/45 text-sm font-bold text-ink"
            >
              {{ Number(idx) + 1 }}
            </span>
            <p
              class="text-base leading-relaxed text-ink"
            >
              {{ step }}
            </p>
          </li>
        </ol>
      </section>

      <button
        v-if="!cookingMode"
        type="button"
        @click="toggleCookingMode"
        class="mt-10 w-full rounded-full bg-ink px-6 py-5 text-xl font-bold text-surface transition hover:bg-ink/85"
      >
        Lancer le mode cuisine
      </button>

      <div v-if="cookingMode" class="mt-16 flex gap-4">
        <button
          type="button"
          @click="previousCookingStep"
          :disabled="cookingStepIndex === 0"
          class="flex-1 rounded-full bg-dark-surface px-5 py-5 text-xl font-bold text-canvas disabled:opacity-40"
        >
          Précédent
        </button>
        <button
          type="button"
          @click="nextCookingStep"
          :disabled="cookingStepIndex >= (recipe.steps?.length || 1) - 1"
          class="flex-1 rounded-full bg-accent px-5 py-5 text-xl font-bold text-ink disabled:opacity-40"
        >
          Suivant
        </button>
      </div>
    </article>
  </main>
</template>