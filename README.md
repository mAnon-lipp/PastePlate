# PastePlate 🍽️

> **Transformez vos vidéos culinaires TikTok et Instagram en fiches recettes structurées, consultables en cuisine d'un seul geste.**

**PastePlate** est une Progressive Web App (PWA) mobile-first conçue pour centraliser, extraire automatiquement et organiser les recettes repérées sur les réseaux sociaux. Grâce à une architecture hybride combinant scraping automatisé et intelligence artificielle multimodale (texte, audio et vidéo), l'application convertit un simple lien de partage en une fiche pratique pensée pour la cuisine.

---

## 🎯 La problématique

Sauvegarder des recettes sur TikTok ou Instagram pose trois problèmes récurrents au moment de passer derrière les fournaux :
1. **L'éparpillement** : les recettes sont noyées dans des favoris disparates entre plusieurs applications.
2. **L'illisibilité en cuisine** : devoir mettre en pause une vidéo toutes les dix secondes avec les mains pleines de farine ou déverrouiller son téléphone toutes les trente secondes rend la préparation pénible.
3. **L'information incomplète** : de nombreux créateurs n'écrivent pas les quantités en description (*« tout est dans la vidéo »*), obligeant à visionner et retranscrire manuellement la voix off ou le texte incrusté à l'écran.

**L'objectif de PastePlate :** supprimer toute friction entre la découverte d'un plat sur mobile et sa réalisation en cuisine.

---

## ✨ Fonctionnalités clés

### 📲 Capture instantanée (Web Share Target)
- **Intégration native au menu « Partager »** : une fois installée sur l'écran d'accueil, l'application apparaît directement dans la feuille de partage Android/iOS depuis TikTok et Instagram.
- **Résolution automatique des liens** : prise en charge des URLs complètes et des liens raccourcis (`vm.tiktok.com`, Reels Instagram) avec système de cache en base pour éviter les doublons.

### 🧠 Extraction IA hybride et multimodale
- **Analyse textuelle intelligente** : nettoyage des hashtags, emojis et timecodes, traduction automatique en français, normalisation des unités et catégorisation des ingrédients (*Fruits & Légumes, Frais & Crèmerie, Viandes & Poissons, Épicerie, Épices & Condiments*).
- **Fallback Vidéo & Audio (Gemini Multimodal)** : si la description ne contient pas la recette, le serveur télécharge temporairement le flux MP4 et le soumet à l'API Gemini pour analyser simultanément la piste audio (voix off) et le flux visuel (texte incrusté à l'écran).
- **Résilience API** : détection dynamique et bascule automatique entre les modèles Gemini disponibles en cas de surcharge serveur.

### 👨‍🍳 Conçue pour la cuisine
- **Mode Cuisine (Screen Wake Lock API)** : empêche le verrouillage automatique de l'écran pendant la préparation et bascule l'interface vers une typographie agrandie à fort contraste.
- **Ajustement dynamique des portions** : recalcul proportionnel en temps réel des quantités (gestion des entiers, décimaux et fractions de type `1/2`).
- **Suivi interactif** : cases à cocher pour suivre les ingrédients rassemblés et les étapes réalisées.

### 🗂️ Bibliothèque & Gestion complète (CRUD)
- **Recherche instantanée** par nom de plat ou par ingrédient disponible dans le frigo.
- **Filtrage par type de recette et durée** (Toutes, Salé, Sucré, moins de 20 minutes).
- **Édition complète et suppression** : modification manuelle des titres, portions, temps de préparation, ingrédients et étapes.

---

## 🛠️ Stack technique

| Couche | Technologies |
| :--- | :--- |
| **Front-end & PWA** | Nuxt 4, Vue 3, TypeScript, Tailwind CSS, `@vite-pwa/nuxt` (Workbox, Web Share Target) |
| **Back-end (Serverless)** | Nitro (preset Vercel), API REST Nuxt (`/api/extract`, `/api/recipes`) |
| **Base de données & ORM** | PostgreSQL (hébergé sur Supabase), Prisma ORM |
| **Extraction & IA** | Google GenAI SDK (Gemini Multimodal & File API), Apify Scrapers, TikWM fallback |
| **Déploiement** | Vercel |

---

## 🏗️ Architecture du pipeline d'extraction

```text
[Partage TikTok / Instagram]
           │
           ▼
   (1) Résolution URL & Vérification du cache PostgreSQL
           │
           ▼
   (2) Extraction métadonnées & sous-titres via Apify
           │
           ├──► Légende / Sous-titres exploitables ? ──► [Gemini : Extraction JSON structurée]
           │
           └──► Légende vide / incomplète ?
                     │
                     ▼
        (3) Récupération flux MP4 direct (Apify / TikWM)
                     │
                     ▼
        (4) Upload temporaire vers Gemini File API
                     │
                     ▼
        (5) Analyse multimodale (Audio + Texte à l'écran) ──► [Nettoyage /tmp & File API]
                     │
                     ▼
        (6) Sauvegarde PostgreSQL (Prisma) & Redirection vers la fiche recette