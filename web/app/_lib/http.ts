import { NextResponse } from "next/server";

/**
 * Permissive CORS for the sync API. Safe here because auth is a Bearer JWT, NOT
 * cookies — there are no ambient credentials to protect, so `*` exposes nothing a
 * caller couldn't get by sending the token itself. The Tauri webview (origin
 * `tauri://localhost` / `https://tauri.localhost`) and the browser both call these.
 */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS });
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}
