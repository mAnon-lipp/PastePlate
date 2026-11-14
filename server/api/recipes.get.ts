import { prisma } from "../utils/prisma"

export default defineEventHandler(async () => {
  return await prisma.recipe.findMany({
    orderBy: { createdAt: 'desc' },
  })
})