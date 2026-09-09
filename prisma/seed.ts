import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { seedNeuralMind } from "./seed-neural.ts";

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
  "culture", "nairobi", "kigali", "climate", "education",
  "health", "ai", "mobile", "blockchain", "renewable",
  "wildlife", "ocean", "mountains", "music", "film",
];

const USERS = [
  { name: "Amara Ochieng", username: "amara_o", email: "amara@connectplus.io", bio: "Tech journalist covering the Nairobi startup scene. Former engineer at Safaricom. I write about code, culture, and the spaces where they collide.", role: "CREATOR", node: "Nairobi", avatar: "https://i.pravatar.cc/300?img=1" },
  { name: "Kwame Asante", username: "kwame_a", email: "kwame@connectplus.io", bio: "Culture writer and photographer. Exploring the intersection of tradition and modernity across East Africa. Words in The Guardian, Al Jazeera.", role: "CREATOR", node: "Kampala", avatar: "https://i.pravatar.cc/300?img=3" },
  { name: "Fatima Hassan", username: "fatima_h", email: "fatima@connectplus.io", bio: "Business analyst and storyteller. Covering the fintech revolution in East Africa. MBA from Strathmore. Former McKinsey.", role: "CREATOR", node: "Dar es Salaam", avatar: "https://i.pravatar.cc/300?img=5" },
  { name: "Brian Kiprop", username: "brian_k", email: "brian@connectplus.io", bio: "Sports journalist based in Eldoret. Athletics, football, rugby, and everything in between. Former 800m runner.", role: "CREATOR", node: "Eldoret", avatar: "https://i.pravatar.cc/300?img=7" },
  { name: "Zainab Mohamed", username: "zainab_m", email: "zainab@connectplus.io", bio: "Food blogger exploring the rich culinary traditions of the Swahili coast. Cookbook author. Spice collector.", role: "CREATOR", node: "Mombasa", avatar: "https://i.pravatar.cc/300?img=9" },
  { name: "Daniel Mugisha", username: "daniel_m", email: "daniel@connectplus.io", bio: "Music producer and cultural critic. Documenting the bongo-flava and gengetone movements from Kigali to Nairobi.", role: "CREATOR", node: "Kigali", avatar: "https://i.pravatar.cc/300?img=11" },
  { name: "Admin", username: "admin", email: "connect@plus.com", bio: "Platform super administrator.", role: "SUPER_ADMIN", node: "Nairobi", avatar: "https://i.pravatar.cc/300?img=12" },
  { name: "Sarah Nyambura", username: "sarah_n", email: "sarah@connectplus.io", bio: "Travel photographer and writer. Every hill and valley has a story to tell. National Geographic contributor.", role: "USER", node: "Nakuru", avatar: "https://i.pravatar.cc/300?img=16" },
  { name: "Ibrahim Osman", username: "ibrahim_o", email: "ibrahim@connectplus.io", bio: "Marine biologist turned writer. The Indian Ocean is my muse. Researcher at Kenya Marine and Fisheries Research Institute.", role: "CREATOR", node: "Mombasa", avatar: "https://i.pravatar.cc/300?img=14" },
  { name: "Grace Akoth", username: "grace_a", email: "grace@connectplus.io", bio: "Lifestyle and wellness advocate. Yoga, nutrition, and mental health in East Africa. Certified nutritionist.", role: "USER", node: "Kisumu", avatar: "https://i.pravatar.cc/300?img=20" },
  { name: "James Odhiambo", username: "james_o", email: "james@connectplus.io", bio: "Climate reporter covering renewable energy and environmental justice across the Lake Victoria basin.", role: "CREATOR", node: "Kisumu", avatar: "https://i.pravatar.cc/300?img=53" },
  { name: "Neema Kimaro", username: "neema_k", email: "neema@connectplus.io", bio: "Education policy researcher. Documenting the EdTech revolution transforming rural schools in Tanzania.", role: "CREATOR", node: "Arusha", avatar: "https://i.pravatar.cc/300?img=25" },
  { name: "Peter Wanjiku", username: "peter_w", email: "peter@connectplus.io", bio: "Blockchain enthusiast and crypto educator. Building the decentralized future in East Africa.", role: "USER", node: "Nairobi", avatar: "https://i.pravatar.cc/300?img=52" },
  { name: "Amina Juma", username: "amina_j", email: "amina@connectplus.io", bio: "Nollywood film critic and entertainment journalist. From Lagos to Nairobi, cinema tells our stories.", role: "CREATOR", node: "Nairobi", avatar: "https://i.pravatar.cc/300?img=26" },
  { name: "David Tumwine", username: "david_t", email: "david@connectplus.io", bio: "Wildlife conservation photographer. Frame by frame, protecting Africa's natural heritage.", role: "CREATOR", node: "Entebbe", avatar: "https://i.pravatar.cc/300?img=57" },
];

interface PostData {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  authorIndex: number;
  categorySlug: string;
  tags: string[];
  viewCount: number;
  featured: boolean;
  coverImage: string;
}

const POSTS: PostData[] = [
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
    coverImage: "https://images.unsplash.com/photo-1611348524140-53c9a25263d6?w=800&h=400&fit=crop",
  },
  {
    title: "The Art of Ugali: More Than Just a Meal",
    slug: "art-of-ugali",
    content: `In every East African household, the sound of a wooden spoon hitting the sides of a sufuria signals something fundamental — ugali is being made. But to reduce this staple to mere sustenance would be to miss its profound cultural significance.\n\nUgali is the great equalizer. In the boardrooms of Nairobi and the fishing villages of Lake Victoria, it brings people together. It's the canvas upon which East African cuisine is painted, accompanying nyama choma, sukuma wiki, and countless other dishes.\n\nThe preparation is an art form passed down through generations. The ratio of water to maize flour, the vigorous stirring motion, the timing — each element requires intuition developed over years of practice.\n\nDifferent regions have their variations. In Tanzania, ugali tends to be softer. In Kenya, firmer. In parts of Uganda, millet or cassava flour replaces maize, creating a darker, more earthy version. Each variation tells a story of the land, the climate, and the people.\n\nBut ugali is evolving. Young chefs in Nairobi's upscale restaurants are reimagining it — serving it with pesto, using it as a pizza base, or incorporating vegetables for colorful variations. Some call it innovation; others call it sacrilege.\n\nIn a world of fast food and instant noodles, ugali remains a reminder that the simplest things are often the most meaningful. It's not just food. It's identity, wrapped in the warmth of community.`,
    excerpt: "Exploring the cultural significance and culinary art behind East Africa's most beloved staple food.",
    authorIndex: 4,
    categorySlug: "food",
    tags: ["swahili", "east-africa", "culture"],
    viewCount: 3210,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=800&h=400&fit=crop",
  },
  {
    title: "Bodaboda Economy: The Backbone of East African Urban Transport",
    slug: "bodaboda-economy",
    content: `They weave through traffic with an almost supernatural agility, their engines creating a distinctive buzz that forms the soundtrack of East African cities. Bodabodas — motorcycle taxis — are far more than a mode of transport. They're an economic lifeline for millions.\n\nIn Kenya alone, an estimated 1.5 million young men earn their living as bodaboda riders. In Uganda, the numbers are even higher. These riders have become the arteries of urban commerce, ferrying everything from people to parcels.\n\nThe economics are compelling. A young man with limited formal education can purchase a motorcycle through a SACCO, start earning within days, and potentially support an extended family of ten or more.\n\nBut the industry faces significant challenges. Safety concerns are paramount — bodaboda accidents account for a significant proportion of road injuries across the region. Insurance is rare, and the lack of formal regulation creates a Wild West environment.\n\nInnovations are emerging. Digital platforms like SafeBoda in Uganda and Sendy in Kenya are bringing technology to the sector, offering insurance, training, and structured earning opportunities.\n\nThe bodaboda economy represents a broader truth about East Africa: when formal systems fail, informal innovation fills the gap.`,
    excerpt: "How motorcycle taxis became the backbone of urban transport and commerce across East Africa.",
    authorIndex: 3,
    categorySlug: "business",
    tags: ["bodaboda", "sacco", "entrepreneur", "east-africa"],
    viewCount: 2845,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&h=400&fit=crop",
  },
  {
    title: "Gengetone: The Sound of Nairobi's Streets",
    slug: "gengetone-sound",
    content: `The bass hits different in the city. That's the first thing you notice about gengetone — it's music designed for the streets, born from the concrete and chaos of Nairobi's informal settlements.\n\nBorn in the early 2010s in the estates of Eastlands — Embakasi, Donholm, Umoja — gengetone fuses hip-hop, dancehall, and the raw energy of urban Kenya.\n\nGroups like Sailors Gang, Ochungulo Family, and Ethic became the movement's early pioneers, creating music that was unapologetically Nairobi. Their lyrics, often in Sheng, spoke to the reality of young people navigating the complexities of urban life.\n\nThe music industry initially dismissed gengetone. Radio stations refused to play it. But the youth spoke through their phones, streaming tracks on YouTube and sharing them on WhatsApp. By 2018, gengetone had become the dominant sound of Nairobi's youth.\n\nToday, the genre has evolved. Artists like Otile Brown, Mejja, and Xenia Manjeng have polished the sound while maintaining its street credibility.\n\nMore importantly, gengetone has created an economic ecosystem. Producers, sound engineers, dancers, content creators — the industry supports thousands of young creatives.`,
    excerpt: "The story of how Nairobi's streets created Africa's most exciting music movement.",
    authorIndex: 5,
    categorySlug: "music",
    tags: ["gengetone", "afrobeats", "digital", "youth", "nairobi"],
    viewCount: 5120,
    featured: true,
    coverImage: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=400&fit=crop",
  },
  {
    title: "Safari Reimagined: Sustainable Tourism in the Serengeti",
    slug: "safari-reimagined",
    content: `The Great Migration is one of Earth's most spectacular natural events — over two million wildebeest, zebras, and gazelles thundering across the Serengeti-Mara ecosystem. But how we experience this wonder is changing.\n\nA new wave of eco-conscious safari operators is reimagining what it means to witness Africa's wildlife. Gone are the days of large groups in diesel-guzzling vehicles. In their place: small-group experiences, solar-powered camps, and community-led conservation.\n\nCommunity conservancies in Kenya and Tanzania now manage millions of acres of wildlife habitat, funded primarily by tourism revenue. When Maasai warriors become rangers and village elders become lodge managers, conservation becomes a shared responsibility.\n\nTechnology plays an increasingly important role. GPS tracking of wildlife helps manage visitor flow. Virtual reality experiences are being developed for those who cannot physically visit.\n\nThe COVID-19 pandemic accelerated many of these changes. With tourism revenue frozen, communities were forced to innovate. Some turned to carbon credit programs. Others developed cultural tourism experiences.\n\nThe future of safari lies in this balance — between experience and preservation, between tourism revenue and community empowerment.`,
    excerpt: "How eco-tourism and community partnerships are transforming the African safari experience.",
    authorIndex: 7,
    categorySlug: "travel",
    tags: ["safari", "safari-park", "innovation", "east-africa"],
    viewCount: 3890,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?w=800&h=400&fit=crop",
  },
  {
    title: "Kenya's SACCO Revolution: Democratizing Finance",
    slug: "kenyas-sacco-revolution",
    content: `Long before Silicon Valley coined the term "fintech," Kenya's SACCOs were quietly revolutionizing financial inclusion. These Savings and Credit Cooperatives have become the backbone of grassroots economic empowerment across East Africa.\n\nKenya now has over 170 registered SACCOs, serving more than 6 million members. Combined assets exceed KES 1 trillion.\n\n"I tried getting a loan from three banks," says Martha Wanjiku, a small trader in Wakulima Market. "They wanted collateral I didn't have. My SACCO gave me a loan within a week, based on my savings history."\n\nTechnology is transforming the sector. Digital platforms now allow members to save, borrow, and repay via mobile phones. Some SACCOs have integrated with M-Pesa, enabling real-time transactions.\n\nThe challenges are real. Governance issues have plagued some cooperatives, and regulatory oversight remains uneven. Competition from mobile lenders like M-Shwari and Tala has forced SACCOs to innovate.\n\nBut the fundamental proposition remains powerful. In a continent where over 60% of adults lack access to formal banking, SACCOs offer something banks cannot: community trust.`,
    excerpt: "How grassroots savings cooperatives are transforming financial inclusion across East Africa.",
    authorIndex: 2,
    categorySlug: "business",
    tags: ["sacco", "fintech", "innovation", "entrepreneur", "east-africa"],
    viewCount: 2670,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=400&fit=crop",
  },
  {
    title: "The Rise of Matatu Culture: Art on Wheels",
    slug: "rise-of-matatu-culture",
    content: `If you want to understand Nairobi, ride a matatu. These brightly decorated minibuses are more than public transport — they're mobile canvases, rolling galleries, and cultural institutions.\n\nMatatu culture began in the 1980s when operators started decorating their vehicles to attract passengers. What started as simple slogans and neon lights has evolved into an art form that rivals any gallery.\n\nToday's matatus are rolling masterpieces. Airbrush portraits of pop culture icons, intricate graffiti-style murals, booming sound systems, and LED screens create an experience that transforms a simple commute.\n\n"The matatu is the people's gallery," explains artist Kevin Ochieng. "When I paint a bus, I'm not just decorating it. I'm telling the story of the community it serves."\n\nEach matatu route has its own identity. The 33/33 from the CBD to Eastlands is known for its hip-hop themed vehicles. The 14 from Westlands to the airport tends toward corporate sophistication.\n\nThe industry faces modernization pressures. The government's push for new mass transit systems threatens the traditional matatu model. Electric buses are beginning to appear.\n\nBut the culture persists. In matatu stages across Nairobi, you can witness a living art tradition — one that moves with the heartbeat of the city.`,
    excerpt: "Exploring Nairobi's iconic matatu art tradition and its role in urban cultural identity.",
    authorIndex: 0,
    categorySlug: "culture",
    tags: ["matatu", "nairobi", "digital", "youth", "east-africa"],
    viewCount: 3450,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=800&h=400&fit=crop",
  },
  {
    title: "Kigali's Tech Transformation: Rwanda's Digital Leap",
    slug: "kigalis-tech-transformation",
    content: `Kigali is clean, organized, and increasingly digital. Rwanda's capital has become a model for how African cities can embrace technology while maintaining cultural identity.\n\nThe country's Vision 2050 strategy places technology at the center of economic transformation. From drone delivery corridors to IoT-enabled street lighting, Kigali is a living laboratory for smart city innovation.\n\n"We're not trying to be the next Silicon Valley," says Paula Ingabire, Rwanda's Minister of ICT. "We're building something uniquely African."\n\nEarly results are promising. Rwanda has one of Africa's highest internet penetration rates. The government's e-governance platform allows citizens to access most public services digitally. The drone delivery network, operated by Zipline, has delivered over 300,000 medical supplies.\n\nEducation is a key focus. Coding bootcamps, tech hubs, and university programs are producing a new generation of Rwandan tech talent.\n\nThe trajectory is clear. Kigali is not just keeping pace with the digital revolution — it's helping to define it.`,
    excerpt: "How Rwanda's capital became Africa's most ambitious smart city experiment.",
    authorIndex: 5,
    categorySlug: "technology",
    tags: ["tech-hub", "innovation", "digital", "kigali", "east-africa"],
    viewCount: 2980,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=800&h=400&fit=crop",
  },
  {
    title: "The Coastal Cuisine of Lamu: A Swahili Food Journey",
    slug: "lamu-coastal-cuisine",
    content: `The old town of Lamu is a labyrinth of coral stone buildings, carved wooden doors, and the persistent scent of cardamom and clove. Here, food isn't just sustenance — it's a living museum of centuries of trade, migration, and cultural fusion.\n\nSwahili cuisine is one of the world's great fusion traditions. Brought together by Indian Ocean trade winds, it blends African, Arab, Indian, and Portuguese influences into something entirely unique.\n\nThe pilau is the crown jewel. Unlike its cousin the biryani, Lamu pilau is a subtle symphony — cinnamon, cardamom, cumin, and black pepper infusing each grain of rice with layers of flavor. The meat, usually goat or beef, is slow-cooked until it yields to the gentlest touch.\n\nThen there's the mahamri — pillowy doughnuts flavored with coconut milk and cardamom, fried golden and dusted with sugar. Served with chai, they're the perfect morning ritual.\n\nThe Mkunazini spice market remains the beating heart of Lamu's food culture. Here, women who have inherited knowledge from generations of spice traders measure out blends that have remained unchanged for centuries.\n\nTourism has brought both opportunity and challenge. While restaurants on the waterfront cater to international palates, the real magic remains in the back alleys — family kitchens where recipes are passed down like sacred texts.`,
    excerpt: "A culinary journey through the ancient Swahili food traditions of Kenya's Lamu archipelago.",
    authorIndex: 4,
    categorySlug: "food",
    tags: ["swahili", "east-africa", "culture", "nairobi"],
    viewCount: 1890,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=800&h=400&fit=crop",
  },
  {
    title: "Climate Warriors: Young East Africans Fighting for the Planet",
    slug: "climate-warriors-east-africa",
    content: `When 19-year-old Elizabeth Wathuti picked up a tree seedling in Kenya's Aberdare Forest, she didn't know she was starting a movement. Today, her Green Generation Foundation has planted over two million trees across East Africa.\n\nYoung climate activists across the region are no longer waiting for permission. They're organizing, innovating, and demanding change on their own terms.\n\nIn Tanzania, 22-year-old Abel Safari has developed a solar-powered water purification system that now serves over 30 rural communities. In Uganda, Vanessa Nakate's school strikes have drawn global attention to the climate crisis.\n\n"I don't see myself as an activist," says Wathuti. "I see myself as someone who doesn't want to inherit a dying planet."\n\nThe science backs their urgency. East Africa is warming 20% faster than the global average. Droughts are more frequent and severe. Lake Chad has shrunk by 90% in 60 years.\n\nThese young people are translating that urgency into action. Tree planting campaigns, clean energy startups, climate education programs, and community adaptation projects are proliferating across the region.\n\nThe challenge is scale. While individual initiatives are impressive, the crisis demands systemic change. That's where these activists are turning their attention — from grassroots projects to policy advocacy.`,
    excerpt: "Meet the young East Africans leading the fight against climate change in their communities.",
    authorIndex: 10,
    categorySlug: "lifestyle",
    tags: ["climate", "east-africa", "youth", "innovation"],
    viewCount: 2150,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800&h=400&fit=crop",
  },
  {
    title: "Kenya's Basketball Boom: From the Streets to the NBA",
    slug: "kenya-basketball-boom",
    content: `The squeak of sneakers on polished concrete echoes through Nairobi's Bahati neighborhood. Here, in a converted warehouse, Kenya's basketball revolution is taking shape.\n\nFive years ago, basketball was a niche sport in Kenya, overshadowed by football and athletics. Today, the Kenya Basketball Federation has over 5,000 registered players, and the sport is growing faster than any other in the country.\n\nThe catalyst was simple: visibility. When the Kenyan national team qualified for the AfroBasket tournament in 2021, the country took notice. Suddenly, basketball was cool.\n\n"The courts in every estate are full now," says coach James Mwangi. "Kids who would have been playing football are picking up basketballs. The energy is incredible."\n\nProfessional leagues are emerging. The Kenya Basketball Premier League now attracts corporate sponsors, and player salaries are becoming competitive with other sports.\n\nThe talent pipeline is growing. Youth academies in Nairobi, Mombasa, and Kisumu are producing players with international potential. Two Kenyan players have already secured scholarships at US colleges.\n\nThe dream, of course, is the NBA. While that remains distant, the foundation is being laid. Every dribble on every neighborhood court is a step toward that future.`,
    excerpt: "How basketball went from obscurity to East Africa's fastest-growing sport.",
    authorIndex: 3,
    categorySlug: "sports",
    tags: ["east-africa", "nairobi", "youth", "innovation"],
    viewCount: 1720,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&h=400&fit=crop",
  },
  {
    title: "The EdTech Revolution Transforming Rural East African Schools",
    slug: "edtech-rural-east-africa",
    content: `In a one-room schoolhouse in rural Tanzania, 40 children sit in front of a battered tablet computer. Their eyes are wide, their attention absolute. On the screen, an animated character teaches them mathematics in Swahili.\n\nThis is the frontline of East Africa's EdTech revolution — and it's changing everything.\n\nThe numbers tell the story. East Africa has one of the youngest populations on Earth. Over 60% of Kenyans, Ugandans, and Tanzanians are under 25. Traditional education systems simply cannot keep pace with demand.\n\nEnter technology. Platforms like Eneza Education in Kenya, Eneza in Tanzania, and Bridge International Academies are delivering personalized learning to millions of children who would otherwise have limited access to quality education.\n\n"We're not replacing teachers," explains Neema Kimaro, EdTech researcher at the University of Dar es Salaam. "We're giving them superpowers. A single teacher with the right technology can deliver personalized instruction to every child in their classroom."\n\nThe results are measurable. Schools using EdTech platforms show 30-40% improvement in math and reading scores. Student attendance increases. Dropout rates decrease.\n\nBut the digital divide remains a barrier. In many rural areas, electricity is unreliable and internet connectivity is non-existent. Offline-first solutions are critical.\n\nOrganizations like Worldreader are addressing this with e-readers that work without internet, preloaded with thousands of books in local languages.`,
    excerpt: "How digital tools are bridging the education gap in rural East Africa's classrooms.",
    authorIndex: 11,
    categorySlug: "technology",
    tags: ["education", "digital", "east-africa", "innovation", "youth"],
    viewCount: 1540,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=400&fit=crop",
  },
  {
    title: "Zanzibar's Spice Tourism: Where History Meets Flavor",
    slug: "zanzibar-spice-tourism",
    content: `The Spice Island has lured traders for over two millennia. Today, Zanzibar's spice heritage is drawing a different kind of visitor — tourists seeking authentic cultural immersion.\n\nSpice tours have become Zanzibar's most popular tourist activity. Visitors are guided through lush plantations where clove, vanilla, cinnamon, nutmeg, and pepper grow in wild abundance.\n\n"Touch it, smell it, taste it," says guide Juma Mohammed, plucking a fresh clove from its branch. "This is what brought the Portuguese, the Arabs, the British. This tiny flower changed the world."\n\nThe economics are significant. Spice tourism generates over $15 million annually for local communities, providing sustainable income that doesn't depend on beach resorts.\n\nBeyond tours, Zanzibar's spice heritage is inspiring a culinary renaissance. Chefs on the island are blending traditional Swahili recipes with contemporary techniques, creating a food scene that rivals anywhere in East Africa.\n\nThe Spice Route restaurant in Stone Town serves dishes that tell the story of the island's multicultural past — each plate a chapter in a centuries-old narrative of trade, migration, and cultural exchange.`,
    excerpt: "How Zanzibar's ancient spice trade is inspiring a modern tourism and culinary revolution.",
    authorIndex: 8,
    categorySlug: "travel",
    tags: ["swahili", "safari", "east-africa", "culture", "innovation"],
    viewCount: 2340,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=800&h=400&fit=crop",
  },
  {
    title: "The Mental Health Revolution in East Africa",
    slug: "mental-health-east-africa",
    content: `For decades, mental health in East Africa was whispered about, if discussed at all. Depression was "laziness." Anxiety was "weakness." Seeking help meant admitting failure.\n\nThat silence is breaking.\n\nA new generation of mental health professionals, activists, and tech innovators is fundamentally changing how East Africans think about and access mental health care.\n\nIn Kenya, platforms like Keheala and Thalia Psychotherapy are making therapy accessible via mobile phones. In Uganda, the Butabika National Referral Hospital has partnered with international organizations to modernize its approach.\n\n"The stigma is still there," says Dr. Grace Akoth, a clinical psychologist based in Kisumu. "But it's shrinking. Young people are leading this change. They're talking about their mental health openly, and that's revolutionary."\n\nThe numbers justify the urgency. East Africa has fewer than one mental health professional per 100,000 people. Depression and anxiety affect millions, exacerbated by poverty, conflict, and the pressures of rapid urbanization.\n\nTechnology is bridging the gap. AI-powered chatbots offer basic mental health support. Teletherapy platforms connect urban therapists with rural patients. Peer support networks are proliferating on social media.\n\nThe challenge remains enormous, but the trajectory is clear: East Africa's mental health revolution has begun, and there's no turning back.`,
    excerpt: "How a new generation is breaking the silence around mental health in East Africa.",
    authorIndex: 9,
    categorySlug: "lifestyle",
    tags: ["health", "east-africa", "digital", "innovation", "youth"],
    viewCount: 1870,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1544027993-37dbfe43562a?w=800&h=400&fit=crop",
  },
  {
    title: "Blockchain Beyond Crypto: Real-World Applications in East Africa",
    slug: "blockchain-beyond-crypto-east-africa",
    content: `When most people hear "blockchain," they think cryptocurrency. But in East Africa, the technology is quietly transforming industries far removed from speculative trading.\n\nIn Kenya, BitPesa (now AZA Finance) uses blockchain to enable cross-border business payments, reducing transfer costs by up to 75%. In Rwanda, the government is piloting blockchain-based land registration to eliminate title fraud.\n\n"Africa leapfrogged fixed-line telephony with mobile phones," explains Peter Wanjiku, a blockchain developer in Nairobi. "We can leapfrog traditional banking and land registration with blockchain."\n\nAgriculture is a prime beneficiary. Blockchain platforms are enabling smallholder farmers to prove the provenance of their crops, access fair trade markets, and secure crop insurance without traditional paperwork.\n\nIn Tanzania, the blockchain startup Sun Exchange allows global investors to purchase solar cells and lease them to schools and businesses in rural Tanzania. The returns are paid in cryptocurrency, but the impact is real: clean energy for communities that need it most.\n\nChallenges persist. Regulatory uncertainty, limited technical expertise, and the association with cryptocurrency speculation all slow adoption. But the fundamentals are sound, and the use cases are multiplying.\n\nThe future of blockchain in East Africa is not about speculation. It's about building trust in systems that have historically been unreliable.`,
    excerpt: "How blockchain technology is solving real problems in East Africa beyond the cryptocurrency hype.",
    authorIndex: 12,
    categorySlug: "technology",
    tags: ["blockchain", "fintech", "innovation", "east-africa"],
    viewCount: 1430,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=400&fit=crop",
  },
  {
    title: "The Marathon Capital: Eldoret's Running Economy",
    slug: "eldoret-marathon-capital",
    content: `At dawn, the red dust roads of Eldoret are already alive with runners. In this Kenyan highland city, running isn't a hobby — it's a way of life, an economic engine, and a source of profound community pride.\n\nEldoret sits at 2,100 meters above sea level, in the Rift Valley — the altitude training ground that has produced more world-class distance runners than anywhere else on Earth. The numbers are staggering: runners from the Nandi and Kalenjin communities have won over half of all Olympic medals in distance events.\n\n"I run because my father ran, and his father before him," says 24-year-old Kipchumba Korir, who trains with a group of 30 runners near the Kamariny Stadium. "Running is in our blood."\n\nBut running is also an economy. Training camps, sports tourism, shoe deals, and sponsorship agreements generate millions of dollars annually. Running agents have become power brokers, and the sport has created a middle class in a region that had few economic opportunities.\n\nThe rise of marathon tourism has added another dimension. International runners flock to Eldoret and neighboring Iten to train at altitude, creating demand for accommodation, physiotherapy, and coaching services.\n\nThe challenge is sustainability. As competition intensifies and doping scandals threaten the sport's integrity, Eldoret's running community must navigate the tension between tradition and the pressures of modern professional athletics.`,
    excerpt: "Inside the Kenyan highland city that produces more world champions than anywhere else on Earth.",
    authorIndex: 3,
    categorySlug: "sports",
    tags: ["east-africa", "athletics", "nairobi", "entrepreneur"],
    viewCount: 3780,
    featured: true,
    coverImage: "https://images.unsplash.com/photo-1461896836934-bd45ba8fcf9b?w=800&h=400&fit=crop",
  },
  {
    title: "Nollywood Goes East: How Nigerian Film is Conquering East Africa",
    slug: "nollywood-goes-east",
    content: `Every evening at 7pm, across living rooms from Nairobi to Kampala, televisions flicker to life with the unmistakable sound of Nollywood. The Nigerian film industry, the world's second-largest by volume, has found a passionate new audience in East Africa.\n\nThe numbers are remarkable. Nollywood content accounts for over 40% of video-on-demand viewing in Kenya and Uganda. Streaming platforms like Showmax and Netflix have invested heavily in Nigerian content, knowing it performs exceptionally well across the continent.\n\n"Why does Nollywood resonate?" asks Amina Juma, a film critic based in Nairobi. "Because it tells African stories. We see ourselves on screen — our families, our struggles, our triumphs. Hollywood doesn't do that."\n\nThe cross-pollination is creating something new. East African filmmakers are adopting Nollywood's production models — faster turnaround, lower budgets, audience-first storytelling — while incorporating their own cultural perspectives.\n\nKenyan productions like "Sense8" and "Country Queen" have shown that East African stories can achieve international quality while maintaining local authenticity.\n\nThe streaming revolution has accelerated this convergence. A Kenyan viewer can now seamlessly switch between a Lagos-produced drama, a Nairobi-based thriller, and a Kampala comedy. African content is becoming a unified market.\n\nThis isn't just entertainment. It's cultural diplomacy, building bridges across a continent of 1.4 billion people.`,
    excerpt: "How Nigeria's film industry is reshaping entertainment culture across East Africa.",
    authorIndex: 13,
    categorySlug: "culture",
    tags: ["nollywood", "east-africa", "culture", "digital", "youth"],
    viewCount: 2010,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&h=400&fit=crop",
  },
  {
    title: "The Great Rift Valley: East Africa's Renewable Energy Frontier",
    slug: "rift-valley-renewable-energy",
    content: `The Great Rift Valley is famous for its dramatic landscapes and abundant wildlife. But beneath its volcanic soil lies another treasure: some of the most concentrated renewable energy resources on the planet.\n\nKenya's Olkaria geothermal complex, nestled in the floor of the Rift Valley, is Africa's largest geothermal installation. It generates over 800MW of electricity — enough to power a small country.\n\n"We're sitting on a goldmine," says James Odhiambo, a renewable energy journalist. "Literally. The heat beneath our feet can power our cities, our schools, our hospitals."\n\nGeothermal is just the beginning. The Rift Valley's consistent wind patterns have attracted massive wind farm investments. The Lake Turkana Wind Power project, the largest in Africa, generates 310MW from 365 turbines.\n\nSolar energy is booming across the region. Falling panel costs and innovative financing models are making solar accessible to communities that have never had electricity.\n\nThe economic impact is transformative. Renewable energy projects create jobs, reduce dependence on expensive fossil fuel imports, and provide reliable power for businesses.\n\nBut the transition isn't without challenges. Grid infrastructure needs upgrading. Land disputes complicate project development. And the communities that host these installations must see tangible benefits.\n\nThe Rift Valley's energy revolution is a microcosm of Africa's broader opportunity: to build a clean energy future that powers prosperity while protecting the environment.`,
    excerpt: "How the Great Rift Valley became Africa's most promising renewable energy corridor.",
    authorIndex: 10,
    categorySlug: "technology",
    tags: ["renewable", "climate", "innovation", "east-africa"],
    viewCount: 1680,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&h=400&fit=crop",
  },
  {
    title: "The Coffee Renaissance: Why East African Beans Are World-Class",
    slug: "coffee-renaissance-east-africa",
    content: `In the misty highlands of central Kenya, where red volcanic soil meets equatorial sun, some of the world's most prized coffee beans are grown. But for decades, East African coffee was exported raw, with the value added elsewhere.\n\nThat's changing. A new wave of specialty coffee roasters, baristas, and entrepreneurs across East Africa are keeping the value chain local.\n\nIn Nairobi, coffee shops like Kin Tea and Story Coffee have become cultural hubs, serving single-origin Kenyan beans roasted to perfection. In Kampala, Endiro Coffee is building a chain that sources exclusively from Ugandan smallholders.\n\n"We grow some of the best coffee in the world," says a Nyeri coffee farmer. "But we were always selling green beans to Europe. Now my children can drink coffee I grew, roasted just 50 kilometers from here."\n\nThe specialty coffee movement is driving premiums. While commodity coffee trades at around $1 per pound, East African specialty lots regularly fetch $5-15 per pound at auction.\n\nTechnology is enabling the transformation. Apps like Twiga Foods connect farmers directly with cafes and restaurants, cutting out middlemen. Blockchain platforms are verifying origin and quality, building consumer trust.\n\nThe renaissance extends beyond Kenya. Rwandan specialty coffee has won international awards. Ethiopian single-origins command premium prices. Tanzanian peaberry is gaining recognition.\n\nEast African coffee is coming home.`,
    excerpt: "How East African coffee producers are reclaiming the value chain from bean to cup.",
    authorIndex: 2,
    categorySlug: "business",
    tags: ["entrepreneur", "east-africa", "innovation", "digital"],
    viewCount: 1920,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800&h=400&fit=crop",
  },
  {
    title: "Ocean Guardians: Marine Conservation Along the Swahili Coast",
    slug: "ocean-guardians-swahili-coast",
    content: `The waters off the Kenyan and Tanzanian coast teem with life — coral reefs, sea turtles, dolphins, and hundreds of fish species. But this biodiversity is under threat from climate change, overfishing, and coastal development.\n\nA network of marine conservation organizations, community groups, and government agencies is fighting to protect these vital ecosystems.\n\nAt the Watamu Marine National Park, Ibrahim Osman leads a team of marine biologists monitoring coral health. "The bleaching events are becoming more frequent," he explains. "We're racing against time to understand and protect these ecosystems."\n\nCommunity-based conservation is proving most effective. In the village of Kuruwitu, local fishers established one of Kenya's first community marine conservancies. The results have been remarkable — fish stocks have increased, and tourism revenue has risen.\n\nThe blue economy is a growing priority. East Africa's 4,600-kilometer coastline offers enormous potential for sustainable fisheries, marine tourism, and even offshore energy.\n\nTechnology is playing an increasingly important role. Underwater drones map reef systems. Satellite monitoring tracks illegal fishing vessels. DNA analysis helps identify poached species.\n\nThe challenges are immense. Rising sea temperatures, ocean acidification, and plastic pollution threaten the very foundations of marine ecosystems. But the guardians of the Swahili coast are determined.`,
    excerpt: "Meet the scientists and communities protecting East Africa's precious marine ecosystems.",
    authorIndex: 8,
    categorySlug: "lifestyle",
    tags: ["ocean", "east-africa", "climate", "wildlife", "innovation"],
    viewCount: 1340,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=800&h=400&fit=crop",
  },
  {
    title: "The Bongo Flava Phenomenon: Tanzania's Musical Gift to Africa",
    slug: "bongo-flava-phenomenon",
    content: `Bongo Flava is more than a music genre. It's the sound of Tanzania — a vibrant fusion of hip-hop, R&B, traditional taarab, and dancehall that has become one of Africa's most distinctive musical exports.\n\nThe name itself tells the story. "Bongo" is Swahili slang for "brain" or "cleverness," while "Flava" is the stylistic twist. Together, they represent the ingenuity and creativity of Dar es Salaam's music scene.\n\nArtists like Diamond Platnumz, Alikiba, and Zuchu have taken Bongo Flava from the streets of Dar to the global stage. Diamond's WCB Wasafi label has become one of Africa's most successful music brands, with artists dominating charts across the continent.\n\nWhat makes Bongo Flava unique is its rootedness in Swahili language and culture. Unlike much of West African music, which uses English or local languages, Bongo Flava is proudly Swahili.\n\nThe production quality has risen dramatically. Studios in Dar es Salaam now rival those in Lagos and Johannesburg. Young producers are blending traditional instruments — the nyatiti, the orutu, the orambba — with modern beats.\n\nThe economics are significant. Music tourism, concert promotion, and merchandise are creating an ecosystem that supports thousands of young people.\n\nBongo Flava is Tanzania's gift to Africa — and the continent is listening.`,
    excerpt: "How Tanzania's distinctive music genre became one of Africa's most powerful cultural exports.",
    authorIndex: 5,
    categorySlug: "music",
    tags: ["bongo-flava", "afrobeats", "east-africa", "culture", "youth"],
    viewCount: 2760,
    featured: false,
    coverImage: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&h=400&fit=crop",
  },
];

const COMMENTS = [
  { text: "This is an incredible piece! Really captures the energy of what's happening on the ground.", authorIdx: 1, postIdx: 0 },
  { text: "As a tech worker in Nairobi, I can confirm every word. The scene here is electric.", authorIdx: 2, postIdx: 0 },
  { text: "Beautifully written. The cultural significance of ugali cannot be overstated.", authorIdx: 8, postIdx: 1 },
  { text: "My grandmother would love this article. She still makes ugali the traditional way.", authorIdx: 9, postIdx: 1 },
  { text: "The bodaboda economy is truly the backbone of our cities. Great reporting.", authorIdx: 0, postIdx: 2 },
  { text: "I switched from banking to bodaboda riding. Best decision I ever made.", authorIdx: 6, postIdx: 2 },
  { text: "Gengetone gets too much hate. This article explains why it matters.", authorIdx: 4, postIdx: 3 },
  { text: "The sound of Nairobi! Love seeing this genre get the recognition it deserves.", authorIdx: 10, postIdx: 3 },
  { text: "Sustainable safari is the only way forward. Great to see community-led initiatives.", authorIdx: 11, postIdx: 4 },
  { text: "Visited a community conservancy in Laikipia last year. Life-changing experience.", authorIdx: 13, postIdx: 4 },
  { text: "SACCOs changed my life. Got a loan to start my business and never looked back.", authorIdx: 7, postIdx: 5 },
  { text: "The matatu art tradition is so underrated. These are rolling masterpieces!", authorIdx: 5, postIdx: 6 },
  { text: "Every matatu has a personality. You just captured it perfectly.", authorIdx: 13, postIdx: 6 },
  { text: "Kigali is honestly the cleanest city I've ever visited. Rwanda is doing it right.", authorIdx: 0, postIdx: 7 },
  { text: "The Lamu food scene is magical. Pilau from my grandmother's kitchen is still the benchmark.", authorIdx: 2, postIdx: 8 },
  { text: "Climate activism by young Africans needs more global attention. Powerful article.", authorIdx: 6, postIdx: 9 },
  { text: "The basketball courts in every Nairobi estate are full now. Change is coming.", authorIdx: 14, postIdx: 10 },
  { text: "EdTech platforms are a game-changer for rural schools. So proud of this work.", authorIdx: 3, postIdx: 11 },
  { text: "Zanzibar spice tours are incredible. Every tourist should try one.", authorIdx: 12, postIdx: 12 },
  { text: "Mental health stigma is real but slowly breaking. Thank you for this piece.", authorIdx: 4, postIdx: 13 },
  { text: "Blockchain is about so much more than crypto. This proves it.", authorIdx: 8, postIdx: 14 },
  { text: "Eldoret running culture is something else. The altitude, the commitment, the community.", authorIdx: 10, postIdx: 15 },
  { text: "Nollywood is truly conquering East Africa! Our screens are full of Nigerian stories.", authorIdx: 7, postIdx: 16 },
  { text: "Geothermal energy in the Rift Valley is the future. Kenya leading the way.", authorIdx: 12, postIdx: 17 },
  { text: "Specialty coffee from East Africa is world-class. About time we kept the value local.", authorIdx: 11, postIdx: 18 },
  { text: "Marine conservation along the coast is critical. Beautiful work by the teams there.", authorIdx: 14, postIdx: 19 },
  { text: "Diamond Platnumz put Tanzania on the map. Bongo Flava is here to stay.", authorIdx: 0, postIdx: 20 },
];

const FOLLOWS: [number, number][] = [
  [0, 1], [0, 2], [0, 5], [0, 10],
  [1, 0], [1, 4], [1, 13],
  [2, 0], [2, 3], [2, 12],
  [3, 0], [3, 14],
  [4, 1], [4, 8], [4, 9],
  [5, 0], [5, 6], [5, 13],
  [6, 0], [6, 1],
  [7, 0], [7, 4], [7, 8],
  [8, 4], [8, 14],
  [9, 0], [9, 4], [9, 11],
  [10, 0], [10, 11],
  [11, 0], [11, 10],
  [12, 0], [12, 2],
  [13, 5], [13, 1],
  [14, 8], [14, 3],
];

const NOTIFICATIONS = [
  { userIdx: 0, actorIdx: 1, type: "FOLLOW", title: "New follower", message: "Kwame Asante started following you." },
  { userIdx: 0, actorIdx: 2, type: "COMMENT", title: "New comment", message: "Fatima Hassan commented on your post.", postIdx: 0 },
  { userIdx: 1, actorIdx: 0, type: "FOLLOW", title: "New follower", message: "Amara Ochieng started following you." },
  { userIdx: 3, actorIdx: 0, type: "FOLLOW", title: "New follower", message: "Amara Ochieng started following you." },
  { userIdx: 4, actorIdx: 8, type: "FOLLOW", title: "New follower", message: "Ibrahim Osman started following you." },
  { userIdx: 5, actorIdx: 0, type: "FOLLOW", title: "New follower", message: "Amara Ochieng started following you." },
  { userIdx: 0, actorIdx: 6, type: "COMMENT", title: "New comment", message: "Admin commented on your post.", postIdx: 0 },
  { userIdx: 3, actorIdx: 10, type: "COMMENT", title: "New comment", message: "James Odhiambo commented on your post.", postIdx: 15 },
  { userIdx: 5, actorIdx: 13, type: "MODERATION_APPROVED", title: "Post approved", message: "Your post has been approved and published." },
  { userIdx: 2, actorIdx: 12, type: "FOLLOW", title: "New follower", message: "Peter Wanjiku started following you." },
  { userIdx: 8, actorIdx: 4, type: "FOLLOW", title: "New follower", message: "Zainab Mohamed started following you." },
  { userIdx: 10, actorIdx: 0, type: "FOLLOW", title: "New follower", message: "Amara Ochieng started following you." },
];

async function main() {
  console.log("🌱 Seeding connectPlus database...\n");

  await prisma.notification.deleteMany();
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

  console.log("📁 Creating categories...");
  const categories: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    const created = await prisma.category.create({ data: cat });
    categories[cat.slug] = created.id;
  }

  console.log("🏷️  Creating tags...");
  const tagIds: Record<string, string> = {};
  for (const tagName of TAGS) {
    const created = await prisma.tag.create({
      data: { name: tagName, slug: tagName.toLowerCase().replace(/\s+/g, "-") },
    });
    tagIds[tagName] = created.id;
  }

  console.log("👤 Creating users...");
  const defaultPassword = await hash("Password123!", 12);
  const adminPassword = await hash("Mtemi@254#", 12);
  const userIds: string[] = [];
  for (const user of USERS) {
    const created = await prisma.user.create({
      data: {
        name: user.name,
        username: user.username,
        email: user.email,
        bio: user.bio,
        role: user.role,
        node: user.node,
        avatar: user.avatar,
        password: user.role === "ADMIN" ? adminPassword : defaultPassword,
        // Seeded accounts skip onboarding — emails are considered confirmed.
        emailVerified: new Date(),
        isVerified: user.role === "CREATOR" || user.role === "ADMIN" || user.role === "SUPER_ADMIN",
      },
    });
    userIds.push(created.id);
    console.log(`   ✓ ${user.name} (${user.username})`);
  }

  console.log("\n📝 Creating posts...");
  const postIds: string[] = [];
  for (const post of POSTS) {
    const tagConnections = post.tags.map((t) => ({ id: tagIds[t] })).filter((t) => t.id);
    const created = await prisma.post.create({
      data: {
        title: post.title,
        slug: post.slug,
        content: post.content,
        excerpt: post.excerpt,
        authorId: userIds[post.authorIndex]!,
        categoryId: categories[post.categorySlug]!,
        tags: { connect: tagConnections },
        viewCount: post.viewCount,
        featured: post.featured,
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        publishedAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000),
        coverImage: post.coverImage,
      },
    });
    postIds.push(created.id);
    console.log(`   ✓ ${post.title.slice(0, 60)}...`);
  }

  console.log("\n💬 Creating comments...");
  const commentData = COMMENTS
    .filter((c) => postIds[c.postIdx])
    .map((c) => ({
      content: c.text,
      authorId: userIds[c.authorIdx]!,
      postId: postIds[c.postIdx]!,
    }));
  await prisma.comment.createMany({ data: commentData });
  console.log(`   ✓ ${commentData.length} comments created`);

  const allPosts = await prisma.post.findMany({ select: { id: true } });

  console.log("\n❤️  Creating likes...");
  const likeData: { userId: string; postId: string }[] = [];
  for (let i = 0; i < USERS.length; i++) {
    const numLikes = 3 + Math.floor(Math.random() * 10);
    const liked = new Set<number>();
    for (let j = 0; j < numLikes; j++) {
      const postIdx = Math.floor(Math.random() * allPosts.length);
      if (!liked.has(postIdx)) {
        liked.add(postIdx);
        likeData.push({ userId: userIds[i]!, postId: allPosts[postIdx]!.id });
      }
    }
  }
  await prisma.like.createMany({ data: likeData });
  console.log(`   ✓ ${likeData.length} likes created`);

  console.log("\n🔗 Creating follows...");
  const followData: { followerId: string; followingId: string }[] = [];
  for (const [followerIdx, followingIdx] of FOLLOWS) {
    if (followerIdx !== followingIdx) {
      followData.push({ followerId: userIds[followerIdx]!, followingId: userIds[followingIdx]! });
    }
  }
  await prisma.follow.createMany({ data: followData, skipDuplicates: true });

  // Batch update follower/following counts
  const followCounts: Record<string, { followers: number; following: number }> = {};
  for (const f of followData) {
    if (!followCounts[f.followerId]) followCounts[f.followerId] = { followers: 0, following: 0 };
    if (!followCounts[f.followingId]) followCounts[f.followingId] = { followers: 0, following: 0 };
    followCounts[f.followerId]!.following++;
    followCounts[f.followingId]!.followers++;
  }
  for (const [uid, counts] of Object.entries(followCounts)) {
    await prisma.user.update({ where: { id: uid }, data: { followersCount: counts.followers, followingCount: counts.following } });
  }
  console.log(`   ✓ ${followData.length} follows created`);

  console.log("\n🔔 Creating notifications...");
  const notifData = NOTIFICATIONS.map((n) => ({
    userId: userIds[n.userIdx]!,
    actorId: userIds[n.actorIdx]!,
    type: n.type,
    title: n.title,
    message: n.message,
    postId: n.postIdx !== undefined ? postIds[n.postIdx] : undefined,
    read: Math.random() > 0.5,
  }));
  await prisma.notification.createMany({ data: notifData });
  console.log(`   ✓ ${notifData.length} notifications created`);

  console.log("\n📊 Creating analytics data...");
  const cities = ["Nairobi", "Kampala", "Dar es Salaam", "Kigali", "Mombasa", "Eldoret", "Kisumu", "Addis Ababa"];
  const countries = ["Kenya", "Uganda", "Tanzania", "Rwanda", "Kenya", "Kenya", "Kenya", "Ethiopia"];
  const viewData = [];
  for (let day = 0; day < 30; day++) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    const viewsPerDay = Math.floor(Math.random() * 80) + 30;
    for (let v = 0; v < viewsPerDay; v++) {
      const cityIdx = Math.floor(Math.random() * cities.length);
      viewData.push({
        postId: allPosts[Math.floor(Math.random() * allPosts.length)]!.id,
        path: "/",
        city: cities[cityIdx],
        country: countries[cityIdx],
        createdAt: date,
      });
    }
  }
  await prisma.pageView.createMany({ data: viewData });
  console.log(`   ✓ ${viewData.length} page views created`);

  console.log("\n🔍 Creating moderation queue...");
  await prisma.post.create({
    data: {
      title: "Why I Think Matatus Should Be Replaced Completely",
      slug: "replace-matatus-opinion",
      content: "This is a controversial opinion piece that challenges the status quo...",
      excerpt: "A provocative take on Nairobi's transport future.",
      authorId: userIds[7]!,
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
      authorId: userIds[8]!,
      status: "PUBLISHED",
      moderationStatus: "FLAGGED",
    },
  });
  console.log("   ✓ 2 moderation queue posts created");

  console.log("\n📡 Creating RSS feeds...");
  const rssFeeds = [
    { name: "BBC Africa", url: "http://feeds.bbci.co.uk/news/world/africa/rss.xml", siteUrl: "https://bbc.co.uk/africa", description: "BBC Africa News", category: "News" },
    { name: "TechCabal", url: "https://techcabal.com/feed/", siteUrl: "https://techcabal.com", description: "Africa's leading tech publication", category: "Technology" },
    { name: "Disrupt Africa", url: "https://disrupt-africa.com/feed/", siteUrl: "https://disrupt-africa.com", description: "African tech startup news", category: "Technology" },
    { name: "Nairobi Wire", url: "https://nairobiwire.com/feed/", siteUrl: "https://nairobiwire.com", description: "Nairobi's digital newsroom", category: "News" },
    { name: "KBC Kenya", url: "https://www.kbc.co.ke/feed/", siteUrl: "https://www.kbc.co.ke", description: "Kenya Broadcasting Corporation", category: "News" },
    { name: "Ghafla Kenya", url: "https://www.ghafla.co.ke/feed/", siteUrl: "https://www.ghafla.co.ke", description: "Kenyan entertainment news", category: "Entertainment" },
    { name: "Michuzi Blog (TZ)", url: "https://michuzijr.blogspot.com/feeds/posts/default", siteUrl: "https://michuzijr.blogspot.com", description: "Tanzania's leading news blog", category: "News" },
    { name: "Nile Post Uganda", url: "https://nilepost.co.ug/feed/", siteUrl: "https://nilepost.co.ug", description: "Ugandan news and analysis", category: "News" },
    { name: "SoftPower Uganda", url: "https://softpower.ug/feed/", siteUrl: "https://softpower.ug", description: "Ugandan journalism", category: "News" },
    { name: "Independent Uganda", url: "https://www.independent.co.ug/feed/", siteUrl: "https://www.independent.co.ug", description: "Ugandan independent journalism", category: "News" },
    { name: "PML Daily Uganda", url: "https://www.pmldaily.com/feed", siteUrl: "https://www.pmldaily.com", description: "Uganda news daily", category: "News" },
  ];

  for (const feed of rssFeeds) {
    await prisma.rssFeed.create({ data: feed });
  }
  console.log(`   ✓ ${rssFeeds.length} RSS feeds created`);

  console.log("\n🧠 Seeding the Neural Mind (hive knowledge base)...");
  const seededMemories = await seedNeuralMind(prisma);
  console.log(`   ✓ ${seededMemories} knowledge memories seeded (topics, entities, intent maps, lessons)`);

  console.log("\n✅ Seed completed successfully!");
  console.log(`   ${USERS.length} users (with avatars)`);
  console.log(`   ${POSTS.length + 2} posts (with cover images)`);
  console.log(`   ${CATEGORIES.length} categories`);
  console.log(`   ${TAGS.length} tags`);
  console.log(`   ${COMMENTS.length} comments`);
  console.log(`   ${likeData.length} likes`);
  console.log(`   ${followData.length} follows`);
  console.log(`   ${NOTIFICATIONS.length} notifications`);
  console.log(`   ${rssFeeds.length} RSS feeds`);
  console.log(`   ${viewData.length} analytics page views`);
  console.log("\n   Default password: Password123! | Admin: Mtemi@254#");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
