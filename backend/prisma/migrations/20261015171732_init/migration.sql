-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('new', 'contacted', 'no_answer', 'callback', 'qualified', 'sale', 'refund', 'invalid');

-- CreateEnum
CREATE TYPE "event_source" AS ENUM ('system', 'webhook', 'panel');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'OPERATOR');

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnels" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliates" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_centers" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_count" INTEGER NOT NULL DEFAULT 0,
    "webhook_secret" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "dedup_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "funnel_id" INTEGER NOT NULL,
    "affiliate_id" INTEGER,
    "source" TEXT,
    "campaign" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "status" "lead_status" NOT NULL DEFAULT 'new',
    "status_updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "call_center_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributions" (
    "id" SERIAL NOT NULL,
    "lead_id" UUID NOT NULL,
    "call_center_id" INTEGER NOT NULL,
    "external_id" TEXT,
    "distributed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_events" (
    "id" SERIAL NOT NULL,
    "lead_id" UUID NOT NULL,
    "status" "lead_status" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "event_source" NOT NULL,
    "call_center_id" INTEGER,
    "user_id" INTEGER,
    "external_id" TEXT,
    "applied" BOOLEAN NOT NULL,
    "reason" TEXT,

    CONSTRAINT "lead_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "call_center_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "funnels_product_id_slug_key" ON "funnels"("product_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_code_key" ON "affiliates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "call_centers_slug_key" ON "call_centers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "leads_dedup_key_key" ON "leads"("dedup_key");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "leads_call_center_id_created_at_idx" ON "leads"("call_center_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_status_created_at_idx" ON "leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "leads_product_id_created_at_idx" ON "leads"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "distributions_lead_id_idx" ON "distributions"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_status_events_lead_id_status_occurred_at_key" ON "lead_status_events"("lead_id", "status", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_funnel_id_fkey" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_call_center_id_fkey" FOREIGN KEY ("call_center_id") REFERENCES "call_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_call_center_id_fkey" FOREIGN KEY ("call_center_id") REFERENCES "call_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_events" ADD CONSTRAINT "lead_status_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_events" ADD CONSTRAINT "lead_status_events_call_center_id_fkey" FOREIGN KEY ("call_center_id") REFERENCES "call_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_events" ADD CONSTRAINT "lead_status_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_call_center_id_fkey" FOREIGN KEY ("call_center_id") REFERENCES "call_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras de integridade que o schema do Prisma não declara (escritas à mão).
ALTER TABLE "call_centers" ADD CONSTRAINT "call_centers_weight_check" CHECK ("weight" >= 0);
ALTER TABLE "call_centers" ADD CONSTRAINT "call_centers_assigned_count_check" CHECK ("assigned_count" >= 0);
-- OPERATOR sempre pertence a um call center; ADMIN nunca.
ALTER TABLE "users" ADD CONSTRAINT "users_role_call_center_check"
  CHECK (("role" = 'OPERATOR') = ("call_center_id" IS NOT NULL));
