export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{
    title?: string
    prepTime?: string | null
    servings?: number
    ingredients?: any[]
    steps?: string[]
  }>(event)

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID manquant' })
  }

  return await prisma.recipe.update({
    where: { id },
    data: {
      title: body.title,
      prepTime: body.prepTime,
      servings: body.servings ? Number(body.servings) : undefined,
      ingredients: body.ingredients,
      steps: body.steps,
    },
  })
})