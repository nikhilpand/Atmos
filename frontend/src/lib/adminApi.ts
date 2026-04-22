/**
 * ATMOS Admin API — Centralized admin API client with HMAC token auth.
 * All admin pages import from here instead of rolling their own fetch calls.
 */

const API_BASE = process.env.NEXT_PUBLIC_CONTROL_URL || "https://nikhil1776-gdrivefwd.hf.space";

/** Get the stored admin session token */
export function getToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("atmos_admin_token") || localStorage.getItem("atmos_admin_token") || "";
}

/** Store the admin session token */
export function setToken(token: string) {
  sessionStorage.setItem("atmos_admin_token", token);
  localStorage.setItem("atmos_admin_token", token);
}

/** Clear the admin session */
export function clearToken() {
  sessionStorage.removeItem("atmos_admin_token");
  localStorage.removeItem("atmos_admin_token");
  localStorage.removeItem("atmos_admin_auth");
}

/** Check if we have a stored token */
export function isAuthenticated(): boolean {
  return !!getToken();
}

/** Build auth headers */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Generic admin GET */
export async function adminGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Generic admin POST */
export async function adminPost<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Login and store token */
export async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.token) {
      setToken(data.token);
      localStorage.setItem("atmos_admin_auth", "true");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Public (no auth) GET */
export async function publicGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export { API_BASE };
