import { getCocoModelUpstreamUrl } from "@/lib/coco-model";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const upstreamUrl = getCocoModelUpstreamUrl(file);
  if (!upstreamUrl) return Response.json({ error: "Model file not found" }, { status: 404 });

  try {
    const upstream = await fetch(upstreamUrl, { cache: "force-cache" });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "Device model is temporarily unavailable" }, { status: 502 });
    }

    const headers = new Headers({
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": file === "model.json" ? "application/json" : "application/octet-stream",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("COCO model proxy failed:", error);
    return Response.json({ error: "Device model is temporarily unavailable" }, { status: 502 });
  }
}
