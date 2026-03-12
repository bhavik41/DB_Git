const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany();
  console.log('PROJECTS:', JSON.stringify(projects, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
