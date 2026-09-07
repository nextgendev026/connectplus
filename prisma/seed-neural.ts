import type { PrismaClient } from "@prisma/client";

/**
 * Seeds the Neural Mind's shared knowledge base (hive memory) with quality
 * East African context across every area: content topics, entities, intent
 * maps (so chat recognises admin phrasing out of the box) and AI lessons.
 *
 * Safe to re-run: it first deletes memories tagged `"seed":true`, so it never
 * duplicates on repeated seed/feed runs.
 */
export async function seedNeuralMind(prisma: PrismaClient): Promise<number> {
  await prisma.neuralMemory.deleteMany({ where: { metadata: { contains: '"seed":true' } } });

  const topicMemories = [
    { content: "East African fintech: M-Pesa pioneered mobile money, and Nairobi's Silicon Savannah now hosts 200+ startups spanning payments, credit, insurtech and agri-fintech. The region is a global leader in mobile-first financial services.", tags: "fintech,mpesa,mobile-money,nairobi,startup,east-africa" },
    { content: "Agritech in East Africa: startups like Twiga Foods and Apollo Agriculture connect smallholder farmers to markets, credit and inputs, cutting middlemen and raising farm-gate margins across Kenya, Tanzania and Uganda.", tags: "agritech,farming,twiga-foods,logistics,kenya,tanzania" },
    { content: "Bongo flava and gengetone: Tanzania's bongo flava and Kenya's gengetone are the defining youth music movements in East Africa, powered by cheap smartphones, social media and a fiercely local fanbase.", tags: "bongo-flava,gengetone,music,swahili,youth,culture" },
    { content: "Lake Victoria basin economy: fishing, transport and climate adaptation around Lake Victoria (Kenya, Uganda, Tanzania) employ millions; climate change is reshaping fish stocks and lake-side livelihoods.", tags: "lake-victoria,fishing,climate,kenya,uganda,tanzania" },
    { content: "Safari tourism: Kenya's Maasai Mara, Tanzania's Serengeti and Rwanda's gorilla parks anchor East Africa's tourism economy. Sustainable, community-led conservancies are the growth frontier.", tags: "safari,tourism,maasai-mara,serengeti,rwanda,wildlife" },
    { content: "EdTech in East Africa: Eneza Education and M-Shule deliver lessons over SMS and mobile, reaching rural students who lack broadband — proof that low-tech distribution can move learning outcomes.", tags: "edtech,education,mobile,sms,rural,arusha" },
    { content: "Sacco movement: Kenya's savings and credit co-operatives (SACCOS) mobilize billions in grassroots capital and are quietly financing everything from matatus to micro-manufacturing.", tags: "sacco,finance,cooperative,kenya,savings" },
    { content: "Renewable energy: Lake Turkana Wind Power and East Africa's geothermal belt position the region for green baseload power; off-grid solar is electrifying rural homes across the Rift Valley.", tags: "renewable,geothermal,solar,energy,lake-turkana,climate" },
    { content: "Urban transport: Nairobi's matatus and boda bodas are informal transit lifelines. Cashless ticketing and EV boda pilots are the first steps toward modernizing them.", tags: "matatu,bodaboda,transport,nairobi,ev,urban" },
    { content: "Jua kali innovation: Kenya's informal 'jua kali' workshops produce everything from cookers to truck parts — a vast, self-organizing R&D lab that formal programs are finally learning from.", tags: "jua-kali,innovation,informal-economy,manufacturing,kenya" },
  ].map((m, i) => ({
    source: "internal",
    category: "topic",
    content: m.content,
    tags: m.tags,
    confidence: 0.85,
    metadata: JSON.stringify({ seed: true, order: i }),
  }));

  const entityMemories = ([
    ["M-Pesa", "Mobile money platform by Safaricom that made Kenya a global fintech pioneer; M-Pesa handles billions of transactions monthly.", "mpesa,safaricom,mobile-money,fintech"],
    ["Silicon Savannah", "Nickname for Nairobi's tech ecosystem — iHub, M-Pesa, and a startup scene that exports innovation across Africa.", "nairobi,tech-hub,startup,innovation"],
    ["Maasai Mara", "Kenya's flagship wildlife reserve and the site of the Great Migration — the anchor of East African safari tourism.", "safari,wildlife,kenya,tourism"],
    ["Lake Victoria", "Africa's largest lake, shared by Kenya, Uganda and Tanzania — the economic heart of the East African fishing industry.", "lake-victoria,fishing,kenya,uganda,tanzania"],
    ["Zanzibar", "Tanzania's spice island — a cultural crossroads of Swahili, Omani and African heritage and a rising tourism hotspot.", "zanzibar,swahili,tourism,tanzania"],
    ["Kigali Innovation City", "Rwanda's flagship tech hub, positioning Kigali as a continental centre for software and AI talent.", "kigali,rwanda,tech-hub,innovation"],
    ["Jua Kali", "Kenya's informal manufacturing sector — thousands of workshops building hardware with skill, speed and scarce resources.", "jua-kali,manufacturing,informal-economy,kenya"],
    ["Great Migration", "The annual wildebeest migration between the Serengeti and the Maasai Mara — East Africa's greatest wildlife spectacle.", "safari,serengeti,maasai-mara,wildlife"],
    ["Boda boda", "Motorcycle taxis that move people and goods across East Africa — a billion-dollar informal economy in their own right.", "bodaboda,transport,east-africa,informal-economy"],
    ["Safaricom", "Kenya's largest telecom and the company behind M-Pesa — a cornerstone of the region's digital economy.", "safaricom,telecom,mpesa,kenya"],
  ] as [string, string, string][]).map(([name, content, tags], i) => ({
    source: "internal",
    category: "entity",
    content: `${name} — ${content}`,
    tags,
    confidence: 0.9,
    metadata: JSON.stringify({ seed: true, entity: name, order: i }),
  }));

  const intentMaps = ([
    ["system_health", ["how is the platform doing", "is everything ok", "system status", "how are things running", "is the site healthy"]],
    ["trend_query", ["what topics are hot", "what is trending", "what are people reading", "what is buzzing right now"]],
    ["content_analysis", ["analyze the content", "what are the posts about", "content performance", "what topics dominate"]],
    ["user_analysis", ["user growth", "how many users do we have", "who is joining the platform"]],
    ["rewrite_content", ["polish my draft", "rewrite this paragraph", "make my writing better", "improve this text"]],
    ["write_content", ["write a post about", "draft an article", "compose a story", "write me a blog"]],
    ["summarize_content", ["summarize my post", "make an excerpt", "tl dr", "give me a summary"]],
    ["headline_suggest", ["suggest a headline", "title my post", "give me title ideas", "headline for this"]],
    ["tag_suggest", ["suggest tags for my post", "which hashtags", "tag this article", "recommend keywords"]],
    ["outline_suggest", ["outline my post", "structure the article", "plan my story"]],
    ["expand_content", ["continue writing my draft", "extend the article", "add more to this"]],
    ["curate_content", ["what should i write about", "curate content", "give me story ideas", "what topics to publish"]],
  ] as [string, string[]][]).map(([intent, phrases], i) => ({
    source: "ai",
    category: "intent-map",
    content: `intent-map:${intent}`,
    tags: `intent-map,${intent}`,
    confidence: 0.9,
    metadata: JSON.stringify({ seed: true, phrases, order: i }),
  }));

  const lessonMemories = [
    { content: "AI lesson (content): strong East African stories open with a concrete scene or number, name real places and people, and end with a forward-looking take. Specific beats generic every time.", tags: "lesson,writing,content,east-africa", category: "lesson" },
    { content: "AI lesson (platform): connectPlus is a social blogging platform for East African creators — read, write and connect. The admin console controls settings, RSS, moderation and the neural brains.", tags: "lesson,platform,connectplus,admin", category: "lesson" },
    { content: "AI lesson (curation): the audience rewards original angles on fintech, agritech, music and climate — stories that report from the ground instead of recycling press releases.", tags: "lesson,curation,content-strategy,trends", category: "lesson" },
  ].map((m, i) => ({
    source: "ai",
    category: m.category,
    content: m.content,
    tags: m.tags,
    confidence: 0.95,
    metadata: JSON.stringify({ seed: true, order: i }),
  }));

  const seedMemories = [...topicMemories, ...entityMemories, ...intentMaps, ...lessonMemories];
  await prisma.neuralMemory.createMany({ data: seedMemories });
  return seedMemories.length;
}