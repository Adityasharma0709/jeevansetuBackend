import { PrismaClient } from '@prisma/client'
import data from './india_states_districts.json'

const prisma = new PrismaClient()

function toStateLocationCode(stateId: number) {
  const minDigits = 2
  const numeric = String(stateId)
  const padded = numeric.length >= minDigits ? numeric : numeric.padStart(minDigits, '0')
  return `LC${padded}`
}

async function main() {
  console.log("🌱 Seeding started...")

  for (const state of data) {
    const locationCode = toStateLocationCode(state.id)

    // 1. Insert / Update State
    const createdState = await prisma.state.upsert({
      where: { id: state.id },
      update: {
        name: state.name,
        locationCode
      },
      create: {
        id: state.id,
        name: state.name,
        locationCode
      }
    })

    // 2. Insert Districts (skip duplicates)
    await prisma.district.createMany({
      data: state.districts.map((district: string) => ({
        name: district,
        stateId: createdState.id
      })),
      skipDuplicates: true
    })

    console.log(`âœ… Seeded: ${state.name}`)
  }

  console.log("🌱 Seeding completed")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
