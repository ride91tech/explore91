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

async function request(path: string, opts: FetchOptions = {}): Promise<Response> {
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
  return res;
}

export async function api<T = any>(path: string, opts: FetchOptions = {}): Promise<T> {
  const res = await request(path, opts);
  if (res.status === 204) return undefined as any;
  return res.json();
}

export type Paged<T> = { rows: T[]; total: number };

/** List endpoints return rows in the body and the unfiltered total in a header,
 *  so the UI can say "showing 50 of 1,284" instead of silently truncating. */
export async function apiPaged<T = any>(
  path: string,
  opts: FetchOptions = {}
): Promise<Paged<T>> {
  const res = await request(path, opts);
  const rows = (await res.json()) as T[];
  const header = res.headers.get("X-Total-Count");
  return { rows, total: header ? parseInt(header, 10) : rows.length };
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
  amount_inr: number;
  amount_source: "service" | "estimate";
  created_at: string;
};

export type CategoryT = { slug: string; name: string; icon: string };
export type CityT = {
  slug: string;
  name: string;
  tagline: string;
  image: string;
  state?: string;
  region?: string;
  /** Content counts and liveness come from /cities/grouped only, and are
   *  absent until the backend carrying them is deployed. Treat an undefined
   *  `is_live` as live, so the picker never hides cities against an older API. */
  business_count?: number;
  reel_count?: number;
  is_live?: boolean;
};

export type CityGroupT = { region: string; cities: CityT[] };

/** Journey coverage. States and union territories are counted apart: the
 *  percentage is over India's 28 states, so a union-territory-only trip is
 *  honestly 0% rather than being rounded up. */
export type JourneyT = {
  cities: number;
  states: number;
  states_total: number;
  union_territories: number;
  union_territories_total: number;
  india_percent: number;
  visited: {
    city_slug: string;
    name: string;
    state: string;
    visited_at: string;
  }[];
};

/** What sits where a booking button would. "interested" is the bucket list,
 *  "visited" also fills in the journey map. */
export type InterestStatus = "interested" | "going" | "visited";

export type InterestPlace = Business & {
  interest_status: InterestStatus;
  interest_at: string;
};

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
