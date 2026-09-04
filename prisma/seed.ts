import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Technology", slug: "technology", icon: "💻" },
  { name: "Culture", slug: "culture", icon: "🎭" },
  { name: "Business", slug: "business", icon: "💼" },
  { name: "Lifestyle", slug: "lifestyle", icon: "🌿" },
  { name: "Sports", slug: "sports", icon: "⚽" },
  { name: "Music", slug: "music", icon: "🎵" },
  { name: "Food", slug: "food", icon: "🍛" },
  { name: "Travel", slug: "travel", icon: "✈️" },
];

const TAGS = [
  "startup", "fintech", "safari", "afrobeats", "sacco", "tech-hub",
  "jua-kali", "bodaboda", "matatu", "swahili", "safari-park",
  "savannah", "innovation", "digital", "youth", "entrepreneur",
  "nollywood", "bongo-flava", "gengetone", "east-africa",
  "culture", "nairobi", "kigali",
];

const USERS = [
  { name: "Amara Ochieng", username: "amara_o", email: "amara@connectplus.io", bio: "Tech journalist covering the Nairobi startup scene. Former engineer at Safaricom.", role: "CREATOR", node: "Nairobi" },
  { name: "Kwame Asante", username: "kwame_a", email: "kwame@connectplus.io", bio: "Culture writer. Exploring the intersection of tradition and modernity across East Africa.", role: "CREATOR", node: "Kampala" },
  { name: "Fatima Hassan", username: "fatima_h", email: "fatima@connectplus.io", bio: "Business analyst and storyteller. Covering fintech revolution in East Africa.", role: "CREATOR", node: "Dar es Salaam" },
  { name: "Brian Kiprop", username: "brian_k", email: "brian@connectplus.io", bio: "Sports journalist. Athletics, football, and everything in between.", role: "CREATOR", node: "Eldoret" },
  { name: "Zainab Mohamed", username: "zainab_m", email: "zainab@connectplus.io", bio: "Food blogger exploring the rich culinary traditions of the Swahili coast.", role: "CREATOR", node: "Mombasa" },
  { name: "Daniel Mugisha", username: "daniel_m", email: "daniel@connectplus.io", bio: "Music producer and writer. Documenting the bongo-flava and gengetone movements.", role: "CREATOR", node: "Kigali" },
  { name: "Admin User", username: "admin", email: "admin@connectplus.io", bio: "Platform administrator.", role: "ADMIN", node: "Nairobi" },
  { name: "Sarah Nyambura", username: "sarah_n", email: "sarah@connectplus.io", bio: "Travel enthusiast. Every hill and valley has a story to tell.", role: "USER", node: "Nakuru" },
  { name: "Ibrahim Osman", username: "ibrahim_o", email: "ibrahim@connectplus.io", bio: "Marine biologist turned writer. The Indian Ocean is my muse.", role: "CREATOR", node: "Mombasa" },
  { name: "Grace Akoth", username: "grace_a", email: "grace@connectplus.io", bio: "Lifestyle and wellness advocate. Yoga, nutrition, and mental health in East Africa.", role: "USER", node: "Kisumu" },
];

const POSTS = [
  {
    title: "Nairobi's Tech Revolution: How the Silicon Savannah is Reshaping Africa's Future",
    slug: "nairobis-tech-revolution",
    content: `The sun rises over Nairobi's skyline, casting a golden glow on the glass towers of Westlands and the bustling streets of the Central Business District. But beneath this familiar panorama, a revolution is brewing — one that's positioning Kenya's capital as the undisputed tech hub of Africa.\n\nFrom the co-working spaces of Kilimani to the innovation labs of the University of Nairobi, a new generation of entrepreneurs is building solutions that speak to Africa's unique challenges. M-Pesa, the mobile money platform that changed the world, was just the beginning.\n\nToday, Nairobi is home to over 200 tech startups, attracting billions in venture capital funding. Companies like Sendy, Lori Systems, and Twiga Foods are solving logistics challenges that have plagued the continent for decades. The city's tech ecosystem employs over 100,000 people directly and countless more indirectly.\n\n"The narrative has changed," says James Mwangi, a prominent venture capitalist. "We're no longer importing solutions. We're building them here, for us, by us."\n\nThe success of the Silicon Savannah has inspired similar movements across the continent. Kampala, Dar es Salaam, and Kigali are all developing their own tech ecosystems, often with Nairobi-based mentorship and investment.\n\nBut challenges remain. Internet connectivity, while improving, is still inconsistent in rural areas. Access to capital remains a barrier for many entrepreneurs, particularly women and those outside major cities. And the regulatory framework, while more supportive than many African nations, still has room for improvement.\n\nDespite these hurdles, the momentum is undeniable. As the sun sets on another day in Nairobi, the glow from countless screens illuminates the city's promise — a future built by Africans, for Africa.`,
    excerpt: "How Kenya's capital became Africa's leading tech hub and what it means for the continent's digital future.",
    authorIndex: 0,
    categorySlug: "technology",
    tags: ["startup", "tech-hub", "innovation", "digital", "east-africa"],
    viewCount: 4523,
    featured: true,
  },
  {
    title: "The Art of Ugali: More Than Just a Meal",
    slug: "art-of-ugali",
    content: `In every East African household, the sound of a wooden spoon hitting the sides of a sufuria signals something fundamental — ugali is being made. But to reduce this staple to mere sustenance would be to miss its profound cultural significance.\n\nUgali is the great equalizer. In the boardrooms of Nairobi and the fishing villages of Lake Victoria, it brings people together. It's the canvas upon which East African cuisine is painted, accompanying nyama choma, sukuma wiki, and countless other dishes.\n\nThe preparation is an art form passed down through generations. The ratio of water to maize flour, the vigorous stirring motion, the timing — each element requires intuition developed over years of practice. A grandmother's hands move with the confidence of decades, while a young cook learns the subtle signals: the change in sound, the shift in texture, the moment when the ugali pulls away from the pot's sides.\n\nDifferent regions have their variations. In Tanzania, ugali tends to be softer. In Kenya, firmer. In parts of Uganda, millet or cassava flour replaces maize, creating a darker, more earthy version. Each variation tells a story of the land, the climate, and the people.\n\nBut ugali is evolving. Young chefs in Nairobi's upscale restaurants are reimagining it — serving it with pesto, using it as a pizza base, or incorporating vegetables for colorful variations. Some call it innovation; others call it sacrilege. Either way, it speaks to ugali's enduring relevance.\n\nIn a world of fast food and instant noodles, ugali remains a reminder that the simplest things are often the most meaningful. It's not just food. It's identity, wrapped in the warmth of community.`,
    excerpt: "Exploring the cultural significance and culinary art behind East Africa's most beloved staple food.",
    authorIndex: 4,
    categorySlug: "food",
    tags: ["swahili", "east-africa", "culture", "safari"],
    viewCount: 3210,
    featured: false,
  },
  {
    title: "Bodaboda Economy: The Backbone of East African Urban Transport",
    slug: "bodaboda-economy",
    content: `They weave through traffic with an almost supernatural agility, their engines creating a distinctive buzz that forms the soundtrack of East African cities. Bodabodas — motorcycle taxis — are far more than a mode of transport. They're an economic lifeline for millions.\n\nIn Kenya alone, an estimated 1.5 million young men earn their living as bodaboda riders. In Uganda, the numbers are even higher. These riders have become the arteries of urban commerce, ferrying everything from people to parcels, from hot meals to building materials.\n\nThe economics are compelling. A young man with limited formal education can purchase a motorcycle through a SACCO (Savings and Credit Cooperative), start earning within days, and potentially support an extended family of ten or more. The daily earnings, while modest by international standards, represent economic freedom for communities where formal employment is scarce.\n\nBut the industry faces significant challenges. Safety concerns are paramount — bodaboda accidents account for a significant proportion of road injuries across the region. Insurance is rare, and the lack of formal regulation creates a Wild West environment in many cities.\n\nInnovations are emerging. Digital platforms like SafeBoda in Uganda and Sendy in Kenya are bringing technology to the sector, offering insurance, training, and structured earning opportunities. Some cooperatives are exploring electric motorcycles, addressing both environmental concerns and the volatile cost of fuel.\n\nThe bodaboda economy represents a broader truth about East Africa: when formal systems fail, informal innovation fills the gap. It's messy, it's imperfect, but it works.`,
    excerpt: "How motorcycle taxis became the backbone of urban transport and commerce across East Africa.",
    authorIndex: 3,
    categorySlug: "business",
    tags: ["bodaboda", "sacco", "entrepreneur", "east-africa"],
    viewCount: 2845,
    featured: false,
  },
  {
    title: "Gengetone: The Sound of Nairobi's Streets",
    slug: "gengetone-sound",
    content: `The bass hits different in the city. That's the first thing you notice about gengetone — it's music designed for the streets, born from the concrete and chaos of Nairobi's informal settlements.\n\nBorn in the early 2010s in the estates of Eastlands — Embakasi, Donholm, Umoja — gengetone fuses hip-hop, dancehall, and the raw energy of urban Kenya. The name itself, a portmanteau of "genre" and "getone" (get on it), speaks to its grassroots origins.\n\nGroups like Sailors Gang, Ochungulo Family, and Ethic became the movement's early pioneers, creating music that was unapologetically Nairobi. Their lyrics, often in Sheng (the city's creole language), spoke to the reality of young people navigating the complexities of urban life — hustle, love, ambition, and survival.\n\nThe music industry initially dismissed gengetone. Radio stations refused to play it, citing explicit content and low production quality. But the youth spoke through their phones, streaming tracks on YouTube and sharing them on WhatsApp. By 2018, gengetone had become the dominant sound of Nairobi's youth.\n\nToday, the genre has evolved. Artists like Otile Brown, Mejja, and Xenia Manjeng have polished the sound while maintaining its street credibility. Collaborations with mainstream artists have brought gengetone to continental audiences, with tracks amassing hundreds of millions of views.\n\nMore importantly, gengetone has created an economic ecosystem. Producers, sound engineers, dancers, content creators — the industry supports thousands of young creatives. The genre has proven that commercial success and cultural authenticity are not mutually exclusive.\n\nAs Nairobi's skyline continues to evolve, gengetone remains the soundtrack of the streets below — raw, real, and relentlessly forward-looking.`,
    excerpt: "The story of how Nairobi's streets created Africa's most exciting music movement.",
    authorIndex: 5,
    categorySlug: "music",
    tags: ["gengetone", "afrobeats", "digital", "youth", "nairobi"],
    viewCount: 5120,
    featured: true,
  },
  {
    title: "Safari Reimagined: Sustainable Tourism in the Serengeti",
    slug: "safari-reimagined",
    content: `The Great Migration is one of Earth's most spectacular natural events — over two million wildebeest, zebras, and gazelles thundering across the Serengeti-Mara ecosystem. But how we experience this wonder is changing.\n\nA new wave of eco-conscious safari operators is reimagining what it means to witness Africa's wildlife. Gone are the days of large groups in diesel-guzzling vehicles. In their place: small-group experiences, solar-powered camps, and community-led conservation.\n\n"These aren't just tourist operations anymore," explains Dr. Sarah Kimani, a conservation biologist working in the Serengeti. "They're partnerships between tourism, conservation, and local communities."\n\nThe numbers support this shift. Community conservancies in Kenya and Tanzania now manage millions of acres of wildlife habitat, funded primarily by tourism revenue. When Maasai warriors become rangers and village elders become lodge managers, conservation becomes a shared responsibility.\n\nTechnology plays an increasingly important role. GPS tracking of wildlife helps manage visitor flow, reducing disturbance during sensitive periods. Virtual reality experiences are being developed for those who cannot physically visit, extending conservation messaging to global audiences.\n\nThe COVID-19 pandemic accelerated many of these changes. With tourism revenue frozen, communities were forced to innovate. Some turned to carbon credit programs. Others developed cultural tourism experiences that didn't depend on wildlife viewing.\n\nThe future of safari lies in this balance — between experience and preservation, between tourism revenue and community empowerment. The Serengeti's ancient rhythms continue, but our role as witnesses is evolving to become one of active participants in conservation.`,
    excerpt: "How eco-tourism and community partnerships are transforming the African safari experience.",
    authorIndex: 7,
    categorySlug: "travel",
    tags: ["safari", "safari-park", "innovation", "east-africa"],
    viewCount: 3890,
    featured: false,
  },
  {
    title: "Kenya's SACCO Revolution: Democratizing Finance",
    slug: "kenyas-sacco-revolution",
    content: `Long before Silicon Valley coined the term "fintech," Kenya's SACCOs were quietly revolutionizing financial inclusion. These Savings and Credit Cooperatives have become the backbone of grassroots economic empowerment across East Africa.\n\nThe concept is elegantly simple: community members pool their savings, lending to each other at rates far lower than commercial banks. What began as informal chamas (community savings groups) has evolved into a sophisticated financial ecosystem.\n\nKenya now has over 170 registered SACCOs, serving more than 6 million members. Combined assets exceed KES 1 trillion. These institutions provide everything from vehicle financing to housing loans, from business credit to education funding.\n\n"I tried getting a loan from three banks," says Martha Wanjiku, a small trader in Wakulima Market. "They wanted collateral I didn't have. My SACCO gave me a loan within a week, based on my savings history."\n\nTechnology is transforming the sector. Digital platforms now allow members to save, borrow, and repay via mobile phones. Some SACCOs have integrated with M-Pesa, enabling real-time transactions. Others are exploring blockchain for transparent record-keeping.\n\nThe challenges are real. Governance issues have plagued some cooperatives, and regulatory oversight, while improving, remains uneven. Competition from mobile lenders like M-Shwari and Tala has forced SACCOs to innovate or risk irrelevance.\n\nBut the fundamental proposition remains powerful. In a continent where over 60% of adults lack access to formal banking, SACCOs offer something banks cannot: community trust. And trust, it turns out, is the most valuable currency of all.`,
    excerpt: "How grassroots savings cooperatives are transforming financial inclusion across East Africa.",
    authorIndex: 2,
    categorySlug: "business",
    tags: ["sacco", "fintech", "innovation", "entrepreneur", "east-africa"],
    viewCount: 2670,
    featured: false,
  },
  {
    title: "The Rise of Matatu Culture: Art on Wheels",
    slug: "rise-of-matatu-culture",
    content: `If you want to understand Nairobi, ride a matatu. These brightly decorated minibuses are more than public transport — they're mobile canvases, rolling galleries, and cultural institutions all rolled into one.\n\nMatatu culture, or "matatu art," began in the 1980s when operators started decorating their vehicles to attract passengers. What started as simple slogans and neon lights has evolved into an art form that rivals any gallery.\n\nToday's matatus are rolling masterpieces. Airbrush portraits of pop culture icons, intricate graffiti-style murals, booming sound systems, and LED screens create an experience that transforms a simple commute into a cultural event. The best matatu artists charge premium rates, and their work is recognized internationally.\n\n"The matatu is the people's gallery," explains artist Kevin Ochieng, who has been painting matatus for over a decade. "When I paint a bus, I'm not just decorating it. I'm telling the story of the community it serves."\n\nEach matatu route has its own identity. The 33/33 from the CBD to Eastlands is known for its hip-hop themed vehicles. The 14 from Westlands to the airport tends toward corporate sophistication. These identities are shaped by the communities they serve and the operators who commission them.\n\nThe industry faces modernization pressures. The government's push for new mass transit systems threatens the traditional matatu model. Electric buses are beginning to appear, raising questions about how traditional art will adapt to new vehicle forms.\n\nBut the culture persists. In matatu stages across Nairobi, you can witness a living art tradition — one that moves, literally and figuratively, with the heartbeat of the city.`,
    excerpt: "Exploring Nairobi's iconic matatu art tradition and its role in urban cultural identity.",
    authorIndex: 0,
    categorySlug: "culture",
    tags: ["matatu", "nairobi", "digital", "youth", "east-africa"],
    viewCount: 3450,
    featured: false,
  },
  {
    title: "Kigali's Tech Transformation: Rwanda's Digital Leap",
    slug: "kigalis-tech-transformation",
    content: `Kigali is clean, organized, and increasingly digital. Rwanda's capital has become a model for how African cities can embrace technology while maintaining cultural identity.\n\nThe country's Vision 2050 strategy places technology at the center of economic transformation. From drone delivery corridors to IoT-enabled street lighting, Kigali is a living laboratory for smart city innovation.\n\nThe flagship initiative is the Kigali Innovation City, a $2 billion project that aims to create Africa's premier technology hub. The campus, still under development, will house tech companies, universities, and research institutions.\n\n"We're not trying to be the next Silicon Valley," says Paula Ingabire, Rwanda's Minister of ICT. "We're building something uniquely African — a tech ecosystem that solves African problems."\n\nEarly results are promising. Rwanda has one of Africa's highest internet penetration rates. The government's e-governance platform allows citizens to access most public services digitally. The country's drone delivery network, operated by Zipline, has delivered over 300,000 medical supplies to remote areas.\n\nThe mobile money revolution continues to gain momentum. While M-Pesa dominates in Kenya, Rwanda has developed its own ecosystem, with platforms like MTN MoMo and Airtel Money facilitating everything from utility payments to cross-border remittances.\n\nEducation is a key focus. Coding bootcamps, tech hubs, and university programs are producing a new generation of Rwandan tech talent. Organizations like Andela and Gebeya are training developers who work for companies across the globe.\n\nChallenges remain. Access to venture capital is limited compared to Nairobi. The regulatory environment, while supportive, can be bureaucratic. And there's a constant tension between innovation and the need to ensure technology benefits all citizens, not just urban elites.\n\nBut the trajectory is clear. Kigali is not just keeping pace with the digital revolution — in many ways, it's leading it.`,
    excerpt: "How Rwanda's capital became Africa's most ambitious smart city experiment.",
    authorIndex: 5,
    categorySlug: "technology",
    tags: ["tech-hub", "innovation", "digital", "kigali", "east-africa"],
    viewCount: 2980,
    featured: false,
  },
];

async function main() {
  console.log("🌱 Seeding connectPlus database...\n");

  // Clean existing data
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.moderationLog.deleteMany();
  await prisma.pageView.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rssArticle.deleteMany();
  await prisma.rssFeed.deleteMany();

  // Create categories
  console.log("📁 Creating categories...");
  const categories: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    const created = await prisma.category.create({ data: cat });
    categories[cat.slug] = created.id;
  }

  // Create tags
  console.log("🏷️  Creating tags...");
  const tagIds: Record<string, string> = {};
  for (const tagName of TAGS) {
    const created = await prisma.tag.create({
      data: { name: tagName, slug: tagName.toLowerCase().replace(/\s+/g, "-") },
    });
    tagIds[tagName] = created.id;
  }

  // Create users
  console.log("👤 Creating users...");
  const password = await hash("Password123!", 12);
  const userIds: string[] = [];
  for (const user of USERS) {
    const created = await prisma.user.create({
      data: { ...user, password },
    });
    userIds.push(created.id);
    console.log(`   ✓ ${user.name} (${user.username})`);
  }

  // Create posts
  console.log("\n📝 Creating posts...");
  for (const post of POSTS) {
    const tagConnections = post.tags.map((t) => ({ id: tagIds[t] }));
    const created = await prisma.post.create({
      data: {
        title: post.title,
        slug: post.slug,
        content: post.content,
        excerpt: post.excerpt,
        authorId: userIds[post.authorIndex],
        categoryId: categories[post.categorySlug],
        tags: { connect: tagConnections },
        viewCount: post.viewCount,
        featured: post.featured,
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        publishedAt: new Date(),
        coverImage: null,
      },
    });
    console.log(`   ✓ ${post.title.slice(0, 50)}...`);
  }

  // Create some comments
  console.log("\n💬 Creating comments...");
  const posts = await prisma.post.findMany({ take: 5 });
  const commentTexts = [
    "This is an amazing article! Really captures the essence of what's happening here.",
    "Great perspective. I'd love to see more coverage on this topic.",
    "As someone living through this, I can confirm every word. Keep writing!",
    "Incredible insights. Shared this with my entire team.",
    "This is why I love connectPlus. Real stories from real people.",
    "Beautifully written. The details really bring the story to life.",
    "Important topic. More people need to read this.",
    "Love the depth of research here. Well done!",
  ];

  for (let i = 0; i < Math.min(posts.length, 5); i++) {
    const comment = await prisma.comment.create({
      data: {
        content: commentTexts[i],
        authorId: userIds[(i + 2) % userIds.length],
        postId: posts[i].id,
      },
    });

    // Add a reply to some comments
    if (i < 3) {
      await prisma.comment.create({
        data: {
          content: commentTexts[(i + 3) % commentTexts.length],
          authorId: userIds[(i + 4) % userIds.length],
          postId: posts[i].id,
          parentId: comment.id,
        },
      });
    }
  }

  // Create some page views for analytics
  console.log("\n📊 Creating analytics data...");
  const cities = ["Nairobi", "Kampala", "Dar es Salaam", "Kigali", "Mombasa"];
  const viewData = [];
  for (let day = 0; day < 30; day++) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    const viewsPerDay = Math.floor(Math.random() * 50) + 20;
    for (let v = 0; v < viewsPerDay; v++) {
      viewData.push({
        postId: posts[Math.floor(Math.random() * posts.length)].id,
        path: "/",
        city: cities[Math.floor(Math.random() * cities.length)],
        country: "Kenya",
        createdAt: date,
      });
    }
  }
  await prisma.pageView.createMany({ data: viewData });

  // Create some pending moderation posts
  console.log("\n🔍 Creating moderation queue...");
  await prisma.post.create({
    data: {
      title: "Why I Think Matatus Should Be Replaced Completely",
      slug: "replace-matatus-opinion",
      content: "This is a controversial opinion piece that challenges the status quo...",
      excerpt: "A provocative take on Nairobi's transport future.",
      authorId: userIds[7],
      status: "DRAFT",
      moderationStatus: "PENDING",
    },
  });
  await prisma.post.create({
    data: {
      title: "Cryptocurrency in East Africa: Scam or Opportunity?",
      slug: "crypto-east-africa",
      content: "The crypto conversation in East Africa is heating up, but are we ready?",
      excerpt: "Examining the cryptocurrency landscape in the region.",
      authorId: userIds[8],
      status: "PUBLISHED",
      moderationStatus: "FLAGGED",
    },
  });

  // RSS Feeds
  console.log("\n📡 Creating RSS feeds...");
  const rssFeeds = [
    { name: "BuzzFeed World", url: "https://www.buzzfeed.com/world.xml", siteUrl: "https://buzzfeed.com", description: "BuzzFeed World News", category: "News" },
    { name: "BBC Africa", url: "http://feeds.bbci.co.uk/news/world/africa/rss.xml", siteUrl: "https://bbc.co.uk/africa", description: "BBC Africa News", category: "News" },
    { name: "Nation Africa", url: "https://nation.africa/rss", siteUrl: "https://nation.africa", description: "Nation Media Group - Kenya's largest media house", category: "News" },
    { name: "Daily Nation", url: "https://nation.africa/rss/kenya", siteUrl: "https://nation.africa/kenya", description: "Daily Nation Kenya", category: "News" },
    { name: "Standard Media", url: "https://www.standardmedia.co.ke/rss", siteUrl: "https://standardmedia.co.ke", description: "The Standard - Kenya", category: "News" },
    { name: "Capital FM Kenya", url: "https://capitalfm.co.ke/feed/", siteUrl: "https://capitalfm.co.ke", description: "Capital FM - Kenya's Top Hit Music Station", category: "Entertainment" },
    { name: "Pulse Kenya", url: "https://www.the-star.co.ke/feed/", siteUrl: "https://the-star.co.ke", description: "The Star Kenya - News and Opinion", category: "News" },
    { name: "TechCabal", url: "https://techcabal.com/feed/", siteUrl: "https://techcabal.com", description: "Africa's leading tech publication", category: "Technology" },
    { name: "Disrupt Africa", url: "https://disrupt-africa.com/feed/", siteUrl: "https://disrupt-africa.com", description: "African tech startup news", category: "Technology" },
    { name: "Nairobi Wire", url: "https://nairobiwire.com/feed/", siteUrl: "https://nairobiwire.com", description: "Nairobi's digital newsroom", category: "News" },
    { name: "HowTo DIY", url: "https://www.instructables.com/rss.xml", siteUrl: "https://instructables.com", description: "DIY projects and tutorials", category: "DIY" },
    { name: "DIY Network", url: "https://www.diynetwork.com/feed", siteUrl: "https://diynetwork.com", description: "DIY Network - Home improvement", category: "DIY" },
    { name: "Lifehacker", url: "https://lifehacker.com/rss", siteUrl: "https://lifehacker.com", description: "Life hacks and DIY tips", category: "DIY" },
    { name: "MakeUseOf", url: "https://www.makeuseof.com/feed/", siteUrl: "https://makeuseof.com", description: "Technology guides and DIY", category: "Technology" },
    { name: "Kampala Gloss", url: "https://www.monitor.co.ug/rss", siteUrl: "https://monitor.co.ug", description: "Daily Monitor - Uganda", category: "News" },
    { name: "New Vision Uganda", url: "https://www.newvision.co.ug/rss", siteUrl: "https://newvision.co.ug", description: "New Vision - Uganda", category: "News" },
    { name: "The Citizen Tanzania", url: "https://www.thecitizen.co.tz/rss", siteUrl: "https://thecitizen.co.tz", description: "The Citizen - Tanzania", category: "News" },
    { name: "Rwanda Today", url: "https://www.newtimes.co.rw/rss", siteUrl: "https://newtimes.co.rw", description: "The New Times - Rwanda", category: "News" },
  ];

  for (const feed of rssFeeds) {
    await prisma.rssFeed.create({ data: feed });
  }
  console.log(`   ✓ ${rssFeeds.length} RSS feeds created`);

  console.log("\n✅ Seed completed successfully!");
  console.log(`   ${USERS.length} users, ${POSTS.length + 2} posts, ${CATEGORIES.length} categories, ${TAGS.length} tags, ${rssFeeds.length} RSS feeds`);
  console.log("   Default password: Password123!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
