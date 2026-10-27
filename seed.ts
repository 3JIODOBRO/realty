import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const seller = await prisma.user.upsert({ where: { email: 'seller@demo.dev' }, update: {}, create: { email: 'seller@demo.dev', name: 'Marina Owner' } });
  await prisma.user.upsert({ where: { email: 'buyer@demo.dev' }, update: {}, create: { email: 'buyer@demo.dev', name: 'Alex Tenant' } });
  await prisma.user.upsert({ where: { email: 'support@demo.dev' }, update: {}, create: { email: 'support@demo.dev', name: 'Nika Support', role: 'SUPPORT' } });

  const listings = [
    { type: 'RENT', title: '2-bedroom apartment with river view', price: 1200, rentPeriod: 'month', areaM2: 74, rooms: 2, address: 'Rua das Flores 18', lat: 38.7101, lng: -9.1432 },
    { type: 'RENT', title: 'Studio near the metro, furnished', price: 750, rentPeriod: 'month', areaM2: 32, rooms: 1, address: 'Av. Almirante Reis 102', lat: 38.7262, lng: -9.1351 },
    { type: 'SALE', title: '3-bedroom family apartment, renovated', price: 389000, areaM2: 118, rooms: 3, address: 'Rua de Campolide 45', lat: 38.7330, lng: -9.1660 },
    { type: 'SALE', title: 'Penthouse with terrace', price: 845000, areaM2: 160, rooms: 4, address: 'Av. da Liberdade 220', lat: 38.7210, lng: -9.1470 },
  ] as const;

  for (const l of listings) {
    await prisma.listing.create({
      data: {
        ...l,
        ownerId: seller.id,
        description: 'Bright, quiet, close to public transport. Documents available on request.',
        city: 'Lisbon',
        currency: 'EUR',
        photos: [],
      },
    });
  }
  console.log('Seeded: seller@demo.dev, buyer@demo.dev, support@demo.dev (use /api/auth/dev-login)');
}

main().finally(() => prisma.$disconnect());
