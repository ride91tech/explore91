import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
export const TOKEN_KEY = "explore91.session_token";

let inMemoryToken: string | null = null;

export async function setToken(token: string | null) {
  inMemoryToken = token;
  if (token) await storage.secureSet(TOKEN_KEY, token);
  else await storage.secureRemove(TOKEN_KEY);
}

export async function loadToken(): Promise<string | null> {
  if (inMemoryToken) return inMemoryToken;
  const t = await storage.secureGet<string>(TOKEN_KEY, "" as string);
  inMemoryToken = t && t.length > 0 ? t : null;
  return inMemoryToken;
}

export type FetchOptions = RequestInit & { auth?: boolean };

export async function api<T = any>(path: string, opts: FetchOptions = {}): Promise<T> {
  const url = `${BASE}/api${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (opts.auth) {
    const t = await loadToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {}
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as any;
  return res.json();
}

// Typed helpers -----------------------------------------------------------
export type Business = {
  business_id: string;
  name: string;
  category: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  cover_image: string;
  gallery: string[];
  rating: number;
  review_count: number;
  price_range: string;
  tags: string[];
  description: string;
  open_hours: string;
  phone: string;
  is_featured: boolean;
  offers: string[];
  menu: { name: string; price: number; image?: string }[];
  services: { name: string; duration: string; price: number }[];
  booking_type: string;
};

export type UserT = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  wallet_points: number;
  home_city: string;
  roles?: string[];
};

export type Booking = {
  booking_id: string;
  business_id: string;
  business_name: string;
  business_image: string;
  date: string;
  time: string;
  guests: number;
  service_name?: string | null;
  status: string;
  notes?: string;
  created_at: string;
};

export type CategoryT = { slug: string; name: string; icon: string };
export type CityT = { slug: string; name: string; tagline: string; image: string };

export type ReelT = {
  reel_id: string;
  business_id?: string | null;
  business_name?: string | null;
  business_category?: string | null;
  city: string;
  video_url: string;
  cover_image: string;
  caption: string;
  author: string;
  likes: number;
  views: number;
  created_at: string;
};
