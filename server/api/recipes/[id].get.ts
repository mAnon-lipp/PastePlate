import { prisma } from "../../utils/prisma"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const recipe = await prisma.recipe.findUnique({
    where: { id },
  })

  if (!recipe) {
    throw createError({ statusCode: 404, statusMessage: 'Recette introuvable' })
  }

  return recipe
})