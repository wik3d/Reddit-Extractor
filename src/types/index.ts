export interface proxyType {
    protocol: string;
    host: string;
    port: number;
    auth?: { username: string, password: string };
}

export interface Post {
    ok: boolean;
    author: string | null;
    subreddit: string;
    title?: string;
    description?: string | null;
    media?: Media[] | null;
    externalUrl?: string | null;
    upVotes: number;
    downVotes: number;
    comments: number;
    isOver18: boolean;
    postedAt: Date;
    id: string;
    subreddit_id: string;
}

export interface Media {
    type: 'image' | 'video' | 'gif';
    buffer: Buffer;
}