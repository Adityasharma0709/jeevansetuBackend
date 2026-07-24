import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('Querying users with analyst roles...');
  const users = await prisma.user.findMany({
    where: {
      roles: {
        some: {
          role: {
            name: {
              contains: 'analyst',
              mode: 'insensitive'
            }
          }
        }
      }
    },
    include: {
      roles: {
        include: {
          role: true
        }
      }
    }
  });

  console.log(`Found ${users.length} analyst users:`);
  users.forEach((u) => {
    console.log('User:', {
      id: u.id,
      name: u.name,
      email: u.email,
      roles: u.roles.map((ur) => ({
        userRoleId: ur.id,
        roleId: ur.roleId,
        roleName: ur.role.name
      }))
    });
  });
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
