export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string;
  username?: string;
  avatar?: string | null;
}

export interface PostWithAuthor {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt?: string | null;
  coverImage?: string | null;
  viewCount: number;
  status: string;
  featured: boolean;
  moderationStatus: string;
  source?: string | null;
  sourceUrl?: string | null;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authorId: string;
  author: {
    id: string;
    name: string | null;
    username: string;
    avatar: string | null;
  };
  category?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  tags: {
    id: string;
    name: string;
    slug: string;
  }[];
  _count?: {
    comments: number;
    likes: number;
  };
}

export interface AdminStats {
  totalUsers: number;
  totalPosts: number;
  totalComments: number;
  totalViews: number;
  pendingModeration: number;
  usersThisWeek: number;
  postsThisWeek: number;
  activeNodes: number;
  regionalBreakdown: Record<string, { users: number; posts: number }>;
}

export interface TrendData {
  date: string;
  views: number;
  users: number;
  posts: number;
}

export interface ModerationQueueItem {
  id: string;
  title: string;
  content: string;
  author: {
    id: string;
    name: string | null;
    username: string;
    avatar: string | null;
  };
  createdAt: Date;
  moderationStatus: string;
  aiFlags?: string | null;
  aiScore?: number | null;
}
