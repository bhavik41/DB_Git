const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user found');
    process.exit(1);
  }
  const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
  console.log(`TOKEN:${token}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
