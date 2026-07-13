CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "password" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "labels" TEXT,
  "color" TEXT,
  "word" TEXT,
  "order" INTEGER NOT NULL DEFAULT 100,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Post" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "excerpt" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "imageUrl" TEXT,
  "language" TEXT NOT NULL,
  "translations" TEXT,
  "breaking" BOOLEAN NOT NULL DEFAULT false,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "views" INTEGER NOT NULL DEFAULT 0,
  "aspect" TEXT NOT NULL DEFAULT '16:9',
  "gallery" TEXT,
  "origin" TEXT NOT NULL DEFAULT 'manual',
  "source" TEXT,
  "sourceUrl" TEXT,
  "dedupeKey" TEXT,
  "clearedAt" TIMESTAMP(3),
  "categoryId" TEXT NOT NULL,
  "authorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE INDEX "Category_active_order_idx" ON "Category"("active", "order");
CREATE UNIQUE INDEX "Post_dedupeKey_key" ON "Post"("dedupeKey");
CREATE INDEX "Post_language_categoryId_idx" ON "Post"("language", "categoryId");
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
