import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Analyzing current group memberships (including primary beneficiaries and children)...");
  try {
    const groups = await prisma.beneficiaryGroup.findMany({
      include: {
        _count: {
          select: { 
            members: true,
            childMembers: true
          }
        }
      }
    });

    console.log("Group Membership Counts:");
    console.log("----------------------------------------------------------------");
    console.log(
      String("Group Name").padEnd(40) + " | " + 
      String("Primary Members").padEnd(16) + " | " + 
      String("Child Members").padEnd(14) + " | " +
      "Total"
    );
    console.log("-".repeat(80));
    for (const g of groups) {
      const primaryCount = g._count.members;
      const childCount = g._count.childMembers;
      const total = primaryCount + childCount;
      console.log(
        g.name.padEnd(40) + " | " +
        String(primaryCount).padStart(16) + " | " +
        String(childCount).padStart(14) + " | " +
        total
      );
    }

    // Check for Children under 3 in the 3-6 groups (either in primary members or child members)
    const girlsGroup = await prisma.beneficiaryGroup.findFirst({ where: { name: 'Children below 6(3-6 Years) - Girls' } });
    const boysGroup = await prisma.beneficiaryGroup.findFirst({ where: { name: 'Children below 6(3-6 Years) - Boys' } });

    const calcAge = (dob: Date) => {
      const today = new Date();
      const birth = new Date(dob);
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      return age;
    };

    let girlViolators = 0;
    let boyViolators = 0;

    if (girlsGroup) {
      // check primary members under 3
      const girlPrimary = await prisma.beneficiary.findMany({
        where: { groups: { some: { groupId: girlsGroup.id } } },
        select: { dateOfBirth: true }
      });
      girlViolators += girlPrimary.filter(b => calcAge(b.dateOfBirth) < 3).length;

      // check child members under 3
      const girlChildren = await prisma.beneficiaryChild.findMany({
        where: { childGroups: { some: { groupId: girlsGroup.id } } },
        select: { dateOfBirth: true }
      });
      girlViolators += girlChildren.filter(b => calcAge(b.dateOfBirth) < 3).length;
    }

    if (boysGroup) {
      // check primary members under 3
      const boyPrimary = await prisma.beneficiary.findMany({
        where: { groups: { some: { groupId: boysGroup.id } } },
        select: { dateOfBirth: true }
      });
      boyViolators += boyPrimary.filter(b => calcAge(b.dateOfBirth) < 3).length;

      // check child members under 3
      const boyChildren = await prisma.beneficiaryChild.findMany({
        where: { childGroups: { some: { groupId: boysGroup.id } } },
        select: { dateOfBirth: true }
      });
      boyViolators += boyChildren.filter(b => calcAge(b.dateOfBirth) < 3).length;
    }

    console.log("\nChecking for Children under 3 in 'Children below 6(3-6 Years)' groups:");
    console.log("----------------------------------------------------------------------");
    if (girlViolators === 0 && boyViolators === 0) {
      console.log("Success! No children under 3 years of age are in the 3-6 years groups.");
    } else {
      console.log(`Found violations: ${girlViolators} girls and ${boyViolators} boys under 3.`);
    }

  } catch (e) {
    console.error("Error checking group members:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
