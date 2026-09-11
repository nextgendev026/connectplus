-- Subscription plans (3 tiers: free, pro, premium × reader/writer)
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "priceMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceYearly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "features" TEXT NOT NULL,
    "limits" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionPlan_name_key" ON "SubscriptionPlan"("name");
CREATE INDEX "SubscriptionPlan_tier_audience_idx" ON "SubscriptionPlan"("tier", "audience");

-- Active user subscriptions
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "usageThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserSubscription_userId_planId_key" ON "UserSubscription"("userId", "planId");
CREATE INDEX "UserSubscription_userId_idx" ON "UserSubscription"("userId");
CREATE INDEX "UserSubscription_status_idx" ON "UserSubscription"("status");
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Third-party ad slot configuration (Google AdSense, Facebook, etc.)
CREATE TABLE "ThirdPartyAdSlot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scriptTag" TEXT,
    "adUnitId" TEXT,
    "sizes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ThirdPartyAdSlot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ThirdPartyAdSlot_name_key" ON "ThirdPartyAdSlot"("name");
CREATE INDEX "ThirdPartyAdSlot_slot_isActive_idx" ON "ThirdPartyAdSlot"("slot", "isActive");

-- SEO metadata per article
CREATE TABLE "SeoMetadata" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "noIndex" BOOLEAN NOT NULL DEFAULT false,
    "jsonLd" TEXT,
    "customOgTitle" TEXT,
    "customOgDesc" TEXT,
    "customOgImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SeoMetadata_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SeoMetadata_postId_key" ON "SeoMetadata"("postId");
ALTER TABLE "SeoMetadata" ADD CONSTRAINT "SeoMetadata_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default subscription plans
INSERT INTO "SubscriptionPlan" ("id", "name", "displayName", "tier", "audience", "priceMonthly", "priceYearly", "features", "limits", "sortOrder", "createdAt", "updatedAt") VALUES
('plan_reader_free', 'reader-free', 'Free Reader', 'free', 'reader', 0, 0, '["Unlimited reading","Bookmarks","Basic recommendations"]', '{"aiRequestsPerDay":5,"savedPostsMax":50}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_reader_pro', 'reader-pro', 'Pro Reader', 'pro', 'reader', 4.99, 47.88, '["Everything in Free","Ad-free reading","Advanced AI recommendations","Priority support","Offline reading"]', '{"aiRequestsPerDay":50,"savedPostsMax":500}', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_reader_premium', 'reader-premium', 'Premium Reader', 'premium', 'reader', 9.99, 95.88, '["Everything in Pro","Exclusive content access","Early access to features","Direct writer messaging","Custom themes"]', '{"aiRequestsPerDay":200,"savedPostsMax":-1}', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_writer_free', 'writer-free', 'Free Writer', 'free', 'writer', 0, 0, '["Publish up to 5 articles/month","Basic editor","Community engagement"]', '{"postsPerMonth":5,"storageMb":100,"aiRequestsPerDay":10}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_writer_pro', 'writer-pro', 'Pro Writer', 'pro', 'writer', 9.99, 95.88, '["Unlimited publishing","Advanced editor with AI","SEO tools","Analytics dashboard","Custom domain","Monetization"]', '{"postsPerMonth":-1,"storageMb":5000,"aiRequestsPerDay":100}', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_writer_premium', 'writer-premium', 'Premium Writer', 'premium', 'writer', 24.99, 239.88, '["Everything in Pro","Team collaboration","API access","White-label options","Priority review","Revenue share boost"]', '{"postsPerMonth":-1,"storageMb":50000,"aiRequestsPerDay":500}', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
