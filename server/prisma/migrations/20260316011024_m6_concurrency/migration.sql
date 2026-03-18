-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_headCommitId_fkey" FOREIGN KEY ("headCommitId") REFERENCES "Commit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
