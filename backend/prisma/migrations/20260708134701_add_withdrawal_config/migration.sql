-- CreateTable
CREATE TABLE "WithdrawalConfig" (
    "id" SERIAL NOT NULL,
    "minWithdrawalAmount" DOUBLE PRECISION NOT NULL DEFAULT 100,
    CONSTRAINT "WithdrawalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalFee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 20.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WithdrawalFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalFee_userId_key" ON "WithdrawalFee"("userId");

-- AddForeignKey
ALTER TABLE "WithdrawalFee" ADD CONSTRAINT "WithdrawalFee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;